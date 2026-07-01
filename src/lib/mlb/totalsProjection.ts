import type { EnrichedMlbGame, MlbLeagueAverageSnapshot, MlbMarketOdd, MlbTeamStanding } from "@/types/mlbStandings";
import type {
  MlbExpectedRunsComponents,
  MlbLeagueAverageContext,
  MlbPoissonTotalProbabilities,
  MlbProjectionCandidateStatus,
  MlbTotalMarketNoVig,
  MlbTotalsProjectionConfig,
  MlbTotalsScreenerRow,
} from "@/types/mlbProjections";

export const MLB_TOTALS_THRESHOLDS = {
  analyzeEv: 0.06,
  analyzeProbGap: 0.05,
  analyzeRunGap: 0.70,
  monitorEv: 0.02,
  monitorProbGap: 0.025,
  monitorRunGap: 0.45,
  minOdd: 1.55,
  maxOdd: 2.60,
  maxAnalyzeDistanceFromMainLine: 1.0,
  maxMonitorDistanceFromMainLine: 1.5,
  minAnalyzeFairOdd: 1.35,
  maxAnalyzeOdd: 2.80,
  minAnalyzeOdd: 1.55,
} satisfies MlbTotalsProjectionConfig["thresholds"];

export const MLB_TOTALS_PROJECTION_CONFIG: MlbTotalsProjectionConfig = {
  offenseWeight: 0.55,
  opponentDefenseWeight: 0.45,
  homeRunsAdjustment: 0.03,
  awayRunsAdjustment: -0.01,
  recentFormMultiplier: 0.15,
  recentFormMin: -0.08,
  recentFormMax: 0.08,
  minExpectedRuns: 2.2,
  maxExpectedRuns: 7.2,
  fallbackLeagueAvgRunsPerTeam: 4.5,
  thresholds: MLB_TOTALS_THRESHOLDS,
};

type TotalLineGroup = {
  line: number;
  overOdd: MlbMarketOdd | null;
  underOdd: MlbMarketOdd | null;
  alerts: string[];
};

export function calculateMlbExpectedRuns(params: {
  team: MlbTeamStanding;
  opponent: MlbTeamStanding;
  venue: "home" | "away";
  leagueAvgRunsPerTeam: number;
  config?: Partial<MlbTotalsProjectionConfig>;
}): MlbExpectedRunsComponents {
  const config = mergeTotalsConfig(params.config);
  const missingFields = getExpectedRunsMissingFields(params.team, params.opponent);
  const offenseIndex = clampNumber((params.team.runs_per_game ?? params.leagueAvgRunsPerTeam) / params.leagueAvgRunsPerTeam, 0.70, 1.30);
  const opponentDefenseIndex = clampNumber((params.opponent.runs_allowed_per_game ?? params.leagueAvgRunsPerTeam) / params.leagueAvgRunsPerTeam, 0.70, 1.30);
  const baseExpectedRuns = params.leagueAvgRunsPerTeam * (
    config.offenseWeight * offenseIndex + config.opponentDefenseWeight * opponentDefenseIndex
  );
  const homeAwayAdjustment = params.venue === "home" ? config.homeRunsAdjustment : config.awayRunsAdjustment;
  const recentFormAdjustment = calculateRecentFormAdjustment(params.team, config);
  const finalExpectedRuns = clampNumber(
    baseExpectedRuns + homeAwayAdjustment + recentFormAdjustment,
    config.minExpectedRuns,
    config.maxExpectedRuns,
  );

  return {
    offense_index: round(offenseIndex, 4),
    opponent_defense_index: round(opponentDefenseIndex, 4),
    base_expected_runs: round(baseExpectedRuns, 4),
    home_away_adjustment: round(homeAwayAdjustment, 4),
    recent_form_adjustment: round(recentFormAdjustment, 4),
    final_expected_runs: round(finalExpectedRuns, 4),
    missing_fields: missingFields,
  };
}

