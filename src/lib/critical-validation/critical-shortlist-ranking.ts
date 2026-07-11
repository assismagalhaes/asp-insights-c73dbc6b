import type { Prognostico } from "@/lib/db";

export type CriticalShortlistStatus = "CANDIDATA" | "MONITORAR" | "RESERVA" | "BLOQUEADA";
export type CriticalShortlistFinalStatus = "TOP_FINAL" | "RESERVA_CONFIRMADA" | "PULAR" | "RESERVA_NAO_ANALISADA";
export type CriticalRiskSeverity = "low" | "medium" | "high" | "critical" | "hard_block";

export type CriticalShortlistRiskFlag = {
  code: string;
  severity: CriticalRiskSeverity;
  message: string;
};

export type CriticalShortlistScoreComponents = {
  value_score: number;
  probability_margin_score: number;
  odds_operational_score: number;
  data_readiness_score: number;
  market_risk_score: number;
  timing_score: number;
  source_integrity_score: number;
  risk_penalty: number;
};

export type CriticalShortlistCandidate = {
  prognostico: Prognostico;
  rank: number | null;
  critical_shortlist_score: number;
  critical_shortlist_confidence: number;
  critical_shortlist_status: CriticalShortlistStatus;
  operational_status: "SHORTLIST_PRE_IA" | "RESERVA_NAO_ANALISADA" | "BLOQUEADA";
  components: CriticalShortlistScoreComponents;
  risk_flags: CriticalShortlistRiskFlag[];
  applied_penalties: Array<{ code: string; severity: CriticalRiskSeverity; delta: number }>;
  effective_edge: number | null;
  implied_probability: number | null;
  probability_margin: number | null;
  value_gap: number | null;
  score_explanation: string;
  missing_fields: string[];
};

export type CriticalShortlistStats = {
  total: number;
  candidates: number;
  monitor: number;
  reserves: number;
  blocked: number;
  highRisk: number;
  bestScore: number | null;
  bestEdge: number | null;
};

export type CriticalShortlistChallengerAlert = {
  message: string;
  challengerIds: string[];
};

export type CriticalShortlistResult = {
  ranked: CriticalShortlistCandidate[];
  shortlist: CriticalShortlistCandidate[];
  reservesNotAnalyzed: CriticalShortlistCandidate[];
  blocked: CriticalShortlistCandidate[];
  stats: CriticalShortlistStats;
  challengerAlert: CriticalShortlistChallengerAlert | null;
};

export type CriticalFinalRankingInput = {
  prognostico: Prognostico;
  decision: "CONFIRMAR" | "PULAR" | null;
  adjusted_probability?: number | null;
  adjusted_ev?: number | null;
  critical_validation_score?: number | null;
  preview_alignment_score?: number | null;
  data_quality_after_validation?: number | null;
  conflict_severity?: CriticalRiskSeverity | null;
  final_risk_flags?: CriticalShortlistRiskFlag[];
};

export type CriticalFinalRankingItem = {
  input: CriticalFinalRankingInput;
  rank: number | null;
  final_status: CriticalShortlistFinalStatus;
  critical_final_score: number;
  final_risk_flags: CriticalShortlistRiskFlag[];
};

const SHORTLIST_LIMIT = 12;

const WEIGHTS = {
  value: 0.38,
  probabilityMargin: 0.24,
  dataReadiness: 0.20,
  marketRisk: 0.10,
  timing: 0.06,
  sourceIntegrity: 0.02,
} as const;

const PENALTY_BY_SEVERITY: Record<CriticalRiskSeverity, number> = {
  low: 2,
  medium: 6,
  high: 12,
  critical: 25,
  hard_block: 100,
};

export function buildCriticalShortlist(prognosticos: Prognostico[], now = new Date()): CriticalShortlistResult {
  const pending = prognosticos.filter((p) => p.resultado === "PENDENTE" && p.status_validacao === "PENDENTE");
  const ranked = pending.map((p) => buildCandidate(p, now)).sort(compareCandidates);

  let displayRank = 1;
  const withRanks = ranked.map((candidate) => {
    if (candidate.critical_shortlist_status === "BLOQUEADA") return { ...candidate, rank: null };
    return { ...candidate, rank: displayRank++ };
  });

  const eligible = withRanks.filter((item) => item.critical_shortlist_status !== "BLOQUEADA");
  const shortlist = eligible.slice(0, SHORTLIST_LIMIT).map((item) => ({
    ...item,
    operational_status: "SHORTLIST_PRE_IA" as const,
  }));
  const shortlistIds = new Set(shortlist.map((item) => item.prognostico.id));
  const reservesNotAnalyzed = eligible
    .filter((item) => !shortlistIds.has(item.prognostico.id))
    .map((item) => ({ ...item, operational_status: "RESERVA_NAO_ANALISADA" as const }));
  const blocked = withRanks
    .filter((item) => item.critical_shortlist_status === "BLOQUEADA")
    .map((item) => ({ ...item, operational_status: "BLOQUEADA" as const }));

  return {
    ranked: [...shortlist, ...reservesNotAnalyzed, ...blocked],
    shortlist,
    reservesNotAnalyzed,
    blocked,
    stats: buildStats(withRanks),
    challengerAlert: detectChallengerAlert(shortlist),
  };
}

