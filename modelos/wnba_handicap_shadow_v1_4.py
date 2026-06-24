from __future__ import annotations

import csv
import json
import math
import re
import unicodedata
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable


VALID_HANDICAP_PAIR = "VALID_HANDICAP_PAIR"
PAIR_INCOMPLETE = "PAIR_INCOMPLETE"
INVALID_LINE = "INVALID_LINE"
INVALID_ODDS = "INVALID_ODDS"
SAME_SIGN_PAIR = "SAME_SIGN_PAIR"
NON_SYMMETRIC_PAIR = "NON_SYMMETRIC_PAIR"
AMBIGUOUS_SIDE = "AMBIGUOUS_SIDE"
PLACEHOLDER_ODDS = "PLACEHOLDER_ODDS"

GREEN = "GREEN"
RED = "RED"
PUSH = "PUSH"

NO_MARKET_BASELINE = "NO_MARKET_BASELINE"
MARKET_BASELINE_OK = "MARKET_BASELINE_OK"

DEFAULT_PRIOR = 0.50
DEFAULT_PRIOR_STRENGTH = 10.0
DEFAULT_MIN_SAMPLE = 5
DEFAULT_PLACEHOLDER_ODDS = (2.0,)


@dataclass
class HandicapCoverResult:
    status: str
    margin: float
    handicap_line: float
    adjusted_margin: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class WnbaHandicapPair:
    status: str
    data: str = ""
    hora: str = ""
    liga: str = ""
    jogo: str = ""
    mandante: str = ""
    visitante: str = ""
    mercado: str = ""
    bookmaker: str = ""
    abs_line: float | None = None
    home_pick: str = ""
    away_pick: str = ""
    home_line: float | None = None
    away_line: float | None = None
    home_odd: float | None = None
    away_odd: float | None = None
    reasons: list[str] = field(default_factory=list)
    raw_rows: list[dict[str, Any]] = field(default_factory=list)

    @property
    def is_valid(self) -> bool:
        return self.status == VALID_HANDICAP_PAIR

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["is_valid"] = self.is_valid
        return data


