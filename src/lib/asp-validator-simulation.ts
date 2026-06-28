export type AspValidatorSimulationInput = {
  sport: string | null;
  market: string | null;
  pick: string | null;
  line: string | number | null;
  offered_odd: number | null;
  home_team: string | null;
  away_team: string | null;
  user_context?: string | null;
  structured_json?: Record<string, unknown> | null;
};

export type AspValidatorSimulationResult = {
  model: "poisson_score_matrix" | "corner_race_simplified" | "corner_volume_matrix" | "low_confidence_corner_race";
  status: "completed" | "low_confidence" | "not_applicable" | "failed";
  lambda_home: number | null;
  lambda_away: number | null;
  market_probability: number | null;
  fair_odd: number | null;
  ev: number | null;
  most_likely_scores: Array<{ score: string; probability: number }>;
  goal_distribution: Record<string, number>;
  notes: string[];
  warnings: string[];
};

type LambdaEstimate = {
  lambdaHome: number | null;
  lambdaAway: number | null;
  confidence: "low" | "medium" | "high";
  notes: string[];
  warnings: string[];
};

type ScoreCell = {
  home: number;
  away: number;
  probability: number;
};

const MAX_GOALS = 10;

export function runAspValidatorSimulation(input: AspValidatorSimulationInput): AspValidatorSimulationResult {
  try {
    const marketText = normalize(`${input.market ?? ""} ${input.pick ?? ""}`);
    if (!isFootballLike(input.sport) || !isSupportedMarket(marketText)) {
      return {
        model: "poisson_score_matrix",
        status: "not_applicable",
        lambda_home: null,
        lambda_away: null,
        market_probability: null,
        fair_odd: null,
        ev: null,
        most_likely_scores: [],
        goal_distribution: {},
        notes: ["Simulacao nao aplicada para este mercado nesta versao."],
        warnings: [],
      };
    }

    if (isCornerMarket(marketText)) {
      return runCornerSimulation(input, marketText);
    }

    const line = parseLine(input.line);
    const lambda = estimateLambdas(input);
    if (lambda.lambdaHome === null || lambda.lambdaAway === null) {
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
        notes: [...lambda.notes, "Simulacao de baixa confiabilidade por insuficiencia de dados."],
        warnings: [...lambda.warnings, "Dados insuficientes para estimar lambdas de gols."],
      };
    }

    const matrix = buildScoreMatrix(lambda.lambdaHome, lambda.lambdaAway, MAX_GOALS);
    const probability = calculateMarketProbability(matrix, marketText, input, line);
    if (probability === null) {
      return {
        model: "poisson_score_matrix",
        status: "not_applicable",
        lambda_home: round(lambda.lambdaHome),
        lambda_away: round(lambda.lambdaAway),
        market_probability: null,
        fair_odd: null,
        ev: null,
        most_likely_scores: topScores(matrix),
        goal_distribution: buildGoalDistribution(matrix),
        notes: [...lambda.notes, "Simulacao nao aplicada para este mercado nesta versao."],
        warnings: lambda.warnings,
      };
    }

    const fairOdd = probability > 0 ? round(1 / probability) : null;
    const ev = input.offered_odd && input.offered_odd > 1 ? round(input.offered_odd * probability - 1, 4) : null;
    const status = lambda.confidence === "low" ? "low_confidence" : "completed";

    return {
      model: "poisson_score_matrix",
      status,
      lambda_home: round(lambda.lambdaHome),
      lambda_away: round(lambda.lambdaAway),
      market_probability: round(probability, 4),
      fair_odd: fairOdd,
      ev,
      most_likely_scores: topScores(matrix),
      goal_distribution: buildGoalDistribution(matrix),
      notes: [
        ...lambda.notes,
        "Probabilidade calculada por matriz de placares Poisson.",
        "A simulacao e um sinal tecnico e nao confirma nem pula prognostico sozinha.",
      ],
      warnings: status === "low_confidence" ? [...lambda.warnings, "Simulacao de baixa confiabilidade por insuficiencia de dados."] : lambda.warnings,
    };
  } catch (error) {
    return {
      model: "poisson_score_matrix",
      status: "failed",
      lambda_home: null,
      lambda_away: null,
      market_probability: null,
      fair_odd: null,
      ev: null,
      most_likely_scores: [],
      goal_distribution: {},
      notes: [],
      warnings: [error instanceof Error ? error.message : "Falha inesperada ao executar simulacao."],
    };
  }
}

