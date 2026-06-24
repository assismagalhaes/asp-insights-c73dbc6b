from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any, Iterable

from modelos.wnba_handicap_shadow_v1_4 import (
    GREEN,
    INVALID_LINE,
    PAIR_INCOMPLETE,
    PUSH,
    RED,
    VALID_HANDICAP_PAIR,
    WnbaHandicapPair,
    evaluate_handicap_cover,
    identify_pick_side,
    is_handicap_market,
    is_wnba_row,
    parse_float,
    read_normalized_rows,
    read_wnba_handicap_pairs,
)


VALID_ODD = "VALID_ODD"
POSSIBLE_PLACEHOLDER_ODD = "POSSIBLE_PLACEHOLDER_ODD"
CONFIRMED_PLACEHOLDER_ODD = "CONFIRMED_PLACEHOLDER_ODD"
MISSING_ODD = "MISSING_ODD"
INVALID_ODD = "INVALID_ODD"

MARKET_BASELINE_OK = "MARKET_BASELINE_OK"
NO_MARKET_BASELINE = "NO_MARKET_BASELINE"

MARGIN_PROBABILITY_OK = "MARGIN_PROBABILITY_OK"
MARGIN_FALLBACK_USED = "MARGIN_FALLBACK_USED"
INVALID_SIGMA = "INVALID_SIGMA"

HISTORICAL_COVER_OK = "HISTORICAL_COVER_OK"
LOW_HISTORY_SAMPLE = "LOW_HISTORY_SAMPLE"
NO_HISTORY = "NO_HISTORY"

SHADOW_READY = "SHADOW_READY"
INVALID_PAIR = "INVALID_PAIR"
INVALID_ODDS = "INVALID_ODDS"
OVERCONFIDENCE_FLAG = "OVERCONFIDENCE_FLAG"
DATA_QUALITY_WARNING = "DATA_QUALITY_WARNING"

DEFAULT_PRIOR = 0.50
DEFAULT_PRIOR_STRENGTH = 10.0
DEFAULT_MIN_SAMPLE = 5
DEFAULT_SIGMA_MARGIN = 12.0
DEFAULT_OVERCONFIDENCE_CAP = 0.70

DEFAULT_SHADOW_WEIGHTS = {
    "market": 0.40,
    "historical": 0.30,
    "margin": 0.30,
}


@dataclass
class OddClassification:
    status: str
    odd: float | None
    reasons: list[str] = field(default_factory=list)

    @property
    def is_usable(self) -> bool:
        return self.status in {VALID_ODD, POSSIBLE_PLACEHOLDER_ODD}

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class HandicapNoVigProbability:
    market_prob_home: float | None
    market_prob_away: float | None
    vig: float | None
    status: str
    home_odd_status: str | None = None
    away_odd_status: str | None = None
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class MarginCoverProbability:
    margin_cover_prob: float
    threshold: float
    mu_margin: float
    sigma_margin: float
    fallback_used: bool
    status: str
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ExpectedMarginEstimate:
    expected_points_team: float | None
    expected_points_opponent: float | None
    expected_margin: float | None
    league_regression_adjustment: float
    home_away_adjustment: float
    recent_form_adjustment: float
    data_quality_status: str
    components: dict[str, float | None] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class HistoricalCoverProbability:
    raw_cover_rate: float | None
    shrinked_cover_rate: float
    games_considered: int
    pushes: int
    fallback_used: bool
    fallback_reason: str
    status: str
    cover_wins: int = 0
    cover_losses: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class CombinedShadowProbability:
    final_shadow_prob: float
    components_used: dict[str, float]
    weights_used: dict[str, float]
    missing_components: list[str]
    fallback_used: bool
    overconfidence_flag: bool
    status: str
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class HandicapPickDiagnostic:
    jogo: str
    mandante: str
    visitante: str
    lado: str
    linha: float | None
    odd: float | None
    odd_oposta: float | None
    market_no_vig_prob: float | None
    historical_cover_prob: float | None
    margin_cover_prob: float | None
    final_shadow_prob: float | None
    odd_justa_shadow: float | None
    edge_shadow: float | None
    status: str
    alertas: list[str] = field(default_factory=list)
    componentes: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def classify_odd(value: Any, metadata: dict[str, Any] | None = None) -> OddClassification:
    odd = parse_float(value)
    meta = metadata or {}
    if odd is None:
        return OddClassification(MISSING_ODD, None, [MISSING_ODD])
    if odd <= 1:
        return OddClassification(INVALID_ODD, odd, [INVALID_ODD])

    if _metadata_marks_placeholder(meta):
        return OddClassification(CONFIRMED_PLACEHOLDER_ODD, odd, [CONFIRMED_PLACEHOLDER_ODD])

    if math.isclose(odd, 2.0, abs_tol=1e-12):
        if _metadata_has_real_source(meta):
            return OddClassification(VALID_ODD, odd)
        return OddClassification(POSSIBLE_PLACEHOLDER_ODD, odd, [POSSIBLE_PLACEHOLDER_ODD])

    return OddClassification(VALID_ODD, odd)


