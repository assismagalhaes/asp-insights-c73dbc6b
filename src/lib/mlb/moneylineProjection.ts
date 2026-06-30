import type { EnrichedMlbGame, MlbMarketOdd, MlbTeamStanding } from "@/types/mlbStandings";
import type {
  MlbMoneylineProjectionConfig,
  MlbMoneylineProjectionInput,
  MlbMoneylineScreenerRow,
  MlbNoVigMoneylineMarket,
  MlbProjectionCandidateStatus,
  MlbTeamRatingInput,
  MlbTeamSimpleRating,
} from "@/types/mlbProjections";
import { matchMlbTeamName } from "@/utils/mlbTeamNameMap";

export const MLB_SIMPLE_RATING_WEIGHTS = {
  srs: 0.30,
  runDiffPerGame: 0.25,
  pythWinPct: 0.15,
  winPct: 0.10,
  recentFormLast30: 0.10,
  homeRoadSplit: 0.05,
  luckRegression: 0.05,
} satisfies MlbMoneylineProjectionConfig["weights"];

export const MLB_HOME_FIELD_ADVANTAGE = 0.15;
export const MLB_MONEYLINE_LOGISTIC_SCALE = 0.85;

export const MLB_MONEYLINE_THRESHOLDS = {
  analyzeEv: 0.05,
  analyzeProbGap: 0.04,
  monitorEv: 0.02,
  monitorProbGap: 0.025,
  minOdd: 1.50,
  maxOdd: 2.80,
} satisfies MlbMoneylineProjectionConfig["thresholds"];

export const MLB_MONEYLINE_PROJECTION_CONFIG: MlbMoneylineProjectionConfig = {
  weights: MLB_SIMPLE_RATING_WEIGHTS,
  homeFieldAdvantage: MLB_HOME_FIELD_ADVANTAGE,
  logisticScale: MLB_MONEYLINE_LOGISTIC_SCALE,
  minModelProb: 0.25,
  maxModelProb: 0.75,
  thresholds: MLB_MONEYLINE_THRESHOLDS,
};

export function calculateMlbTeamSimpleRating(input: MlbTeamRatingInput): MlbTeamSimpleRating {
  const config = mergeConfig(input.config);
  const { standings, venue } = input;
  const missingFields = missingRatingFields(standings, venue);
  const recentPct = firstWinPct(
    [standings.last30_wins, standings.last30_losses],
    [standings.last20_wins, standings.last20_losses],
    [standings.last10_wins, standings.last10_losses],
  );
  const contextualPct = venue === "home" ? standings.home_win_pct : standings.road_win_pct;
  const ratingComponents = {
    srs_component: clampNumber(standings.srs ?? 0, -2.5, 2.5),
    run_diff_component: clampNumber(standings.run_diff_per_game ?? 0, -2.5, 2.5),
    pyth_component: ((standings.pyth_win_pct ?? 0.5) - 0.5) * 4,
    win_pct_component: ((standings.win_pct ?? 0.5) - 0.5) * 3,
    recent_form_component: ((recentPct ?? 0.5) - 0.5) * 2,
    home_road_component: ((contextualPct ?? 0.5) - 0.5) * 1.5,
    luck_component: clampNumber(-(standings.luck ?? 0) / 10, -0.5, 0.5),
  };

  const rating =
    config.weights.srs * ratingComponents.srs_component +
    config.weights.runDiffPerGame * ratingComponents.run_diff_component +
    config.weights.pythWinPct * ratingComponents.pyth_component +
    config.weights.winPct * ratingComponents.win_pct_component +
    config.weights.recentFormLast30 * ratingComponents.recent_form_component +
    config.weights.homeRoadSplit * ratingComponents.home_road_component +
    config.weights.luckRegression * ratingComponents.luck_component;

  return {
    team_key: standings.team_key,
    team_name: standings.team_name,
    venue,
    team_simple_rating: round(rating, 4),
    rating_components: mapValues(ratingComponents, (value) => round(value, 4)),
    missing_fields: missingFields,
  };
}

