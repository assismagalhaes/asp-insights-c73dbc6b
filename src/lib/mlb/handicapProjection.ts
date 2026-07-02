import type { EnrichedMlbGame, MlbLeagueAverageSnapshot, MlbMarketOdd, MlbTeamStanding } from "@/types/mlbStandings";
import type {
  MlbHandicapCandidateStatus,
  MlbHandicapCoverProbabilities,
  MlbHandicapMarketNoVig,
  MlbHandicapProjectionConfig,
  MlbHandicapScreenerRow,
  MlbHandicapSide,
  MlbLeagueAverageContext,
  MlbRunDistribution,
} from "@/types/mlbProjections";
import { matchMlbTeamName } from "@/utils/mlbTeamNameMap";
import { calculateMlbProjectedTotal, getLeagueAverageContext } from "@/lib/mlb/totalsProjection";

export const MLB_HANDICAP_THRESHOLDS = {
  analyzeEv: 0.06,
  analyzeProbGap: 0.05,
  monitorEv: 0.02,
  monitorProbGap: 0.03,
  minOdd: 1.55,
  maxOdd: 3.00,
  maxAnalyzeDistanceFromMainLine: 1.0,
  maxAnalyzeOdd: 3.00,
  minAnalyzeOdd: 1.55,
  tailMassWarning: 0.995,
  runlineMinusMargin: 0.75,
  runlineMinusEv: 0.08,
  runlineMinusProbGap: 0.06,
  runlinePlusEv: 0.06,
  runlinePlusProbGap: 0.05,
  maxAnalyzeAbsLine: 1.5,
} satisfies MlbHandicapProjectionConfig["thresholds"];

export const MLB_HANDICAP_PROJECTION_CONFIG: MlbHandicapProjectionConfig = {
  maxRunsBase: 20,
  maxRunsCap: 30,
  dynamicRunsStdDevMultiplier: 8,
  thresholds: MLB_HANDICAP_THRESHOLDS,
};

type HandicapLineGroup = {
  canonicalHomeLine: number;
  homeOdd: MlbMarketOdd | null;
  awayOdd: MlbMarketOdd | null;
  homeLine: number | null;
  awayLine: number | null;
  alerts: string[];
};

export function calculateMlbRunDistribution(lambda: number, maxRuns: number) {
  const distribution: Record<number, number> = {};
  if (!Number.isFinite(lambda) || lambda <= 0 || maxRuns < 0) return distribution;
  let probability = Math.exp(-lambda);
  distribution[0] = probability;
  for (let runs = 1; runs <= maxRuns; runs++) {
    probability *= lambda / runs;
    distribution[runs] = probability;
  }
  return distribution;
}

export function calculateMlbMarginDistribution(params: {
  homeLambda: number;
  awayLambda: number;
  maxRuns?: number;
  config?: Partial<MlbHandicapProjectionConfig>;
}): MlbRunDistribution {
  const config = mergeHandicapConfig(params.config);
  const maxRuns = params.maxRuns ?? getDynamicMaxRuns(params.homeLambda, params.awayLambda, config);
  const homeDistribution = calculateMlbRunDistribution(params.homeLambda, maxRuns);
  const awayDistribution = calculateMlbRunDistribution(params.awayLambda, maxRuns);
  const marginDistribution: Record<number, number> = {};
  let capturedMass = 0;

  for (const [homeRunsRaw, homeProb] of Object.entries(homeDistribution)) {
    for (const [awayRunsRaw, awayProb] of Object.entries(awayDistribution)) {
      const margin = Number(homeRunsRaw) - Number(awayRunsRaw);
      const jointProb = homeProb * awayProb;
      marginDistribution[margin] = (marginDistribution[margin] ?? 0) + jointProb;
      capturedMass += jointProb;
    }
  }

  const normalized = Object.fromEntries(
    Object.entries(marginDistribution).map(([margin, probability]) => [
      Number(margin),
      capturedMass > 0 ? probability / capturedMass : 0,
    ]),
  ) as Record<number, number>;

  return {
    probabilities: normalized,
    max_runs: maxRuns,
    mass_before_normalization: round(capturedMass, 6),
    tail_warning: capturedMass < config.thresholds.tailMassWarning,
  };
}