export function calculateCriticalShortlistScore(prognostico: Prognostico, now = new Date()): {
  score: number;
  components: CriticalShortlistScoreComponents;
  flags: CriticalShortlistRiskFlag[];
  appliedPenalties: CriticalShortlistCandidate["applied_penalties"];
  effectiveEdge: number | null;
  impliedProbability: number | null;
  probabilityMargin: number | null;
  valueGap: number | null;
  missingFields: string[];
} {
  const flags = detectCriticalShortlistRiskFlags(prognostico, now);
  const value = calculateValueScore(prognostico);
  const probability = calculateProbabilityMarginScore(prognostico);
  const data = calculateDataReadinessScore(prognostico);
  const market = calculateMarketRiskScore(prognostico);
  const timing = calculateTimingScore(prognostico, now);
  const sourceIntegrity = calculateSourceIntegrityScore(prognostico);
  const oddsOperational = calculateOddsOperationalScore(prognostico);
  const penalties = applyCriticalShortlistPenalties(flags);
  const hardBlocked = flags.some((flag) => flag.severity === "hard_block");
  const weighted =
    value.score * WEIGHTS.value +
    probability.score * WEIGHTS.probabilityMargin +
    data.score * WEIGHTS.dataReadiness +
    market.score * WEIGHTS.marketRisk +
    timing.score * WEIGHTS.timing +
    sourceIntegrity * WEIGHTS.sourceIntegrity -
    penalties.total;
  const score = hardBlocked ? 0 : round(clamp(weighted, 0, 100), 1);
  return {
    score,
    components: {
      value_score: value.score,
      probability_margin_score: probability.score,
      odds_operational_score: oddsOperational,
      data_readiness_score: data.score,
      market_risk_score: market.score,
      timing_score: timing.score,
      source_integrity_score: sourceIntegrity,
      risk_penalty: penalties.total,
    },
    flags,
    appliedPenalties: penalties.applied,
    effectiveEdge: value.effectiveEdge,
    impliedProbability: probability.impliedProbability,
    probabilityMargin: probability.margin,
    valueGap: value.valueGap,
    missingFields: data.missingFields,
  };
}

export function calculateCriticalShortlistConfidence(
  prognostico: Prognostico,
  flags = detectCriticalShortlistRiskFlags(prognostico),
): number {
  if (flags.some((flag) => flag.severity === "hard_block")) return 0;
  const data = calculateDataReadinessScore(prognostico);
  const probability = calculateProbabilityMarginScore(prognostico);
  const odds = calculateOddsOperationalScore(prognostico);
  const hasSource = Boolean(String(prognostico.origem_modelo ?? "").trim());
  let score = 60;
  if (data.hasUsefulContext) score += 10;
  if (isFiniteNumber(prognostico.edge_ajustado)) score += 8;
  if ((probability.margin ?? 0) >= 5) score += 8;
  if (odds >= 90) score += 5;
  if (hasSource) score += 5;
  if (prognostico.mercado && prognostico.pick && (prognostico.linha || !marketUsuallyNeedsLine(prognostico))) score += 5;
  if (!data.hasUsefulContext) score -= 8;
  if (!isFiniteNumber(prognostico.edge_ajustado)) score -= 8;
  if (odds < 85) score -= 8;
  if (isVolatileMarket(prognostico)) score -= 10;
  if (data.missingFields.length) score -= 10;
  score -= flags.filter((flag) => flag.severity === "high").length * 15;
  score -= flags.filter((flag) => flag.severity === "critical").length * 20;
  return round(clamp(score, 0, 85), 1);
}

export function calculateValueScore(prognostico: Prognostico): {
  score: number;
  effectiveEdge: number | null;
  valueGap: number | null;
} {
  const valueGap =
    isPositiveFinite(prognostico.odd_ofertada) && isPositiveFinite(prognostico.odd_valor)
      ? (prognostico.odd_ofertada / prognostico.odd_valor - 1) * 100
      : null;
  const calculatedEdge = isFiniteNumber(valueGap) ? valueGap : null;
  const effectiveEdge =
    isFiniteNumber(prognostico.edge_ajustado)
      ? prognostico.edge_ajustado
      : isFiniteNumber(prognostico.edge)
        ? prognostico.edge
        : calculatedEdge;
  if (!isFiniteNumber(effectiveEdge) || effectiveEdge <= 0) return { score: 0, effectiveEdge, valueGap };
  if (effectiveEdge <= 3) return { score: round((effectiveEdge / 3) * 30, 1), effectiveEdge, valueGap };
  if (effectiveEdge <= 6) return { score: round(30 + ((effectiveEdge - 3) / 3) * 25, 1), effectiveEdge, valueGap };
  if (effectiveEdge <= 10) return { score: round(55 + ((effectiveEdge - 6) / 4) * 30, 1), effectiveEdge, valueGap };
  return { score: round(clamp(85 + Math.min(effectiveEdge - 10, 5) * 3, 0, 100), 1), effectiveEdge, valueGap };
}