export function calculateMlbMoneylineProjection(input: MlbMoneylineProjectionInput): MlbMoneylineScreenerRow {
  const config = mergeConfig(input.config);
  const { game } = input;
  const moneyline = pickMoneylineOdds(game);
  const missingFields = getMissingProjectionFields(game, moneyline);
  const baseRow = baseProjectionRow(game, moneyline, missingFields);

  if (missingFields.length) {
    return {
      ...baseRow,
      candidate_status: "missing_data",
      projection_status: "missing_data",
      alerts: [...baseRow.alerts, ...missingFields.map((field) => `Dado ausente: ${field}`)],
    };
  }

  const homeOdd = moneyline.homeOdd?.odd as number;
  const awayOdd = moneyline.awayOdd?.odd as number;
  const market = calculateNoVigMoneylineMarket(homeOdd, awayOdd);
  const homeRating = calculateMlbTeamSimpleRating({ standings: game.home_standings as MlbTeamStanding, venue: "home", config });
  const awayRating = calculateMlbTeamSimpleRating({ standings: game.away_standings as MlbTeamStanding, venue: "away", config });
  const ratingDiff = homeRating.team_simple_rating - awayRating.team_simple_rating + config.homeFieldAdvantage;
  const homeModelProb = clampNumber(
    logistic(ratingDiff * config.logisticScale),
    config.minModelProb,
    config.maxModelProb,
  );
  const awayModelProb = 1 - homeModelProb;
  const homeFairOdd = calculateFairOdd(homeModelProb);
  const awayFairOdd = calculateFairOdd(awayModelProb);
  const homeEv = calculateExpectedValue(homeModelProb, homeOdd);
  const awayEv = calculateExpectedValue(awayModelProb, awayOdd);
  const recommendation = getRecommendation({
    game,
    homeOdd,
    awayOdd,
    homeModelProb,
    awayModelProb,
    homeFairOdd,
    awayFairOdd,
    homeEv,
    awayEv,
  });
  const candidateStatus = classifyCandidate({
    recommendedEv: recommendation.recommended_ev,
    recommendedOdd: recommendation.recommended_odd,
    recommendedProbGap: recommendation.side === "home"
      ? homeModelProb - market.home_market_implied_prob_no_vig
      : recommendation.side === "away"
        ? awayModelProb - market.away_market_implied_prob_no_vig
        : Math.max(homeModelProb - market.home_market_implied_prob_no_vig, awayModelProb - market.away_market_implied_prob_no_vig),
    config,
  });

  return {
    ...baseRow,
    home_market_implied_prob_raw: round(market.home_market_implied_prob_raw, 4),
    away_market_implied_prob_raw: round(market.away_market_implied_prob_raw, 4),
    home_market_implied_prob_no_vig: round(market.home_market_implied_prob_no_vig, 4),
    away_market_implied_prob_no_vig: round(market.away_market_implied_prob_no_vig, 4),
    market_overround: round(market.market_overround, 4),
    home_team_rating: homeRating.team_simple_rating,
    away_team_rating: awayRating.team_simple_rating,
    rating_diff: round(ratingDiff, 4),
    home_model_prob: round(homeModelProb, 4),
    away_model_prob: round(awayModelProb, 4),
    home_fair_odd: homeFairOdd,
    away_fair_odd: awayFairOdd,
    home_ev: round(homeEv, 4),
    away_ev: round(awayEv, 4),
    recommended_side: recommendation.recommended_side,
    recommended_odd: recommendation.recommended_odd,
    recommended_model_prob: recommendation.recommended_model_prob,
    recommended_fair_odd: recommendation.recommended_fair_odd,
    recommended_ev: recommendation.recommended_ev,
    candidate_status: candidateStatus,
    reasons: buildReasons({
      game,
      homeRating,
      awayRating,
      homeModelProb,
      awayModelProb,
      homeFairOdd,
      awayFairOdd,
      homeOdd,
      awayOdd,
      recommendationSide: recommendation.side,
    }),
    alerts: buildAlerts({ candidateStatus, homeRating, awayRating, homeEv, awayEv }),
    projection_status: "ok",
    rating_payload: {
      home: homeRating,
      away: awayRating,
    },
  };
}