export function calculateMlbProjectedTotal(params: {
  game: EnrichedMlbGame;
  leagueAverage: MlbLeagueAverageContext;
  config?: Partial<MlbTotalsProjectionConfig>;
}) {
  if (!params.game.home_standings || !params.game.away_standings) {
    return { home: null, away: null, projectedTotalRuns: null };
  }
  const home = calculateMlbExpectedRuns({
    team: params.game.home_standings,
    opponent: params.game.away_standings,
    venue: "home",
    leagueAvgRunsPerTeam: params.leagueAverage.league_avg_runs_per_team,
    config: params.config,
  });
  const away = calculateMlbExpectedRuns({
    team: params.game.away_standings,
    opponent: params.game.home_standings,
    venue: "away",
    leagueAvgRunsPerTeam: params.leagueAverage.league_avg_runs_per_team,
    config: params.config,
  });
  return {
    home,
    away,
    projectedTotalRuns: round(home.final_expected_runs + away.final_expected_runs, 4),
  };
}

export function calculatePoissonTotalProbabilities(lambda: number, line: number): MlbPoissonTotalProbabilities {
  if (!Number.isFinite(lambda) || lambda <= 0 || !Number.isFinite(line)) {
    return unsupportedPoisson();
  }
  const fractional = Math.abs(line - Math.trunc(line));
  if (closeTo(fractional, 0.5)) {
    const underMax = Math.floor(line);
    const under = poissonCdf(underMax, lambda);
    return {
      over_model_prob: 1 - under,
      under_model_prob: under,
      push_prob: 0,
      over_win_prob: 1 - under,
      under_win_prob: under,
      supported_line_type: true,
      line_kind: "half",
    };
  }
  if (closeTo(fractional, 0)) {
    const pushAt = Math.trunc(line);
    const underWin = poissonCdf(pushAt - 1, lambda);
    const push = poissonPmf(pushAt, lambda);
    const overWin = 1 - underWin - push;
    return {
      over_model_prob: overWin,
      under_model_prob: underWin,
      push_prob: push,
      over_win_prob: overWin,
      under_win_prob: underWin,
      supported_line_type: true,
      line_kind: "integer",
    };
  }
  return unsupportedPoisson();
}

export function calculateTotalMarketNoVig(overOdd: number, underOdd: number): MlbTotalMarketNoVig {
  const overRaw = 1 / overOdd;
  const underRaw = 1 / underOdd;
  const sum = overRaw + underRaw;
  return {
    over_market_implied_prob_raw: overRaw,
    under_market_implied_prob_raw: underRaw,
    over_market_implied_prob_no_vig: overRaw / sum,
    under_market_implied_prob_no_vig: underRaw / sum,
    market_overround: sum - 1,
  };
}

export function identifyMainTotalLine(groups: TotalLineGroup[]) {
  const candidates = groups
    .filter((group) => group.overOdd?.odd && group.underOdd?.odd)
    .map((group) => {
      const market = calculateTotalMarketNoVig(Number(group.overOdd?.odd), Number(group.underOdd?.odd));
      return {
        line: group.line,
        distanceToBalancedMarket: Math.abs(market.over_market_implied_prob_no_vig - 0.5),
      };
    })
    .sort((a, b) => a.distanceToBalancedMarket - b.distanceToBalancedMarket || a.line - b.line);
  return candidates[0]?.line ?? null;
}