export function calculateProbabilityMarginScore(prognostico: Prognostico): {
  score: number;
  impliedProbability: number | null;
  margin: number | null;
} {
  const impliedProbability = isPositiveFinite(prognostico.odd_ofertada) ? (1 / prognostico.odd_ofertada) * 100 : null;
  const probability = isFiniteNumber(prognostico.probabilidade_final) ? prognostico.probabilidade_final : null;
  const margin = probability != null && impliedProbability != null ? probability - impliedProbability : null;
  if (!isFiniteNumber(margin) || margin <= 0) return { score: 0, impliedProbability, margin };
  return { score: round(clamp((margin / 8) * 100, 0, 100), 1), impliedProbability, margin };
}

export function calculateOddsOperationalScore(prognostico: Prognostico): number {
  const odd = prognostico.odd_ofertada;
  if (!isPositiveFinite(odd)) return 0;
  if (odd >= 1.70 && odd <= 1.95) return 100;
  if (odd >= 1.96 && odd <= 2.00) return 90;
  if (odd >= 1.60 && odd <= 1.69) return 85;
  if (odd >= 1.50 && odd <= 1.59) return 70;
  return 35;
}

export function calculateDataReadinessScore(prognostico: Prognostico): {
  score: number;
  structuredFieldsScore: number;
  marketCriticalFieldsScore: number;
  contextPresenceScore: number;
  sourceIntegrityScore: number;
  missingFields: string[];
  hasUsefulContext: boolean;
} {
  const text = combinedContext(prognostico);
  const missingFields: string[] = [];
  const structuredSignals = countStructuredSignals(prognostico, text);
  const structuredFieldsScore = round(clamp((structuredSignals / 10) * 100, 0, 100), 1);
  const critical = detectMarketCriticalSignals(prognostico, text);
  const contextPresenceScore = calculateContextPresenceScore(prognostico, text);
  const sourceIntegrityScore = calculateSourceIntegrityScore(prognostico);
  if (!prognostico.mercado) missingFields.push("mercado");
  if (!prognostico.pick) missingFields.push("pick");
  if (marketUsuallyNeedsLine(prognostico) && !prognostico.linha) missingFields.push("linha");
  if (!textHasUsefulContent(text)) missingFields.push("contexto tecnico");
  missingFields.push(...critical.missingFields);
  const score = round(
    clamp(
      structuredFieldsScore * 0.40 +
        critical.score * 0.30 +
        contextPresenceScore * 0.20 +
        sourceIntegrityScore * 0.10,
      0,
      100,
    ),
    1,
  );
  return {
    score,
    structuredFieldsScore,
    marketCriticalFieldsScore: critical.score,
    contextPresenceScore,
    sourceIntegrityScore,
    missingFields: Array.from(new Set(missingFields)),
    hasUsefulContext: textHasUsefulContent(text),
  };
}

export function calculateMarketRiskScore(prognostico: Prognostico): { score: number; recognized: boolean } {
  const market = normalized(`${prognostico.mercado} ${prognostico.pick}`);
  const lineAlternative = isAlternativeLine(prognostico);
  if (/player prop|props|jogador|pontos jogador|rebotes|assistencias|pra\b/.test(market)) {
    return { score: lineAlternative ? 30 : 45, recognized: true };
  }
  if (/race|corrida|primeiro escanteio|first corner/.test(market)) return { score: lineAlternative ? 35 : 50, recognized: true };
  if (/escanteio|corner/.test(market)) return { score: lineAlternative ? 45 : 62, recognized: true };
  if (/ambas marcam|btts/.test(market)) return { score: 68, recognized: true };
  if (/handicap|spread|run line/.test(market)) return { score: lineAlternative ? 45 : 70, recognized: true };
  if (/over|under|total|gols|pontos|corridas|runs/.test(market)) return { score: lineAlternative ? 50 : 75, recognized: true };
  if (/moneyline|vencedor|resultado|1x2|dupla chance|double chance/.test(market)) return { score: 85, recognized: true };
  return { score: 40, recognized: false };
}

export function calculateTimingScore(prognostico: Prognostico, now = new Date()): { score: number; minutesToStart: number | null } {
  const start = parseEventDate(prognostico);
  if (!start) return { score: 40, minutesToStart: null };
  const minutes = (start.getTime() - now.getTime()) / 60000;
  if (minutes <= 0) return { score: 0, minutesToStart: minutes };
  if (minutes < 15) return { score: 20, minutesToStart: minutes };
  if (minutes <= 60) return { score: 85, minutesToStart: minutes };
  if (minutes <= 240) return { score: 100, minutesToStart: minutes };
  if (minutes <= 720) return { score: 75, minutesToStart: minutes };
  return { score: 55, minutesToStart: minutes };
}

export function calculateSourceIntegrityScore(prognostico: Prognostico): number {
  const hasOrigin = Boolean(String(prognostico.origem_modelo ?? "").trim());
  const text = combinedContext(prognostico);
  const hasContext = textHasUsefulContent(text);
  const hasStructuredPayload = looksStructured(text);
  if (hasOrigin && hasStructuredPayload && hasContext) return 85;
  if (hasOrigin && hasContext) return 70;
  if (!hasOrigin && hasContext && countStructuredSignals(prognostico, text) >= 4) return 55;
  if (hasOrigin || hasContext) return 35;
  return 15;
}