export function calculateHandicapCoverProbabilities(
  marginDistribution: Record<number, number>,
  side: MlbHandicapSide,
  line: number,
): MlbHandicapCoverProbabilities {
  const lineKind = getSupportedLineKind(line);
  if (lineKind === "unsupported") {
    return { win_prob: 0, push_prob: 0, loss_prob: 0, supported_line_type: false, line_kind: "unsupported" };
  }

  let win = 0;
  let push = 0;
  let loss = 0;
  for (const [marginRaw, probability] of Object.entries(marginDistribution)) {
    const margin = Number(marginRaw);
    const sideMargin = side === "home" ? margin : -margin;
    const adjustedResult = sideMargin + line;
    if (closeTo(adjustedResult, 0)) push += probability;
    else if (adjustedResult > 0) win += probability;
    else loss += probability;
  }

  return {
    win_prob: round(win, 6),
    push_prob: lineKind === "integer" ? round(push, 6) : 0,
    loss_prob: round(loss, 6),
    supported_line_type: true,
    line_kind: lineKind,
  };
}

export function calculateAsianHandicapEv(probabilities: MlbHandicapCoverProbabilities, odd: number) {
  if (!probabilities.supported_line_type || !Number.isFinite(odd) || odd <= 1) return null;
  return probabilities.win_prob * (odd - 1) - probabilities.loss_prob;
}

