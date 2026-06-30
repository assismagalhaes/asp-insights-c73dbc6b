import type {
  MlbBaseballReferenceMatchupContext,
  MlbContextAlignment,
  MlbPreparedCriticalValidationPayload,
  MlbValidationPreparation,
  MlbValidationReadinessStatus,
} from "@/types/mlbCriticalValidation";
import type { MlbUnifiedOpportunity } from "@/types/mlbProjections";

export function isMlbOpportunityEligibleForCriticalValidation(opportunity: MlbUnifiedOpportunity) {
  return (
    ["ANALISAR", "MONITORAR"].includes(opportunity.priority_status) &&
    (opportunity.ev ?? 0) > 0 &&
    Number.isFinite(opportunity.opportunity_score) &&
    opportunity.projection_status === "ok" &&
    Boolean(opportunity.game_id)
  );
}

export function calculateMlbContextAlignment(
  opportunity: MlbUnifiedOpportunity,
  parsedContext: MlbBaseballReferenceMatchupContext,
): MlbContextAlignment {
  const supporting: string[] = [];
  const conflicting: string[] = [];
  const neutral: string[] = [];
  const notes: string[] = [];
  const flags: string[] = [];
  const selectedIsHome = opportunity.selection_team === opportunity.home_team || opportunity.side === "home";
  const selectedTeam = selectedIsHome ? parsedContext.teams.home : parsedContext.teams.away;
  const opponentTeam = selectedIsHome ? parsedContext.teams.away : parsedContext.teams.home;
  const selectedStarter = selectedIsHome ? parsedContext.starting_pitchers.home : parsedContext.starting_pitchers.away;
  const opponentStarter = selectedIsHome ? parsedContext.starting_pitchers.away : parsedContext.starting_pitchers.home;

  if (!parsedContext.teams.home.team_name || !parsedContext.teams.away.team_name) {
    flags.push("insufficient_baseball_reference_context");
    return {
      alignment_status: "insufficient_context",
      alignment_score: 20,
      supporting_factors: [],
      conflicting_factors: ["Texto Baseball-Reference nao identificou os dois times."],
      neutral_factors: [],
      market_specific_notes: [],
      critical_flags: flags,
    };
  }

  if (selectedTeam.record?.win_pct != null && opponentTeam.record?.win_pct != null) {
    if (selectedTeam.record.win_pct > opponentTeam.record.win_pct) supporting.push("Time selecionado tem recorde geral superior.");
    else conflicting.push("Time selecionado nao tem vantagem de recorde geral.");
  }
  if (selectedTeam.last10?.win_pct != null && opponentTeam.last10?.win_pct != null) {
    if (selectedTeam.last10.win_pct >= opponentTeam.last10.win_pct) supporting.push("Forma recente last10 sustenta a oportunidade.");
    else {
      conflicting.push("Forma recente last10 favorece o adversario.");
      flags.push("recent_form_conflict");
    }
  }
  if (opponentStarter.starter_quality_score != null && selectedStarter.starter_quality_score != null) {
    const starterGap = selectedStarter.starter_quality_score - opponentStarter.starter_quality_score;
    if (starterGap >= 8) supporting.push("Starter matchup favorece o lado selecionado.");
    else if (starterGap <= -8) {
      conflicting.push("Starter matchup favorece o adversario e reduz confianca.");
      flags.push("starter_matchup_conflict");
    } else neutral.push("Starter matchup parece equilibrado pelo score simples.");
  } else {
    flags.push("starter_data_missing");
    neutral.push("Dados de starter incompletos.");
  }
  if (selectedStarter.innings_pitched_decimal != null && selectedStarter.innings_pitched_decimal < 40) flags.push("small_sample_pitcher");
  if (opponentStarter.innings_pitched_decimal != null && opponentStarter.innings_pitched_decimal < 40) flags.push("small_sample_pitcher");
  if ((opportunity.probability_edge ?? 0) < 0.03) flags.push("market_edge_too_small");
  if (opportunity.correlation_status === "correlated_alternative") flags.push("correlated_opportunity");
  if (!opportunity.is_main_line) flags.push("alternative_line_risk");

  if (opportunity.market_family === "moneyline") {
    notes.push("Moneyline: revisar se a vantagem geral sobrevive ao matchup de starters.");
  }
  if (opportunity.market_family === "totals") {
    notes.push("Totals: confrontar total projetado com ERA, HR/9 e forma recente dos starters.");
    const lowHrRisk = [selectedStarter.hr_per_9, opponentStarter.hr_per_9].every((value) => value != null && value < 0.8);
    if (/Over/i.test(opportunity.side ?? "") && lowHrRisk) {
      conflicting.push("Ambos starters mostram baixo HR/9 no contexto extraido.");
      flags.push("total_projection_conflict");
    }
  }
  if (opportunity.market_family === "handicap") {
    notes.push("Handicap: avaliar se a margem projetada sustenta a linha escolhida.");
    if ((opportunity.line ?? 0) < 0 && selectedTeam.one_run_record) {
      neutral.push("Revisar risco de jogo de 1 corrida antes de validar handicap negativo.");
      flags.push("one_run_game_risk");
    }
    flags.push("runline_margin_risk");
  }

  const alignmentScore = clamp(55 + supporting.length * 9 - conflicting.length * 12 - flags.length * 3, 0, 100);
  const status = getAlignmentStatus(alignmentScore, supporting.length, conflicting.length);
  return {
    alignment_status: status,
    alignment_score: alignmentScore,
    supporting_factors: supporting,
    conflicting_factors: conflicting,
    neutral_factors: neutral,
    market_specific_notes: notes,
    critical_flags: [...new Set(flags)],
  };
}

