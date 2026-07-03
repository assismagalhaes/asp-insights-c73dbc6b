import type {
  MlbCriticalValidationContext,
  MlbCriticalValidationPayload,
  MlbHandicapCandidateStatus,
  MlbHandicapProjectionStatus,
  MlbHandicapScreenerRow,
  MlbMoneylineScreenerRow,
  MlbOpportunityAppliedPenalty,
  MlbOpportunityMarketFamily,
  MlbOpportunityPriorityStatus,
  MlbOpportunityScoreComponents,
  MlbOpportunityScoreWeights,
  MlbOpportunityShortlistResult,
  MlbProjectionCandidateStatus,
  MlbTotalsScreenerRow,
  MlbUnifiedOpportunity,
} from "@/types/mlbProjections";

export const MLB_PRE_CRITICAL_MAX_SCORE = 92;
export const MLB_PRE_CRITICAL_MAX_CONFIDENCE = 72;

const TOP5_EXCLUDED_FLAGS = new Set(["alternate_total_line_risk", "alternate_handicap_line_risk"]);

export const MLB_OPPORTUNITY_SCORE_WEIGHTS = {
  evQuality: 0.35,
  probabilityEdge: 0.25,
  marketLineQuality: 0.15,
  modelGap: 0.10,
  dataQuality: 0.10,
  baseStatusCoherence: 0.05,
} satisfies MlbOpportunityScoreWeights;

const UNIVERSAL_MODEL_ALERT_PATTERNS = [
  /nao considera starters/i,
  /nao considera bullpen/i,
  /nao considera bullpens/i,
  /nao considera lineup/i,
  /nao considera lineups/i,
  /park factor/i,
  /clima/i,
];

type OpportunityBase = Omit<
  MlbUnifiedOpportunity,
  | "opportunity_score"
  | "confidence_score"
  | "priority_status"
  | "rank"
  | "is_primary_shortlist"
  | "correlation_status"
  | "correlated_with"
  | "risk_flags"
  | "score_components"
  | "score_explanation"
>;

export function normalizeMoneylineOpportunity(row: MlbMoneylineScreenerRow): MlbUnifiedOpportunity {
  const side = getMoneylineRecommendedSide(row);
  const marketProb = side === "home"
    ? row.home_market_implied_prob_no_vig
    : side === "away"
      ? row.away_market_implied_prob_no_vig
      : null;
  return finalizeOpportunity({
    opportunity_id: `${row.game_id}_moneyline_${side ?? "none"}`,
    game_id: row.game_id,
    date: row.date,
    time: row.time,
    home_team: row.home_team,
    away_team: row.away_team,
    matchup: `${row.home_team} vs ${row.away_team}`,
    market_family: "moneyline",
    market_label: "Moneyline",
    pick_label: row.recommended_side,
    selection_team: row.recommended_side,
    side,
    line: null,
    line_type: null,
    is_main_line: true,
    distance_from_main_line: 0,
    offered_odd: row.recommended_odd,
    median_odd: row.recommended_odd_mediana,
    market_base_odd: row.recommended_odd_mediana,
    bookmaker_melhor: row.recommended_bookmaker_melhor,
    market_prob_no_vig: marketProb,
    model_prob: row.recommended_model_prob,
    probability_edge: calculateProbabilityEdge(row.recommended_model_prob, marketProb),
    fair_odd: row.recommended_fair_odd,
    ev: row.recommended_ev,
    market_overround: row.market_overround,
    model_gap_value: calculateProbabilityEdge(row.recommended_model_prob, marketProb),
    model_gap_label: "Edge de probabilidade Moneyline",
    base_candidate_status: row.candidate_status,
    projection_status: row.projection_status,
    correlation_group_id: row.game_id,
    reasons: row.reasons,
    alerts: row.alerts,
    source_projection_payload: row,
  });
}

