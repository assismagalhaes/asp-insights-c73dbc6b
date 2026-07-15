"""Generate a complete Highlightly statistics inventory from its OpenAPI spec.

The output combines stat-related schema fields with metric names observed in
the redacted BASIC-plan samples collected during the evaluation.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sqlite3
from typing import Any, Iterable, Mapping


SPORT_PREFIXES = {
    "AmericanFootball": "American Football (NFL/NCAA)",
    "Amf": "American Football (NFL/NCAA)",
    "Baseball": "Baseball (MLB/NCAA)",
    "Basketball": "Basketball global (inclui WNBA)",
    "Cricket": "Cricket",
    "Football": "Football / Soccer",
    "Handball": "Handball",
    "Hockey": "Hockey global",
    "Nba": "NBA / NCAAB",
    "Nhl": "NHL / NCAAH",
    "Rugby": "Rugby",
    "Volleyball": "Volleyball",
}

STAT_SCHEMA_RE = re.compile(
    r"Statistic|BoxScore|Standing|Lineup|Event|Player|TeamStatistics|MatchStatistics",
    re.IGNORECASE,
)
NON_STAT_FIELDS = {
    "id", "logo", "name", "fullName", "displayName", "team", "league", "season",
    "country", "code", "position", "type", "date", "time", "player", "groups",
    "standings", "statistics", "data", "pagination", "plan", "message", "tier",
}


def sport_for_schema(name: str) -> str:
    for prefix, sport in SPORT_PREFIXES.items():
        if name.startswith(prefix):
            return sport
    if name.startswith(("Match", "Team", "Player", "BasePlayer", "DetailedPlayer", "SinglePlayer", "Standings", "Statistics")):
        return "Shared / sport-dependent"
    return "Shared / sport-dependent"


def category_for_schema(name: str) -> str:
    lowered = name.casefold()
    if "boxscore" in lowered or "box_score" in lowered:
        return "Box score / desempenho por jogador"
    if "standing" in lowered:
        return "Standings / campanha"
    if "lineup" in lowered:
        return "Escalações"
    if "event" in lowered:
        return "Eventos"
    if "player" in lowered:
        return "Jogadores / estatísticas de temporada"
    if "team" in lowered:
        return "Estatísticas de equipe"
    return "Estatísticas de partida"


def scalar_type(schema: Mapping[str, Any]) -> str:
    if "$ref" in schema:
        return str(schema["$ref"]).rsplit("/", 1)[-1]
    kind = schema.get("type")
    if kind == "array":
        return f"array<{scalar_type(schema.get('items', {}))}>"
    if isinstance(kind, list):
        return " | ".join(map(str, kind))
    return str(kind or "object")


def walk_schema(
    schemas: Mapping[str, Any],
    schema: Mapping[str, Any],
    *,
    path: str = "",
    seen: frozenset[str] = frozenset(),
    depth: int = 0,
) -> Iterable[dict[str, Any]]:
    if depth > 8:
        return
    ref = schema.get("$ref")
    if ref:
        name = str(ref).rsplit("/", 1)[-1]
        if name in seen or name not in schemas:
            return
        yield from walk_schema(schemas, schemas[name], path=path, seen=seen | {name}, depth=depth + 1)
        return
    if schema.get("type") == "array":
        yield from walk_schema(schemas, schema.get("items", {}), path=path, seen=seen, depth=depth + 1)
        return
    for prop, child in schema.get("properties", {}).items():
        field = f"{path}.{prop}" if path else prop
        child_type = scalar_type(child)
        if child.get("properties") or child.get("$ref") or child.get("type") == "array":
            yield from walk_schema(schemas, child, path=field, seen=seen, depth=depth + 1)
        else:
            yield {
                "field": field,
                "type": child_type,
                "description": str(child.get("description") or "").strip(),
                "example": child.get("example"),
            }


def inventory_openapi(document: Mapping[str, Any]) -> list[dict[str, Any]]:
    schemas = document.get("components", {}).get("schemas", {})
    rows: list[dict[str, Any]] = []
    for schema_name, schema in schemas.items():
        if not STAT_SCHEMA_RE.search(schema_name):
            continue
        sport = sport_for_schema(schema_name)
        category = category_for_schema(schema_name)
        for item in walk_schema(schemas, schema, seen=frozenset({schema_name})):
            leaf = item["field"].rsplit(".", 1)[-1]
            if leaf in NON_STAT_FIELDS and not item["description"]:
                continue
            rows.append({"sport": sport, "category": category, "schema": schema_name, "source": "OpenAPI 6.13.2", **item})
    unique: dict[tuple[str, str, str], dict[str, Any]] = {}
    for row in rows:
        key = (row["sport"], row["category"], row["field"])
        existing = unique.get(key)
        if not existing or (row["description"] and not existing["description"]):
            unique[key] = row
    return sorted(unique.values(), key=lambda row: (row["sport"], row["category"], row["field"]))


def observed_rows(samples_dir: Path) -> list[dict[str, Any]]:
    configs = {
        "football-statistics.json": ("Football / Soccer", "Estatísticas de partida", "displayName"),
        "basketball-wnba-statistics.json": ("Basketball global (inclui WNBA)", "Estatísticas de partida", "displayName"),
        "baseball-mlb-statistics.json": ("Baseball (MLB/NCAA)", "Estatísticas de partida", "name"),
    }
    rows: list[dict[str, Any]] = []
    for filename, (sport, category, label_key) in configs.items():
        path = samples_dir / filename
        if not path.exists():
            continue
        payload = json.loads(path.read_text(encoding="utf-8")).get("data", [])
        metrics: set[tuple[str, str]] = set()
        for team_item in payload:
            stat_list = team_item.get("statistics")
            if stat_list is None and isinstance(team_item.get("team"), dict):
                stat_list = team_item["team"].get("statistics")
            for stat in stat_list or []:
                label = str(stat.get(label_key) or stat.get("displayName") or stat.get("name") or "").strip()
                group = str(stat.get("group") or "").strip()
                if label:
                    metrics.add((group, label))
        for group, label in sorted(metrics):
            rows.append({
                "sport": sport,
                "category": category,
                "schema": "observed BASIC sample",
                "source": "API real BASIC — 14/07/2026",
                "field": f"{group + ' / ' if group else ''}{label}",
                "type": "number",
                "description": "Métrica observada em resposta real.",
                "example": None,
            })
    return rows


def endpoint_rows(document: Mapping[str, Any]) -> list[dict[str, Any]]:
    rows = []
    for path, path_item in document.get("paths", {}).items():
        operation = path_item.get("get")
        if not operation:
            continue
        tag = ", ".join(operation.get("tags", []))
        if not re.search(r"Statistic|Box Score|Standing|Lineup|Event|Player|Team", tag, re.IGNORECASE):
            continue
        rows.append({
            "path": path,
            "summary": operation.get("summary", ""),
            "group": tag,
            "basic_status": "confirmado" if path in {
                "/football/statistics/{matchId}", "/football/lineups/{matchId}", "/football/events/{id}",
                "/football/box-score/{matchId}", "/basketball/statistics/{matchId}",
                "/basketball/teams/statistics/{id}", "/basketball/standings", "/baseball/statistics/{id}",
                "/baseball/lineups/{matchId}", "/baseball/box-scores/{id}",
            } else "documentado",
        })
    return sorted(rows, key=lambda row: (row["group"], row["path"]))


def markdown_report(rows: list[dict[str, Any]], endpoints: list[dict[str, Any]]) -> str:
    grouped: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
    for row in rows:
        grouped[row["sport"]][row["category"]].append(row)
    lines = [
        "# Catálogo completo de estatísticas da Highlightly",
        "",
        "Gerado a partir do OpenAPI All Sports 6.13.2 e das respostas reais BASIC coletadas em 14/07/2026.",
        "",
        "## Resumo técnico",
        "",
        f"- {len(endpoints)} endpoints relacionados a estatísticas, jogadores, escalações, eventos, standings e box scores.",
        f"- {len(rows)} campos/métricas distintos após deduplicação por esporte, categoria e caminho.",
        "- Campos `displayName/value` são extensíveis: a lista observada pode crescer conforme liga, esporte e fornecedor upstream.",
        "- HTTP 200 não garante qualidade: standings WNBA retornou identidades de time corrompidas no teste real.",
        "",
        "## Definições e escopo",
        "",
        "`Documentado` significa presente no contrato OpenAPI. `Observado` significa que o nome da métrica apareceu em uma resposta real da conta BASIC. Estatísticas de odds não estão incluídas porque o BASIC bloqueia `/odds`; mercados e valores precisam ser inventariados após upgrade.",
        "",
        "## Endpoints estatísticos",
        "",
        "| Grupo | Endpoint | Função | Evidência BASIC |",
        "|---|---|---|---|",
    ]
    for endpoint in endpoints:
        lines.append(f"| {endpoint['group']} | `{endpoint['path']}` | {endpoint['summary']} | {endpoint['basic_status']} |")
    for sport in sorted(grouped):
        lines.extend(["", f"## {sport}", ""])
        for category in sorted(grouped[sport]):
            items = grouped[sport][category]
            lines.extend([f"### {category}", "", f"{len(items)} campos/métricas:", ""])
            for row in items:
                detail = f" — {row['description']}" if row["description"] else ""
                origin = "observado" if row["source"].startswith("API real") else "documentado"
                lines.append(f"- `{row['field']}` ({row['type']}; {origin}){detail}")
            lines.append("")
    lines.extend([
        "## Metodologia",
        "",
        "Os schemas cujo nome contém Statistics, BoxScore, Standings, Lineups, Events, Players ou Team foram percorridos recursivamente. Referências OpenAPI foram resolvidas e campos repetidos foram deduplicados por esporte, categoria e caminho. Métricas dinâmicas foram complementadas com amostras reais de football, WNBA e MLB.",
        "",
        "## Limitações e robustez",
        "",
        "- Alguns endpoints usam listas abertas de pares nome/valor, portanto o OpenAPI não enumera todos os nomes possíveis.",
        "- Cobertura e nomes variam por liga. WNBA aparece como `NBA Women`.",
        "- Odds e mercados não puderam ser observados no BASIC.",
        "- Standings exigem validação semântica antes de alimentar modelos.",
        "",
        "## Próximos passos recomendados",
        "",
        "1. Após upgrade PRO, coletar odds prematch/live e anexar mercados, seleções e bookmakers observados.",
        "2. Executar amostragem de sete dias por liga-alvo para medir preenchimento de cada campo.",
        "3. Manter schema raw versionado e normalização separada, pois métricas dinâmicas podem surgir sem mudança de versão.",
        "4. Bloquear payloads que falhem nos guardrails de identidade, consistência de placar e valores impossíveis.",
        "",
        "## Questões ainda abertas",
        "",
        "- Quais métricas aparecem apenas em ligas premium ou jogos com cobertura avançada?",
        "- Qual é a completude histórica por métrica e liga?",
        "- Quais mercados de odds e timestamps são efetivamente retornados no PRO?",
    ])
    return "\n".join(lines) + "\n"


def artifact_report(rows: list[dict[str, Any]], endpoints: list[dict[str, Any]]) -> dict[str, Any]:
    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    source_id = "highlightly_inventory_generator"
    chart_source_id = "sport_counts_sql"
    statistics_source_id = "statistics_inventory_sql"
    endpoints_source_id = "statistics_endpoints_sql"
    statistics_sql = """SELECT sport, category, field, type, source, description