export function detectCriticalShortlistRiskFlags(prognostico: Prognostico, now = new Date()): CriticalShortlistRiskFlag[] {
  const flags: CriticalShortlistRiskFlag[] = [];
  const value = calculateValueScore(prognostico);
  const probability = calculateProbabilityMarginScore(prognostico);
  const market = calculateMarketRiskScore(prognostico);
  const timing = calculateTimingScore(prognostico, now);
  const data = calculateDataReadinessScore(prognostico);
  const text = combinedContext(prognostico);

  pushIf(flags, !prognostico.pick, "pick_missing", "hard_block", "Pick ausente.");
  pushIf(flags, !prognostico.mercado, "market_missing", "hard_block", "Mercado ausente.");
  pushIf(flags, !isPositiveFinite(prognostico.odd_ofertada), "odd_missing", "hard_block", "Odd ofertada invalida ou ausente.");
  pushIf(flags, timing.minutesToStart != null && timing.minutesToStart <= 0, "event_already_started", "hard_block", "Evento ja iniciado.");
  pushIf(
    flags,
    isPositiveFinite(prognostico.odd_valor) && prognostico.odd_ofertada <= prognostico.odd_valor,
    "odd_not_above_fair_odd",
    "hard_block",
    "Odd ofertada nao supera a odd de valor esperada pelo modelo.",
  );
  pushIf(flags, !isPositiveFinite(prognostico.odd_valor), "fair_odd_missing", "medium", "Odd de valor ausente.");
  pushIf(
    flags,
    isPositiveFinite(prognostico.odd_ofertada) && (prognostico.odd_ofertada < 1.5 || prognostico.odd_ofertada > 2),
    "odd_outside_model_filter_range",
    "medium",
    "Odd fora da faixa esperada do filtro preditivo inicial.",
  );
  pushIf(
    flags,
    isPositiveFinite(prognostico.odd_valor) && isPositiveFinite(prognostico.odd_ofertada) &&
      (prognostico.odd_ofertada < 1.5 || prognostico.odd_ofertada > 2 || prognostico.odd_ofertada <= prognostico.odd_valor),
    "value_filter_inconsistency",
    "high",
    "Inconsistencia contra o filtro upstream esperado de odd/valor.",
  );
  pushIf(flags, !isFiniteNumber(value.effectiveEdge), "edge_missing", "high", "Edge ausente.");
  pushIf(flags, isFiniteNumber(value.effectiveEdge) && value.effectiveEdge <= 0, "edge_not_positive", "hard_block", "Edge nao positivo.");
  pushIf(flags, !isFiniteNumber(prognostico.edge_ajustado), "edge_adjusted_missing", "medium", "Edge ajustado ausente.");
  pushIf(
    flags,
    isFiniteNumber(value.effectiveEdge) && value.effectiveEdge >= 18,
    "edge_extreme_needs_review",
    "medium",
    "Edge muito alto exige revisao para evitar distorcao.",
  );
  pushIf(
    flags,
    /CONFLITO_FORTE_COM_MERCADO/i.test(text),
    "model_market_conflict_strong",
    "high",
    "Modelo WNBA diverge fortemente da linha de mercado; manter como reserva ate validacao contextual.",
  );
  pushIf(flags, !isFiniteNumber(prognostico.probabilidade_final), "probability_missing", "hard_block", "Probabilidade ausente.");
  pushIf(
    flags,
    isFiniteNumber(probability.margin) && probability.margin <= 0,
    "probability_below_implied",
    "hard_block",
    "Probabilidade nao supera a implicita da odd.",
  );
  pushIf(
    flags,
    isFiniteNumber(probability.margin) && probability.margin > 0 && probability.margin < 3,
    "probability_margin_small",
    "medium",
    "Margem contra a probabilidade implicita e pequena.",
  );
  pushIf(flags, !String(prognostico.origem_modelo ?? "").trim(), "source_missing", "medium", "Origem nao identificada.");
  pushIf(flags, !textHasUsefulContent(text), "technical_context_weak", "high", "Contexto tecnico insuficiente.");
  pushIf(flags, data.missingFields.length > 0, "critical_fields_missing", "medium", "Campos criticos ausentes ou incompletos.");
  pushIf(flags, !market.recognized, "market_not_recognized", "medium", "Mercado pouco reconhecido.");
  pushIf(flags, isVolatileMarket(prognostico), "volatile_market", "medium", "Mercado estruturalmente volatil.");
  pushIf(flags, isAlternativeLine(prognostico), "alternative_line", "high", "Linha alternativa ou distante exige mais contexto.");
  pushIf(
    flags,
    market.score <= 62 && !textHasUsefulContent(text),
    "market_requires_extra_context",
    "high",
    "Mercado exige contexto adicional antes da analise.",
  );
  pushIf(
    flags,
    isMlbTotals(prognostico) && !/starter|pitcher|arremessador|probable/i.test(text),
    "mlb_totals_starter_missing",
    "high",
    "MLB totals sem starter identificado no contexto.",
  );
  pushIf(
    flags,
    isWnbaBasketball(prognostico) && isBasketballTotalMarket(prognostico) && !hasBasketballPaceEfficiencyContext(text),
    "wnba_total_pace_context_missing",
    "high",
    "WNBA total/over-under sem sinais de pace, eficiencia ou posses no contexto.",
  );
  pushIf(
    flags,
    isWnbaBasketball(prognostico) && isBasketballSpreadMarket(prognostico) && !hasBasketballSpreadContext(text),
    "wnba_spread_context_missing",
    "medium",
    "WNBA spread/handicap sem sinais de margem, matchup, mando ou descanso.",
  );
  pushIf(
    flags,
    isWnbaBasketball(prognostico) && isBasketballMoneylineMarket(prognostico) && !hasBasketballMoneylineContext(text),
    "wnba_moneyline_context_missing",
    "medium",
    "WNBA moneyline sem sinais de forma, matchup, mando ou disponibilidade.",
  );
  pushIf(
    flags,
    isWnbaBasketball(prognostico) && isBasketballPlayerPropMarket(prognostico) && !hasBasketballPlayerPropContext(text),
    "wnba_player_prop_context_missing",
    "high",
    "WNBA player prop sem sinais de minutos, uso, rotacao ou papel da jogadora.",
  );
  pushIf(
    flags,
    isWnbaBasketball(prognostico) && !hasBasketballAvailabilityContext(text),
    "wnba_availability_context_missing",
    "low",
    "WNBA sem contexto de rotacao, lesoes, descanso ou disponibilidade.",
  );
  pushIf(flags, timing.minutesToStart == null, "event_time_missing", "medium", "Horario do evento ausente.");
  pushIf(
    flags,
    timing.minutesToStart != null && timing.minutesToStart > 0 && timing.minutesToStart < 15,
    "event_too_close",
    "high",
    "Evento muito proximo para validacao confortavel.",
  );
  pushIf(
    flags,
    timing.minutesToStart != null && timing.minutesToStart > 720,
    "event_far_from_start",
    "medium",
    "Evento ainda distante; informacoes podem mudar.",
  );

  return dedupeFlags(flags);
}

