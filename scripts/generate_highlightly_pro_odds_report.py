"""Generate an evidence report from captured Highlightly PRO odds payloads."""

from __future__ import annotations

from collections import Counter, defaultdict
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "outputs" / "highlightly"
JSON_OUT = ROOT / "docs" / "highlightly-pro-odds-inventory.json"
MD_OUT = ROOT / "docs" / "highlightly-pro-odds-report.md"


def family(name: str) -> str:
    if name.startswith("Correct Score"):
        return "Correct Score"
    value = re.sub(r"\s+[+-]?\d+(?:\.\d+)?(?:/[+-]?\d+(?:\.\d+)?)?\s*$", "", name).strip()
    aliases = {
        "Home/Away": "Moneyline",
        "Over/Under": "Total",
        "Asian Handicap": "Handicap/Spread",
        "Spread": "Handicap/Spread",
    }
    return aliases.get(value, value)


def main() -> None:
    inventory = {}
    for path in sorted(INPUT.glob("pro-*-odds.json")):
        sport = path.stem.removeprefix("pro-").removesuffix("-odds")
        wrapped = json.loads(path.read_text(encoding="utf-8"))
        payload = wrapped.get("data", wrapped)
        matches = payload.get("data", [])
        markets = Counter()
        families = Counter()
        bookmakers = Counter()
        types = Counter()
        selections = 0
        invalid = 0
        min_odd = None
        max_odd = None
        for match in matches:
            for offer in match.get("odds", []):
                market = str(offer.get("market") or "")
                values = offer.get("values", [])
                markets[market] += len(values)
                families[family(market)] += len(values)
                bookmakers[str(offer.get("bookmakerName") or offer.get("bookmakerId"))] += len(values)
                types[str(offer.get("type") or "unknown")] += len(values)
                for selection in values:
                    selections += 1
                    try:
                        odd = float(selection.get("odd"))
                    except (TypeError, ValueError):
                        invalid += 1
                        continue
                    if odd <= 1:
                        invalid += 1
                    min_odd = odd if min_odd is None else min(min_odd, odd)
                    max_odd = odd if max_odd is None else max(max_odd, odd)
        inventory[sport] = {
            "matches": len(matches),
            "market_offers": sum(len(item.get("odds", [])) for item in matches),
            "selections": selections,
            "bookmakers": len(bookmakers),
            "exact_markets": len(markets),
            "types": dict(types),
            "invalid_odds": invalid,
            "min_odd": min_odd,
            "max_odd": max_odd,
            "market_families": dict(families.most_common()),
            "markets": dict(markets.most_common()),
            "bookmaker_selections": dict(bookmakers.most_common()),
        }
    JSON_OUT.write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# Relatório de odds Highlightly PRO",
        "",
        "Amostra real coletada em 14/07/2026. Contagens representam seleções de odds, não partidas únicas.",
        "",
        "| Esporte | Partidas | Ofertas | Seleções | Bookmakers | Mercados exatos | Odds inválidas | Faixa observada |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for sport, data in inventory.items():
        lines.append(
            f"| {sport} | {data['matches']} | {data['market_offers']} | {data['selections']} | "
            f"{data['bookmakers']} | {data['exact_markets']} | {data['invalid_odds']} | "
            f"{data['min_odd']:.2f}–{data['max_odd']:.2f} |"
        )
    for sport, data in inventory.items():
        lines.extend(["", f"## {sport}", "", "### Famílias de mercado", ""])
        lines.extend(f"- `{name}`: {count} seleções" for name, count in data["market_families"].items())
        lines.extend(["", "### Bookmakers por volume de seleções (top 20)", ""])
        lines.extend(f"- `{name}`: {count}" for name, count in list(data["bookmaker_selections"].items())[:20])
        lines.extend(["", "### Mercados exatos", ""])
        lines.extend(f"- `{name}`: {count}" for name, count in data["markets"].items())
    lines.extend([
        "", "## Conclusões para o ASP Insights", "",
        "- O PRO libera odds e retorna limite de 7.500 requisições/dia.",
        "- A amostra contém apenas `prematch`; odds live precisam ser medidas durante jogos em andamento.",
        "- Cotações decimais `<= 1.00` devem ser rejeitadas ou colocadas em quarentena.",
        "- A lista diária pode não conter metadados de todos os `matchId` presentes em odds; o coletor deve buscar a partida por ID e paginar completamente.",
        "- O inventário JSON preserva todos os mercados exatos e bookmakers observados para integração e comparação futura.",
    ])
    MD_OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