export function normalizeTotalsOpportunity(row: MlbTotalsScreenerRow): MlbUnifiedOpportunity {
  const isOver = row.recommended_side === "Over";
  const marketProb = row.recommended_side === "Over"
    ? row.over_market_implied_prob_no_vig
    : row.recommended_side === "Under"
      ? row.under_market_implied_prob_no_vig
      : null;
  return finalizeOpportunity({
    opportunity_id: `${row.row_id}_totals_${row.recommended_side ?? "none"}`,
    game_id: row.game_id,
    date: row.date,
    time: row.time,
    home_team: row.home_team,
    away_team: row.away_team,
    matchup: `${row.home_team} vs ${row.away_team}`,
    market_family: "totals",
    market_label: "Over/Under",
    pick_label: row.recommended_side ? `${row.recommended_side} ${formatLine(row.line)}` : null,
    selection_team: null,
    side: row.recommended_side,
    line: row.line,
    line_type: row.line_type,
    is_main_line: row.is_main_total_line,
    distance_from_main_line: row.distance_from_main_line,
    offered_odd: row.recommended_odd,
    median_odd: row.recommended_odd_mediana,
    market_base_odd: row.recommended_odd_mediana,
    bookmaker_melhor: row.recommended_bookmaker_melhor,
    market_prob_no_vig: marketProb,
    model_prob: row.recommended_model_prob,
    probability_edge: calculateProbabilityEdge(row.recommended_model_prob, marketProb),
    fair_odd: row.recommended_fair_odd,
    ev: row.recommended_ev,
    market_overround: row.market_overround,
    model_gap_value: row.total_gap_vs_line == null ? null : Math.abs(row.total_gap_vs_line),
    model_gap_label: "Gap de total projetado vs linha",
    base_candidate_status: row.projection_status === "unsupported_line" ? "unsupported_line" : row.candidate_status,
    projection_status: row.projection_status,
    correlation_group_id: row.game_id,
    reasons: [
      ...row.reasons,
      row.total_gap_vs_line != null && row.line != null
        ? `Linha ${formatLine(row.line)} | Total ASP ${formatLine(row.projected_total_runs)} | Gap ${isOver ? "+" : ""}${row.total_gap_vs_line.toFixed(2)} corridas`
        : null,
    ].filter(Boolean) as string[],
    alerts: row.alerts,
    source_projection_payload: row,
  });
}

export function normalizeHandicapOpportunity(row: MlbHandicapScreenerRow): MlbUnifiedOpportunity {
  const marketProb = row.recommended_side === "home"
    ? row.home_market_implied_prob_no_vig
    : row.recommended_side === "away"
      ? row.away_market_implied_prob_no_vig
      : null;
  return finalizeOpportunity({
    opportunity_id: `${row.row_id}_handicap_${row.recommended_side ?? "none"}`,
    game_id: row.game_id,
    date: row.date,
    time: row.time,
    home_team: row.home_team,
    away_team: row.away_team,
    matchup: `${row.home_team} vs ${row.away_team}`,
    market_family: "handicap",
    market_label: "Asian Handicap",
    pick_label: row.recommended_pick ? `${row.recommended_pick} ${formatSignedLine(row.recommended_line)}` : null,
    selection_team: row.recommended_pick,
    side: row.recommended_side,
    line: row.recommended_line,
    line_type: row.line_type,
    is_main_line: row.is_main_handicap_line,
    distance_from_main_line: row.distance_from_main_handicap_line,
    offered_odd: row.recommended_odd,
    median_odd: row.recommended_odd_mediana,
    market_base_odd: row.recommended_odd_mediana,
    bookmaker_melhor: row.recommended_bookmaker_melhor,
    market_prob_no_vig: marketProb,
    model_prob: row.recommended_model_prob,
    probability_edge: calculateProbabilityEdge(row.recommended_model_prob, marketProb),
    fair_odd: row.recommended_fair_odd,
    ev: row.recommended_ev,
    market_overround: row.market_overround,
    model_gap_value: calculateProbabilityEdge(row.recommended_model_prob, marketProb),
    model_gap_label: "Edge de cover no handicap",
    base_candidate_status: row.candidate_status,
    projection_status: row.projection_status,
    correlation_group_id: row.game_id,
    reasons: row.reasons,
    alerts: row.alerts,
    source_projection_payload: row,
  });
}

export function buildMlbUnifiedOpportunities(params: {
  moneylineRows: MlbMoneylineScreenerRow[];
  totalsRows: MlbTotalsScreenerRow[];
  handicapRows: MlbHandicapScreenerRow[];
}): MlbUnifiedOpportunity[] {
  return [
    ...params.moneylineRows.map(normalizeMoneylineOpportunity),
    ...params.totalsRows.map(normalizeTotalsOpportunity),
    ...params.handicapRows.map(normalizeHandicapOpportunity),
  ];
}