export function applyCriticalShortlistPenalties(flags: CriticalShortlistRiskFlag[]): {
  total: number;
  applied: CriticalShortlistCandidate["applied_penalties"];
} {
  const applied = flags
    .filter((flag) => flag.severity !== "hard_block")
    .map((flag) => ({ code: flag.code, severity: flag.severity, delta: PENALTY_BY_SEVERITY[flag.severity] }));
  return {
    total: applied.reduce((sum, item) => sum + item.delta, 0),
    applied,
  };
}

export function classifyCriticalShortlistCandidate(
  score: number,
  confidence: number,
  flags: CriticalShortlistRiskFlag[],
  prognostico?: Prognostico,
): CriticalShortlistStatus {
  if (flags.some((flag) => flag.severity === "hard_block")) return "BLOQUEADA";
  if (flags.some((flag) => flag.code === "model_market_conflict_strong")) return "RESERVA";
  const hasValue = prognostico ? calculateValueScore(prognostico).effectiveEdge ?? 0 : 1;
  const hasProbabilityMargin = prognostico ? calculateProbabilityMarginScore(prognostico).margin ?? 0 : 1;
  if (score >= 70 && confidence >= 55 && hasValue > 0 && hasProbabilityMargin > 0) return "CANDIDATA";
  if (score >= 55 || confidence >= 50 || hasValue > 0) return "MONITORAR";
  return "RESERVA";
}

export function recomputeCriticalFinalRanking(items: CriticalFinalRankingInput[]): CriticalFinalRankingItem[] {
  const scored = items.map((input) => {
    const flags = input.final_risk_flags ?? [];
    const implied = isPositiveFinite(input.prognostico.odd_ofertada) ? (1 / input.prognostico.odd_ofertada) * 100 : null;
    const adjustedProbability = input.adjusted_probability ?? input.prognostico.probabilidade_final;
    const adjustedEv = input.adjusted_ev ?? input.prognostico.edge_ajustado ?? input.prognostico.edge;
    const margin = implied != null ? adjustedProbability - implied : null;
    const hardBlock =
      flags.some((flag) => flag.severity === "hard_block" || flag.severity === "critical") ||
      adjustedEv <= 0 ||
      (margin != null && margin <= 0) ||
      input.conflict_severity === "critical" ||
      input.conflict_severity === "hard_block";
    const penalty = applyCriticalShortlistPenalties(flags).total;
    const score = hardBlock || input.decision !== "CONFIRMAR"
      ? 0
      : round(
        clamp(
          normalizePositive(adjustedEv, 15) * 0.25 +
            normalizePositive(margin, 8) * 0.20 +
            clamp(input.critical_validation_score ?? 65, 0, 100) * 0.20 +
            clamp(input.preview_alignment_score ?? 60, 0, 100) * 0.15 +
            clamp(input.data_quality_after_validation ?? calculateDataReadinessScore(input.prognostico).score, 0, 100) * 0.10 +
            calculateOddsOperationalScore(input.prognostico) * 0.10 -
            penalty,
          0,
          100,
        ),
        1,
      );
    return { input, final_risk_flags: flags, critical_final_score: score, rank: null, final_status: "RESERVA_NAO_ANALISADA" as CriticalShortlistFinalStatus };
  });

  const confirmed = scored
    .filter((item) => item.input.decision === "CONFIRMAR" && item.critical_final_score > 0)
    .sort((a, b) => b.critical_final_score - a.critical_final_score);
  const confirmedIds = new Set(confirmed.map((item) => item.input.prognostico.id));
  const rankedConfirmed = confirmed.map((item, index) => ({
    ...item,
    rank: index + 1,
    final_status: index < 3 ? "TOP_FINAL" as const : "RESERVA_CONFIRMADA" as const,
  }));
  const rest = scored
    .filter((item) => !confirmedIds.has(item.input.prognostico.id))
    .map((item) => ({
      ...item,
      final_status: item.input.decision === "PULAR" ? "PULAR" as const : "RESERVA_NAO_ANALISADA" as const,
    }));
  return [...rankedConfirmed, ...rest];
}