function isFootballLike(sport: string | null): boolean {
  const text = normalize(sport ?? "");
  return text.includes("futebol") || text.includes("football") || text.includes("soccer");
}

function isSupportedMarket(text: string): boolean {
  return (
    text.includes("over") ||
    text.includes("under") ||
    text.includes("total") ||
    text.includes("gol") ||
    text.includes("btts") ||
    text.includes("ambas") ||
    text.includes("1x2") ||
    text.includes("resultado") ||
    text.includes("moneyline") ||
    text.includes("dupla chance") ||
    text.includes("double chance") ||
    text.includes("handicap") ||
    text.includes("corner") ||
    text.includes("escanteio") ||
    text.includes("canto")
  );
}

function isCornerMarket(text: string): boolean {
  return text.includes("corner") || text.includes("escanteio") || text.includes("canto");
}

function runCornerSimulation(input: AspValidatorSimulationInput, marketText: string): AspValidatorSimulationResult {
  const structured = (input.structured_json ?? {}) as Record<string, any>;
  const market = (structured.market ?? structured.prediction ?? {}) as Record<string, any>;
  const corners = (structured.corners ?? {}) as Record<string, any>;
  const pickText = normalize(input.pick ?? market.pick ?? "");
  const wantsAway = pickText.includes(normalize(input.away_team ?? "")) || pickText.includes("fora") || pickText.includes("visitante") || pickText.includes("away");
  const side = wantsAway ? "away" : "home";
  const sideStats = (corners[side] ?? {}) as Record<string, number | null>;
  const opponentStats = (corners[side === "home" ? "away" : "home"] ?? {}) as Record<string, number | null>;
  const line = parseLine(input.line ?? market.line ?? readCornerRaceLine(input.pick ?? market.pick ?? ""));
  const prediction = (structured.prediction ?? {}) as Record<string, any>;
  const sourceProb = percentToDecimal(readNumber(market.probability_original ?? prediction.source_probability ?? prediction.probability_original));
  const offeredOdd = input.offered_odd ?? readNumber(market.offered_odd ?? structured.prediction?.offered_odd);
  const marketProb = offeredOdd && offeredOdd > 1 ? 1 / offeredOdd : null;
  const raceProb = line ? percentToDecimal(readNumber(sideStats[`race_to_${Math.trunc(line)}_pct`])) : null;
  const avgFor = readNumber(sideStats.avg_for);
  const avgAgainstOpp = readNumber(opponentStats.avg_against);
  const avgTotal = readNumber(sideStats.avg_total ?? opponentStats.avg_total);
  const avgSupport =
    avgFor !== null && avgAgainstOpp !== null && line
      ? clampDecimal((avgFor * 0.6 + avgAgainstOpp * 0.4) / Math.max(line, 1), 0.35, 0.72)
      : avgTotal !== null && line
        ? clampDecimal(avgTotal / Math.max(line * 1.8, 1), 0.35, 0.68)
        : null;
  const components = [
    sourceProb !== null ? { value: sourceProb, weight: 0.35 } : null,
    raceProb !== null ? { value: raceProb, weight: 0.3 } : null,
    avgSupport !== null ? { value: avgSupport, weight: 0.2 } : null,
    marketProb !== null ? { value: marketProb, weight: 0.15 } : null,
  ].filter((item): item is { value: number; weight: number } => Boolean(item));

  if (!components.length) {
    return {
      model: "low_confidence_corner_race",
      status: "low_confidence",
      lambda_home: null,
      lambda_away: null,
      market_probability: null,
      fair_odd: null,
      ev: null,
      most_likely_scores: [],
      goal_distribution: {},
      notes: ["Simulacao simplificada de corners nao realizada por falta de dados quantitativos OCR."],
      warnings: ["Dados OCR de corners insuficientes para estimar probabilidade."],
    };
  }

  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  const rawProbability = components.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight;
  const quality = readNumber(structured.data_quality_score) ?? readNumber(structured.data_quality?.score) ?? 0.5;
  const penalty = quality < 0.7 ? (0.7 - quality) * 0.12 : 0;
  const probability = clampDecimal(rawProbability - penalty, 0.05, 0.85);
  const fairOdd = probability > 0 ? round(1 / probability) : null;
  const ev = offeredOdd && offeredOdd > 1 ? round(offeredOdd * probability - 1, 4) : null;

  return {
    model: line ? "corner_race_simplified" : "corner_volume_matrix",
    status: components.length >= 2 ? "completed" : "low_confidence",
    lambda_home: null,
    lambda_away: null,
    market_probability: round(probability, 4),
    fair_odd: fairOdd,
    ev,
    most_likely_scores: [],
    goal_distribution: {},
    notes: [
      "Simulacao simplificada baseada em dados extraidos das imagens.",
      `Composicao: probabilidade original ${formatProb(sourceProb)}, race ${formatProb(raceProb)}, medias ${formatProb(avgSupport)}, mercado ${formatProb(marketProb)}.`,
      "Penalidade por qualidade OCR limitada para evitar cortes agressivos sem base quantitativa.",
    ],
    warnings: components.length < 2 ? ["Simulacao de baixa confiabilidade por pouca evidencia estruturada."] : [],
  };
}