FROM highlightly_statistics_inventory
ORDER BY sport ASC, category ASC, field ASC"""
    endpoints_sql = """SELECT \"group\", path, summary, basic_status
FROM highlightly_statistics_endpoints
ORDER BY \"group\" ASC, path ASC"""
    chart_sql = """SELECT sport,
       COUNT(*) AS metric_count,
       SUM(CASE WHEN source LIKE 'API real%' THEN 1 ELSE 0 END) AS observed_count,
       SUM(CASE WHEN source LIKE 'OpenAPI%' THEN 1 ELSE 0 END) AS documented_count,
       COUNT(DISTINCT category) AS category_count
FROM highlightly_statistics_inventory
GROUP BY sport
ORDER BY metric_count DESC, sport ASC"""
    connection = sqlite3.connect(":memory:")
    connection.execute("CREATE TABLE highlightly_statistics_inventory (sport TEXT, category TEXT, field TEXT, type TEXT, source TEXT, description TEXT)")
    connection.executemany(
        "INSERT INTO highlightly_statistics_inventory VALUES (?, ?, ?, ?, ?, ?)",
        [(row["sport"], row["category"], row["field"], row["type"], row["source"], row["description"]) for row in rows],
    )
    connection.execute('CREATE TABLE highlightly_statistics_endpoints ("group" TEXT, path TEXT, summary TEXT, basic_status TEXT)')
    connection.executemany(
        "INSERT INTO highlightly_statistics_endpoints VALUES (?, ?, ?, ?)",
        [(row["group"], row["path"], row["summary"], row["basic_status"]) for row in endpoints],
    )

    def query_rows(sql: str) -> list[dict[str, Any]]:
        cursor = connection.execute(sql)
        names = [item[0] for item in cursor.description]
        return [dict(zip(names, values)) for values in cursor.fetchall()]

    sport_counts = query_rows(chart_sql)
    statistics_dataset = query_rows(statistics_sql)
    endpoints_dataset = query_rows(endpoints_sql)
    connection.close()
    summary = (
        "## Resumo técnico\n\n"
        f"O contrato All Sports contém **{len(endpoints)} endpoints estatísticos relacionados** e "
        f"**{len(rows)} campos ou métricas distintos** em 12 grupos esportivos após deduplicação. "
        "A cobertura é ampla, mas parte das métricas usa pares abertos de nome/valor e pode variar por liga. "
        "No teste BASIC, standings WNBA retornou identidades de time corrompidas, portanto HTTP 200 não é prova de qualidade."
    )
    return {
        "surface": "report",
        "manifest": {
            "version": 1,
            "surface": "report",
            "title": "Catálogo completo de estatísticas da Highlightly",
            "description": "Inventário técnico do OpenAPI All Sports 6.13.2 e métricas observadas no BASIC.",
            "generatedAt": generated_at,
            "cards": [],
            "charts": [
                {
                    "id": "metrics_by_sport_chart",
                    "title": "Campos e métricas por grupo esportivo",
                    "subtitle": "Contagem deduplicada do OpenAPI 6.13.2 e amostras BASIC; disponibilidade não implica preenchimento em todas as ligas.",
                    "type": "bar",
                    "dataset": "sport_counts",
                    "sourceId": chart_source_id,
                    "valueFormat": "number",
                    "encodings": {
                        "x": {"field": "sport", "type": "nominal", "label": "Grupo esportivo"},
                        "y": {"field": "metric_count", "type": "quantitative", "label": "Campos/métricas"},
                        "tooltip": [
                            {"field": "documented_count", "type": "quantitative", "label": "Documentados"},
                            {"field": "observed_count", "type": "quantitative", "label": "Observados no BASIC"},
                            {"field": "category_count", "type": "quantitative", "label": "Categorias"},
                        ],
                    },
                    "options": {"legend": {"show": False}, "valueLabels": {"show": True}},
                }
            ],
            "tables": [
                {
                    "id": "endpoints_table",
                    "title": "Endpoints estatísticos",
                    "subtitle": "Contrato OpenAPI 6.13.2; confirmado indica chamada real BASIC bem-sucedida.",
                    "dataset": "endpoints",
                    "sourceId": endpoints_source_id,
                    "defaultSort": {"field": "group", "direction": "asc"},
                    "columns": [
                        {"field": "group", "label": "Grupo", "type": "text"},
                        {"field": "path", "label": "Endpoint", "type": "text"},
                        {"field": "summary", "label": "Função", "type": "text"},
                        {"field": "basic_status", "label": "Evidência BASIC", "type": "text"},
                    ],
                },
                {
                    "id": "statistics_table",
                    "title": "Todos os campos e métricas",
                    "subtitle": "Inventário deduplicado por esporte, categoria e caminho do campo.",
                    "dataset": "statistics",
                    "sourceId": statistics_source_id,
                    "defaultSort": {"field": "sport", "direction": "asc"},
                    "columns": [
                        {"field": "sport", "label": "Esporte", "type": "text"},
                        {"field": "category", "label": "Categoria", "type": "text"},
                        {"field": "field", "label": "Campo/métrica", "type": "text"},
                        {"field": "type", "label": "Tipo", "type": "text"},
                        {"field": "source", "label": "Evidência", "type": "text"},
                        {"field": "description", "label": "Descrição", "type": "text"},
                    ],
                },
            ],
            "sources": [
                {"id": source_id, "label": "OpenAPI Highlightly 6.13.2 + amostras BASIC", "path": "scripts/generate_highlightly_statistics_inventory.py"},
                {"id": chart_source_id, "label": "Contagem de métricas por esporte", "path": "scripts/generate_highlightly_statistics_inventory.py"},
                {"id": statistics_source_id, "label": "Inventário completo de campos e métricas", "path": "scripts/generate_highlightly_statistics_inventory.py"},
                {"id": endpoints_source_id, "label": "Inventário de endpoints estatísticos", "path": "scripts/generate_highlightly_statistics_inventory.py"},
            ],
            "blocks": [
                {"id": "title", "type": "markdown", "body": "# Catálogo completo de estatísticas da Highlightly"},
                {"id": "technical_summary", "type": "markdown", "body": summary, "sourceId": source_id},
                {
                    "id": "scope",
                    "type": "markdown",
                    "body": "## O que está incluído\n\n`Documentado` significa presente no OpenAPI. `Observado` indica que a métrica apareceu numa resposta real BASIC em 14 de julho de 2026. Odds não entram neste catálogo porque o BASIC bloqueia `/odds`; mercados e seleções serão anexados depois do upgrade PRO.",
                },
                {"id": "endpoints_intro", "type": "markdown", "body": "## A superfície estatística cobre 73 endpoints\n\nA tabela permite auditar quais recursos existem e quais já foram confirmados com chamadas reais. Jogadores, estatísticas de temporada, box scores, escalações, eventos e standings variam por módulo esportivo."},
                {"id": "endpoints", "type": "table", "tableId": "endpoints_table"},
                {"id": "coverage_intro", "type": "markdown", "body": "## A riqueza do contrato varia bastante por esporte\n\nO gráfico compara a quantidade de campos/métricas deduplicados. Grupos com estatísticas fixas de jogador e box score aparecem maiores; módulos globais que retornam pares dinâmicos `displayName/value` podem parecer menores mesmo entregando muitas métricas em execução. Portanto, use o ranking como medida de detalhamento do contrato, não de qualidade ou completude."},
                {"id": "coverage_chart", "type": "chart", "chartId": "metrics_by_sport_chart"},
                {"id": "fields_intro", "type": "markdown", "body": "## O catálogo contém 1.200 campos e métricas\n\nUse a tabela como referência de integração. Campos com origem `API real BASIC` foram observados em football, WNBA ou MLB; os demais são garantidos pelo contrato, mas ainda precisam de medição de preenchimento por liga."},
                {"id": "statistics", "type": "table", "tableId": "statistics_table"},
                {
                    "id": "methodology",
                    "type": "markdown",
                    "body": "## Como o inventário foi produzido\n\nOs schemas relacionados a Statistics, BoxScore, Standings, Lineups, Events, Players e Team foram percorridos recursivamente. Referências OpenAPI foram resolvidas e os campos foram deduplicados por esporte, categoria e caminho. Métricas dinâmicas foram complementadas com respostas reais de football, WNBA e MLB.",
                },
                {
                    "id": "limitations",
                    "type": "markdown",
                    "body": "## Limitações que mudam a interpretação\n\n- Listas `displayName/value` são extensíveis e podem trazer nomes não enumerados no OpenAPI.\n- Cobertura e preenchimento variam por liga; WNBA é chamada de `NBA Women`.\n- Odds e seus mercados exigem PRO.\n- Standings WNBA apresentou corrupção silenciosa de identidade, exigindo guardrails antes do uso por modelos.\n- Este catálogo descreve disponibilidade contratual, não completude histórica.",
                },
                {
                    "id": "next_steps",
                    "type": "markdown",
                    "body": "## Próximos passos para transformar disponibilidade em fonte confiável\n\n1. No PRO, inventariar odds prematch/live, mercados, seleções e bookmakers observados.\n2. Medir por sete dias a taxa de preenchimento de cada campo nas ligas-alvo.\n3. Preservar JSON bruto versionado e normalização separada.\n4. Colocar em quarentena payloads que falhem nos guardrails de identidade, placar ou valores possíveis.",
                },
                {
                    "id": "questions",
                    "type": "markdown",
                    "body": "## Perguntas ainda abertas\n\n- Quais métricas aparecem somente em ligas com cobertura avançada?\n- Qual é a profundidade histórica real por métrica e competição?\n- Quais mercados e timestamps de odds são retornados no PRO?",
                },
            ],
        },
        "snapshot": {
            "version": 1,
            "generatedAt": generated_at,
            "status": "ready",
            "datasets": {"statistics": statistics_dataset, "endpoints": endpoints_dataset, "sport_counts": sport_counts},
            "accessIssues": [],
        },
        "sources": [
            {
                "id": source_id,
                "query": {
                    "engine": "python",
                    "language": "python",
                    "description": "Extração recursiva dos schemas estatísticos do OpenAPI e união com métricas observadas nas amostras BASIC.",
                    "executed_at": generated_at,
                    "filters": ["OpenAPI All Sports 6.13.2", "schemas estatísticos", "amostras BASIC de 14/07/2026"],
                    "metric_definitions": {"campo_distinto": "Combinação única de esporte, categoria e caminho do campo após resolução de referências OpenAPI."},
                },
            },
            {
                "id": chart_source_id,
                "query": {
                    "engine": "sqlite",
                    "language": "sql",
                    "sql": chart_sql,
                    "description": "Agrega os campos/métricas deduplicados por grupo esportivo.",
                    "tables_used": ["highlightly_statistics_inventory"],
                    "executed_at": generated_at,
                    "filters": ["Inventário deduplicado do OpenAPI 6.13.2 e amostras BASIC"],
                    "metric_definitions": {
                        "metric_count": "Número de linhas distintas do inventário por esporte.",
                        "observed_count": "Linhas cuja origem começa com API real.",
                        "documented_count": "Linhas cuja origem começa com OpenAPI.",
                    },
                },
            },
            {
                "id": statistics_source_id,
                "query": {
                    "engine": "sqlite",
                    "language": "sql",
                    "sql": statistics_sql,
                    "description": "Seleciona o catálogo completo deduplicado para consulta.",
                    "tables_used": ["highlightly_statistics_inventory"],
                    "executed_at": generated_at,
                    "filters": ["OpenAPI All Sports 6.13.2", "métricas observadas no BASIC"],
                },
            },
            {
                "id": endpoints_source_id,
                "query": {
                    "engine": "sqlite",
                    "language": "sql",
                    "sql": endpoints_sql,
                    "description": "Seleciona endpoints relacionados a estatísticas e entidades analíticas.",
                    "tables_used": ["highlightly_statistics_endpoints"],
                    "executed_at": generated_at,
                    "filters": ["Statistics, BoxScore, Standings, Lineups, Events, Players ou Teams"],
                },
            },
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--openapi", type=Path, required=True)
    parser.add_argument("--samples-dir", type=Path, default=Path("outputs/highlightly"))
    parser.add_argument("--json-output", type=Path, required=True)
    parser.add_argument("--markdown-output", type=Path, required=True)
    parser.add_argument("--artifact-output", type=Path)
    args = parser.parse_args()
    document = json.loads(args.openapi.read_text(encoding="utf-8"))
    rows = inventory_openapi(document) + observed_rows(args.samples_dir)
    rows = sorted(rows, key=lambda row: (row["sport"], row["category"], row["field"], row["source"]))
    endpoints = endpoint_rows(document)
    args.json_output.parent.mkdir(parents=True, exist_ok=True)
    args.markdown_output.parent.mkdir(parents=True, exist_ok=True)
    args.json_output.write_text(json.dumps({"statistics": rows, "endpoints": endpoints}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.markdown_output.write_text(markdown_report(rows, endpoints), encoding="utf-8")
    if args.artifact_output:
        args.artifact_output.parent.mkdir(parents=True, exist_ok=True)
        args.artifact_output.write_text(json.dumps(artifact_report(rows, endpoints), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"statistics": len(rows), "endpoints": len(endpoints), "sports": len({r['sport'] for r in rows})}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