function buildCandidate(prognostico: Prognostico, now: Date): CriticalShortlistCandidate {
  const result = calculateCriticalShortlistScore(prognostico, now);
  const confidence = calculateCriticalShortlistConfidence(prognostico, result.flags);
  const status = classifyCriticalShortlistCandidate(result.score, confidence, result.flags, prognostico);
  return {
    prognostico,
    rank: null,
    critical_shortlist_score: result.score,
    critical_shortlist_confidence: confidence,
    critical_shortlist_status: status,
    operational_status: status === "BLOQUEADA" ? "BLOQUEADA" : "RESERVA_NAO_ANALISADA",
    components: result.components,
    risk_flags: result.flags,
    applied_penalties: result.appliedPenalties,
    effective_edge: result.effectiveEdge,
    implied_probability: result.impliedProbability,
    probability_margin: result.probabilityMargin,
    value_gap: result.valueGap,
    score_explanation: buildScoreExplanation(prognostico, result.score, result.components, result.flags),
    missing_fields: result.missingFields,
  };
}

function compareCandidates(a: CriticalShortlistCandidate, b: CriticalShortlistCandidate): number {
  const aBlocked = a.critical_shortlist_status === "BLOQUEADA";
  const bBlocked = b.critical_shortlist_status === "BLOQUEADA";
  if (aBlocked !== bBlocked) return aBlocked ? 1 : -1;
  return (
    b.critical_shortlist_score - a.critical_shortlist_score ||
    b.critical_shortlist_confidence - a.critical_shortlist_confidence ||
    (b.effective_edge ?? -999) - (a.effective_edge ?? -999) ||
    (b.probability_margin ?? -999) - (a.probability_margin ?? -999) ||
    compareUsefulStart(a.prognostico, b.prognostico)
  );
}

function compareUsefulStart(a: Prognostico, b: Prognostico): number {
  const aDate = parseEventDate(a)?.getTime() ?? Number.POSITIVE_INFINITY;
  const bDate = parseEventDate(b)?.getTime() ?? Number.POSITIVE_INFINITY;
  return aDate - bDate;
}

function buildStats(candidates: CriticalShortlistCandidate[]): CriticalShortlistStats {
  const edges = candidates.map((item) => item.effective_edge).filter(isFiniteNumber);
  const scores = candidates.map((item) => item.critical_shortlist_score).filter(isFiniteNumber);
  return {
    total: candidates.length,
    candidates: candidates.filter((item) => item.critical_shortlist_status === "CANDIDATA").length,
    monitor: candidates.filter((item) => item.critical_shortlist_status === "MONITORAR").length,
    reserves: candidates.filter((item) => item.critical_shortlist_status === "RESERVA").length,
    blocked: candidates.filter((item) => item.critical_shortlist_status === "BLOQUEADA").length,
    highRisk: candidates.filter((item) => item.risk_flags.some((flag) => flag.severity === "high" || flag.severity === "critical")).length,
    bestScore: scores.length ? Math.max(...scores) : null,
    bestEdge: edges.length ? Math.max(...edges) : null,
  };
}

function detectChallengerAlert(shortlist: CriticalShortlistCandidate[]): CriticalShortlistChallengerAlert | null {
  if (shortlist.length < 4) return null;
  const third = shortlist[2];
  const challengers = shortlist.slice(3, 5).filter((item) => {
    const closeScore = third.critical_shortlist_score - item.critical_shortlist_score < 5;
    const higherEdge = (item.effective_edge ?? -999) >= (third.effective_edge ?? -999) + 2;
    const thirdHigh = third.risk_flags.some((flag) => flag.severity === "high");
    const itemHigh = item.risk_flags.some((flag) => flag.severity === "high");
    return closeScore || higherEdge || (thirdHigh && !itemHigh);
  });
  if (!challengers.length) return null;
  return {
    message: "Ha candidato reserva com score competitivo proximo ao TOP 3. Recomenda-se revisar antes de finalizar.",
    challengerIds: challengers.map((item) => item.prognostico.id),
  };
}

function buildScoreExplanation(
  prognostico: Prognostico,
  score: number,
  components: CriticalShortlistScoreComponents,
  flags: CriticalShortlistRiskFlag[],
): string {
  if (flags.some((flag) => flag.severity === "hard_block")) {
    return `Score ${score}: bloqueado por ${flags.filter((flag) => flag.severity === "hard_block").map((flag) => flag.message).join(" ")}`;
  }
  const positives: string[] = [];
  if (components.value_score >= 70) positives.push("valor relativo forte");
  if (components.probability_margin_score >= 70) positives.push("boa margem contra a probabilidade implicita");
  if (components.data_readiness_score >= 65) positives.push("dados tecnicos uteis");
  if (components.market_risk_score >= 70) positives.push("mercado estruturalmente mais estavel");
  const limits = flags.filter((flag) => flag.severity === "medium" || flag.severity === "high").slice(0, 2).map((flag) => flag.message);
  return `Score ${score}: ${positives.length ? positives.join(", ") : "valor minimo presente, mas com sinais limitados"}. ${limits.length ? `Limitacoes: ${limits.join(" ")}` : `Origem registrada como metadado: ${prognostico.origem_modelo || "nao informada"}.`}`;
}