export function calculateMlbTotalsProjection(params: {
  game: EnrichedMlbGame;
  lineGroup: TotalLineGroup;
  mainTotalLine: number | null;
  leagueAverage: MlbLeagueAverageContext;
  config?: Partial<MlbTotalsProjectionConfig>;
}): MlbTotalsScreenerRow {
  const config = mergeTotalsConfig(params.config);
  const missingFields = getMissingTotalFields(params.game, params.lineGroup);
  const distanceFromMainLine = params.mainTotalLine == null ? null : round(Math.abs(params.lineGroup.line - params.mainTotalLine), 2);
  const baseRow = baseTotalsRow(params, missingFields, distanceFromMainLine);

  if (missingFields.length) {
    return {
      ...baseRow,
      candidate_status: "missing_data",
      projection_status: "missing_data",
      alerts: [...baseRow.alerts, ...missingFields.map((field) => `Dado ausente: ${field}`)],
    };
  }

  const overOdd = Number(params.lineGroup.overOdd?.odd);
  const underOdd = Number(params.lineGroup.underOdd?.odd);
  const market = calculateTotalMarketNoVig(overOdd, underOdd);
  const projected = calculateMlbProjectedTotal({
    game: params.game,
    leagueAverage: params.leagueAverage,
    config,
  });
  const projectedTotalRuns = projected.projectedTotalRuns as number;
  const totalGapVsLine = projectedTotalRuns - params.lineGroup.line;
  const poisson = calculatePoissonTotalProbabilities(projectedTotalRuns, params.lineGroup.line);
  if (!poisson.supported_line_type) {
    return {
      ...baseRow,
      over_market_implied_prob_raw: round(market.over_market_implied_prob_raw, 4),
      under_market_implied_prob_raw: round(market.under_market_implied_prob_raw, 4),
      over_market_implied_prob_no_vig: round(market.over_market_implied_prob_no_vig, 4),
      under_market_implied_prob_no_vig: round(market.under_market_implied_prob_no_vig, 4),
      market_overround: round(market.market_overround, 4),
      home_expected_runs: projected.home?.final_expected_runs ?? null,
      away_expected_runs: projected.away?.final_expected_runs ?? null,
      projected_total_runs: projectedTotalRuns,
      total_gap_vs_line: round(totalGapVsLine, 4),
      candidate_status: "missing_data",
      projection_status: "unsupported_line",
      alerts: [...baseRow.alerts, "Linha .25/.75 ainda nao suportada nesta etapa."],
      components: { home: projected.home, away: projected.away },
    };
  }

  const overFairOdd = calculateFairOdd(poisson.over_win_prob);
  const underFairOdd = calculateFairOdd(poisson.under_win_prob);
  const overEv = poisson.line_kind === "integer"
    ? poisson.over_win_prob * (overOdd - 1) - poisson.under_win_prob
    : poisson.over_model_prob * overOdd - 1;
  const underEv = poisson.line_kind === "integer"
    ? poisson.under_win_prob * (underOdd - 1) - poisson.over_win_prob
    : poisson.under_model_prob * underOdd - 1;
  const recommendation = getTotalRecommendation({
    overOdd,
    underOdd,
    overFairOdd,
    underFairOdd,
    overEv,
    underEv,
    overModelProb: poisson.over_model_prob,
    underModelProb: poisson.under_model_prob,
  });
  const probGap = recommendation.recommended_side === "Over"
    ? poisson.over_model_prob - market.over_market_implied_prob_no_vig
    : recommendation.recommended_side === "Under"
      ? poisson.under_model_prob - market.under_market_implied_prob_no_vig
      : Math.max(
        poisson.over_model_prob - market.over_market_implied_prob_no_vig,
        poisson.under_model_prob - market.under_market_implied_prob_no_vig,
      );
  const candidateStatus = classifyTotalCandidate({
    recommendedEv: recommendation.recommended_ev,
    recommendedOdd: recommendation.recommended_odd,
    recommendedFairOdd: recommendation.recommended_fair_odd,
    recommendedProbGap: probGap,
    runGap: Math.abs(totalGapVsLine),
    distanceFromMainLine,
    config,
  });
  const alerts = buildTotalAlerts({
    row: baseRow,
    candidateStatus,
    distanceFromMainLine,
    recommendedOdd: recommendation.recommended_odd,
    recommendedFairOdd: recommendation.recommended_fair_odd,
    leagueAverage: params.leagueAverage,
    home: projected.home,
    away: projected.away,
  });

  return {
    ...baseRow,
    over_market_implied_prob_raw: round(market.over_market_implied_prob_raw, 4),
    under_market_implied_prob_raw: round(market.under_market_implied_prob_raw, 4),
    over_market_implied_prob_no_vig: round(market.over_market_implied_prob_no_vig, 4),
    under_market_implied_prob_no_vig: round(market.under_market_implied_prob_no_vig, 4),
    market_overround: round(market.market_overround, 4),
    home_expected_runs: projected.home?.final_expected_runs ?? null,
    away_expected_runs: projected.away?.final_expected_runs ?? null,
    projected_total_runs: projectedTotalRuns,
    total_gap_vs_line: round(totalGapVsLine, 4),
    over_model_prob: round(poisson.over_model_prob, 4),
    under_model_prob: round(poisson.under_model_prob, 4),
    push_prob: round(poisson.push_prob, 4),
    over_fair_odd: overFairOdd,
    under_fair_odd: underFairOdd,
    over_ev: round(overEv, 4),
    under_ev: round(underEv, 4),
    recommended_side: recommendation.recommended_side,
    recommended_odd: recommendation.recommended_odd,
    recommended_model_prob: recommendation.recommended_model_prob,
    recommended_fair_odd: recommendation.recommended_fair_odd,
    recommended_ev: recommendation.recommended_ev,
    candidate_status: candidateStatus,
    projection_status: "ok",
    reasons: buildTotalReasons({
      game: params.game,
      recommendationSide: recommendation.recommended_side,
      totalGapVsLine,
      overOdd,
      underOdd,
      overFairOdd,
      underFairOdd,
      home: projected.home,
      away: projected.away,
    }),
    alerts,
    components: { home: projected.home, away: projected.away },
  };
}