export function calculateNoVigMoneylineMarket(homeOdd: number, awayOdd: number): MlbNoVigMoneylineMarket {
  const homeRaw = 1 / homeOdd;
  const awayRaw = 1 / awayOdd;
  const sum = homeRaw + awayRaw;
  return {
    home_market_implied_prob_raw: homeRaw,
    away_market_implied_prob_raw: awayRaw,
    home_market_implied_prob_no_vig: homeRaw / sum,
    away_market_implied_prob_no_vig: awayRaw / sum,
    market_overround: sum - 1,
  };
}

export function calculateExpectedValue(modelProb: number, offeredOdd: number) {
  return modelProb * offeredOdd - 1;
}

export function calculateFairOdd(modelProb: number) {
  return round(1 / modelProb, 2);
}

export function buildMlbMoneylineScreenerRows(
  games: EnrichedMlbGame[],
  config?: Partial<MlbMoneylineProjectionConfig>,
): MlbMoneylineScreenerRow[] {
  const seen = new Set<string>();
  return games.map((game) => {
    const projection = calculateMlbMoneylineProjection({ game, config });
    if (seen.has(game.game_id)) {
      return {
        ...projection,
        alerts: [...projection.alerts, "game_id duplicado no slate"],
      };
    }
    seen.add(game.game_id);
    return projection;
  });
}

function baseProjectionRow(
  game: EnrichedMlbGame,
  moneyline: ReturnType<typeof pickMoneylineOdds>,
  missingFields: string[],
): MlbMoneylineScreenerRow {
  const alerts = [
    "Modelo simples de screener: ainda nao considera starters, lineups, bullpen, clima ou validacao critica.",
    ...moneyline.alerts,
  ];
  return {
    game_id: game.game_id,
    date: game.date,
    time: game.time,
    home_team: game.home_team,
    away_team: game.away_team,
    market: "Moneyline",
    home_team_key: game.home_team_key,
    away_team_key: game.away_team_key,
    home_pick: moneyline.homeOdd?.pick ?? game.home_team,
    home_odd: moneyline.homeOdd?.odd ?? null,
    away_pick: moneyline.awayOdd?.pick ?? game.away_team,
    away_odd: moneyline.awayOdd?.odd ?? null,
    home_market_implied_prob_raw: null,
    away_market_implied_prob_raw: null,
    home_market_implied_prob_no_vig: null,
    away_market_implied_prob_no_vig: null,
    market_overround: null,
    home_team_rating: null,
    away_team_rating: null,
    rating_diff: null,
    home_model_prob: null,
    away_model_prob: null,
    home_fair_odd: null,
    away_fair_odd: null,
    home_ev: null,
    away_ev: null,
    recommended_side: null,
    recommended_odd: null,
    recommended_model_prob: null,
    recommended_fair_odd: null,
    recommended_ev: null,
    candidate_status: "pular",
    reasons: [],
    alerts,
    projection_status: "ok",
    missing_fields: missingFields,
    rating_payload: {
      home: null,
      away: null,
    },
    game,
  };
}

function pickMoneylineOdds(game: EnrichedMlbGame): {
  homeOdd: MlbMarketOdd | null;
  awayOdd: MlbMarketOdd | null;
  alerts: string[];
} {
  const moneylineMarkets = game.markets.filter((market) => isMoneylineMarket(market.market));
  const homeMatches = moneylineMarkets.filter((market) => market.odd && isTeamPick(market.pick, game.home_team_key, game.home_team));
  const awayMatches = moneylineMarkets.filter((market) => market.odd && isTeamPick(market.pick, game.away_team_key, game.away_team));
  const alerts: string[] = [];
  if (homeMatches.length > 1) alerts.push("Odds Moneyline duplicadas para o mandante; usando a maior odd disponivel.");
  if (awayMatches.length > 1) alerts.push("Odds Moneyline duplicadas para o visitante; usando a maior odd disponivel.");
  return {
    homeOdd: pickBestOdd(homeMatches),
    awayOdd: pickBestOdd(awayMatches),
    alerts,
  };
}