export function calculateMlbOpportunityScoreBreakdown(
  opportunity: MlbUnifiedOpportunity,
  ctx?: MlbCriticalValidationContext | null,
): { raw_score: number; final_score: number; applied_penalties: MlbOpportunityAppliedPenalty[] } {
  if (hasHardBlock(opportunity)) {
    return { raw_score: 0, final_score: 0, applied_penalties: [] };
  }
  const components = calculateScoreComponentsBase(opportunity);
  const weighted =
    components.ev_quality_score * MLB_OPPORTUNITY_SCORE_WEIGHTS.evQuality +
    components.probability_edge_score * MLB_OPPORTUNITY_SCORE_WEIGHTS.probabilityEdge +
    components.market_line_quality_score * MLB_OPPORTUNITY_SCORE_WEIGHTS.marketLineQuality +
    components.model_gap_score * MLB_OPPORTUNITY_SCORE_WEIGHTS.modelGap +
    components.data_quality_score * MLB_OPPORTUNITY_SCORE_WEIGHTS.dataQuality +
    components.base_status_coherence_score * MLB_OPPORTUNITY_SCORE_WEIGHTS.baseStatusCoherence -
    components.risk_penalty;
  const rawScore = round(clamp(weighted, 0, 100), 1);

  const penalties: MlbOpportunityAppliedPenalty[] = [];
  const pushPenalty = (flag: string, delta: number) => penalties.push({ flag, delta });
  const hasAlert = (pattern: RegExp) => opportunity.alerts.some((alert) => pattern.test(alert));

  if (opportunity.market_family === "moneyline") pushPenalty("moneyline_no_pitcher_context", -8);
  if (isHighEdgeWithoutPitchers(opportunity)) pushPenalty("high_edge_without_pitchers", -12);
  if (hasAlert(/low_fair_odd_tail_risk/i)) pushPenalty("low_fair_odd_tail_risk", -8);
  if (hasAlert(/alternate_total_line_risk/i)) pushPenalty("alternate_total_line_risk", -12);
  if (hasAlert(/alternate_handicap_line_risk/i)) pushPenalty("alternate_handicap_line_risk", -10);
  if (hasAlert(/runline_margin_risk/i)) pushPenalty("runline_margin_risk", -8);

  const totalPenalty = penalties.reduce((sum, item) => sum + item.delta, 0);
  const afterPenalty = rawScore + totalPenalty;
  const cap = isCriticalValidationPass(ctx) ? 100 : MLB_PRE_CRITICAL_MAX_SCORE;
  const finalScore = round(clamp(afterPenalty, 0, cap), 1);
  return { raw_score: rawScore, final_score: finalScore, applied_penalties: penalties };
}

export function calculateMlbOpportunityScore(
  opportunity: MlbUnifiedOpportunity,
  ctx?: MlbCriticalValidationContext | null,
): number {
  return calculateMlbOpportunityScoreBreakdown(opportunity, ctx).final_score;
}

export function calculateMlbOpportunityConfidence(
  opportunity: MlbUnifiedOpportunity,
  ctx?: MlbCriticalValidationContext | null,
): number {
  if (opportunity.projection_status === "missing_data" || opportunity.projection_status === "unsupported_line") return 0;
  let score = 60;
  if (opportunity.is_main_line) score += 10;
  if ((opportunity.ev ?? 0) >= 0.08) score += 8;
  if ((opportunity.probability_edge ?? 0) >= 0.06) score += 8;
  if (isOddInIdealBand(opportunity.offered_odd)) score += 5;
  if (opportunity.base_candidate_status === "analisar") score += 5;
  if (!opportunity.is_main_line) score -= 10;
  if (!isOddInAcceptableBand(opportunity.offered_odd)) score -= 10;
  if ((opportunity.probability_edge ?? 0) < 0.04) score -= 10;
  if ((opportunity.ev ?? 0) < 0.05) score -= 10;
  if (hasFallbackAverage(opportunity)) score -= 10;
  if (countRelevantAlerts(opportunity.alerts) >= 4) score -= 10;
  if (hasTailWarning(opportunity)) score -= 15;
  if (opportunity.market_family === "moneyline") score -= 8;
  if (isHighEdgeWithoutPitchers(opportunity)) score -= 10;
  const cap = isCriticalValidationPass(ctx) ? 100 : MLB_PRE_CRITICAL_MAX_CONFIDENCE;
  return round(clamp(score, 0, cap), 1);
}

function isCriticalValidationPass(ctx?: MlbCriticalValidationContext | null) {
  return Boolean(
    ctx &&
      ctx.readiness_status === "pronto_para_validator" &&
      ctx.alignment_status === "supports_screener",
  );
}