export function buildMlbTotalsScreenerRows(params: {
  games: EnrichedMlbGame[];
  standings: MlbTeamStanding[];
  leagueAverageSnapshot?: MlbLeagueAverageSnapshot | null;
  config?: Partial<MlbTotalsProjectionConfig>;
}): MlbTotalsScreenerRow[] {
  const leagueAverage = getLeagueAverageContext(params.standings, params.leagueAverageSnapshot, params.config);
  return params.games.flatMap((game) => {
    const groups = groupTotalLines(game);
    if (!groups.length) {
      return [missingGameTotalsRow(game, leagueAverage)];
    }
    const mainTotalLine = identifyMainTotalLine(groups);
    return groups
      .sort((a, b) => a.line - b.line)
      .map((lineGroup) => calculateMlbTotalsProjection({
        game,
        lineGroup,
        mainTotalLine,
        leagueAverage,
        config: params.config,
      }));
  });
}

export function getLeagueAverageContext(
  standings: MlbTeamStanding[],
  leagueAverageSnapshot?: MlbLeagueAverageSnapshot | null,
  config?: Partial<MlbTotalsProjectionConfig>,
): MlbLeagueAverageContext {
  const mergedConfig = mergeTotalsConfig(config);
  if (leagueAverageSnapshot?.runs_per_game_average && leagueAverageSnapshot.runs_per_game_average > 0) {
    return {
      league_avg_runs_per_team: leagueAverageSnapshot.runs_per_game_average,
      league_average_source: "average_row",
    };
  }
  const values = standings
    .map((team) => team.runs_per_game)
    .filter((value): value is number => value != null && Number.isFinite(value) && value > 0);
  if (values.length) {
    return {
      league_avg_runs_per_team: round(values.reduce((sum, value) => sum + value, 0) / values.length, 4),
      league_average_source: "computed_from_teams",
    };
  }
  return {
    league_avg_runs_per_team: mergedConfig.fallbackLeagueAvgRunsPerTeam,
    league_average_source: "fallback",
  };
}

function groupTotalLines(game: EnrichedMlbGame): TotalLineGroup[] {
  const groups = new Map<number, TotalLineGroup>();
  for (const market of game.markets) {
    if (!isTotalMarket(market)) continue;
    const line = extractTotalLine(market);
    if (line == null) continue;
    const group = groups.get(line) ?? { line, overOdd: null, underOdd: null, alerts: [] };
    const side = getTotalSide(market.pick);
    if (side === "over") {
      if (group.overOdd) group.alerts.push("Odds Over duplicadas na mesma linha; usando a maior odd disponivel.");
      group.overOdd = pickBestOdd([group.overOdd, market]);
    }
    if (side === "under") {
      if (group.underOdd) group.alerts.push("Odds Under duplicadas na mesma linha; usando a maior odd disponivel.");
      group.underOdd = pickBestOdd([group.underOdd, market]);
    }
    groups.set(line, group);
  }
  return [...groups.values()];
}

function baseTotalsRow(
  params: {
    game: EnrichedMlbGame;
    lineGroup: TotalLineGroup;
    mainTotalLine: number | null;
    leagueAverage: MlbLeagueAverageContext;
  },
  missingFields: string[],
  distanceFromMainLine: number | null,
): MlbTotalsScreenerRow {
  const isMain = params.mainTotalLine != null && closeTo(params.lineGroup.line, params.mainTotalLine);
  return {
    game_id: params.game.game_id,
    row_id: `${params.game.game_id}_total_${params.lineGroup.line}`,
    date: params.game.date,
    time: params.game.time,
    home_team: params.game.home_team,
    away_team: params.game.away_team,
    market: "Over/Under",
    line: params.lineGroup.line,
    line_type: isMain ? "main" : "alternate",
    is_main_total_line: isMain,
    main_total_line: params.mainTotalLine,
    distance_from_main_line: distanceFromMainLine,
    over_odd: params.lineGroup.overOdd?.odd ?? null,
    under_odd: params.lineGroup.underOdd?.odd ?? null,
    over_market_implied_prob_raw: null,
    under_market_implied_prob_raw: null,
    over_market_implied_prob_no_vig: null,
    under_market_implied_prob_no_vig: null,
    market_overround: null,
    league_avg_runs_per_team: params.leagueAverage.league_avg_runs_per_team,
    league_average_source: params.leagueAverage.league_average_source,
    home_expected_runs: null,
    away_expected_runs: null,
    projected_total_runs: null,
    total_gap_vs_line: null,
    over_model_prob: null,
    under_model_prob: null,
    push_prob: null,
    over_fair_odd: null,
    under_fair_odd: null,
    over_ev: null,
    under_ev: null,
    recommended_side: null,
    recommended_odd: null,
    recommended_model_prob: null,
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
    components: { home: null, away: null },
    game: params.game,
  };
}

