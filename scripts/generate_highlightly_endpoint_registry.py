"""Build the executable Highlightly endpoint registry from the frozen OpenAPI contract."""

from __future__ import annotations

from collections import Counter
import hashlib
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "vendor" / "highlightly" / "openapi-6.13.2.json"
MANIFEST = CONTRACT.with_name("manifest.json")
REGISTRY = ROOT / "config" / "highlightly" / "endpoint-registry.json"
MATRIX = ROOT / "docs" / "highlightly" / "phase-0-capability-matrix.md"
SPORTS = ("football", "baseball", "basketball")
AUTH_PARAMETERS = {"x-rapidapi-key", "x-rapidapi-host"}


POLICIES: dict[str, dict[str, Any]] = {
    "countries": {"priority": 3, "cadence": "weekly", "sla": "8d", "target": "sports_countries"},
    "leagues": {"priority": 2, "cadence": "daily", "sla": "36h", "target": "sports_competitions"},
    "teams": {"priority": 2, "cadence": "daily", "sla": "36h", "target": "sports_teams"},
    "team_statistics": {"priority": 1, "cadence": "daily", "sla": "36h", "target": "sports_team_season_stats"},
    "matches": {"priority": 0, "cadence": "adaptive_match_window", "sla": "10m_game_day", "target": "sports_matches"},
    "highlights": {"priority": 3, "cadence": "postmatch_30m_6h", "sla": "8h", "target": "sports_highlights"},
    "highlight_geo_restrictions": {"priority": 4, "cadence": "on_demand", "sla": "on_demand", "target": "sports_highlights"},
    "bookmakers": {"priority": 2, "cadence": "weekly", "sla": "8d", "target": "sports_bookmakers"},
    "odds": {"priority": 0, "cadence": "adaptive_odds_window", "sla": "20m_prematch_12m_live", "target": "sports_odds_current,sports_odds_history"},
    "standings": {"priority": 1, "cadence": "daily_post_round", "sla": "36h", "target": "sports_standings_snapshots"},
    "last_five_games": {"priority": 3, "cadence": "on_demand_ttl_6h", "sla": "on_demand", "target": "sports_matches"},
    "head_to_head": {"priority": 3, "cadence": "on_demand_ttl_24h", "sla": "on_demand", "target": "sports_matches"},
    "lineups": {"priority": 0, "cadence": "t24h_t2h_t30m_kickoff", "sla": "30m_prematch", "target": "sports_lineups,sports_lineup_players"},
    "match_statistics": {"priority": 1, "cadence": "final_15m_2h_24h", "sla": "26h_postmatch", "target": "sports_match_team_stats"},
    "events": {"priority": 0, "cadence": "active_match_only", "sla": "provider_live_cadence", "target": "sports_match_events"},
    "players": {"priority": 3, "cadence": "weekly_and_on_demand", "sla": "8d", "target": "sports_players"},
    "player_statistics": {"priority": 2, "cadence": "weekly_and_on_demand", "sla": "8d", "target": "sports_player_stats"},
    "box_scores": {"priority": 1, "cadence": "final_15m_2h_24h", "sla": "26h_postmatch", "target": "sports_player_box_scores"},
}


OBSERVED: dict[tuple[str, str], str] = {
    ("football", "matches"): "confirmed",
    ("football", "bookmakers"): "confirmed",
    ("football", "odds"): "confirmed_pro",
    ("football", "lineups"): "confirmed",
    ("football", "match_statistics"): "confirmed",
    ("football", "events"): "confirmed",
    ("football", "box_scores"): "confirmed",
    ("baseball", "matches"): "confirmed",
    ("baseball", "odds"): "confirmed_pro",
    ("baseball", "last_five_games"): "confirmed",
    ("baseball", "lineups"): "confirmed",
    ("baseball", "match_statistics"): "confirmed",
    ("baseball", "box_scores"): "confirmed",
    ("basketball", "matches"): "confirmed",
    ("basketball", "odds"): "confirmed_pro",
    ("basketball", "team_statistics"): "confirmed",
    ("basketball", "last_five_games"): "confirmed",
    ("basketball", "match_statistics"): "confirmed",
    ("basketball", "standings"): "confirmed_quality_issue",
}


def _resource(path: str) -> str:
    parts = path.strip("/").split("/")[1:]
    joined = "/".join(parts)
    if joined.startswith("highlights/geo-restrictions"):
        return "highlight_geo_restrictions"
    if joined.startswith("teams/statistics"):
        return "team_statistics"
    if joined.startswith("players/") and joined.endswith("/statistics"):
        return "player_statistics"
    if joined.startswith("last-five-games"):
        return "last_five_games"
    if joined.startswith("head-2-head"):
        return "head_to_head"
    if joined.startswith("statistics/"):
        return "match_statistics"
    if joined.startswith("box-score") or joined.startswith("box-scores"):
        return "box_scores"
    return parts[0].replace("-", "_")


def _parameter(param: dict[str, Any]) -> dict[str, Any]:
    schema = param.get("schema") or {}
    result: dict[str, Any] = {
        "name": param["name"],
        "in": param.get("in"),
        "required": bool(param.get("required")),
        "type": schema.get("type", "unknown"),
    }
    for key in ("format", "default", "minimum", "maximum", "enum"):
        if key in schema:
            result[key] = schema[key]
    return result