export function applyMlbOpportunityRiskPenalties(opportunity: MlbUnifiedOpportunity): string[] {
  const flags: string[] = [];
  if (!opportunity.pick_label) flags.push("recommended_side ausente");
  if ((opportunity.ev ?? 0) <= 0) flags.push("EV <= 0");
  if (opportunity.projection_status === "missing_data") flags.push("projection_status missing_data");
  if (opportunity.projection_status === "unsupported_line") flags.push("unsupported_line");
  if ((opportunity.offered_odd ?? 0) < 1.45) flags.push("odd < 1.45");
  if ((opportunity.offered_odd ?? 0) > 3.00) flags.push("odd > 3.00");
  if (!opportunity.is_main_line && (opportunity.distance_from_main_line ?? 0) > 1.0) flags.push("linha alternativa distante da principal");
  if ((opportunity.market_overround ?? 0) > 0.08) flags.push("market_overround > 8%");
  if ((opportunity.probability_edge ?? 0) < 0.03) flags.push("probability_edge < 3 p.p.");
  if ((opportunity.ev ?? 0) < 0.03) flags.push("EV < 3%");
  if (hasTailWarning(opportunity)) flags.push("distribution_tail_warning");
  if (hasFallbackAverage(opportunity)) flags.push("league_average_source fallback");
  const relevantAlerts = countRelevantAlerts(opportunity.alerts);
  if (relevantAlerts >= 6) flags.push("muitos alertas criticos");
  else if (relevantAlerts >= 3) flags.push("alertas condicionais relevantes");
  if (isHighEdgeWithoutPitchers(opportunity)) flags.push("high_edge_without_pitchers");
  if (opportunity.market_family === "totals" && opportunity.line_type === "alternate") flags.push("alternate_total_line_penalty");
  if (opportunity.alerts.some((alert) => /alternate_total_line_risk/i.test(alert))) flags.push("alternate_total_line_risk");
  if (opportunity.alerts.some((alert) => /low_fair_odd_tail_risk/i.test(alert))) flags.push("low_fair_odd_tail_risk");
  if (opportunity.alerts.some((alert) => /alternate_handicap_line_risk/i.test(alert))) flags.push("alternate_handicap_line_risk");
  if (opportunity.alerts.some((alert) => /runline_margin_risk/i.test(alert))) flags.push("runline_margin_risk");
  return [...new Set(flags)];
}

export function applyMlbCorrelationGuard(opportunities: MlbUnifiedOpportunity[]): MlbUnifiedOpportunity[] {
  const grouped = new Map<string, MlbUnifiedOpportunity[]>();
  for (const opportunity of opportunities) {
    const group = grouped.get(opportunity.correlation_group_id) ?? [];
    group.push(opportunity);
    grouped.set(opportunity.correlation_group_id, group);
  }

  const updated: MlbUnifiedOpportunity[] = [];
  for (const group of grouped.values()) {
    const analisar = group.filter((item) => item.priority_status === "ANALISAR");
    const eligible = analisar
      .filter((item) => isEligibleForPrimary(item))
      .sort(compareOpportunityPriority);

    // Rule: high_edge_without_pitchers deve ser preterido se houver outra oportunidade
    // do mesmo jogo com linha principal e menor risco estrutural.
    let primary = eligible[0] ?? null;
    if (primary && isHighEdgeWithoutPitchers(primary)) {
      const saferMain = eligible.find(
        (item) =>
          item.opportunity_id !== primary!.opportunity_id &&
          item.is_main_line &&
          !isHighEdgeWithoutPitchers(item) &&
          item.risk_flags.length <= primary!.risk_flags.length,
      );
      if (saferMain) primary = saferMain;
    }

    for (const opportunity of group) {
      if (!primary || opportunity.opportunity_id === primary.opportunity_id) {
        updated.push({
          ...opportunity,
          correlation_status: primary && opportunity.opportunity_id === primary.opportunity_id ? "primary" : "standalone",
          is_primary_shortlist: Boolean(primary && opportunity.opportunity_id === primary.opportunity_id),
        });
        continue;
      }
      if (opportunity.priority_status === "ANALISAR") {
        updated.push({
          ...opportunity,
          correlation_status: "correlated_alternative",
          correlated_with: primary.opportunity_id,
          is_primary_shortlist: false,
          alerts: [...new Set([...opportunity.alerts, "Existe outra oportunidade melhor ranqueada no mesmo jogo."])],
        });
        continue;
      }
      updated.push(opportunity);
    }
  }

  const primaryRanked = updated
    .filter((item) => item.is_primary_shortlist)
    .sort(compareOpportunityPriority);

  // Rule: fair_odd < 1.35 não pode ocupar top 3 da shortlist.
  const top: MlbUnifiedOpportunity[] = [];
  const deferred: MlbUnifiedOpportunity[] = [];
  for (const item of primaryRanked) {
    if (top.length < 3 && (item.fair_odd ?? Number.POSITIVE_INFINITY) < 1.35) {
      deferred.push(item);
    } else {
      top.push(item);
    }
  }
  // Rule: alternate_total_line_risk e alternate_handicap_line_risk nao podem ocupar top 5.
  const combined = [...top, ...deferred];
  const safeTop5: MlbUnifiedOpportunity[] = [];
  const laterSlots: MlbUnifiedOpportunity[] = [];
  const heldForLater: MlbUnifiedOpportunity[] = [];
  for (const item of combined) {
    const excludedFromTop5 = item.risk_flags.some((flag) => TOP5_EXCLUDED_FLAGS.has(flag));
    if (excludedFromTop5) heldForLater.push(item);
    else if (safeTop5.length < 5) safeTop5.push(item);
    else laterSlots.push(item);
  }
  const rankedPrimary = [...safeTop5, ...laterSlots, ...heldForLater]
    .slice(0, 10)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  const primaryIds = new Map(rankedPrimary.map((item) => [item.opportunity_id, item]));

  return updated
    .map((item) => primaryIds.get(item.opportunity_id) ?? { ...item, is_primary_shortlist: false, rank: null })
    .sort(compareOpportunityDisplay);
}