@dataclass
class HistoricalCoverResult:
    raw_cover_rate: float | None
    shrinked_cover_rate: float
    games_considered: int
    pushes: int
    fallback_used: bool
    fallback_reason: str
    cover_wins: int = 0
    cover_losses: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class MarketBaselineResult:
    market_prob_home: float | None
    market_prob_away: float | None
    vig: float | None
    market_baseline_status: str
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class MarginShadowResult:
    expected_margin_component: float | None
    home_away_component: float | None
    recent_form_component: float | None
    league_regression_component: float
    margin_projection: float | None
    margin_shadow_prob: float | None
    margin_projection_status: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ShadowProbabilityResult:
    side: str
    pick: str
    line: float
    odd: float
    historical_cover_prob: float
    market_no_vig_prob: float | None
    margin_shadow_prob: float | None
    final_shadow_prob: float | None
    weights: dict[str, float]
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def normalize_text(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", text)


def parse_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    text = str(value).strip().replace(",", ".")
    if not text:
        return None
    text = re.sub(r"[^0-9+\-.]", "", text)
    if text in {"", "+", "-", ".", "+.", "-."}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def is_wnba_row(row: dict[str, Any]) -> bool:
    league = normalize_text(row.get("liga"))
    sport = normalize_text(row.get("esporte"))
    return "wnba" in league or ("basketball" in sport and "wnba" in normalize_text(row.get("league")))


def is_handicap_market(value: Any) -> bool:
    text = normalize_text(value)
    return "handicap" in text or "spread" in text


def is_placeholder_odd(odd: Any, placeholder_odds: Iterable[float] | None = DEFAULT_PLACEHOLDER_ODDS) -> bool:
    parsed = parse_float(odd)
    if parsed is None or parsed <= 1:
        return True
    for placeholder in placeholder_odds or ():
        if math.isclose(parsed, float(placeholder), abs_tol=1e-12):
            return True
    return False


def identify_pick_side(pick: Any, home: Any, away: Any) -> str | None:
    pick_norm = normalize_text(pick)
    home_norm = normalize_text(home)
    away_norm = normalize_text(away)
    if pick_norm in {"1", "home", "casa", "mandante"}:
        return "home"
    if pick_norm in {"2", "away", "fora", "visitante"}:
        return "away"
    if home_norm and (home_norm in pick_norm or pick_norm in home_norm):
        return "home"
    if away_norm and (away_norm in pick_norm or pick_norm in away_norm):
        return "away"
    return None


def _event_key(row: dict[str, Any], line: float | None) -> tuple[Any, ...]:
    return (
        row.get("data") or row.get("date"),
        row.get("hora") or row.get("time"),
        row.get("liga") or row.get("league"),
        row.get("jogo") or f"{row.get('mandante') or ''} vs {row.get('visitante') or ''}",
        row.get("mandante") or row.get("home"),
        row.get("visitante") or row.get("away"),
        row.get("mercado") or row.get("market"),
        row.get("bookmaker") or row.get("fonte") or row.get("source"),
        abs(line) if line is not None else None,
    )


def _event_key_without_line(row: dict[str, Any]) -> tuple[Any, ...]:
    return (
        row.get("data") or row.get("date"),
        row.get("hora") or row.get("time"),
        row.get("liga") or row.get("league"),
        row.get("jogo") or f"{row.get('mandante') or ''} vs {row.get('visitante') or ''}",
        row.get("mandante") or row.get("home"),
        row.get("visitante") or row.get("away"),
        row.get("mercado") or row.get("market"),
        row.get("bookmaker") or row.get("fonte") or row.get("source"),
    )


def read_normalized_rows(path: str | Path) -> list[dict[str, Any]]:
    file_path = Path(path)
    if file_path.suffix.lower() == ".csv":
        with file_path.open("r", encoding="utf-8-sig", newline="") as fh:
            return list(csv.DictReader(fh))

    data = json.loads(file_path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    if isinstance(data, dict):
        rows = data.get("linhas") or data.get("rows") or data.get("data")
        if isinstance(rows, list):
            return [row for row in rows if isinstance(row, dict)]
    return []


def read_wnba_handicap_pairs(
    rows: Iterable[dict[str, Any]],
    *,
    placeholder_odds: Iterable[float] | None = DEFAULT_PLACEHOLDER_ODDS,
) -> list[WnbaHandicapPair]:
    groups: dict[tuple[Any, ...], list[dict[str, Any]]] = {}
    invalid: list[WnbaHandicapPair] = []

    for row in rows:
        if not is_wnba_row(row) or not is_handicap_market(row.get("mercado") or row.get("market")):
            continue
        line = parse_float(row.get("linha") or row.get("line"))
        if line is None:
            invalid.append(_invalid_pair(row, INVALID_LINE, ["INVALID_LINE"]))
            continue
        groups.setdefault(_event_key_without_line(row), []).append(row)

    pairs: list[WnbaHandicapPair] = []
    for group_rows in groups.values():
        pairs.extend(_pair_event_rows(group_rows, placeholder_odds=placeholder_odds))
    return pairs + invalid


def _pair_event_rows(
    group_rows: list[dict[str, Any]],
    *,
    placeholder_odds: Iterable[float] | None = DEFAULT_PLACEHOLDER_ODDS,
) -> list[WnbaHandicapPair]:
    home_rows: list[dict[str, Any]] = []
    away_rows: list[dict[str, Any]] = []
    invalid: list[WnbaHandicapPair] = []

    for row in group_rows:
        side = identify_pick_side(row.get("pick"), row.get("mandante") or row.get("home"), row.get("visitante") or row.get("away"))
        line = parse_float(row.get("linha") or row.get("line"))
        if side is None:
            invalid.append(_invalid_pair(row, AMBIGUOUS_SIDE, [AMBIGUOUS_SIDE]))
            continue
        if line is None:
            invalid.append(_invalid_pair(row, INVALID_LINE, [INVALID_LINE]))
            continue
        if side == "home":
            home_rows.append(row)
        else:
            away_rows.append(row)

    used_away: set[int] = set()
    pairs: list[WnbaHandicapPair] = []
    for home in home_rows:
        home_line = parse_float(home.get("linha") or home.get("line"))
        matched_index: int | None = None
        fallback_index: int | None = None
        for index, away in enumerate(away_rows):
            if index in used_away:
                continue
            away_line = parse_float(away.get("linha") or away.get("line"))
            if home_line is None or away_line is None:
                continue
            if math.isclose(home_line + away_line, 0.0, abs_tol=1e-9):
                matched_index = index
                break
            if fallback_index is None and math.isclose(abs(home_line), abs(away_line), abs_tol=1e-9):
                fallback_index = index

        chosen_index = matched_index if matched_index is not None else fallback_index
        if chosen_index is None:
            pairs.append(validate_handicap_pair([home], placeholder_odds=placeholder_odds))
            continue
        used_away.add(chosen_index)
        pairs.append(validate_handicap_pair([home, away_rows[chosen_index]], placeholder_odds=placeholder_odds))

    for index, away in enumerate(away_rows):
        if index not in used_away:
            pairs.append(validate_handicap_pair([away], placeholder_odds=placeholder_odds))

    return pairs + invalid


def validate_handicap_pair(
    rows: Iterable[dict[str, Any]],
    *,
    placeholder_odds: Iterable[float] | None = DEFAULT_PLACEHOLDER_ODDS,
) -> WnbaHandicapPair:
    group_rows = list(rows)
    if not group_rows:
        return WnbaHandicapPair(status=PAIR_INCOMPLETE, reasons=[PAIR_INCOMPLETE])

    base = group_rows[0]
    pair = WnbaHandicapPair(
        status=VALID_HANDICAP_PAIR,
        data=str(base.get("data") or base.get("date") or ""),
        hora=str(base.get("hora") or base.get("time") or ""),
        liga=str(base.get("liga") or base.get("league") or ""),
        jogo=str(base.get("jogo") or f"{base.get('mandante') or ''} vs {base.get('visitante') or ''}"),
        mandante=str(base.get("mandante") or base.get("home") or ""),
        visitante=str(base.get("visitante") or base.get("away") or ""),
        mercado=str(base.get("mercado") or base.get("market") or ""),
        bookmaker=str(base.get("bookmaker") or base.get("fonte") or base.get("source") or ""),
        raw_rows=group_rows,
    )

    sides: dict[str, dict[str, Any]] = {}
    reasons: list[str] = []
    for row in group_rows:
        side = identify_pick_side(row.get("pick"), pair.mandante, pair.visitante)
        line = parse_float(row.get("linha") or row.get("line"))
        odd = parse_float(row.get("odd") or row.get("odd_ofertada"))

        if side is None:
            reasons.append(AMBIGUOUS_SIDE)
            continue
        if line is None:
            reasons.append(INVALID_LINE)
            continue
        if is_placeholder_odd(odd, placeholder_odds):
            reasons.append(PLACEHOLDER_ODDS if odd is not None and odd > 1 else INVALID_ODDS)
            continue
        sides[side] = row

    if "home" not in sides or "away" not in sides:
        reason = AMBIGUOUS_SIDE if AMBIGUOUS_SIDE in reasons and len(group_rows) >= 2 else PAIR_INCOMPLETE
        pair.status = reason
        pair.reasons = sorted(set(reasons + [reason]))
        return pair

    home = sides["home"]
    away = sides["away"]
    pair.home_pick = str(home.get("pick") or "")
    pair.away_pick = str(away.get("pick") or "")
    pair.home_line = parse_float(home.get("linha") or home.get("line"))
    pair.away_line = parse_float(away.get("linha") or away.get("line"))
    pair.home_odd = parse_float(home.get("odd") or home.get("odd_ofertada"))
    pair.away_odd = parse_float(away.get("odd") or away.get("odd_ofertada"))
    pair.abs_line = abs(pair.home_line) if pair.home_line is not None else None

    if pair.home_line is None or pair.away_line is None:
        pair.status = INVALID_LINE
        pair.reasons = sorted(set(reasons + [INVALID_LINE]))
        return pair
    if is_placeholder_odd(pair.home_odd, placeholder_odds) or is_placeholder_odd(pair.away_odd, placeholder_odds):
        pair.status = PLACEHOLDER_ODDS
        pair.reasons = sorted(set(reasons + [PLACEHOLDER_ODDS]))
        return pair
    if pair.home_line * pair.away_line > 0:
        pair.status = SAME_SIGN_PAIR
        pair.reasons = sorted(set(reasons + [SAME_SIGN_PAIR]))
        return pair
    if not math.isclose(pair.home_line + pair.away_line, 0.0, abs_tol=1e-9):
        pair.status = NON_SYMMETRIC_PAIR
        pair.reasons = sorted(set(reasons + [NON_SYMMETRIC_PAIR]))
        return pair

    pair.status = VALID_HANDICAP_PAIR
    pair.reasons = sorted(set(reasons))
    return pair


def _invalid_pair(row: dict[str, Any], status: str, reasons: list[str]) -> WnbaHandicapPair:
    return WnbaHandicapPair(
        status=status,
        data=str(row.get("data") or row.get("date") or ""),
        hora=str(row.get("hora") or row.get("time") or ""),
        liga=str(row.get("liga") or row.get("league") or ""),
        jogo=str(row.get("jogo") or ""),
        mandante=str(row.get("mandante") or row.get("home") or ""),
        visitante=str(row.get("visitante") or row.get("away") or ""),
        mercado=str(row.get("mercado") or row.get("market") or ""),
        bookmaker=str(row.get("bookmaker") or row.get("fonte") or ""),
        reasons=reasons,
        raw_rows=[row],
    )


def evaluate_handicap_cover(team_points: Any, opponent_points: Any, handicap_line: Any) -> HandicapCoverResult:
    team = parse_float(team_points)
    opponent = parse_float(opponent_points)
    line = parse_float(handicap_line)
    if team is None or opponent is None or line is None:
        raise ValueError("team_points, opponent_points e handicap_line precisam ser numericos.")
    margin = team - opponent
    adjusted = margin + line
    if math.isclose(adjusted, 0.0, abs_tol=1e-12):
        status = PUSH
    elif adjusted > 0:
        status = GREEN
    else:
        status = RED
    return HandicapCoverResult(status=status, margin=margin, handicap_line=line, adjusted_margin=adjusted)


def historical_handicap_cover_probability(
    team: str,
    opponent: str,
    line: Any,
    side: str,
    historical_games: Iterable[dict[str, Any]],
    *,
    prior: float = DEFAULT_PRIOR,
    prior_strength: float = DEFAULT_PRIOR_STRENGTH,
    min_sample: int = DEFAULT_MIN_SAMPLE,
) -> HistoricalCoverResult:
    parsed_line = parse_float(line)
    if parsed_line is None:
        return HistoricalCoverResult(None, prior, 0, 0, True, INVALID_LINE)

    wins = 0
    losses = 0
    pushes = 0
    considered = 0
    for game in historical_games:
        points = _team_points_from_game(team, opponent, game)
        if points is None:
            continue
        team_points, opponent_points = points
        result = evaluate_handicap_cover(team_points, opponent_points, parsed_line)
        if result.status == PUSH:
            pushes += 1
            continue
        considered += 1
        if result.status == GREEN:
            wins += 1
        else:
            losses += 1

    if considered == 0:
        return HistoricalCoverResult(None, prior, considered, pushes, True, "NO_HISTORY", wins, losses)

    raw = wins / considered
    shrinked = ((raw * considered) + (prior * prior_strength)) / (considered + prior_strength)
    fallback = considered < min_sample
    return HistoricalCoverResult(
        raw_cover_rate=raw,
        shrinked_cover_rate=prior if considered < 3 else shrinked,
        games_considered=considered,
        pushes=pushes,
        fallback_used=fallback,
        fallback_reason="LOW_SAMPLE_NEUTRAL_FALLBACK" if considered < 3 else "LOW_SAMPLE_SHRINKAGE" if fallback else "",
        cover_wins=wins,
        cover_losses=losses,
    )


def _team_points_from_game(team: str, opponent: str, game: dict[str, Any]) -> tuple[float, float] | None:
    if "pontos_time" in game and "pontos_adversario" in game:
        team_points = parse_float(game.get("pontos_time"))
        opp_points = parse_float(game.get("pontos_adversario"))
        if team_points is not None and opp_points is not None:
            return team_points, opp_points

    home = normalize_text(game.get("mandante") or game.get("home") or game.get("team_home"))
    away = normalize_text(game.get("visitante") or game.get("away") or game.get("team_away"))
    team_norm = normalize_text(team)
    opp_norm = normalize_text(opponent)
    home_points = parse_float(game.get("pontos_mandante") or game.get("home_points") or game.get("pts_home"))
    away_points = parse_float(game.get("pontos_visitante") or game.get("away_points") or game.get("pts_away"))
    if home_points is None or away_points is None:
        return None
    if team_norm and (team_norm == home or team_norm in home or home in team_norm):
        return home_points, away_points
    if team_norm and (team_norm == away or team_norm in away or away in team_norm):
        return away_points, home_points
    if opp_norm and (opp_norm == home or opp_norm in home or home in opp_norm):
        return away_points, home_points
    if opp_norm and (opp_norm == away or opp_norm in away or away in opp_norm):
        return home_points, away_points
    return None


def calculate_market_no_vig(
    odd_home: Any,
    odd_away: Any,
    *,
    placeholder_odds: Iterable[float] | None = DEFAULT_PLACEHOLDER_ODDS,
) -> MarketBaselineResult:
    home = parse_float(odd_home)
    away = parse_float(odd_away)
    reasons: list[str] = []
    if is_placeholder_odd(home, placeholder_odds):
        reasons.append("HOME_ODD_INVALID_OR_PLACEHOLDER")
    if is_placeholder_odd(away, placeholder_odds):
        reasons.append("AWAY_ODD_INVALID_OR_PLACEHOLDER")
    if reasons:
        return MarketBaselineResult(None, None, None, NO_MARKET_BASELINE, reasons)

    assert home is not None and away is not None
    imp_home = 1 / home
    imp_away = 1 / away
    total = imp_home + imp_away
    if total <= 0:
        return MarketBaselineResult(None, None, None, NO_MARKET_BASELINE, ["INVALID_IMPLIED_PROBABILITY"])
    return MarketBaselineResult(
        market_prob_home=imp_home / total,
        market_prob_away=imp_away / total,
        vig=total - 1,
        market_baseline_status=MARKET_BASELINE_OK,
    )


def calculate_margin_shadow(
    team: str,
    opponent: str,
    historical_games: Iterable[dict[str, Any]],
    *,
    is_home: bool = True,
    line: Any = None,
) -> MarginShadowResult:
    margins: list[float] = []
    recent: list[float] = []
    home_away: list[float] = []
    for game in historical_games:
        points = _team_points_from_game(team, opponent, game)
        if points is None:
            continue
        team_points, opp_points = points
        margin = team_points - opp_points
        margins.append(margin)
        recent = (recent + [margin])[-5:]
        game_home = normalize_text(game.get("mandante") or game.get("home"))
        if is_home and normalize_text(team) in game_home:
            home_away.append(margin)
        elif not is_home and normalize_text(opponent) in game_home:
            home_away.append(margin)

    if not margins:
        return MarginShadowResult(None, None, None, 0.0, None, None, "NO_MARGIN_HISTORY")

    expected = sum(margins) / len(margins)
    ha = sum(home_away) / len(home_away) if home_away else None
    recent_component = sum(recent) / len(recent) if recent else None
    components = [expected]
    if ha is not None:
        components.append(ha)
    if recent_component is not None:
        components.append(recent_component)
    projection = (sum(components) / len(components)) * 0.80
    parsed_line = parse_float(line)
    margin_prob = None
    if parsed_line is not None:
        # Conservative smooth conversion: one possession of margin edge is useful, not decisive.
        margin_edge = projection + parsed_line
        margin_prob = max(0.05, min(0.95, 0.50 + (margin_edge / 30.0)))
    return MarginShadowResult(expected, ha, recent_component, 0.0, projection, margin_prob, "OK")


def build_shadow_probability(
    pair: WnbaHandicapPair,
    side: str,
    historical: HistoricalCoverResult,
    market: MarketBaselineResult,
    margin: MarginShadowResult,
    *,
    weights: dict[str, float] | None = None,
) -> ShadowProbabilityResult:
    if not pair.is_valid:
        raise ValueError("pair precisa ser valido para calcular probabilidade shadow.")
    normalized_side = str(side).lower().strip()
    if normalized_side not in {"home", "away"}:
        raise ValueError("side deve ser home ou away.")
    weights = weights or {"historical": 0.40, "market": 0.40, "margin": 0.20}
    pick = pair.home_pick if normalized_side == "home" else pair.away_pick
    line = pair.home_line if normalized_side == "home" else pair.away_line
    odd = pair.home_odd if normalized_side == "home" else pair.away_odd
    market_prob = market.market_prob_home if normalized_side == "home" else market.market_prob_away
    warnings: list[str] = []
    if market_prob is None:
        warnings.append(NO_MARKET_BASELINE)
    if margin.margin_shadow_prob is None:
        warnings.append("NO_MARGIN_SHADOW")

    components = {"historical": historical.shrinked_cover_rate}
    effective_weights = {"historical": weights.get("historical", 0.40)}
    if market_prob is not None:
        components["market"] = market_prob
        effective_weights["market"] = weights.get("market", 0.40)
    if margin.margin_shadow_prob is not None:
        components["margin"] = margin.margin_shadow_prob
        effective_weights["margin"] = weights.get("margin", 0.20)

    total_weight = sum(effective_weights.values())
    final_prob = None
    if total_weight > 0:
        final_prob = sum(components[name] * effective_weights[name] for name in components) / total_weight
    return ShadowProbabilityResult(
        side=normalized_side,
        pick=pick,
        line=float(line or 0),
        odd=float(odd or 0),
        historical_cover_prob=historical.shrinked_cover_rate,
        market_no_vig_prob=market_prob,
        margin_shadow_prob=margin.margin_shadow_prob,
        final_shadow_prob=final_prob,
        weights=effective_weights,
        warnings=warnings,
    )
