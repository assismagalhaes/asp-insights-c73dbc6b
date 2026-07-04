/**
 * ASP Validator - Roteador de simulacao por mercado de futebol.
 *
 * Para corners e mercados ja suportados pela Poisson (over/under gols, BTTS,
 * 1X2, Dupla Chance), delega para `runAspValidatorSimulation`. Para cartoes,
 * roda o simulador simplificado `football_cards_total_simplified` definido
 * abaixo.
 *
 * O resultado segue o mesmo shape de `AspValidatorSimulationResult` (com
 * acrescimo opcional de `proxy_used` em notes/warnings quando aplicavel).
 */

import {
  runAspValidatorSimulation,
  type AspValidatorSimulationInput,
  type AspValidatorSimulationResult,
} from "./asp-validator-simulation";

export type RoutedSimulationResult = AspValidatorSimulationResult & {
  market_type?: string;
  period?: string;
  model_name?: string;
  proxy_used?: string | null;
};

type DynamicRecord = Record<string, unknown>;

function norm(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function readNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const p = Number(v.replace("%", "").replace(",", "."));
    return Number.isFinite(p) ? p : null;
  }
  return null;
}

function parseLine(value: string | number | null): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const m = String(value ?? "")
    .replace(",", ".")
    .match(/[+-]?\d+(?:\.\d+)?/);
  if (!m) return null;
  const v = Number(m[0]);
  return Number.isFinite(v) ? v : null;
}

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

function round(v: number, d = 4): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

function asRecord(value: unknown): DynamicRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as DynamicRecord)
    : {};
}