function estimateLambdas(input: AspValidatorSimulationInput): LambdaEstimate {
  const text = [
    input.user_context ?? "",
    JSON.stringify(input.structured_json ?? {}),
  ].join("\n");
  const normalized = text.replace(/,/g, ".");

  const homeScored = firstNumber(normalized, [
    /m[eé]dia\s+marcados\s+casa[^0-9]*(\d+(?:\.\d+)?)/i,
    /home[^0-9]{0,30}(?:scored|for|marcados)[^0-9]*(\d+(?:\.\d+)?)/i,
  ]);
  const homeAllowed = firstNumber(normalized, [
    /m[eé]dia\s+sofridos\s+casa[^0-9]*(\d+(?:\.\d+)?)/i,
    /home[^0-9]{0,30}(?:allowed|against|sofridos)[^0-9]*(\d+(?:\.\d+)?)/i,
  ]);
  const awayScored = firstNumber(normalized, [
    /m[eé]dia\s+marcados\s+visitante[^0-9]*(\d+(?:\.\d+)?)/i,
    /away[^0-9]{0,30}(?:scored|for|marcados)[^0-9]*(\d+(?:\.\d+)?)/i,
  ]);
  const awayAllowed = firstNumber(normalized, [
    /m[eé]dia\s+sofridos\s+visitante[^0-9]*(\d+(?:\.\d+)?)/i,
    /away[^0-9]{0,30}(?:allowed|against|sofridos)[^0-9]*(\d+(?:\.\d+)?)/i,
  ]);
  const expectedHomeAwayTotal = normalized.match(/for[cç]a\s+esperada\s+gols[^0-9]*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/i);
  const expectedTotal = firstNumber(normalized, [
    /exp\.\s*de\s*gols\s*\(modelo\)[^0-9]*(\d+(?:\.\d+)?)/i,
    /expectativa\s+de\s+gols[^0-9]*(\d+(?:\.\d+)?)/i,
  ]);

  const notes: string[] = [];
  const warnings: string[] = [];
  let lambdaHome: number | null = null;
  let lambdaAway: number | null = null;
  let evidence = 0;

  if (expectedHomeAwayTotal?.[1] && expectedHomeAwayTotal?.[2]) {
    lambdaHome = Number(expectedHomeAwayTotal[1]);
    lambdaAway = Number(expectedHomeAwayTotal[2]);
    evidence += 3;
    notes.push("Lambdas estimados por forca esperada de gols extraida do OCR/JSON.");
  } else {
    const homeParts = [homeScored, awayAllowed].filter((value): value is number => value !== null);
    const awayParts = [awayScored, homeAllowed].filter((value): value is number => value !== null);
    if (homeParts.length) {
      lambdaHome = average(homeParts);
      evidence += homeParts.length;
    }
    if (awayParts.length) {
      lambdaAway = average(awayParts);
      evidence += awayParts.length;
    }
    if (homeParts.length || awayParts.length) notes.push("Lambdas estimados por medias de marcados/sofridos disponiveis.");
  }

  if ((lambdaHome === null || lambdaAway === null) && expectedTotal !== null) {
    lambdaHome = expectedTotal * 0.52;
    lambdaAway = expectedTotal * 0.48;
    evidence += 1;
    warnings.push("Total esperado foi dividido de forma aproximada por ausencia de lambdas por equipe.");
  }

  if (lambdaHome === null || lambdaAway === null) {
    return { lambdaHome: null, lambdaAway: null, confidence: "low", notes, warnings };
  }

  lambdaHome = clamp(lambdaHome, 0.1, 5.5);
  lambdaAway = clamp(lambdaAway, 0.1, 5.5);
  const confidence = evidence >= 4 ? "high" : evidence >= 2 ? "medium" : "low";
  if (confidence === "low") warnings.push("Poucas evidencias numericas foram encontradas para calibrar a simulacao.");
  return { lambdaHome, lambdaAway, confidence, notes, warnings };
}