function isEligibleForPrimary(opportunity: MlbUnifiedOpportunity): boolean {
  // Totals alternate com distância > 1.0 excluído da shortlist principal.
  if (
    opportunity.market_family === "totals" &&
    opportunity.line_type === "alternate" &&
    (opportunity.distance_from_main_line ?? 0) > 1.0
  ) {
    return false;
  }
  // Handicap alternate nunca é primary (salvo configuração manual — não suportada).
  if (opportunity.market_family === "handicap" && opportunity.line_type === "alternate") {
    return false;
  }
  return true;
}

export function buildMlbOpportunityShortlist(params: {
  moneylineRows: MlbMoneylineScreenerRow[];
  totalsRows: MlbTotalsScreenerRow[];
  handicapRows: MlbHandicapScreenerRow[];
}): MlbOpportunityShortlistResult {
  const opportunities = applyMlbCorrelationGuard(buildMlbUnifiedOpportunities(params));
  return {
    opportunities,
    primaryShortlist: opportunities.filter((item) => item.is_primary_shortlist).sort(compareOpportunityPriority),
    monitorList: opportunities.filter((item) => item.priority_status === "MONITORAR").sort(compareOpportunityPriority).slice(0, 10),
    debugList: opportunities.filter((item) => ["PULAR", "MISSING_DATA", "UNSUPPORTED_LINE"].includes(item.priority_status)),
  };
}

export function buildMlbOpportunityValidationPayload(opportunity: MlbUnifiedOpportunity): MlbCriticalValidationPayload {
  return {
    source: "ASP Screener MLB",
    stage: "Opportunity Score",
    sport: "Baseball",
    league: "MLB",
    game: opportunity.matchup,
    date: opportunity.date,
    time: opportunity.time,
    market: opportunity.market_label,
    pick: opportunity.pick_label,
    line: opportunity.line,
    odd: opportunity.offered_odd,
    model_probability: opportunity.model_prob,
    market_probability_no_vig: opportunity.market_prob_no_vig,
    fair_odd: opportunity.fair_odd,
    ev: opportunity.ev,
    opportunity_score: opportunity.opportunity_score,
    confidence_score: opportunity.confidence_score,
    reasons: opportunity.reasons,
    alerts: opportunity.alerts,
    source_projection_payload: opportunity.source_projection_payload,
  };
}

function finalizeOpportunity(base: OpportunityBase): MlbUnifiedOpportunity {
  const placeholder = {
    ...base,
    opportunity_score: 0,
    confidence_score: 0,
    priority_status: "PULAR" as MlbOpportunityPriorityStatus,
    rank: null,
    is_primary_shortlist: false,
    correlation_status: "standalone" as const,
    correlated_with: null,
    risk_flags: [],
    score_components: zeroScoreComponents(),
    score_explanation: "",
  };
  const riskFlags = applyMlbOpportunityRiskPenalties(placeholder);
  const primed = { ...placeholder, risk_flags: riskFlags };
  const breakdown = calculateMlbOpportunityScoreBreakdown(primed);
  const scoreComponents: MlbOpportunityScoreComponents = {
    ...calculateScoreComponentsBase(primed),
    raw_score: breakdown.raw_score,
    final_score: breakdown.final_score,
    applied_penalties: breakdown.applied_penalties,
  };
  const confidenceScore = calculateMlbOpportunityConfidence(primed);
  const next = {
    ...placeholder,
    risk_flags: riskFlags,
    score_components: scoreComponents,
    opportunity_score: breakdown.final_score,
    confidence_score: confidenceScore,
  };
  return {
    ...next,
    priority_status: getPriorityStatus(next),
    score_explanation: buildScoreExplanation(next),
  };
}