export function calculateHandicapMarketNoVig(homeOdd: number, awayOdd: number): MlbHandicapMarketNoVig {
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

export function normalizeHandicapMarketRows(game: EnrichedMlbGame): HandicapLineGroup[] {
  const groups = new Map<number, HandicapLineGroup>();

  for (const market of game.markets) {
    if (!isHandicapMarket(market.market)) continue;
    const line = parseHandicapLine(market.line);
    const side = getPickSide(market.pick, game);
    if (line == null || !side) {
      const fallbackKey = Number.isFinite(line) ? Number(line) : Number.NaN;
      const key = Number.isFinite(fallbackKey) ? fallbackKey : 9999 + groups.size;
      const group = groups.get(key) ?? {
        canonicalHomeLine: key,
        homeOdd: null,
        awayOdd: null,
        homeLine: null,
        awayLine: null,
        alerts: [],
      };
      group.alerts.push(!side ? "Pick do handicap nao corresponde ao mandante ou visitante." : "Linha de handicap invalida.");
      groups.set(key, group);
      continue;
    }

    const canonicalHomeLine = side === "home" ? line : -line;
    const group = groups.get(canonicalHomeLine) ?? {
      canonicalHomeLine,
      homeOdd: null,
      awayOdd: null,
      homeLine: canonicalHomeLine,
      awayLine: -canonicalHomeLine,
      alerts: [],
    };

    if (side === "home") {
      if (group.homeOdd) group.alerts.push("Odds Handicap duplicadas para o mandante; usando a maior odd disponivel.");
      group.homeOdd = pickBestOdd([group.homeOdd, market]);
      group.homeLine = line;
    } else {
      if (group.awayOdd) group.alerts.push("Odds Handicap duplicadas para o visitante; usando a maior odd disponivel.");
      group.awayOdd = pickBestOdd([group.awayOdd, market]);
      group.awayLine = line;
    }
    groups.set(canonicalHomeLine, group);
  }

  return [...groups.values()];
}

export function identifyMainHandicapLine(game: EnrichedMlbGame, groups: HandicapLineGroup[]) {
  const pairedGroups = groups.filter((group) => group.homeOdd?.odd && group.awayOdd?.odd && Number.isFinite(group.canonicalHomeLine));
  if (!pairedGroups.length) return null;

  const favorite = identifyMoneylineFavorite(game);
  if (favorite) {
    const targetHomeLine = favorite === "home" ? -1.5 : 1.5;
    const standardLine = pairedGroups.find((group) => closeTo(group.canonicalHomeLine, targetHomeLine));
    if (standardLine) return standardLine.canonicalHomeLine;
  }

  const balanced = pairedGroups
    .map((group) => {
      const market = calculateHandicapMarketNoVig(Number(group.homeOdd?.odd), Number(group.awayOdd?.odd));
      return {
        line: group.canonicalHomeLine,
        distanceToBalancedMarket: Math.abs(market.home_market_implied_prob_no_vig - 0.5),
      };
    })
    .sort((a, b) => a.distanceToBalancedMarket - b.distanceToBalancedMarket || Math.abs(Math.abs(a.line) - 1.5) - Math.abs(Math.abs(b.line) - 1.5));

  return balanced[0]?.line ?? pairedGroups
    .sort((a, b) => Math.abs(Math.abs(a.canonicalHomeLine) - 1.5) - Math.abs(Math.abs(b.canonicalHomeLine) - 1.5))[0]
    ?.canonicalHomeLine ?? null;
}

export function calculateMlbHandicapProjection(params: {
  game: EnrichedMlbGame;
  lineGroup: HandicapLineGroup;
  mainHomeHandicapLine: number | null;
  leagueAverage: MlbLeagueAverageContext;
  config?: Partial<MlbHandicapProjectionConfig>;
}): MlbHandicapScreenerRow {
  const config = mergeHandicapConfig(params.config);
  const distanceFromMain = params.mainHomeHandicapLine == null
    ? null
    : round(Math.abs(Math.abs(params.lineGroup.canonicalHomeLine) - Math.abs(params.mainHomeHandicapLine)), 2);
  const missingFields = getMissingHandicapFields(params.game, params.lineGroup);
  const baseRow = baseHandicapRow(params, missingFields, distanceFromMain);

  if (missingFields.length) {
    return {
      ...baseRow,
      candidate_status: "missing_data",
      projection_status: "missing_data",
      alerts: [...baseRow.alerts, ...missingFields.map((field) => `Dado ausente: ${field}`)],
    };
  }

  const homeOdd = Number(params.lineGroup.homeOdd?.odd);
  const awayOdd = Number(params.lineGroup.awayOdd?.odd);
  const homeLine = Number(params.lineGroup.homeLine);
  const awayLine = Number(params.lineGroup.awayLine);
  const market = calculateHandicapMarketNoVig(homeOdd, awayOdd);
  const projected = calculateMlbProjectedTotal({
    game: params.game,
    leagueAverage: params.leagueAverage,
  });
  const homeExpectedRuns = projected.home?.final_expected_runs ?? null;
  const awayExpectedRuns = projected.away?.final_expected_runs ?? null;

  if (homeExpectedRuns == null || awayExpectedRuns == null) {
    return {
      ...baseRow,
      candidate_status: "missing_data",
      projection_status: "missing_data",
      alerts: [...baseRow.alerts, "Expected runs ausente para um dos times."],
      missing_fields: [...baseRow.missing_fields, "expected_runs"],
      components: { ...baseRow.components, home: projected.home, away: projected.away },
    };
  }

  const projectedMargin = homeExpectedRuns - awayExpectedRuns;
  const marginDistribution = calculateMlbMarginDistribution({
    homeLambda: homeExpectedRuns,
    awayLambda: awayExpectedRuns,
    config,
  });
  const homeCover = calculateHandicapCoverProbabilities(marginDistribution.probabilities, "home", homeLine);
  const awayCover = calculateHandicapCoverProbabilities(marginDistribution.probabilities, "away", awayLine);

  if (!homeCover.supported_line_type || !awayCover.supported_line_type) {
    return {
      ...baseRow,
      ...marketFields(market),
      home_expected_runs: homeExpectedRuns,
      away_expected_runs: awayExpectedRuns,
      projected_total_runs: round(homeExpectedRuns + awayExpectedRuns, 4),
      projected_margin: round(projectedMargin, 4),
      candidate_status: "unsupported_line",
      projection_status: "unsupported_line",
      alerts: [...baseRow.alerts, "Linha .25/.75 ainda nao suportada nesta etapa."],
      components: {
        margin_distribution_summary: {
          distribution_max_runs: marginDistribution.max_runs,
          distribution_mass_before_normalization: marginDistribution.mass_before_normalization,
          distribution_tail_warning: marginDistribution.tail_warning,
        },
        home: projected.home,
        away: projected.away,
      },
    };
  }

  const homeFairOdd = calculatePushAwareFairOdd(homeCover);
  const awayFairOdd = calculatePushAwareFairOdd(awayCover);
  const homeEv = calculateAsianHandicapEv(homeCover, homeOdd) ?? 0;
  const awayEv = calculateAsianHandicapEv(awayCover, awayOdd) ?? 0;
  const recommendation = getHandicapRecommendation({
    game: params.game,
    homeLine,
    awayLine,
    homeOdd,
    awayOdd,
    homeCover,
    awayCover,
    homeFairOdd,
    awayFairOdd,
    homeEv,
    awayEv,
  });
  const probGap = recommendation.recommended_side === "home"
    ? homeCover.win_prob - market.home_market_implied_prob_no_vig
    : recommendation.recommended_side === "away"
      ? awayCover.win_prob - market.away_market_implied_prob_no_vig
      : Math.max(
        homeCover.win_prob - market.home_market_implied_prob_no_vig,
        awayCover.win_prob - market.away_market_implied_prob_no_vig,
      );
  const candidateStatus = classifyHandicapCandidate({
    recommendedEv: recommendation.recommended_ev,
    recommendedOdd: recommendation.recommended_odd,
    recommendedLine: recommendation.recommended_line,
    recommendedSide: recommendation.recommended_side,
    recommendedProbGap: probGap,
    projectedMargin,
    distanceFromMain,
    distributionTailWarning: marginDistribution.tail_warning,
    config,
  });
  const alerts = buildHandicapAlerts({
    row: baseRow,
    candidateStatus,
    distanceFromMain,
    recommendedOdd: recommendation.recommended_odd,
    recommendedLine: recommendation.recommended_line,
    recommendedSide: recommendation.recommended_side,
    projectedMargin,
    distributionTailWarning: marginDistribution.tail_warning,
    leagueAverage: params.leagueAverage,
    homePushProb: homeCover.push_prob,
    awayPushProb: awayCover.push_prob,
  });

  return {
    ...baseRow,
    ...marketFields(market),
    home_expected_runs: homeExpectedRuns,
    away_expected_runs: awayExpectedRuns,
    projected_total_runs: round(homeExpectedRuns + awayExpectedRuns, 4),
    projected_margin: round(projectedMargin, 4),
    home_cover_prob: round(homeCover.win_prob, 4),
    home_push_prob: round(homeCover.push_prob, 4),
    home_loss_prob: round(homeCover.loss_prob, 4),
    away_cover_prob: round(awayCover.win_prob, 4),
    away_push_prob: round(awayCover.push_prob, 4),
    away_loss_prob: round(awayCover.loss_prob, 4),
    home_fair_odd: homeFairOdd,
    away_fair_odd: awayFairOdd,
    home_handicap_ev: round(homeEv, 4),
    away_handicap_ev: round(awayEv, 4),
    home_handicap_ev_percent: round(homeEv * 100, 2),
    away_handicap_ev_percent: round(awayEv * 100, 2),
    recommended_side: recommendation.recommended_side,
    recommended_pick: recommendation.recommended_pick,
    recommended_line: recommendation.recommended_line,
    recommended_odd: recommendation.recommended_odd,
    recommended_model_prob: recommendation.recommended_model_prob,
    recommended_push_prob: recommendation.recommended_push_prob,
    recommended_fair_odd: recommendation.recommended_fair_odd,
    recommended_ev: recommendation.recommended_ev,
    candidate_status: candidateStatus,
    projection_status: "ok",
    reasons: buildHandicapReasons({
      game: params.game,
      recommendationSide: recommendation.recommended_side,
      projectedMargin,
      homeFairOdd,
      awayFairOdd,
      homeOdd,
      awayOdd,
      distanceFromMain,
    }),
    alerts,
    components: {
      margin_distribution_summary: {
        distribution_max_runs: marginDistribution.max_runs,
        distribution_mass_before_normalization: marginDistribution.mass_before_normalization,
        distribution_tail_warning: marginDistribution.tail_warning,
      },
      home: projected.home,
      away: projected.away,
    },
  };
}

export function buildMlbHandicapScreenerRows(params: {
  games: EnrichedMlbGame[];
  standings: MlbTeamStanding[];
  leagueAverageSnapshot?: MlbLeagueAverageSnapshot | null;
  config?: Partial<MlbHandicapProjectionConfig>;
}): MlbHandicapScreenerRow[] {
  const leagueAverage = getLeagueAverageContext(params.standings, params.leagueAverageSnapshot);
  return params.games.flatMap((game) => {
    const groups = normalizeHandicapMarketRows(game);
    if (!groups.length) {
      return [missingGameHandicapRow(game, leagueAverage)];
    }
    const mainHomeHandicapLine = identifyMainHandicapLine(game, groups);
    return groups
      .sort((a, b) => a.canonicalHomeLine - b.canonicalHomeLine)
      .map((lineGroup) => calculateMlbHandicapProjection({
        game,
        lineGroup,
        mainHomeHandicapLine,
        leagueAverage,
        config: params.config,
      }));
  });
}

function baseHandicapRow(
  params: {
    game: EnrichedMlbGame;
    lineGroup: HandicapLineGroup;
    mainHomeHandicapLine: number | null;
  },
  missingFields: string[],
  distanceFromMain: number | null,
): MlbHandicapScreenerRow {
  const isMain = params.mainHomeHandicapLine != null && closeTo(params.lineGroup.canonicalHomeLine, params.mainHomeHandicapLine);
  return {
    game_id: params.game.game_id,
    row_id: `${params.game.game_id}_handicap_${params.lineGroup.canonicalHomeLine}`,
    date: params.game.date,
    time: params.game.time,
    home_team: params.game.home_team,
    away_team: params.game.away_team,
    market: "Asian Handicap",
    canonical_home_line: Number.isFinite(params.lineGroup.canonicalHomeLine) ? params.lineGroup.canonicalHomeLine : null,
    line_type: isMain ? "main" : "alternate",
    is_main_handicap_line: isMain,
    main_home_handicap_line: params.mainHomeHandicapLine,
    distance_from_main_handicap_line: distanceFromMain,
    home_pick: params.lineGroup.homeOdd?.pick ?? params.game.home_team,
    home_handicap_line: params.lineGroup.homeLine,
    home_handicap_odd: params.lineGroup.homeOdd?.odd ?? null,
    away_pick: params.lineGroup.awayOdd?.pick ?? params.game.away_team,
    away_handicap_line: params.lineGroup.awayLine,
    away_handicap_odd: params.lineGroup.awayOdd?.odd ?? null,
    home_expected_runs: null,
    away_expected_runs: null,
    projected_total_runs: null,
    projected_margin: null,
    home_market_implied_prob_raw: null,
    away_market_implied_prob_raw: null,
    home_market_implied_prob_no_vig: null,
    away_market_implied_prob_no_vig: null,
    market_overround: null,
    home_cover_prob: null,
    home_push_prob: null,
    home_loss_prob: null,
    away_cover_prob: null,
    away_push_prob: null,
    away_loss_prob: null,
    home_fair_odd: null,
    away_fair_odd: null,
    home_handicap_ev: null,
    away_handicap_ev: null,
    home_handicap_ev_percent: null,
    away_handicap_ev_percent: null,
    recommended_side: null,
    recommended_pick: null,
    recommended_line: null,
    recommended_odd: null,
    recommended_model_prob: null,
    recommended_push_prob: null,
    recommended_fair_odd: null,
    recommended_ev: null,
    candidate_status: "pular",
    projection_status: "ok",
    reasons: [],
    alerts: [
      "Modelo ainda nao considera starters",
      "Modelo ainda nao considera bullpen",
      "Modelo ainda nao considera lineups confirmados",
      "Modelo ainda nao considera park factor e clima",
      ...params.lineGroup.alerts,
    ],
    missing_fields: missingFields,
    components: {
      margin_distribution_summary: {
        distribution_max_runs: null,
        distribution_mass_before_normalization: null,
        distribution_tail_warning: false,
      },
      home: null,
      away: null,
    },
    game: params.game,
  };
}

function missingGameHandicapRow(game: EnrichedMlbGame, leagueAverage: MlbLeagueAverageContext): MlbHandicapScreenerRow {
  return {
    ...baseHandicapRow({
      game,
      lineGroup: { canonicalHomeLine: 0, homeOdd: null, awayOdd: null, homeLine: null, awayLine: null, alerts: [] },
      mainHomeHandicapLine: null,
    }, ["Asian Handicap"], null),
    row_id: `${game.game_id}_handicap_missing`,
    canonical_home_line: null,
    candidate_status: "missing_data",
    projection_status: "missing_data",
    alerts: [
      "Jogo sem mercado Asian Handicap / Run Line pareado na planilha.",
      "Modelo ainda nao considera starters",
      "Modelo ainda nao considera bullpen",
      "Modelo ainda nao considera lineups confirmados",
      "Modelo ainda nao considera park factor e clima",
    ],
  };
}

function getMissingHandicapFields(game: EnrichedMlbGame, lineGroup: HandicapLineGroup) {
  const missing: string[] = [];
  if (game.standings_status !== "matched") missing.push("standings_status matched");
  if (!game.home_standings) missing.push("home_standings");
  if (!game.away_standings) missing.push("away_standings");
  if (!Number.isFinite(lineGroup.canonicalHomeLine)) missing.push("line valida");
  if (lineGroup.homeLine == null || !Number.isFinite(lineGroup.homeLine)) missing.push("home_handicap_line");
  if (lineGroup.awayLine == null || !Number.isFinite(lineGroup.awayLine)) missing.push("away_handicap_line");
  if (!lineGroup.homeOdd?.odd) missing.push("missing_home_handicap_odd");
  if (!lineGroup.awayOdd?.odd) missing.push("missing_away_handicap_odd");
  if (lineGroup.homeOdd?.odd != null && Number(lineGroup.homeOdd.odd) <= 1) missing.push("home_handicap_odd valida");
  if (lineGroup.awayOdd?.odd != null && Number(lineGroup.awayOdd.odd) <= 1) missing.push("away_handicap_odd valida");
  return missing;
}

function classifyHandicapCandidate(input: {
  recommendedEv: number | null;
  recommendedOdd: number | null;
  recommendedLine: number | null;
  recommendedSide: MlbHandicapSide | null;
  recommendedProbGap: number;
  projectedMargin: number;
  distanceFromMain: number | null;
  distributionTailWarning: boolean;
  config: MlbHandicapProjectionConfig;
}): MlbHandicapCandidateStatus {
  const ev = input.recommendedEv ?? Number.NEGATIVE_INFINITY;
  const odd = input.recommendedOdd ?? 0;
  const line = input.recommendedLine ?? 0;
  const absLine = Math.abs(line);
  const distance = input.distanceFromMain ?? 0;
  const { thresholds } = input.config;
  // Alternate handicap far from main line cannot ANALISAR
  if (distance > thresholds.maxAnalyzeDistanceFromMainLine) {
    if (ev >= thresholds.monitorEv || input.recommendedProbGap >= thresholds.monitorProbGap) return "monitorar";
    return "pular";
  }
  // Cap: alt lines |line| >= 2.5 (i.e. +/-2.5, +/-3.5, +/-4.5) can only be MONITORAR at best
  if (absLine >= 2.5) {
    if (ev >= thresholds.monitorEv || input.recommendedProbGap >= thresholds.monitorProbGap) return "monitorar";
    return "pular";
  }
  // Odd bounds
  if (odd < thresholds.minAnalyzeOdd || odd > thresholds.maxAnalyzeOdd) {
    if (ev >= thresholds.monitorEv || input.recommendedProbGap >= thresholds.monitorProbGap) return "monitorar";
    return "pular";
  }
  // Runline -1.5 hardening
  if (line <= -1.5) {
    const marginForSide = input.recommendedSide === "home" ? input.projectedMargin : -input.projectedMargin;
    if (
      ev >= thresholds.runlineMinusEv &&
      input.recommendedProbGap >= thresholds.runlineMinusProbGap &&
      marginForSide >= thresholds.runlineMinusMargin &&
      !input.distributionTailWarning
    ) {
      return "analisar";
    }
    if (ev >= thresholds.monitorEv || input.recommendedProbGap >= thresholds.monitorProbGap) return "monitorar";
    return "pular";
  }
  // Runline +1.5 hardening
  if (line >= 1.5) {
    if (
      ev >= thresholds.runlinePlusEv &&
      input.recommendedProbGap >= thresholds.runlinePlusProbGap &&
      !input.distributionTailWarning
    ) {
      return "analisar";
    }
    if (ev >= thresholds.monitorEv || input.recommendedProbGap >= thresholds.monitorProbGap) return "monitorar";
    return "pular";
  }
  // Generic 0/+-0.5/+-1 lines: use base thresholds
  if (
    ev >= thresholds.analyzeEv &&
    input.recommendedProbGap >= thresholds.analyzeProbGap &&
    !input.distributionTailWarning
  ) {
    return "analisar";
  }
  if (
    ev >= thresholds.monitorEv ||
    input.recommendedProbGap >= thresholds.monitorProbGap ||
    ev > 0
  ) {
    return "monitorar";
  }
  return "pular";
}

function getHandicapRecommendation(input: {
  game: EnrichedMlbGame;
  homeLine: number;
  awayLine: number;
  homeOdd: number;
  awayOdd: number;
  homeCover: MlbHandicapCoverProbabilities;
  awayCover: MlbHandicapCoverProbabilities;
  homeFairOdd: number | null;
  awayFairOdd: number | null;
  homeEv: number;
  awayEv: number;
}) {
  const home = {
    recommended_side: "home" as const,
    recommended_pick: input.game.home_team,
    recommended_line: input.homeLine,
    recommended_odd: input.homeOdd,
    recommended_model_prob: round(input.homeCover.win_prob, 4),
    recommended_push_prob: round(input.homeCover.push_prob, 4),
    recommended_fair_odd: input.homeFairOdd,
    recommended_ev: round(input.homeEv, 4),
  };
  const away = {
    recommended_side: "away" as const,
    recommended_pick: input.game.away_team,
    recommended_line: input.awayLine,
    recommended_odd: input.awayOdd,
    recommended_model_prob: round(input.awayCover.win_prob, 4),
    recommended_push_prob: round(input.awayCover.push_prob, 4),
    recommended_fair_odd: input.awayFairOdd,
    recommended_ev: round(input.awayEv, 4),
  };
  const best = home.recommended_ev >= away.recommended_ev ? home : away;
  if (best.recommended_ev <= 0) {
    return {
      recommended_side: null,
      recommended_pick: null,
      recommended_line: null,
      recommended_odd: null,
      recommended_model_prob: null,
      recommended_push_prob: null,
      recommended_fair_odd: null,
      recommended_ev: null,
    };
  }
  return best;
}

function buildHandicapReasons(input: {
  game: EnrichedMlbGame;
  recommendationSide: MlbHandicapSide | null;
  projectedMargin: number;
  homeFairOdd: number | null;
  awayFairOdd: number | null;
  homeOdd: number;
  awayOdd: number;
  distanceFromMain: number | null;
}) {
  if (!input.recommendationSide) return ["Nenhum lado com EV positivo no modelo simples."];
  const isHome = input.recommendationSide === "home";
  const offeredOdd = isHome ? input.homeOdd : input.awayOdd;
  const fairOdd = isHome ? input.homeFairOdd : input.awayFairOdd;
  const reasons = [
    input.projectedMargin > 0 && isHome ? "Margem projetada ASP favorece o mandante" : null,
    input.projectedMargin < 0 && !isHome ? "Margem projetada ASP favorece o visitante" : null,
    !isHome ? "Visitante recebe margem de seguranca no handicap" : null,
    fairOdd != null && offeredOdd > fairOdd ? "Odd ofertada acima da odd justa ASP" : null,
    input.distanceFromMain != null && input.distanceFromMain <= MLB_HANDICAP_THRESHOLDS.maxAnalyzeDistanceFromMainLine
      ? "Linha proxima da linha principal"
      : null,
  ].filter(Boolean) as string[];
  return [...new Set(["Probabilidade de cover acima do mercado no-vig", ...reasons])];
}

function buildHandicapAlerts(input: {
  row: MlbHandicapScreenerRow;
  candidateStatus: MlbHandicapCandidateStatus;
  distanceFromMain: number | null;
  recommendedOdd: number | null;
  recommendedLine: number | null;
  recommendedSide: MlbHandicapSide | null;
  projectedMargin: number;
  distributionTailWarning: boolean;
  leagueAverage: MlbLeagueAverageContext;
  homePushProb: number;
  awayPushProb: number;
}) {
  const alerts = [...input.row.alerts];
  const line = input.recommendedLine ?? 0;
  const absLine = Math.abs(line);
  if (input.distanceFromMain != null && input.distanceFromMain > MLB_HANDICAP_THRESHOLDS.maxAnalyzeDistanceFromMainLine) {
    alerts.push("alternate_handicap_line_risk: linha alternativa distante da principal.");
  }
  if (absLine >= 2.5) {
    alerts.push("alternate_handicap_line_risk: linha |>=2.5| limitada a MONITORAR.");
  }
  if (line <= -1.5) {
    const marginForSide = input.recommendedSide === "home" ? input.projectedMargin : -input.projectedMargin;
    if (marginForSide < MLB_HANDICAP_THRESHOLDS.runlineMinusMargin) {
      alerts.push("runline_margin_risk: margem ASP < 0.75 run para -1.5.");
    }
  }
  if (input.recommendedOdd != null && input.recommendedOdd < MLB_HANDICAP_THRESHOLDS.minAnalyzeOdd) {
    alerts.push("Odd baixa demais para screener preliminar.");
  }
  if (input.recommendedOdd != null && input.recommendedOdd > MLB_HANDICAP_THRESHOLDS.maxAnalyzeOdd) {
    alerts.push("Odd alta e sensivel a cauda da distribuicao.");
  }
  if (input.distributionTailWarning) {
    alerts.push("Distribuicao de placares com cauda relevante; projecao menos confiavel.");
  }
  if (input.leagueAverage.league_average_source === "fallback") {
    alerts.push("Projecao baseada em media da liga fallback.");
  }
  if (input.homePushProb >= 0.02 || input.awayPushProb >= 0.02) {
    alerts.push("Handicap inteiro com probabilidade de push relevante.");
  }
  if (input.candidateStatus === "monitorar") alerts.push("Edge pequeno contra mercado.");
  return [...new Set(alerts)];
}

function marketFields(market: MlbHandicapMarketNoVig) {
  return {
    home_market_implied_prob_raw: round(market.home_market_implied_prob_raw, 4),
    away_market_implied_prob_raw: round(market.away_market_implied_prob_raw, 4),
    home_market_implied_prob_no_vig: round(market.home_market_implied_prob_no_vig, 4),
    away_market_implied_prob_no_vig: round(market.away_market_implied_prob_no_vig, 4),
    market_overround: round(market.market_overround, 4),
  };
}

function identifyMoneylineFavorite(game: EnrichedMlbGame): MlbHandicapSide | null {
  const moneylineMarkets = game.markets.filter((market) => /moneyline|match winner|winner|vencedor/i.test(String(market.market ?? "")));
  const homeOdd = pickBestOdd(moneylineMarkets.filter((market) => getPickSide(market.pick, game) === "home"));
  const awayOdd = pickBestOdd(moneylineMarkets.filter((market) => getPickSide(market.pick, game) === "away"));
  if (!homeOdd?.odd || !awayOdd?.odd) return null;
  if (Number(homeOdd.odd) === Number(awayOdd.odd)) return null;
  return Number(homeOdd.odd) < Number(awayOdd.odd) ? "home" : "away";
}

function isHandicapMarket(market: string | null) {
  return /asian handicap|run line|handicap|spread/i.test(String(market ?? ""));
}

function getPickSide(pick: string | null, game: EnrichedMlbGame): MlbHandicapSide | null {
  if (!pick) return null;
  const pickKey = matchMlbTeamName(pick);
  if (pickKey && pickKey === game.home_team_key) return "home";
  if (pickKey && pickKey === game.away_team_key) return "away";
  const normalizedPick = pick.trim().toLowerCase();
  if (normalizedPick === game.home_team.trim().toLowerCase()) return "home";
  if (normalizedPick === game.away_team.trim().toLowerCase()) return "away";
  return null;
}

function parseHandicapLine(line: string | null) {
  const value = Number(String(line ?? "").replace(",", ".").replace(/^\+/, ""));
  return Number.isFinite(value) ? value : null;
}

function pickBestOdd(markets: Array<MlbMarketOdd | null>) {
  return markets
    .filter((market): market is MlbMarketOdd => Boolean(market?.odd) && Number(market?.odd) > 1)
    .sort((a, b) => Number(b.odd) - Number(a.odd))[0] ?? null;
}

function calculatePushAwareFairOdd(probabilities: MlbHandicapCoverProbabilities) {
  if (!probabilities.supported_line_type || probabilities.win_prob <= 0) return null;
  return round(1 + probabilities.loss_prob / probabilities.win_prob, 2);
}

function getSupportedLineKind(line: number): "half" | "integer" | "unsupported" {
  if (!Number.isFinite(line)) return "unsupported";
  const fractional = Math.abs(line - Math.trunc(line));
  if (closeTo(fractional, 0)) return "integer";
  if (closeTo(fractional, 0.5)) return "half";
  return "unsupported";
}

function getDynamicMaxRuns(homeLambda: number, awayLambda: number, config: MlbHandicapProjectionConfig) {
  const maxLambda = Math.max(homeLambda, awayLambda);
  if (!Number.isFinite(maxLambda) || maxLambda <= 0) return config.maxRunsBase;
  return Math.min(
    config.maxRunsCap,
    Math.max(config.maxRunsBase, Math.ceil(maxLambda + config.dynamicRunsStdDevMultiplier * Math.sqrt(maxLambda))),
  );
}

function closeTo(a: number, b: number, tolerance = 0.0001) {
  return Math.abs(a - b) <= tolerance;
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function mergeHandicapConfig(config?: Partial<MlbHandicapProjectionConfig>): MlbHandicapProjectionConfig {
  return {
    ...MLB_HANDICAP_PROJECTION_CONFIG,
    ...config,
    thresholds: {
      ...MLB_HANDICAP_PROJECTION_CONFIG.thresholds,
      ...config?.thresholds,
    },
  };
}