export function calculateMlbValidationReadinessScore(
  opportunity: MlbUnifiedOpportunity,
  parsedContext: MlbBaseballReferenceMatchupContext,
  alignment: MlbContextAlignment,
): MlbValidationPreparation {
  const contextCompleteness = parsedContext.data_quality.confidence;
  const opportunityQuality = clamp((opportunity.opportunity_score + opportunity.confidence_score) / 2, 0, 100);
  const alignmentScore = alignment.alignment_score;
  const conflictScore = Math.max(0, 100 - alignment.conflicting_factors.length * 22);
  const starterAvailability = parsedContext.starting_pitchers.home.name && parsedContext.starting_pitchers.away.name ? 100 : 35;
  let score = Math.round(
    contextCompleteness * 0.35 +
    opportunityQuality * 0.25 +
    alignmentScore * 0.20 +
    conflictScore * 0.10 +
    starterAvailability * 0.10,
  );
  if (!parsedContext.teams.home.team_name || !parsedContext.teams.away.team_name) score = Math.min(score, 39);
  if (!parsedContext.starting_pitchers.home.name || !parsedContext.starting_pitchers.away.name) score = Math.min(score, 79);
  const readinessStatus = getReadinessStatus(score);
  return {
    validation_readiness_score: score,
    readiness_status: readinessStatus,
    critical_questions: buildCriticalQuestions(opportunity),
    recommended_next_step: readinessStatus === "pronto_para_validator"
      ? "Pacote pronto para copiar e revisar no Validator em etapa futura."
      : "Revisar contexto colado e completar dados antes de enviar ao Validator em etapa futura.",
  };
}

export function buildMlbCriticalValidationPayload(
  opportunity: MlbUnifiedOpportunity,
  parsedContext: MlbBaseballReferenceMatchupContext,
  alignment = calculateMlbContextAlignment(opportunity, parsedContext),
): MlbPreparedCriticalValidationPayload {
  const validation = calculateMlbValidationReadinessScore(opportunity, parsedContext, alignment);
  return {
    source: "ASP Screener MLB",
    stage: "Critical Validation Preparation",
    sport: "Baseball",
    league: "MLB",
    created_at: new Date().toISOString(),
    game: {
      game_id: opportunity.game_id,
      date: opportunity.date,
      time: opportunity.time,
      home_team: opportunity.home_team,
      away_team: opportunity.away_team,
      matchup: opportunity.matchup,
    },
    opportunity: {
      market: opportunity.market_label,
      pick: opportunity.pick_label,
      line: opportunity.line,
      odd: opportunity.offered_odd,
      model_probability: opportunity.model_prob,
      market_probability_no_vig: opportunity.market_prob_no_vig,
      probability_edge: opportunity.probability_edge,
      fair_odd: opportunity.fair_odd,
      ev: opportunity.ev,
      opportunity_score: opportunity.opportunity_score,
      confidence_score: opportunity.confidence_score,
      priority_status: opportunity.priority_status,
      reasons: opportunity.reasons,
      alerts: opportunity.alerts,
      risk_flags: opportunity.risk_flags,
    },
    baseball_reference_context: parsedContext,
    context_alignment: alignment,
    validation_preparation: validation,
    source_projection_payload: opportunity.source_projection_payload,
  };
}