export function applyMlbCriticalValidationRescore(
  opportunity: MlbUnifiedOpportunity,
  ctx: MlbCriticalValidationContext,
): MlbUnifiedOpportunity {
  const breakdown = calculateMlbOpportunityScoreBreakdown(opportunity, ctx);
  const confidence = calculateMlbOpportunityConfidence(opportunity, ctx);
  const scoreComponents: MlbOpportunityScoreComponents = {
    ...opportunity.score_components,
    raw_score: breakdown.raw_score,
    final_score: breakdown.final_score,
    applied_penalties: breakdown.applied_penalties,
  };
  const next: MlbUnifiedOpportunity = {
    ...opportunity,
    opportunity_score: breakdown.final_score,
    confidence_score: confidence,
    score_components: scoreComponents,
  };
  return { ...next, priority_status: getPriorityStatus(next), score_explanation: buildScoreExplanation(next) };
}

function calculateScoreComponentsBase(opportunity: MlbUnifiedOpportunity): Omit<MlbOpportunityScoreComponents, "raw_score" | "final_score" | "applied_penalties"> {
  return {
    ev_quality_score: normalizePositive(opportunity.ev, 0.15),
    probability_edge_score: normalizePositive(opportunity.probability_edge, 0.10),
    market_line_quality_score: calculateMarketLineQuality(opportunity),
    model_gap_score: calculateModelGapScore(opportunity),
    data_quality_score: calculateDataQualityScore(opportunity),
    base_status_coherence_score: getBaseStatusCoherence(opportunity.base_candidate_status),
    risk_penalty: calculateRiskPenalty(applyMlbOpportunityRiskPenalties(opportunity)),
  };
}

function getPriorityStatus(opportunity: MlbUnifiedOpportunity): MlbOpportunityPriorityStatus {
  if (opportunity.projection_status === "missing_data") return "MISSING_DATA";
  if (opportunity.projection_status === "unsupported_line") return "UNSUPPORTED_LINE";
  if (hasHardBlock(opportunity)) return "PULAR";
  const edgeThreshold = opportunity.market_family === "moneyline" ? 0.05 : 0.05;
  const evThreshold = opportunity.market_family === "totals" ? 0.06 : 0.05;
  const alternativeFar = !opportunity.is_main_line && (opportunity.distance_from_main_line ?? 0) > 1;
  const odd = opportunity.offered_odd ?? 0;
  const maxOdd = opportunity.market_family === "handicap" ? 3.00 : 2.80;
  const baseAnalisar = opportunity.base_candidate_status === "analisar";
  if (
    baseAnalisar &&
    opportunity.opportunity_score >= 75 &&
    opportunity.confidence_score >= 58 &&
    (opportunity.ev ?? 0) >= evThreshold &&
    (opportunity.probability_edge ?? 0) >= edgeThreshold &&
    !alternativeFar &&
    odd >= 1.55 &&
    odd <= maxOdd
  ) {
    return "ANALISAR";
  }
  if (
    opportunity.opportunity_score >= 60 ||
    ((opportunity.ev ?? 0) >= 0.02 && (opportunity.ev ?? 0) < evThreshold) ||
    ((opportunity.probability_edge ?? 0) >= 0.025 && (opportunity.probability_edge ?? 0) < edgeThreshold)
  ) {
    return "MONITORAR";
  }
  return "PULAR";
}

function hasHardBlock(opportunity: MlbUnifiedOpportunity) {
  return (
    !opportunity.pick_label ||
    !isPositiveFinite(opportunity.ev) ||
    !isPositiveFinite(opportunity.offered_odd) ||
    !isFiniteNumber(opportunity.model_prob) ||
    !isFiniteNumber(opportunity.market_prob_no_vig) ||
    opportunity.projection_status === "missing_data" ||
    opportunity.projection_status === "unsupported_line"
  );
}

function calculateMarketLineQuality(opportunity: MlbUnifiedOpportunity) {
  const oddQuality = getOddQuality(opportunity.offered_odd);
  const lineQuality = getLineQuality(opportunity);
  return round((oddQuality + lineQuality) / 2, 1);
}