def _metadata_marks_placeholder(metadata: dict[str, Any]) -> bool:
    keys = {
        "odd_missing",
        "missing_odd",
        "odd_ausente",
        "generated_odd",
        "odd_generated",
        "fallback_odd",
        "odd_fallback",
        "artificial_odd",
        "placeholder_odd",
    }
    for key, value in metadata.items():
        key_text = str(key).strip().lower()
        value_text = str(value).strip().lower()
        if key_text in keys and value_text in {"1", "true", "sim", "yes", "y"}:
            return True
        if key_text in {"odd_status", "status_odd"} and value_text in {"missing", "fallback", "placeholder", "generated"}:
            return True
    return False


def _metadata_has_real_source(metadata: dict[str, Any]) -> bool:
    for key in ("bookmaker", "fonte", "source", "mercado", "market"):
        value = str(metadata.get(key) or "").strip()
        if value:
            return True
    return False


def calculate_handicap_no_vig_probability(
    home_odd: Any,
    away_odd: Any,
    *,
    home_metadata: dict[str, Any] | None = None,
    away_metadata: dict[str, Any] | None = None,
) -> HandicapNoVigProbability:
    home = classify_odd(home_odd, home_metadata)
    away = classify_odd(away_odd, away_metadata)
    reasons = list(home.reasons) + list(away.reasons)

    if not home.is_usable or not away.is_usable or home.odd is None or away.odd is None:
        return HandicapNoVigProbability(
            None,
            None,
            None,
            NO_MARKET_BASELINE,
            home.status,
            away.status,
            reasons or [NO_MARKET_BASELINE],
        )

    imp_home = 1 / home.odd
    imp_away = 1 / away.odd
    total = imp_home + imp_away
    if total <= 0:
        return HandicapNoVigProbability(None, None, None, NO_MARKET_BASELINE, home.status, away.status, ["INVALID_IMPLIED_PROBABILITY"])

    return HandicapNoVigProbability(
        market_prob_home=imp_home / total,
        market_prob_away=imp_away / total,
        vig=total - 1,
        status=MARKET_BASELINE_OK,
        home_odd_status=home.status,
        away_odd_status=away.status,
        reasons=reasons,
    )


def calculate_margin_cover_probability(
    mu_margin: Any,
    sigma_margin: Any,
    handicap_line: Any,
    *,
    fallback_sigma: float = DEFAULT_SIGMA_MARGIN,
) -> MarginCoverProbability:
    mu = parse_float(mu_margin)
    sigma = parse_float(sigma_margin)
    line = parse_float(handicap_line)
    if mu is None or line is None:
        raise ValueError("mu_margin e handicap_line precisam ser numericos.")

    fallback_used = False
    reasons: list[str] = []
    if sigma is None or sigma <= 0:
        sigma = fallback_sigma
        fallback_used = True
        reasons.append(INVALID_SIGMA)

    threshold = -line
    z = (threshold - mu) / sigma
    cdf = 0.5 * (1 + math.erf(z / math.sqrt(2)))
    probability = max(0.0, min(1.0, 1 - cdf))
    return MarginCoverProbability(
        margin_cover_prob=probability,
        threshold=threshold,
        mu_margin=mu,
        sigma_margin=sigma,
        fallback_used=fallback_used,
        status=MARGIN_FALLBACK_USED if fallback_used else MARGIN_PROBABILITY_OK,
        reasons=reasons,
    )