function missingGameTotalsRow(game: EnrichedMlbGame, leagueAverage: MlbLeagueAverageContext): MlbTotalsScreenerRow {
  return {
    game_id: game.game_id,
    row_id: `${game.game_id}_total_missing`,
    date: game.date,
    time: game.time,
    home_team: game.home_team,
    away_team: game.away_team,
    market: "Over/Under",
    line: null,
    line_type: "alternate",
    is_main_total_line: false,
    main_total_line: null,
    distance_from_main_line: null,
    over_odd: null,
    under_odd: null,
    over_market_implied_prob_raw: null,
    under_market_implied_prob_raw: null,
    over_market_implied_prob_no_vig: null,
    under_market_implied_prob_no_vig: null,
    market_overround: null,
    league_avg_runs_per_team: leagueAverage.league_avg_runs_per_team,
    league_average_source: leagueAverage.league_average_source,
    home_expected_runs: null,
    away_expected_runs: null,
    projected_total_runs: null,
    total_gap_vs_line: null,
    over_model_prob: null,
    under_model_prob: null,
    push_prob: null,
    over_fair_odd: null,
    under_fair_odd: null,
    over_ev: null,
    under_ev: null,
    recommended_side: null,
    recommended_odd: null,
    recommended_model_prob: null,
    recommended_fair_odd: null,
    recommended_ev: null,
    candidate_status: "missing_data",
    projection_status: "missing_data",
    reasons: [],
    alerts: [
      "Jogo sem mercado Over/Under pareado na planilha.",
      "Modelo ainda nao considera starters",
      "Modelo ainda nao considera bullpen",
      "Modelo ainda nao considera lineups confirmados",
      "Modelo ainda nao considera park factor e clima",
    ],
    missing_fields: ["Over/Under"],
    components: { home: null, away: null },
    game,
  };
}

function getMissingTotalFields(game: EnrichedMlbGame, lineGroup: TotalLineGroup) {
  const missing: string[] = [];
  if (game.standings_status !== "matched") missing.push("standings_status matched");
  if (!game.home_standings) missing.push("home_standings");
  if (!game.away_standings) missing.push("away_standings");
  if (!Number.isFinite(lineGroup.line)) missing.push("line valida");
  if (!lineGroup.overOdd?.odd) missing.push("odd Over");
  if (!lineGroup.underOdd?.odd) missing.push("odd Under");
  if (lineGroup.overOdd?.odd != null && Number(lineGroup.overOdd.odd) <= 1) missing.push("odd Over valida");
  if (lineGroup.underOdd?.odd != null && Number(lineGroup.underOdd.odd) <= 1) missing.push("odd Under valida");
  return missing;
}

function getExpectedRunsMissingFields(team: MlbTeamStanding, opponent: MlbTeamStanding) {
  const missing: string[] = [];
  if (team.runs_per_game == null) missing.push(`${team.team_name}: runs_per_game`);
  if (opponent.runs_allowed_per_game == null) missing.push(`${opponent.team_name}: runs_allowed_per_game`);
  return missing;
}

function calculateRecentFormAdjustment(team: MlbTeamStanding, config: MlbTotalsProjectionConfig) {
  const recentPct = firstWinPct(
    [team.last30_wins, team.last30_losses],
    [team.last20_wins, team.last20_losses],
    [team.last10_wins, team.last10_losses],
  );
  if (recentPct == null) return 0;
  return clampNumber((recentPct - 0.5) * config.recentFormMultiplier, config.recentFormMin, config.recentFormMax);
}

function isTotalMarket(market: MlbMarketOdd) {
  return /over\/under|total|totals/i.test(String(market.market ?? "")) && Boolean(getTotalSide(market.pick));
}