function calculateModelGapScore(opportunity: MlbUnifiedOpportunity) {
  const value = opportunity.model_gap_value ?? 0;
  if (opportunity.market_family === "totals") {
    if (value >= 1.25) return 100;
    if (value >= 0.70) return 60;
    if (value >= 0.45) return 35;
    return 10;
  }
  if (value >= 0.08) return 100;
  if (value >= 0.05) return 60;
  if (value >= 0.03) return 35;
  if (value > 0) return 10;
  return 0;
}

function calculateDataQualityScore(opportunity: MlbUnifiedOpportunity) {
  let score = 70;
  if (opportunity.source_projection_payload.game?.standings_status === "matched") score += 10;
  if (!hasFallbackAverage(opportunity)) score += 5;
  if (opportunity.is_main_line) score += 5;
  if (isPositiveFinite(opportunity.offered_odd) && isFiniteNumber(opportunity.market_prob_no_vig)) score += 5;
  if (hasFallbackAverage(opportunity)) score -= 10;
  if (!opportunity.is_main_line) score -= 10;
  if (countRelevantAlerts(opportunity.alerts) >= 3) score -= 10;
  if (hasTailWarning(opportunity)) score -= 15;
  if (opportunity.projection_status === "missing_data") score -= 20;
  if (opportunity.projection_status === "unsupported_line") score -= 20;
  return round(clamp(score, 0, 85), 1);
}

function getBaseStatusCoherence(status: MlbProjectionCandidateStatus | MlbHandicapCandidateStatus) {
  if (status === "analisar") return 100;
  if (status === "monitorar") return 60;
  if (status === "pular") return 20;
  return 0;
}

function calculateRiskPenalty(flags: string[]) {
  return flags.reduce((sum, flag) => {
    if (/ausente|EV <= 0|missing_data|unsupported_line/.test(flag)) return sum + 100;
    if (/odd < 1\.45|odd > 3\.00/.test(flag)) return sum + 25;
    if (/linha alternativa distante|distance_from_main/.test(flag)) return sum + 20;
    if (/alternate_total_line_penalty/.test(flag)) return sum + 12;
    if (/market_overround/.test(flag)) return sum + 10;
    if (/probability_edge/.test(flag)) return sum + 15;
    if (/EV < 3%/.test(flag)) return sum + 15;
    if (/tail_warning/.test(flag)) return sum + 10;
    if (/high_edge_without_pitchers/.test(flag)) return sum + 10;
    if (/fallback/.test(flag)) return sum + 5;
    if (/muitos alertas/.test(flag)) return sum + 15;
    if (/alertas condicionais/.test(flag)) return sum + 5;
    return sum;
  }, 0);
}

function isHighEdgeWithoutPitchers(opportunity: MlbUnifiedOpportunity) {
  return opportunity.market_family === "moneyline" && (opportunity.ev ?? 0) >= 0.15;
}

function getOddQuality(odd: number | null) {
  if (odd == null || !Number.isFinite(odd)) return 0;
  if (odd >= 1.70 && odd <= 2.20) return 100;
  if ((odd >= 1.55 && odd <= 1.69) || (odd >= 2.21 && odd <= 2.60)) return 75;
  if ((odd >= 1.45 && odd <= 1.54) || (odd >= 2.61 && odd <= 2.90)) return 40;
  return 10;
}

function getLineQuality(opportunity: MlbUnifiedOpportunity) {
  if (opportunity.market_family === "moneyline") return 100;
  if (opportunity.is_main_line) return 100;
  const distance = opportunity.distance_from_main_line ?? Number.POSITIVE_INFINITY;
  if (distance <= 0.5) return 75;
  if (distance <= 1) return 50;
  return 20;
}

function getMoneylineRecommendedSide(row: MlbMoneylineScreenerRow): "home" | "away" | null {
  if (!row.recommended_side) return null;
  if (row.recommended_side === row.home_team) return "home";
  if (row.recommended_side === row.away_team) return "away";
  return null;
}

function compareOpportunityPriority(a: MlbUnifiedOpportunity, b: MlbUnifiedOpportunity) {
  return (
    b.opportunity_score - a.opportunity_score ||
    b.confidence_score - a.confidence_score ||
    Number(b.is_main_line) - Number(a.is_main_line) ||
    a.risk_flags.length - b.risk_flags.length ||
    Number(isOddInPreferredBand(b.offered_odd)) - Number(isOddInPreferredBand(a.offered_odd)) ||
    getAdjustedEv(b) - getAdjustedEv(a) ||
    getLineQuality(b) - getLineQuality(a) ||
    getStructuralRiskRank(a) - getStructuralRiskRank(b)
  );
}