function calculateMarketProbability(matrix: ScoreCell[], marketText: string, input: AspValidatorSimulationInput, line: number | null): number | null {
  const pickText = normalize(input.pick ?? "");
  const home = normalize(input.home_team ?? "");
  const away = normalize(input.away_team ?? "");

  if (marketText.includes("btts") || marketText.includes("ambas")) {
    const yes = matrix.reduce((sum, cell) => sum + (cell.home > 0 && cell.away > 0 ? cell.probability : 0), 0);
    return pickText.includes("nao") || pickText.includes("no") ? 1 - yes : yes;
  }

  if (marketText.includes("dupla chance") || marketText.includes("double chance")) {
    return matrix.reduce((sum, cell) => {
      const homeWin = cell.home > cell.away;
      const draw = cell.home === cell.away;
      const awayWin = cell.home < cell.away;
      const hit =
        pickText.includes("1x") || pickText.includes("casa/empate") || pickText.includes("home/draw")
          ? homeWin || draw
          : pickText.includes("12")
            ? homeWin || awayWin
            : pickText.includes("x2") || pickText.includes("visitante/empate") || pickText.includes("away/draw")
              ? awayWin || draw
              : pickText.includes(home)
                ? homeWin || draw
                : pickText.includes(away)
                  ? awayWin || draw
                  : false;
      return sum + (hit ? cell.probability : 0);
    }, 0);
  }

  if (marketText.includes("handicap")) {
    if (line === null) return null;
    const targetSide = pickText.includes(away) ? "away" : pickText.includes(home) ? "home" : "home";
    const raw = matrix.reduce((sum, cell) => {
      const teamGoals = targetSide === "home" ? cell.home : cell.away;
      const oppGoals = targetSide === "home" ? cell.away : cell.home;
      return sum + (teamGoals + line > oppGoals ? cell.probability : 0);
    }, 0);
    const push = Number.isInteger(line)
      ? matrix.reduce((sum, cell) => {
          const teamGoals = targetSide === "home" ? cell.home : cell.away;
          const oppGoals = targetSide === "home" ? cell.away : cell.home;
          return sum + (teamGoals + line === oppGoals ? cell.probability : 0);
        }, 0)
      : 0;
    return push > 0 && push < 1 ? raw / (1 - push) : raw;
  }

  if (marketText.includes("over") || marketText.includes("under") || marketText.includes("total") || marketText.includes("gol")) {
    if (line === null) return null;
    const wantsUnder = pickText.includes("under") || pickText.includes("menos");
    const raw = matrix.reduce((sum, cell) => {
      const total = cell.home + cell.away;
      const hit = wantsUnder ? total < line : total > line;
      return sum + (hit ? cell.probability : 0);
    }, 0);
    const push = Number.isInteger(line)
      ? matrix.reduce((sum, cell) => sum + (cell.home + cell.away === line ? cell.probability : 0), 0)
      : 0;
    return push > 0 && push < 1 ? raw / (1 - push) : raw;
  }

  if (marketText.includes("1x2") || marketText.includes("resultado") || marketText.includes("moneyline")) {
    return matrix.reduce((sum, cell) => {
      const hit =
        pickText === "1" || pickText.includes(home) || pickText.includes("casa")
          ? cell.home > cell.away
          : pickText === "x" || pickText.includes("empate") || pickText.includes("draw")
            ? cell.home === cell.away
            : pickText === "2" || pickText.includes(away) || pickText.includes("visitante")
              ? cell.away > cell.home
              : false;
      return sum + (hit ? cell.probability : 0);
    }, 0);
  }

  return null;
}