function detectMarketCriticalSignals(prognostico: Prognostico, text: string): { score: number; missingFields: string[] } {
  const missing: string[] = [];
  let hits = 0;
  const sport = normalized(prognostico.esporte);
  const market = normalized(`${prognostico.mercado} ${prognostico.pick}`);
  const require = (ok: boolean, field: string) => {
    if (ok) hits += 1;
    else missing.push(field);
  };
  require(Boolean(prognostico.mercado), "mercado");
  require(Boolean(prognostico.pick), "pick");
  require(!marketUsuallyNeedsLine(prognostico) || Boolean(prognostico.linha), "linha");
  require(isPositiveFinite(prognostico.odd_ofertada), "odd");
  require(isFiniteNumber(prognostico.probabilidade_final) && isFiniteNumber(prognostico.edge), "probabilidade/edge");
  require(textHasUsefulContent(text), "contexto tecnico");

  if (/baseball|mlb/.test(sport)) {
    if (/total|corridas|run|over|under/.test(market)) require(/starter|pitcher|arremessador|probable/i.test(text), "starters");
    if (/bullpen|lineup|park|clima|weather/i.test(text)) hits += 1;
  } else if (isBasketballSport(prognostico)) {
    require(/time|team|casa|fora|home|away|mandante|visitante|matchup/i.test(text), "times/mando");
    if (/moneyline|vencedor|resultado/.test(market)) {
      require(/forma|ultimos|last|record|net rating|rating|matchup|casa|fora|home|away/i.test(text), "forma/matchup WNBA");
    }
    if (/spread|handicap/.test(market)) {
      require(/spread|margem|net rating|ats|forma|ultimos|last|casa|fora|home|away|descanso|rest|back.?to.?back|b2b/i.test(text), "margem/rest WNBA");
    }
    if (/total|over|under|pontos/.test(market)) {
      require(/pace|ritmo|posse|possessions|offensive rating|defensive rating|ortg|drtg|efg|turnover|rebote|rebound/i.test(text), "pace/eficiencia WNBA");
    }
    if (/player prop|props|jogador|pontos jogador|rebotes|assistencias|pra\b/.test(market)) {
      require(/minutos|minutes|usage|uso|starter|titular|lineup|rotation|rotacao|role|papel|rebote|assist|pontos/i.test(text), "minutos/uso do jogador");
    }
    if (/lesao|injury|injuries|questionable|out|lineup|rotation|rotacao|minutos|minutes|descanso|rest|back.?to.?back|b2b/i.test(text)) hits += 1;
  } else if (/futebol|soccer/.test(sport) || /escanteio|corner/.test(market)) {
    if (/forma|ultimos|last|recent|classifica|mando|casa|fora|home|away/i.test(text)) hits += 1;
    if (/escalacao|noticia|desfalque|lineup|neutral|campo neutro/i.test(text)) hits += 1;
    if (/escanteio|corner/.test(market)) {
      require(/media|average|over|corrida|race|pro|contra|for|against/i.test(text), "metricas de escanteios");
    }
  }
  return { score: round(clamp((hits / Math.max(hits + missing.length, 1)) * 100, 0, 100), 1), missingFields: missing };
}

function countStructuredSignals(prognostico: Prognostico, text: string): number {
  const checks = [
    isPositiveFinite(prognostico.odd_ofertada) || /odd|odds/i.test(text),
    isPositiveFinite(prognostico.odd_valor) || /odd\s*(justa|valor|fair)/i.test(text),
    isFiniteNumber(prognostico.probabilidade_final) || /prob|chance/i.test(text),
    isFiniteNumber(prognostico.edge) || /edge|ev|valor esperado/i.test(text),
    Boolean(prognostico.mercado),
    Boolean(prognostico.pick),
    Boolean(prognostico.linha) || !marketUsuallyNeedsLine(prognostico),
    Boolean(prognostico.data || prognostico.hora),
    /media|average|record|last|ultimos|h2h|forma|starter|lineup|bullpen|escanteio|corner|pace|ritmo|posse|possessions|net rating|ortg|drtg|usage|minutes|minutos|rotation|rotacao|injury|lesao|rest|descanso|b2b/i.test(text),
    /modelo|model|payload|json|origem|source|amostra|sample|historico/i.test(text),
  ];
  return checks.filter(Boolean).length;
}

function calculateContextPresenceScore(prognostico: Prognostico, text: string): number {
  let score = 0;
  if (prognostico.dados_tecnicos?.trim()) score += 30;
  if (prognostico.contexto_modelo?.trim()) score += 30;
  if (looksStructured(text)) score += 20;
  if (prognostico.observacoes?.trim()) score += 10;
  if (textHasUsefulContent(text)) score += 10;
  return clamp(score, 0, 100);
}