def _mode(path: str, parameters: list[dict[str, Any]]) -> str:
    if any(item["in"] == "path" for item in parameters):
        return "detail"
    return "collection"


def build_registry(contract: dict[str, Any], contract_hash: str) -> dict[str, Any]:
    operations: list[dict[str, Any]] = []
    for path, path_item in sorted(contract["paths"].items()):
        sport = path.strip("/").split("/", 1)[0]
        if sport not in SPORTS:
            continue
        for method, operation in sorted(path_item.items()):
            if method.lower() not in {"get", "post", "put", "patch", "delete"}:
                continue
            parameters = [
                _parameter(item)
                for item in operation.get("parameters", [])
                if item.get("name") not in AUTH_PARAMETERS
            ]
            resource = _resource(path)
            if resource not in POLICIES:
                raise ValueError(f"No phase-0 policy for {sport} {method.upper()} {path}: {resource}")
            policy = POLICIES[resource]
            operations.append(
                {
                    "key": f"{sport}.{operation.get('operationId') or method + ':' + path}",
                    "sport": sport,
                    "method": method.upper(),
                    "path": path,
                    "operation_id": operation.get("operationId"),
                    "summary": operation.get("summary", ""),
                    "resource": resource,
                    "mode": _mode(path, parameters),
                    "parameters": parameters,
                    "paginated": {item["name"] for item in parameters} >= {"limit", "offset"},
                    "priority": policy["priority"],
                    "cadence_policy": policy["cadence"],
                    "freshness_sla": policy["sla"],
                    "normalizer": f"{sport}.{resource}",
                    "target_tables": policy["target"].split(","),
                    "evidence": OBSERVED.get((sport, resource), "documented"),
                    "enabled_in_v1": True,
                    "raw_retention_class": retention_class(resource),
                }
            )
    return {
        "provider": "highlightly",
        "contract_version": contract["info"]["version"],
        "contract_sha256": contract_hash,
        "base_url": "https://sports.highlightly.net",
        "sports": list(SPORTS),
        "feature_flag": {"name": "highlightly_analysis_enabled", "default": False},
        "quota": {"daily_limit": 7500, "scheduled": 4500, "postmatch_backfill": 1500, "retry": 750, "reserve": 750},
        "operations": operations,
    }


def retention_class(resource: str) -> str:
    if resource == "odds":
        return "raw_90d_normalized_indefinite"
    if resource in {"countries", "leagues", "teams", "bookmakers", "players"}:
        return "raw_30d_latest_normalized_indefinite"
    if resource in {"highlight_geo_restrictions", "highlights"}:
        return "metadata_365d_no_media_copy"
    return "raw_365d_normalized_indefinite"


def write_matrix(registry: dict[str, Any]) -> None:
    rows = registry["operations"]
    counts = Counter(item["sport"] for item in rows)
    evidence = Counter(item["evidence"] for item in rows)
    lines = [
        "# Fase 0 — matriz de capacidades Highlightly",
        "",
        f"Contrato congelado: OpenAPI `{registry['contract_version']}` (`{registry['contract_sha256']}`).",
        "",
        f"Escopo V1: {len(rows)} operações — " + ", ".join(f"{sport}: {counts[sport]}" for sport in SPORTS) + ".",
        "",
        "## Evidência",
        "",
        "- `confirmed`: resposta real validada.",
        "- `confirmed_pro`: resposta real de recurso PRO validada.",
        "- `confirmed_quality_issue`: endpoint respondeu, mas apresentou corrupção semântica.",
        "- `documented`: disponível no contrato, ainda sem confirmação real.",
        "",
        "| Esporte | Recurso | Operação | Path | Paginação | Prioridade | Cadência | SLA | Evidência | Destino |",
        "|---|---|---|---|---|---:|---|---|---|---|",
    ]
    for item in sorted(rows, key=lambda value: (value["sport"], value["priority"], value["path"])):
        lines.append(
            f"| {item['sport']} | `{item['resource']}` | {item['mode']} | `{item['path']}` | "
            f"{'sim' if item['paginated'] else 'não'} | P{item['priority']} | `{item['cadence_policy']}` | "
            f"`{item['freshness_sla']}` | `{item['evidence']}` | `{', '.join(item['target_tables'])}` |"
        )
    lines.extend(
        [
            "",
            "## Resumo de evidências",
            "",
            *[f"- `{name}`: {count} operações" for name, count in sorted(evidence.items())],
            "",
            "A ausência de confirmação real não desabilita a operação na V1. Ela exige fixture, smoke test e validação de qualidade antes da ativação do scheduler correspondente.",
        ]
    )
    MATRIX.parent.mkdir(parents=True, exist_ok=True)
    MATRIX.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    contract_bytes = CONTRACT.read_bytes()
    contract_hash = hashlib.sha256(contract_bytes).hexdigest()
    contract = json.loads(contract_bytes)
    registry = build_registry(contract, contract_hash)
    REGISTRY.parent.mkdir(parents=True, exist_ok=True)
    REGISTRY.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    MANIFEST.write_text(
        json.dumps(
            {
                "provider": "highlightly",
                "title": contract["info"]["title"],
                "version": contract["info"]["version"],
                "file": CONTRACT.name,
                "bytes": len(contract_bytes),
                "sha256": contract_hash,
                "scope_v1": list(SPORTS),
                "operation_count_v1": len(registry["operations"]),
                "immutable": True,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    write_matrix(registry)


if __name__ == "__main__":
    main()