def estimate_expected_margin(
    team_stats: dict[str, Any],
    opponent_stats: dict[str, Any],
    *,
    league_avg_points: float = 80.0,
    is_home: bool = True,
) -> ExpectedMarginEstimate:
    team_for = parse_float(team_stats.get("avg_points_for") or team_stats.get("pontos_marcados_media"))
    team_against = parse_float(team_stats.get("avg_points_against") or team_stats.get("pontos_sofridos_media"))
    opp_for = parse_float(opponent_stats.get("avg_points_for") or opponent_stats.get("pontos_marcados_media"))
    opp_against = parse_float(opponent_stats.get("avg_points_against") or opponent_stats.get("pontos_sofridos_media"))

    warnings: list[str] = []
    if team_for is None or team_against is None or opp_for is None or opp_against is None:
        return ExpectedMarginEstimate(
            None,
            None,
            None,
            0.0,
            0.0,
            0.0,
            DATA_QUALITY_WARNING,
            warnings=["MISSING_SCORING_COMPONENTS"],
        )

    expected_team = (team_for + opp_against) / 2
    expected_opponent = (opp_for + team_against) / 2

    regression_strength = parse_float(team_stats.get("league_regression_strength")) or 0.10
    expected_team = (expected_team * (1 - regression_strength)) + (league_avg_points * regression_strength)
    expected_opponent = (expected_opponent * (1 - regression_strength)) + (league_avg_points * regression_strength)
    league_adjustment = regression_strength

    home_away_adjustment = 0.0
    if is_home:
        home_away_adjustment = parse_float(team_stats.get("home_margin_adjustment")) or 0.0
    else:
        home_away_adjustment = parse_float(team_stats.get("away_margin_adjustment")) or 0.0

    recent_form_adjustment = parse_float(team_stats.get("recent_margin_adjustment")) or 0.0
    margin = (expected_team - expected_opponent) + home_away_adjustment + recent_form_adjustment
    return ExpectedMarginEstimate(
        expected_points_team=expected_team,
        expected_points_opponent=expected_opponent,
        expected_margin=margin,
        league_regression_adjustment=league_adjustment,
        home_away_adjustment=home_away_adjustment,
        recent_form_adjustment=recent_form_adjustment,
        data_quality_status="OK",
        components={
            "team_avg_for": team_for,
            "team_avg_against": team_against,
            "opponent_avg_for": opp_for,
            "opponent_avg_against": opp_against,
        },
        warnings=warnings,
    )


def historical_cover_probability(
    team: str,
    opponent: str,
    handicap_line: Any,
    historical_games: Iterable[dict[str, Any]],
    *,
    prior: float = DEFAULT_PRIOR,
    prior_strength: float = DEFAULT_PRIOR_STRENGTH,
    min_sample: int = DEFAULT_MIN_SAMPLE,
) -> HistoricalCoverProbability:
    line = parse_float(handicap_line)
    if line is None:
        return HistoricalCoverProbability(None, prior, 0, 0, True, INVALID_LINE, INVALID_LINE)

    wins = 0
    losses = 0
    pushes = 0
    considered = 0
    for game in historical_games:
        points = _points_for_team(team, opponent, game)
        if points is None:
            continue
        result = evaluate_handicap_cover(points[0], points[1], line)
        if result.status == PUSH:
            pushes += 1
            continue
        considered += 1
        if result.status == GREEN:
            wins += 1
        elif result.status == RED:
            losses += 1

    if considered == 0:
        return HistoricalCoverProbability(None, prior, 0, pushes, True, NO_HISTORY, NO_HISTORY, wins, losses)

    raw = wins / considered
    shrinked = ((raw * considered) + (prior * prior_strength)) / (considered + prior_strength)
    if considered < 3:
        return HistoricalCoverProbability(raw, prior, considered, pushes, True, "LOW_SAMPLE_NEUTRAL_FALLBACK", LOW_HISTORY_SAMPLE, wins, losses)

    return HistoricalCoverProbability(
        raw_cover_rate=raw,
        shrinked_cover_rate=shrinked,
        games_considered=considered,
        pushes=pushes,
        fallback_used=considered < min_sample,
        fallback_reason="LOW_SAMPLE_SHRINKAGE" if considered < min_sample else "",
        status=LOW_HISTORY_SAMPLE if considered < min_sample else HISTORICAL_COVER_OK,
        cover_wins=wins,
        cover_losses=losses,
    )