function parseEventDate(prognostico: Prognostico): Date | null {
  if (!prognostico.data) return null;
  const time = prognostico.hora?.match(/\d{1,2}:\d{2}/)?.[0] ?? "23:59";
  const parsed = new Date(`${prognostico.data}T${time}:00-03:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function combinedContext(prognostico: Prognostico): string {
  return [prognostico.dados_tecnicos, prognostico.contexto_modelo, prognostico.observacoes]
    .filter(Boolean)
    .join("\n");
}

function textHasUsefulContent(text: string): boolean {
  if (!text.trim()) return false;
  const signalMatches = text.match(/odd|prob|edge|ev|linha|pick|media|ultimos|h2h|starter|lineup|forma|record|over|under|handicap|escanteio|corner|json|modelo|pace|ritmo|posse|net rating|ortg|drtg|usage|minutes|minutos|rotation|rotacao|injury|lesao|rest|descanso|b2b/gi);
  return (signalMatches?.length ?? 0) >= 3 || looksStructured(text);
}

function looksStructured(text: string): boolean {
  return /[{[]["\w]/.test(text) || /\b\w+[_\w]*\s*[:=]\s*[-+\w\d.%]+/.test(text);
}

function isVolatileMarket(prognostico: Prognostico): boolean {
  const market = normalized(`${prognostico.mercado} ${prognostico.pick}`);
  return /escanteio|corner|race|primeiro|first|cartao|cards|player prop|props|jogador|rebotes|assistencias|pra\b/.test(market);
}

function isAlternativeLine(prognostico: Prognostico): boolean {
  const text = normalized(`${prognostico.mercado} ${prognostico.pick} ${prognostico.linha ?? ""} ${combinedContext(prognostico)}`);
  return /alternativa|alternate|alt line|linha distante/.test(text);
}

function marketUsuallyNeedsLine(prognostico: Prognostico): boolean {
  return /total|over|under|handicap|spread|escanteio|corner|cartao|cards/i.test(`${prognostico.mercado} ${prognostico.pick}`);
}

function isMlbTotals(prognostico: Prognostico): boolean {
  return /baseball|mlb/i.test(`${prognostico.esporte} ${prognostico.liga}`) &&
    /total|corridas|runs|over|under/i.test(`${prognostico.mercado} ${prognostico.pick}`);
}

function isBasketballSport(prognostico: Prognostico): boolean {
  return /basket|basquete|nba|wnba/i.test(`${prognostico.esporte} ${prognostico.liga}`);
}

function isWnbaBasketball(prognostico: Prognostico): boolean {
  return /wnba/i.test(`${prognostico.esporte} ${prognostico.liga} ${combinedContext(prognostico)}`);
}

function isBasketballTotalMarket(prognostico: Prognostico): boolean {
  return /total|over|under|pontos/i.test(`${prognostico.mercado} ${prognostico.pick}`);
}

function isBasketballSpreadMarket(prognostico: Prognostico): boolean {
  return /spread|handicap|margem/i.test(`${prognostico.mercado} ${prognostico.pick}`);
}

function isBasketballMoneylineMarket(prognostico: Prognostico): boolean {
  return /moneyline|vencedor|resultado|1x2/i.test(`${prognostico.mercado} ${prognostico.pick}`);
}

function isBasketballPlayerPropMarket(prognostico: Prognostico): boolean {
  return /player prop|props|jogador|pontos jogador|rebotes|assistencias|pra\b/i.test(`${prognostico.mercado} ${prognostico.pick}`);
}

function hasBasketballPaceEfficiencyContext(text: string): boolean {
  return /pace|ritmo|posse|possessions|offensive rating|defensive rating|ortg|drtg|efg|turnover|rebote|rebound/i.test(text);
}

function hasBasketballSpreadContext(text: string): boolean {
  return /spread|margem|net rating|ats|matchup|forma|ultimos|last|casa|fora|home|away|descanso|rest|back.?to.?back|b2b/i.test(text);
}

function hasBasketballMoneylineContext(text: string): boolean {
  return /forma|ultimos|last|record|net rating|rating|matchup|casa|fora|home|away|lesao|injury|lineup|rotation|rotacao|descanso|rest/i.test(text);
}

function hasBasketballPlayerPropContext(text: string): boolean {
  return /minutos|minutes|usage|uso|starter|titular|lineup|rotation|rotacao|role|papel|rebote|assist|pontos/i.test(text);
}

function hasBasketballAvailabilityContext(text: string): boolean {
  return /lesao|injury|injuries|questionable|out|lineup|rotation|rotacao|minutos|minutes|descanso|rest|back.?to.?back|b2b/i.test(text);
}

function pushIf(
  flags: CriticalShortlistRiskFlag[],
  condition: boolean,
  code: string,
  severity: CriticalRiskSeverity,
  message: string,
): void {
  if (condition) flags.push({ code, severity, message });
}

function dedupeFlags(flags: CriticalShortlistRiskFlag[]): CriticalShortlistRiskFlag[] {
  const seen = new Map<string, CriticalShortlistRiskFlag>();
  for (const flag of flags) {
    const current = seen.get(flag.code);
    if (!current || PENALTY_BY_SEVERITY[flag.severity] > PENALTY_BY_SEVERITY[current.severity]) {
      seen.set(flag.code, flag);
    }
  }
  return Array.from(seen.values());
}

function normalizePositive(value: number | null | undefined, cap: number): number {
  if (!isFiniteNumber(value) || value <= 0) return 0;
  return round(clamp((value / cap) * 100, 0, 100), 1);
}

function normalized(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isPositiveFinite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