function stringOrNumberValue(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function stringValue(value: unknown): string {
  const scalar = stringOrNumberValue(value);
  return scalar === null ? "" : String(scalar);
}

export function routeSimulation(input: AspValidatorSimulationInput): RoutedSimulationResult {
  const structured = asRecord(input.structured_json);
  const declared = String(structured.market_type ?? "").toLowerCase();
  const period = String(structured.period ?? "FT").toUpperCase();
  const blob = norm(`${input.market ?? ""} ${input.pick ?? ""} ${declared}`);

  // Cartoes - simulador dedicado
  if (declared === "cards" || /cart[oa]o|cartoes|cards?/.test(blob)) {
    const sim = simulateCards(input, period);
    return { ...sim, market_type: "cards", period, model_name: "football_cards_total_simplified" };
  }

  // Primeiro a marcar - simulador dedicado
  if (
    declared === "first_goal" ||
    /marcar\s+primeiro|marca\s+primeiro|primeiro\s+(a|para)\s+marcar|first\s+goal|first\s+to\s+score|abrir\s+o\s+placar/.test(
      blob,
    )
  ) {
    const sim = simulateFirstGoal(input, period);
    return {
      ...sim,
      market_type: "first_goal",
      period,
      model_name: "football_first_goal_simplified",
    };
  }

  // Mercados delegados ao Poisson / corner simulator existente
  const base = runAspValidatorSimulation(input);
  let proxy_used: string | null = null;
  if (declared === "goals_total" && period === "HT") {
    // Se nao havia goals.period === HT mas extraimos FT, marcamos como proxy
    const goals = asRecord(structured.goals);
    if (goals.period && goals.period !== "HT") {
      proxy_used = "FT_as_HT";
      base.notes = [
        ...base.notes,
        "Atencao: dados de gols disponiveis sao do tempo regulamentar (FT). Usados como proxy para HT — confianca reduzida.",
      ];
      base.warnings = [...base.warnings, "Proxy FT->HT aplicado por ausencia de dados HT."];
    }
  }
  const model_name =
    declared === "goals_total"
      ? "football_goals_total_simplified"
      : declared === "btts"
        ? "football_btts_simplified"
        : declared === "x1x2"
          ? "football_1x2_simplified"
          : declared === "double_chance"
            ? "football_double_chance_simplified"
            : declared === "corners"
              ? base.model
              : base.model;
  return { ...base, market_type: declared || undefined, period, model_name, proxy_used };
}

// ============================================================================
// Simulador de cartoes - football_cards_total_simplified
// ============================================================================

function simulateCards(
  input: AspValidatorSimulationInput,
  period: string,
): AspValidatorSimulationResult {
  const structured = asRecord(input.structured_json);
  const cards = asRecord(structured.cards);
  const general = asRecord(cards.general ?? cards);
  const home = asRecord(general.home);
  const away = asRecord(general.away);
  const market = asRecord(structured.market ?? structured.prediction);
  const prediction = asRecord(structured.prediction);

  const line = parseLine(input.line ?? stringOrNumberValue(market.line));
  const pickText = norm(stringValue(input.pick ?? market.pick));
  const wantsUnder = /under|menos/.test(pickText);
  const sourceProb = readPct(market.probability_original ?? prediction.source_probability);
  const offeredOdd = input.offered_odd ?? readNumber(market.offered_odd ?? prediction.offered_odd);
  const marketProb = offeredOdd && offeredOdd > 1 ? 1 / offeredOdd : null;

  // Composicao tecnica: expectativa total = media(home_for + away_against) + media(away_for + home_against)
  const homeFor = readNumber(home.avg_cards_for) ?? readNumber(home.avg_total_cards);
  const awayAgainst = readNumber(away.avg_cards_against) ?? readNumber(away.avg_total_cards);
  const awayFor = readNumber(away.avg_cards_for) ?? readNumber(away.avg_total_cards);
  const homeAgainst = readNumber(home.avg_cards_against) ?? readNumber(home.avg_total_cards);
  const expHome = homeFor !== null && awayAgainst !== null ? (homeFor + awayAgainst) / 2 : null;
  const expAway = awayFor !== null && homeAgainst !== null ? (awayFor + homeAgainst) / 2 : null;
  const expectedTotal = expHome !== null && expAway !== null ? expHome + expAway : null;

  const avgSupport =
    expectedTotal !== null && line !== null
      ? wantsUnder
        ? clamp(0.5 - (expectedTotal - line) * 0.1, 0.3, 0.78)
        : clamp(0.5 + (expectedTotal - line) * 0.1, 0.3, 0.78)
      : null;

  const freqOver = line !== null ? readLine(home.over_lines, line, away.over_lines) : null;
  const freqUnder = line !== null ? readLine(home.under_lines, line, away.under_lines) : null;
  const freqProb = wantsUnder ? toDecimal(freqUnder) : toDecimal(freqOver);

  const components = [
    sourceProb !== null ? { v: sourceProb, w: 0.3 } : null,
    marketProb !== null ? { v: marketProb, w: 0.15 } : null,
    avgSupport !== null ? { v: avgSupport, w: 0.3 } : null,
    freqProb !== null ? { v: freqProb, w: 0.25 } : null,
  ].filter((x): x is { v: number; w: number } => Boolean(x));

  if (!components.length || line === null) {
    return {
      model: "corner_total_over_simplified",
      status: "low_confidence",
      lambda_home: null,
      lambda_away: null,
      market_probability: null,
      fair_odd: null,
      ev: null,
      most_likely_scores: [],
      goal_distribution: {},
      notes: ["Simulacao de cartoes nao realizada por falta de dados quantitativos."],
      warnings: ["Dados de cartoes insuficientes."],
    };
  }

  const wsum = components.reduce((s, c) => s + c.w, 0);
  const prob = clamp(components.reduce((s, c) => s + c.v * c.w, 0) / wsum, 0.05, 0.9);
  const fair = prob > 0 ? round(1 / prob, 2) : null;
  const ev = offeredOdd && offeredOdd > 1 ? round(offeredOdd * prob - 1, 4) : null;

  return {
    model: "corner_total_over_simplified", // mantemos enum existente; model_name no wrapper informa football_cards_total_simplified
    status: components.length >= 3 ? "completed" : "low_confidence",
    lambda_home: null,
    lambda_away: null,
    market_probability: round(prob, 4),
    fair_odd: fair,
    ev,
    most_likely_scores: [],
    goal_distribution: {},
    notes: [
      `Modelo football_cards_total_simplified - ${wantsUnder ? "Under" : "Over"} ${line} cartoes (${period}).`,
      `Expectativa mandante = media(${fmt(homeFor)} aplicados, ${fmt(awayAgainst)} sofridos visitante) = ${fmt(expHome)}.`,
      `Expectativa visitante = media(${fmt(awayFor)} aplicados visitante, ${fmt(homeAgainst)} sofridos mandante) = ${fmt(expAway)}.`,
      `Total esperado ~ ${fmt(expectedTotal)} (NUNCA somar medias totais diretamente).`,
      `Frequencia ${wantsUnder ? "Under" : "Over"} ${line}: ${fmtPct(freqProb)}; prob. original ${fmtPct(sourceProb)}; odd implicita ${fmtPct(marketProb)}.`,
    ],
    warnings:
      components.length < 3 ? ["Simulacao de cartoes com pouca evidencia estruturada."] : [],
  };
}

function readPct(v: unknown): number | null {
  const n = readNumber(v);
  if (n === null) return null;
  return n > 0 && n <= 1 ? n : clamp(n / 100, 0, 1);
}

function toDecimal(v: number | null): number | null {
  if (v === null) return null;
  return v > 0 && v <= 1 ? clamp(v, 0, 1) : clamp(v / 100, 0, 1);
}

function readLine(a: unknown, line: number, b?: unknown): number | null {
  const keys = [
    String(line),
    `+${line}`,
    String(Math.trunc(line)),
    `+${Math.trunc(line)}`,
    `${Math.trunc(line)}.5`,
  ];
  for (const map of [a, b]) {
    if (!map || typeof map !== "object") continue;
    const record = asRecord(map);
    for (const k of keys) {
      const v = readNumber(record[k]);
      if (v !== null) return v;
    }
  }
  return null;
}

function fmt(v: number | null): string {
  return v === null ? "indisponivel" : String(Math.round(v * 100) / 100);
}

function fmtPct(v: number | null): string {
  return v === null ? "indisponivel" : `${Math.round(v * 10000) / 100}%`;
}

// ============================================================================
// Simulador de "primeiro a marcar" - football_first_goal_simplified
// ============================================================================

function simulateFirstGoal(
  input: AspValidatorSimulationInput,
  period: string,
): AspValidatorSimulationResult {
  const structured = asRecord(input.structured_json);
  const market = asRecord(structured.market ?? structured.prediction);
  const prediction = asRecord(structured.prediction);
  const goals = asRecord(structured.goals);
  const general = asRecord(goals.general);
  const homeAway = asRecord(goals.home_away);
  const ghGeneral = asRecord(general.home);
  const gaGeneral = asRecord(general.away);
  const ghHA = asRecord(homeAway.home);
  const gaHA = asRecord(homeAway.away);

  // Determinar lado escolhido
  const pickText = norm(`${input.pick ?? market.pick ?? ""} ${input.market ?? ""}`);
  const homeName = norm(input.home_team ?? "");
  const awayName = norm(input.away_team ?? "");
  let side: "home" | "away" | null = null;
  if (/visitante|away|\bfora\b/.test(pickText) || (awayName && pickText.includes(awayName)))
    side = "away";
  else if (/mandante|home|\bcasa\b/.test(pickText) || (homeName && pickText.includes(homeName)))
    side = "home";

  const offeredOdd = input.offered_odd ?? readNumber(market.offered_odd ?? prediction.offered_odd);
  const sourceProb = readPct(market.probability_original ?? prediction.source_probability);
  const marketProb = offeredOdd && offeredOdd > 1 ? 1 / offeredOdd : null;

  if (!side) {
    return {
      model: "poisson_score_matrix",
      status: "low_confidence",
      lambda_home: null,
      lambda_away: null,
      market_probability: null,
      fair_odd: null,
      ev: null,
      most_likely_scores: [],
      goal_distribution: {},
      notes: [
        "Simulacao 'primeiro a marcar' nao realizada: lado (mandante/visitante) nao identificado.",
      ],
      warnings: ["Selecao de lado ausente para mercado first_goal."],
    };
  }

  // Componente 1: frequencia direta (prioriza recorte casa/fora; fallback geral)
  const sideGeneral = side === "home" ? ghGeneral : gaGeneral;
  const sideHA = side === "home" ? ghHA : gaHA;
  const oppGeneral = side === "home" ? gaGeneral : ghGeneral;
  const oppHA = side === "home" ? gaHA : ghHA;

  const fgRateHA = readPct(sideHA.first_goal_pct);
  const fgRateGeneral = readPct(sideGeneral.first_goal_pct);
  const directRate = fgRateHA ?? fgRateGeneral;
  // Penalizacao se adversario tambem marca primeiro com frequencia
  const oppFgRate = readPct(oppHA.first_goal_pct) ?? readPct(oppGeneral.first_goal_pct);

  // Componente 2: pressao ofensiva = avg_for(selecionado) - avg_against(adversario)
  const sideAvgFor = readNumber(sideHA.avg_for) ?? readNumber(sideGeneral.avg_for);
  const oppAvgAgainst = readNumber(oppHA.avg_against) ?? readNumber(oppGeneral.avg_against);
  let goalPressure: number | null = null;
  if (sideAvgFor !== null && oppAvgAgainst !== null) {
    // mapeia (avg_for + opp_avg_against) / 2 em [0.5..3.5] para [0.3..0.85]
    const lambda = (sideAvgFor + oppAvgAgainst) / 2;
    goalPressure = clamp(0.3 + (lambda - 0.5) * 0.18, 0.3, 0.85);
  }

  // Componente 3: iniciativa/eficiencia
  const perf = asRecord(structured.general_performance_home_away ?? structured.general_performance);
  const sidePerf = asRecord(perf[side]);
  const oppPerf = asRecord(perf[side === "home" ? "away" : "home"]);
  const sideEff = readPct(sidePerf.efficiency_pct);
  const sidePoss = readPct(sidePerf.avg_possession_pct);
  let initiative: number | null = null;
  if (sideEff !== null || sidePoss !== null) {
    initiative = clamp(((sideEff ?? 0.5) + (sidePoss ?? 0.5)) / 2, 0.25, 0.85);
  }

  // Combinacao ponderada
  const components: Array<{ v: number; w: number; label: string }> = [];
  if (directRate !== null) components.push({ v: directRate, w: 0.45, label: "first_goal_pct" });
  if (goalPressure !== null)
    components.push({ v: goalPressure, w: 0.25, label: "pressao ofensiva" });
  if (initiative !== null) components.push({ v: initiative, w: 0.15, label: "iniciativa" });
  if (sourceProb !== null) components.push({ v: sourceProb, w: 0.1, label: "prob. fonte" });
  if (marketProb !== null) components.push({ v: marketProb, w: 0.05, label: "odd implicita" });

  if (!components.length) {
    return {
      model: "poisson_score_matrix",
      status: "low_confidence",
      lambda_home: null,
      lambda_away: null,
      market_probability: null,
      fair_odd: null,
      ev: null,
      most_likely_scores: [],
      goal_distribution: {},
      notes: ["Simulacao first_goal nao realizada: sem first_goal_pct nem dados ofensivos."],
      warnings: ["Dados insuficientes para mercado 'primeiro a marcar'."],
    };
  }

  const wsum = components.reduce((s, c) => s + c.w, 0);
  let prob = components.reduce((s, c) => s + c.v * c.w, 0) / wsum;

  // Penalizacao: se adversario tambem tem first_goal_pct alto (>= selecionado), reduz
  const warnings: string[] = [];
  if (directRate !== null && oppFgRate !== null && oppFgRate >= directRate) {
    prob *= 0.9;
    warnings.push(
      `Adversario tem first_goal_pct igual ou superior (${fmtPct(oppFgRate)} vs ${fmtPct(directRate)}); probabilidade penalizada em 10%.`,
    );
  }
  // Guardrail odd baixa
  if (offeredOdd !== null && offeredOdd < 1.3 && prob < 0.85) {
    warnings.push(
      `Odd baixa (${offeredOdd}) exige probabilidade ajustada >= 85%. Atual: ${fmtPct(prob)}.`,
    );
  }
  prob = clamp(prob, 0.05, 0.95);

  const fair = prob > 0 ? round(1 / prob, 2) : null;
  const ev = offeredOdd && offeredOdd > 1 ? round(offeredOdd * prob - 1, 4) : null;

  const status = components.length >= 3 && directRate !== null ? "completed" : "low_confidence";

  return {
    model: "poisson_score_matrix",
    status,
    lambda_home: null,
    lambda_away: null,
    market_probability: round(prob, 4),
    fair_odd: fair,
    ev,
    most_likely_scores: [],
    goal_distribution: {},
    notes: [
      `Modelo football_first_goal_simplified - ${side === "home" ? "Mandante" : "Visitante"} marca primeiro (${period}).`,
      `first_goal_pct (recorte ${fgRateHA !== null ? "casa/fora" : "geral"}): ${fmtPct(directRate)}; adversario: ${fmtPct(oppFgRate)}.`,
      `Pressao ofensiva ~ ${fmt(sideAvgFor)} marcados x ${fmt(oppAvgAgainst)} sofridos do adversario => score ${fmtPct(goalPressure)}.`,
      `Iniciativa (eficiencia/posse): ${fmtPct(initiative)}.`,
      `Componentes usados: ${components.map((c) => c.label).join(", ")}.`,
    ],
    warnings,
  };
}