def _points_for_team(team: str, opponent: str, game: dict[str, Any]) -> tuple[float, float] | None:
    if "pontos_time" in game and "pontos_adversario" in game:
        team_points = parse_float(game.get("pontos_time"))
        opponent_points = parse_float(game.get("pontos_adversario"))
        if team_points is not None and opponent_points is not None:
            return team_points, opponent_points

    home = str(game.get("mandante") or game.get("home") or "").strip().lower()
    away = str(game.get("visitante") or game.get("away") or "").strip().lower()
    team_norm = str(team or "").strip().lower()
    opponent_norm = str(opponent or "").strip().lower()
    home_points = parse_float(game.get("pontos_mandante") or game.get("home_points") or game.get("pts_home"))
    away_points = parse_float(game.get("pontos_visitante") or game.get("away_points") or game.get("pts_away"))
    if home_points is None or away_points is None:
        return None
    if team_norm and (team_norm == home or team_norm in home or home in team_norm):
        return home_points, away_points
    if team_norm and (team_norm == away or team_norm in away or away in team_norm):
        return away_points, home_points
    if opponent_norm and (opponent_norm == home or opponent_norm in home or home in opponent_norm):
        return away_points, home_points
    if opponent_norm and (opponent_norm == away or opponent_norm in away or away in opponent_norm):
        return home_points, away_points
    return None


def combine_shadow_probabilities(
    *,
    market_no_vig_prob: float | None,
    historical_cover_prob: float | None,
    margin_cover_prob: float | None,
    weights: dict[str, float] | None = None,
    neutral_fallback: float = DEFAULT_PRIOR,
    overconfidence_cap: float = DEFAULT_OVERCONFIDENCE_CAP,
) -> CombinedShadowProbability:
    configured = dict(DEFAULT_SHADOW_WEIGHTS if weights is None else weights)
    components = {
        "market": market_no_vig_prob,
        "historical": historical_cover_prob,
        "margin": margin_cover_prob,
    }
    valid_components = {
        name: float(value)
        for name, value in components.items()
        if value is not None and 0 <= float(value) <= 1
    }
    missing = [name for name in components if name not in valid_components]
    fallback_used = bool(missing)
    warnings = list(missing)

    if not valid_components:
        final = neutral_fallback
        used_weights = {"neutral": 1.0}
        fallback_used = True
    else:
        weight_sum = sum(configured.get(name, 0.0) for name in valid_components)
        if weight_sum <= 0:
            final = neutral_fallback
            used_weights = {"neutral": 1.0}
            fallback_used = True
        else:
            used_weights = {
                name: configured.get(name, 0.0) / weight_sum
                for name in valid_components
            }
            final = sum(valid_components[name] * used_weights[name] for name in valid_components)

    overconfidence = final > overconfidence_cap
    if overconfidence:
        warnings.append(OVERCONFIDENCE_FLAG)
        final = overconfidence_cap

    return CombinedShadowProbability(
        final_shadow_prob=max(0.0, min(1.0, final)),
        components_used=valid_components,
        weights_used=used_weights,
        missing_components=missing,
        fallback_used=fallback_used,
        overconfidence_flag=overconfidence,
        status=OVERCONFIDENCE_FLAG if overconfidence else SHADOW_READY,
        warnings=warnings,
    )