function getTotalSide(pick: string | null) {
  if (/^over\b/i.test(String(pick ?? "").trim())) return "over";
  if (/^under\b/i.test(String(pick ?? "").trim())) return "under";
  return null;
}

function extractTotalLine(market: MlbMarketOdd) {
  const rawLine = market.line != null && market.line !== "" ? market.line : String(market.pick ?? "").match(/(\d+(?:[.,]\d+)?)/)?.[1];
  const value = Number(String(rawLine ?? "").replace(",", ".").replace(/^\+/, ""));
  return Number.isFinite(value) ? value : null;
}

function pickBestOdd(markets: Array<MlbMarketOdd | null>) {
  return markets
    .filter((market): market is MlbMarketOdd => Boolean(market?.odd) && Number(market?.odd) > 1)
    .sort((a, b) => Number(b.odd) - Number(a.odd))[0] ?? null;
}

function getTotalRecommendation(input: {
  overOdd: number;
  underOdd: number;
  overFairOdd: number | null;
  underFairOdd: number | null;
  overEv: number;
  underEv: number;
  overModelProb: number;
  underModelProb: number;
}) {
  const over = {
    recommended_side: "Over" as const,
    recommended_odd: input.overOdd,
    recommended_model_prob: round(input.overModelProb, 4),
    recommended_fair_odd: input.overFairOdd,
    recommended_ev: round(input.overEv, 4),
  };
  const under = {
    recommended_side: "Under" as const,
    recommended_odd: input.underOdd,
    recommended_model_prob: round(input.underModelProb, 4),
    recommended_fair_odd: input.underFairOdd,
    recommended_ev: round(input.underEv, 4),
  };
  const best = over.recommended_ev >= under.recommended_ev ? over : under;
  if (best.recommended_ev <= 0) {
    return {
      recommended_side: null,
      recommended_odd: null,
      recommended_model_prob: null,
      recommended_fair_odd: null,
      recommended_ev: null,
    };
  }
  return best;
}

function classifyTotalCandidate(input: {
  recommendedEv: number | null;
  recommendedOdd: number | null;
  recommendedFairOdd: number | null;
  recommendedProbGap: number;
  runGap: number;
  distanceFromMainLine: number | null;
  config: MlbTotalsProjectionConfig;
}): MlbProjectionCandidateStatus {
  const ev = input.recommendedEv ?? Number.NEGATIVE_INFINITY;
  const odd = input.recommendedOdd ?? 0;
  const fairOdd = input.recommendedFairOdd ?? 0;
  const distance = input.distanceFromMainLine ?? 0;
  const { thresholds } = input.config;
  if (distance > thresholds.maxMonitorDistanceFromMainLine) return "pular";
  const canAnalyzeAlternate = distance <= thresholds.maxAnalyzeDistanceFromMainLine;
  const canAnalyzeOdd = odd >= thresholds.minAnalyzeOdd && odd <= thresholds.maxAnalyzeOdd;
  const canAnalyzeFairOdd = fairOdd >= thresholds.minAnalyzeFairOdd;
  if (
    ev >= thresholds.analyzeEv &&
    input.recommendedProbGap >= thresholds.analyzeProbGap &&
    input.runGap >= thresholds.analyzeRunGap &&
    canAnalyzeOdd &&
    canAnalyzeFairOdd &&
    canAnalyzeAlternate
  ) {
    return "analisar";
  }
  if (ev >= thresholds.monitorEv || input.runGap >= thresholds.monitorRunGap || input.recommendedProbGap >= thresholds.monitorProbGap) {
    return "monitorar";
  }
  return "pular";
}