function isMoneylineMarket(market: string | null) {
  return /moneyline|match winner|winner|vencedor/i.test(String(market ?? ""));
}

function isTeamPick(pick: string | null, teamKey: string | null, fallbackName: string) {
  if (!pick) return false;
  const pickKey = matchMlbTeamName(pick);
  if (teamKey && pickKey === teamKey) return true;
  return pick.trim().toLowerCase() === fallbackName.trim().toLowerCase();
}

function pickBestOdd(markets: MlbMarketOdd[]) {
  return markets
    .filter((market) => Number.isFinite(Number(market.odd)) && Number(market.odd) > 1)
    .sort((a, b) => Number(b.odd) - Number(a.odd))[0] ?? null;
}

function getMissingProjectionFields(
  game: EnrichedMlbGame,
  moneyline: ReturnType<typeof pickMoneylineOdds>,
) {
  const missing: string[] = [];
  if (game.standings_status !== "matched") missing.push("standings_status matched");
  if (!game.home_standings) missing.push("home_standings");
  if (!game.away_standings) missing.push("away_standings");
  if (!game.home_team_key) missing.push("home_team_key");
  if (!game.away_team_key) missing.push("away_team_key");
  if (!moneyline.homeOdd?.odd) missing.push("Moneyline mandante");
  if (!moneyline.awayOdd?.odd) missing.push("Moneyline visitante");
  if (moneyline.homeOdd?.odd != null && Number(moneyline.homeOdd.odd) <= 1) missing.push("odd mandante valida");
  if (moneyline.awayOdd?.odd != null && Number(moneyline.awayOdd.odd) <= 1) missing.push("odd visitante valida");
  return missing;
}

function missingRatingFields(standings: MlbTeamStanding, venue: "home" | "away") {
  const fields: string[] = [];
  if (standings.srs == null) fields.push("srs");
  if (standings.run_diff_per_game == null) fields.push("run_diff_per_game");
  if (standings.pyth_win_pct == null) fields.push("pyth_win_pct");
  if (standings.win_pct == null) fields.push("win_pct");
  if (standings.last30_wins == null || standings.last30_losses == null) fields.push("last30");
  if (venue === "home" && standings.home_win_pct == null) fields.push("home_win_pct");
  if (venue === "away" && standings.road_win_pct == null) fields.push("road_win_pct");
  if (standings.luck == null) fields.push("luck");
  return fields;
}

function getRecommendation(input: {
  game: EnrichedMlbGame;
  homeOdd: number;
  awayOdd: number;
  homeModelProb: number;
  awayModelProb: number;
  homeFairOdd: number;
  awayFairOdd: number;
  homeEv: number;
  awayEv: number;
}) {
  const home = {
    side: "home" as const,
    recommended_side: input.game.home_team,
    recommended_odd: input.homeOdd,
    recommended_model_prob: round(input.homeModelProb, 4),
    recommended_fair_odd: input.homeFairOdd,
    recommended_ev: round(input.homeEv, 4),
  };
  const away = {
    side: "away" as const,
    recommended_side: input.game.away_team,
    recommended_odd: input.awayOdd,
    recommended_model_prob: round(input.awayModelProb, 4),
    recommended_fair_odd: input.awayFairOdd,
    recommended_ev: round(input.awayEv, 4),
  };
  const best = home.recommended_ev >= away.recommended_ev ? home : away;
  if (best.recommended_ev <= 0) {
    return {
      side: null,
      recommended_side: null,
      recommended_odd: null,
      recommended_model_prob: null,
      recommended_fair_odd: null,
      recommended_ev: null,
    };
  }
  return best;
}

function classifyCandidate(input: {
  recommendedEv: number | null;
  recommendedOdd: number | null;
  recommendedProbGap: number;
  config: MlbMoneylineProjectionConfig;
}): MlbProjectionCandidateStatus {
  const ev = input.recommendedEv ?? Number.NEGATIVE_INFINITY;
  const odd = input.recommendedOdd ?? 0;
  const gap = input.recommendedProbGap;
  const { thresholds } = input.config;
  if (ev >= thresholds.analyzeEv && gap >= thresholds.analyzeProbGap && odd >= thresholds.minOdd && odd <= thresholds.maxOdd) {
    return "analisar";
  }
  if (ev >= thresholds.monitorEv || gap >= thresholds.monitorProbGap) return "monitorar";
  return "pular";
}