function buildScoreMatrix(lambdaHome: number, lambdaAway: number, maxGoals: number): ScoreCell[] {
  const home = poissonDistribution(lambdaHome, maxGoals);
  const away = poissonDistribution(lambdaAway, maxGoals);
  const cells: ScoreCell[] = [];
  for (let h = 0; h <= maxGoals; h += 1) {
    for (let a = 0; a <= maxGoals; a += 1) {
      cells.push({ home: h, away: a, probability: home[h] * away[a] });
    }
  }
  const covered = cells.reduce((sum, cell) => sum + cell.probability, 0);
  return cells.map((cell) => ({ ...cell, probability: cell.probability / covered }));
}

function poissonDistribution(lambda: number, maxGoals: number): number[] {
  const probs: number[] = [];
  let current = Math.exp(-lambda);
  probs.push(current);
  for (let k = 1; k <= maxGoals; k += 1) {
    current *= lambda / k;
    probs.push(current);
  }
  return probs;
}

function topScores(matrix: ScoreCell[]): Array<{ score: string; probability: number }> {
  return [...matrix]
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 5)
    .map((cell) => ({ score: `${cell.home}-${cell.away}`, probability: round(cell.probability, 4) }));
}

function buildGoalDistribution(matrix: ScoreCell[]): Record<string, number> {
  const distribution: Record<string, number> = {};
  for (const cell of matrix) {
    const total = String(cell.home + cell.away);
    distribution[total] = (distribution[total] ?? 0) + cell.probability;
  }
  return Object.fromEntries(Object.entries(distribution).map(([total, probability]) => [total, round(probability, 4)]));
}

function parseLine(value: string | number | null): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value ?? "").replace(",", ".").match(/[+-]?\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function readCornerRaceLine(value: string | number | null): number | null {
  const text = String(value ?? "");
  const match = text.match(/(\d+(?:[,.]\d+)?)\s*(?:escanteios|cantos|corners?)\s*(?:primeiro|first)/i) ?? text.match(/race\s*to\s*(\d+(?:[,.]\d+)?)/i);
  if (!match?.[1]) return null;
  const parsed = Number(match[1].replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.replace("%", "").replace(",", ".").match(/[+-]?\d+(?:\.\d+)?/)?.[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function percentToDecimal(value: number | null): number | null {
  if (value === null) return null;
  if (value > 0 && value <= 1) return clampDecimal(value, 0, 1);
  return clampDecimal(value / 100, 0, 1);
}

function clampDecimal(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatProb(value: number | null): string {
  return value === null ? "indisponivel" : `${round(value * 100, 2)}%`;
}

function firstNumber(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