def build_handicap_pick_diagnostic(
    pair: WnbaHandicapPair,
    side: str,
    *,
    historical_games: Iterable[dict[str, Any]] | None = None,
    mu_margin: float | None = None,
    sigma_margin: float | None = None,
) -> HandicapPickDiagnostic:
    normalized_side = side.lower().strip()
    if normalized_side not in {"home", "away"}:
        raise ValueError("side deve ser home ou away.")

    if not pair.is_valid:
        return HandicapPickDiagnostic(
            pair.jogo,
            pair.mandante,
            pair.visitante,
            normalized_side,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            INVALID_PAIR,
            [pair.status] + pair.reasons,
        )

    line = pair.home_line if normalized_side == "home" else pair.away_line
    odd = pair.home_odd if normalized_side == "home" else pair.away_odd
    opposite_odd = pair.away_odd if normalized_side == "home" else pair.home_odd
    team = pair.mandante if normalized_side == "home" else pair.visitante
    opponent = pair.visitante if normalized_side == "home" else pair.mandante

    market = calculate_handicap_no_vig_probability(
        pair.home_odd,
        pair.away_odd,
        home_metadata=_side_row(pair, "home"),
        away_metadata=_side_row(pair, "away"),
    )
    market_prob = market.market_prob_home if normalized_side == "home" else market.market_prob_away
    historical = historical_cover_probability(team, opponent, line, historical_games or [])
    margin = calculate_margin_cover_probability(
        mu_margin if mu_margin is not None else 0.0,
        sigma_margin,
        line,
        fallback_sigma=DEFAULT_SIGMA_MARGIN,
    )
    combined = combine_shadow_probabilities(
        market_no_vig_prob=market_prob,
        historical_cover_prob=historical.shrinked_cover_rate,
        margin_cover_prob=margin.margin_cover_prob,
    )

    alerts = list(market.reasons)
    if market.status != MARKET_BASELINE_OK:
        alerts.append(NO_MARKET_BASELINE)
    if historical.fallback_used:
        alerts.append(historical.status)
    if margin.fallback_used:
        alerts.append(MARGIN_FALLBACK_USED)
    alerts.extend(combined.warnings)

    final = combined.final_shadow_prob
    odd_justa = 1 / final if final > 0 else None
    edge = (final * odd - 1) if odd is not None else None
    status = SHADOW_READY
    if market.status != MARKET_BASELINE_OK:
        status = NO_MARKET_BASELINE
    if combined.overconfidence_flag:
        status = OVERCONFIDENCE_FLAG

    return HandicapPickDiagnostic(
        jogo=pair.jogo,
        mandante=pair.mandante,
        visitante=pair.visitante,
        lado=normalized_side,
        linha=line,
        odd=odd,
        odd_oposta=opposite_odd,
        market_no_vig_prob=market_prob,
        historical_cover_prob=historical.shrinked_cover_rate,
        margin_cover_prob=margin.margin_cover_prob,
        final_shadow_prob=final,
        odd_justa_shadow=odd_justa,
        edge_shadow=edge,
        status=status,
        alertas=sorted(set(alerts)),
        componentes={
            "market": market.to_dict(),
            "historical": historical.to_dict(),
            "margin": margin.to_dict(),
            "combined": combined.to_dict(),
        },
    )


def _side_row(pair: WnbaHandicapPair, side: str) -> dict[str, Any]:
    for row in pair.raw_rows:
        if identify_pick_side(row.get("pick"), pair.mandante, pair.visitante) == side:
            return row
    return {}


def read_validated_wnba_handicap_pairs(rows: Iterable[dict[str, Any]]) -> list[WnbaHandicapPair]:
    eligible = [
        row
        for row in rows
        if is_wnba_row(row) and is_handicap_market(row.get("mercado") or row.get("market"))
    ]
    return read_wnba_handicap_pairs(eligible, placeholder_odds=())