function isOddInPreferredBand(odd: number | null) {
  return odd != null && odd >= 1.70 && odd <= 2.10;
}

function getAdjustedEv(opportunity: MlbUnifiedOpportunity) {
  const ev = opportunity.ev ?? 0;
  const scoreFactor = clamp(opportunity.opportunity_score / 100, 0, 1);
  return ev * scoreFactor;
}

function compareOpportunityDisplay(a: MlbUnifiedOpportunity, b: MlbUnifiedOpportunity) {
  return (
    Number(b.is_primary_shortlist) - Number(a.is_primary_shortlist) ||
    statusRank(a.priority_status) - statusRank(b.priority_status) ||
    b.opportunity_score - a.opportunity_score
  );
}

function getStructuralRiskRank(opportunity: MlbUnifiedOpportunity) {
  if (opportunity.market_family === "moneyline") return 1;
  if (opportunity.market_family === "totals" && opportunity.is_main_line) return 2;
  if (opportunity.market_family === "handicap" && opportunity.is_main_line) return 3;
  if (opportunity.market_family === "totals") return 4;
  return 5;
}

function statusRank(status: MlbOpportunityPriorityStatus) {
  const map: Record<MlbOpportunityPriorityStatus, number> = {
    ANALISAR: 1,
    MONITORAR: 2,
    PULAR: 3,
    MISSING_DATA: 4,
    UNSUPPORTED_LINE: 5,
  };
  return map[status];
}

function buildScoreExplanation(opportunity: MlbUnifiedOpportunity) {
  if (hasHardBlock(opportunity)) {
    return `Score ${opportunity.opportunity_score}: item bloqueado para shortlist por ${opportunity.risk_flags.join(", ") || "dados insuficientes"}.`;
  }
  return `O screener atribuiu Score ${opportunity.opportunity_score} porque o EV projetado e ${formatPercent(opportunity.ev)}, o edge contra o mercado e ${formatPercent(opportunity.probability_edge)} e a linha ${opportunity.is_main_line ? "e principal" : "e alternativa"}. A confianca permanece limitada porque o modelo ainda nao considera starters, bullpens, lineups, park factor ou clima.`;
}

function zeroScoreComponents(): MlbOpportunityScoreComponents {
  return {
    ev_quality_score: 0,
    probability_edge_score: 0,
    market_line_quality_score: 0,
    model_gap_score: 0,
    data_quality_score: 0,
    base_status_coherence_score: 0,
    risk_penalty: 0,
    raw_score: 0,
    final_score: 0,
    applied_penalties: [],
  };
}

function calculateProbabilityEdge(modelProb: number | null, marketProb: number | null) {
  if (!isFiniteNumber(modelProb) || !isFiniteNumber(marketProb)) return null;
  return round(modelProb - marketProb, 4);
}

function normalizePositive(value: number | null, cap: number) {
  if (!isFiniteNumber(value) || value <= 0) return 0;
  return round(clamp(value / cap, 0, 1) * 100, 1);
}

function hasFallbackAverage(opportunity: MlbUnifiedOpportunity) {
  return JSON.stringify(opportunity.source_projection_payload).includes('"league_average_source":"fallback"') ||
    opportunity.alerts.some((alert) => /fallback/i.test(alert));
}

function hasTailWarning(opportunity: MlbUnifiedOpportunity) {
  return JSON.stringify(opportunity.source_projection_payload).includes('"distribution_tail_warning":true') ||
    opportunity.alerts.some((alert) => /cauda relevante|tail/i.test(alert));
}

function countRelevantAlerts(alerts: string[]) {
  return alerts.filter((alert) => !UNIVERSAL_MODEL_ALERT_PATTERNS.some((pattern) => pattern.test(alert))).length;
}

function isOddInIdealBand(odd: number | null) {
  return odd != null && odd >= 1.70 && odd <= 2.20;
}

function isOddInAcceptableBand(odd: number | null) {
  return odd != null && odd >= 1.55 && odd <= 2.60;
}

function isPositiveFinite(value: number | null) {
  return value != null && Number.isFinite(value) && value > 0;
}

function isFiniteNumber(value: number | null): value is number {
  return value != null && Number.isFinite(value);
}

function formatLine(value: number | null) {
  return value == null ? "-" : value.toFixed(1);
}

function formatSignedLine(value: number | null) {
  if (value == null) return "-";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function formatPercent(value: number | null) {
  if (value == null) return "-";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