function buildReasons(input: {
  game: EnrichedMlbGame;
  homeRating: MlbTeamSimpleRating;
  awayRating: MlbTeamSimpleRating;
  homeModelProb: number;
  awayModelProb: number;
  homeFairOdd: number;
  awayFairOdd: number;
  homeOdd: number;
  awayOdd: number;
  recommendationSide: "home" | "away" | null;
}) {
  if (!input.recommendationSide) return ["Nenhum lado com EV positivo no modelo simples."];
  const selected = input.recommendationSide === "home" ? input.homeRating : input.awayRating;
  const opponent = input.recommendationSide === "home" ? input.awayRating : input.homeRating;
  const selectedOdd = input.recommendationSide === "home" ? input.homeOdd : input.awayOdd;
  const selectedFairOdd = input.recommendationSide === "home" ? input.homeFairOdd : input.awayFairOdd;
  const selectedProb = input.recommendationSide === "home" ? input.homeModelProb : input.awayModelProb;
  const reasons = [
    selected.team_simple_rating > opponent.team_simple_rating ? "Rating simples superior ao adversario" : "Ajuste contextual mantem EV apesar de rating inferior",
    selected.rating_components.srs_component > opponent.rating_components.srs_component ? "SRS superior" : null,
    selected.rating_components.run_diff_component > opponent.rating_components.run_diff_component ? "Run differential por jogo superior" : null,
    selected.rating_components.pyth_component > selected.rating_components.win_pct_component ? "Pythagorean W-L% sugere desempenho melhor que o recorde real" : null,
    selected.rating_components.recent_form_component > 0 ? "Forma recente positiva" : null,
    selectedOdd > selectedFairOdd ? "Mercado oferece odd acima da odd justa ASP" : null,
    selectedProb >= 0.5 ? "Probabilidade ASP acima de 50%" : null,
  ].filter(Boolean) as string[];
  return [...new Set(reasons)];
}

function buildAlerts(input: {
  candidateStatus: MlbProjectionCandidateStatus;
  homeRating: MlbTeamSimpleRating;
  awayRating: MlbTeamSimpleRating;
  homeEv: number;
  awayEv: number;
}) {
  const alerts = [
    "Modelo ainda nao considera starters",
    "Modelo ainda nao considera bullpen",
    "Modelo ainda nao considera lineup confirmado",
  ];
  if (input.homeRating.missing_fields.length) alerts.push(`Standings incompletos para mandante: ${input.homeRating.missing_fields.join(", ")}`);
  if (input.awayRating.missing_fields.length) alerts.push(`Standings incompletos para visitante: ${input.awayRating.missing_fields.join(", ")}`);
  if (input.candidateStatus === "monitorar") alerts.push("Edge pequeno contra mercado");
  if (Math.max(input.homeEv, input.awayEv) < 0.02) alerts.push("EV preliminar abaixo do corte minimo");
  return alerts;
}

function firstWinPct(...records: Array<[number | null, number | null]>) {
  for (const [wins, losses] of records) {
    if (wins == null || losses == null || wins + losses <= 0) continue;
    return wins / (wins + losses);
  }
  return null;
}

function logistic(value: number) {
  return 1 / (1 + Math.exp(-value));
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function mapValues<T extends Record<string, number>>(obj: T, fn: (value: number) => number): T {
  return Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, fn(value)])) as T;
}

function mergeConfig(config?: Partial<MlbMoneylineProjectionConfig>): MlbMoneylineProjectionConfig {
  return {
    ...MLB_MONEYLINE_PROJECTION_CONFIG,
    ...config,
    weights: {
      ...MLB_MONEYLINE_PROJECTION_CONFIG.weights,
      ...config?.weights,
    },
    thresholds: {
      ...MLB_MONEYLINE_PROJECTION_CONFIG.thresholds,
      ...config?.thresholds,
    },
  };
}