export function buildMlbValidatorPrompt(payload: MlbPreparedCriticalValidationPayload) {
  return [
    "Validacao critica MLB - pacote preparado pelo ASP Screener",
    "",
    `Jogo: ${payload.game.matchup} (${payload.game.date ?? "-"} ${payload.game.time ?? ""})`,
    `Mercado: ${payload.opportunity.market}`,
    `Oportunidade preliminar: ${payload.opportunity.pick ?? "-"} ${payload.opportunity.line ?? ""} @ ${payload.opportunity.odd ?? "-"}`,
    `Prob. ASP: ${formatPercent(payload.opportunity.model_probability)} | Mercado no-vig: ${formatPercent(payload.opportunity.market_probability_no_vig)} | EV: ${formatPercent(payload.opportunity.ev)}`,
    `Opportunity Score: ${payload.opportunity.opportunity_score} | Confianca: ${payload.opportunity.confidence_score}`,
    "",
    "Contexto Baseball-Reference:",
    `Visitante: ${payload.baseball_reference_context.teams.away.team_name ?? "-"} ${payload.baseball_reference_context.teams.away.record?.raw ?? ""}`,
    `Mandante: ${payload.baseball_reference_context.teams.home.team_name ?? "-"} ${payload.baseball_reference_context.teams.home.record?.raw ?? ""}`,
    `Starter visitante: ${formatStarter(payload.baseball_reference_context.starting_pitchers.away)}`,
    `Starter mandante: ${formatStarter(payload.baseball_reference_context.starting_pitchers.home)}`,
    "",
    "Fatores de suporte:",
    ...payload.context_alignment.supporting_factors.map((item) => `- ${item}`),
    "Fatores de conflito:",
    ...payload.context_alignment.conflicting_factors.map((item) => `- ${item}`),
    "Perguntas criticas:",
    ...payload.validation_preparation.critical_questions.map((item) => `- ${item}`),
    "",
    "Instrucao: confronte a projecao original com o contexto detalhado, preserve protecao de banca, evite overconfidence e avalie conflitos antes de qualquer decisao futura. Nesta etapa, nao registrar prognostico automaticamente.",
  ].join("\n");
}

function buildCriticalQuestions(opportunity: MlbUnifiedOpportunity) {
  if (opportunity.market_family === "moneyline") {
    return [
      "O edge do Moneyline permanece valido apos considerar o matchup de starters?",
      "A vantagem geral de time supera a desvantagem ou vantagem no starter?",
      "O split vs mao do pitcher confirma ou enfraquece a projecao?",
    ];
  }
  if (opportunity.market_family === "totals") {
    return [
      "O total projetado pelo screener e compativel com o perfil dos starters?",
      "Ha sinais de HR/9, ERA recente ou forma ofensiva que sustentem o Over/Under?",
      "A linha do mercado esta distante o suficiente da projecao para justificar analise?",
    ];
  }
  return [
    "A margem projetada sustenta a linha escolhida?",
    "O risco de jogo de 1 corrida enfraquece o handicap?",
    "A vantagem contextual e suficiente para um -1.5 ou o +1.5 e mais adequado?",
  ];
}

function getAlignmentStatus(score: number, supports: number, conflicts: number): MlbContextAlignment["alignment_status"] {
  if (supports === 0 && conflicts === 0) return "insufficient_context";
  if (score >= 68 && supports > conflicts) return "supports_screener";
  if (score <= 42 && conflicts > supports) return "conflicts_with_screener";
  return "mixed";
}

function getReadinessStatus(score: number): MlbValidationReadinessStatus {
  if (score >= 80) return "pronto_para_validator";
  if (score >= 60) return "revisar_antes_do_validator";
  if (score >= 40) return "contexto_incompleto";
  return "nao_recomendado_para_validator";
}

function formatStarter(starter: MlbPreparedCriticalValidationPayload["baseball_reference_context"]["starting_pitchers"]["home"]) {
  return `${starter.name ?? "-"} ${starter.throwing_hand ?? ""} ERA ${starter.era ?? "-"} K/9 ${starter.k_per_9 ?? "-"}`;
}

function formatPercent(value: number | null) {
  if (value == null) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