function buildTotalReasons(input: {
  game: EnrichedMlbGame;
  recommendationSide: "Over" | "Under" | null;
  totalGapVsLine: number;
  overOdd: number;
  underOdd: number;
  overFairOdd: number | null;
  underFairOdd: number | null;
  home: MlbExpectedRunsComponents | null;
  away: MlbExpectedRunsComponents | null;
}) {
  if (!input.recommendationSide) return ["Nenhum lado com EV positivo no modelo simples."];
  const isOver = input.recommendationSide === "Over";
  const offeredOdd = isOver ? input.overOdd : input.underOdd;
  const fairOdd = isOver ? input.overFairOdd : input.underFairOdd;
  const reasons = [
    isOver ? "Total projetado ASP acima da linha de mercado" : "Total projetado ASP abaixo da linha de mercado",
    input.home && input.home.offense_index > 1 ? "Ataque mandante acima da media da liga" : null,
    input.away && input.away.offense_index > 1 ? "Ataque visitante acima da media da liga" : null,
    input.away && input.away.opponent_defense_index > 1 ? "Defesa mandante permite corridas acima da media" : null,
    input.home && input.home.opponent_defense_index > 1 ? "Defesa visitante permite corridas acima da media" : null,
    Math.abs(input.totalGapVsLine) >= MLB_TOTALS_THRESHOLDS.monitorRunGap ? "Gap de corridas relevante contra a linha" : null,
    fairOdd != null && offeredOdd > fairOdd ? "Odd ofertada acima da odd justa ASP" : null,
  ].filter(Boolean) as string[];
  return [...new Set(reasons)];
}

function buildTotalAlerts(input: {
  row: MlbTotalsScreenerRow;
  candidateStatus: MlbProjectionCandidateStatus;
  distanceFromMainLine: number | null;
  recommendedOdd: number | null;
  recommendedFairOdd: number | null;
  leagueAverage: MlbLeagueAverageContext;
  home: MlbExpectedRunsComponents | null;
  away: MlbExpectedRunsComponents | null;
}) {
  const alerts = [...input.row.alerts];
  if (input.distanceFromMainLine != null && input.distanceFromMainLine > MLB_TOTALS_THRESHOLDS.maxAnalyzeDistanceFromMainLine) {
    alerts.push("alternate_total_line_risk: linha alternativa distante da linha principal.");
  }
  if (input.recommendedOdd != null && input.recommendedOdd < MLB_TOTALS_THRESHOLDS.minAnalyzeOdd) {
    alerts.push("Odd baixa demais para screener preliminar.");
  }
  if (input.recommendedOdd != null && input.recommendedOdd > MLB_TOTALS_THRESHOLDS.maxAnalyzeOdd) {
    alerts.push("Odd alta e sensivel a cauda da distribuicao.");
  }
  if (input.recommendedFairOdd != null && input.recommendedFairOdd < MLB_TOTALS_THRESHOLDS.minAnalyzeFairOdd) {
    alerts.push("low_fair_odd_tail_risk: odd justa muito baixa (< 1.35) - risco de cauda.");
  }
  if (input.home?.missing_fields.length || input.away?.missing_fields.length) {
    alerts.push("Dados de standings incompletos.");
  }
  if (input.leagueAverage.league_average_source === "fallback") {
    alerts.push("Projecao baseada em media da liga fallback.");
  }
  if (input.candidateStatus === "monitorar") alerts.push("Edge pequeno contra mercado.");
  return [...new Set(alerts)];
}

function unsupportedPoisson(): MlbPoissonTotalProbabilities {
  return {
    over_model_prob: 0,
    under_model_prob: 0,
    push_prob: 0,
    over_win_prob: 0,
    under_win_prob: 0,
    supported_line_type: false,
    line_kind: "unsupported",
  };
}

function poissonPmf(k: number, lambda: number) {
  if (k < 0) return 0;
  let probability = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) probability *= lambda / i;
  return probability;
}

function poissonCdf(maxK: number, lambda: number) {
  if (maxK < 0) return 0;
  let sum = 0;
  let probability = Math.exp(-lambda);
  sum += probability;
  for (let k = 1; k <= maxK; k++) {
    probability *= lambda / k;
    sum += probability;
  }
  return clampNumber(sum, 0, 1);
}

function firstWinPct(...records: Array<[number | null, number | null]>) {
  for (const [wins, losses] of records) {
    if (wins == null || losses == null || wins + losses <= 0) continue;
    return wins / (wins + losses);
  }
  return null;
}

function calculateFairOdd(probability: number) {
  if (!Number.isFinite(probability) || probability <= 0) return null;
  return round(1 / probability, 2);
}

function closeTo(a: number, b: number, tolerance = 0.0001) {
  return Math.abs(a - b) <= tolerance;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function mergeTotalsConfig(config?: Partial<MlbTotalsProjectionConfig>): MlbTotalsProjectionConfig {
  return {
    ...MLB_TOTALS_PROJECTION_CONFIG,
    ...config,
    thresholds: {
      ...MLB_TOTALS_PROJECTION_CONFIG.thresholds,
      ...config?.thresholds,
    },
  };
}
