/**
 * ASP Validator - Detector e normalizador de mercados de futebol.
 *
 * Suporta: 1X2 (FT/HT/ST), Over/Under gols (FT/HT/ST), BTTS, Dupla Chance,
 * Escanteios e Cartoes. Handicap fica fora desta versao.
 *
 * Saida: { market_type, period, line, pick_normalized, validator_model }.
 *
 * Heuristica:
 *   - Ordem de prioridade na deteccao:
 *       corners > cards > btts > double_chance > x1x2 > goals_total
 *   - Periodo: HT se mencionar primeiro tempo / 1T / HT; ST se mencionar
 *     segundo tempo / 2T / ST; FT caso contrario.
 */

export type FootballMarketType =
  | "goals_total"
  | "btts"
  | "x1x2"
  | "double_chance"
  | "corners"
  | "cards";

export type FootballPeriod = "FT" | "HT" | "ST";

export type ValidatorModel =
  | "ASP Goal Validator"
  | "ASP Corner Validator"
  | "ASP Cards Validator"
  | "ASP Market Validator";

export type FootballMarketDetection = {
  market_type: FootballMarketType | null;
  period: FootballPeriod;
  line: number | null;
  pick_normalized: string;
  validator_model: ValidatorModel;
  selection: string;
};

function norm(text: string): string {
  return (text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function extractLine(text: string): number | null {
  const m = text.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const v = Number(m[1].replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

export function detectFootballPeriod(text: string): FootballPeriod {
  const t = norm(text);
  if (
    /\b(1\s*[oº°]?\s*tempo|primeiro\s*tempo|1t\b|ht\b|halftime|half\s*time|intervalo|1\s*o\b)/.test(
      t,
    )
  ) {
    return "HT";
  }
  if (/\b(2\s*[oº°]?\s*tempo|segundo\s*tempo|2t\b|st\b|second\s*half)/.test(t)) {
    return "ST";
  }
  return "FT";
}

export function detectFootballMarketType(
  rawText: string,
  formMarket?: string | null,
  formPick?: string | null,
): FootballMarketDetection {
  const blob = norm(`${rawText || ""}\n${formMarket || ""}\n${formPick || ""}`);
  const marketLine = norm(`${formMarket || ""} ${formPick || ""}`);
  const sourceText = marketLine || blob;
  const period = detectFootballPeriod(sourceText);

  let market_type: FootballMarketType | null = null;

  if (/escanteio|corner|canto/.test(blob)) {
    market_type = "corners";
  } else if (/cartao|cartoes|cards?|amarel|vermelh/.test(blob)) {
    market_type = "cards";
  } else if (/ambas\s+(marcam|equipes)|btts|both\s*teams?\s*to\s*score/.test(blob)) {
    market_type = "btts";
  } else if (/dupla\s*chance|double\s*chance|\b(1x|x2|12)\b/.test(blob)) {
    market_type = "double_chance";
  } else if (
    /\b1x2\b|vencedor|vence|empate|vitoria|moneyline|resultado\s+final/.test(blob)
  ) {
    market_type = "x1x2";
  } else if (
    /(mais\s+de|menos\s+de|over|under|gol|goal|total)/.test(blob)
  ) {
    market_type = "goals_total";
  }

  const line = extractLine(`${formPick || ""} ${formMarket || ""}`);
  const pick_normalized = normalizePick(formMarket || "", formPick || "", market_type, period, line);
  const validator_model = inferValidatorModelFromType(market_type);

  return {
    market_type,
    period,
    line,
    pick_normalized,
    validator_model,
    selection: pick_normalized,
  };
}

function inferValidatorModelFromType(type: FootballMarketType | null): ValidatorModel {
  switch (type) {
    case "corners":
      return "ASP Corner Validator";
    case "cards":
      return "ASP Cards Validator";
    case "goals_total":
    case "btts":
    case "x1x2":
    case "double_chance":
      return "ASP Goal Validator";
    default:
      return "ASP Market Validator";
  }
}

function normalizePick(
  market: string,
  pick: string,
  type: FootballMarketType | null,
  period: FootballPeriod,
  line: number | null,
): string {
  const raw = `${pick || market}`.trim();
  if (!raw) return "";
  const lower = norm(raw);
  const periodSuffix = period === "FT" ? "" : ` ${period}`;
  const isUnder = /menos\s+de|under/.test(lower);
  const isOver = /mais\s+de|over|\+/.test(lower);

  if (type === "goals_total" && line !== null) {
    if (isUnder) return `Menos de ${line} gols${periodSuffix}`.trim();
    if (isOver) return `Mais de ${line} gols${periodSuffix}`.trim();
  }
  if (type === "corners" && line !== null) {
    if (isUnder) return `Menos de ${line} escanteios${periodSuffix}`.trim();
    if (isOver) return `Mais de ${line} escanteios${periodSuffix}`.trim();
  }
  if (type === "cards" && line !== null) {
    if (isUnder) return `Menos de ${line} cartoes${periodSuffix}`.trim();
    if (isOver) return `Mais de ${line} cartoes${periodSuffix}`.trim();
  }
  if (type === "btts") {
    if (/nao|no\b/.test(lower)) return `BTTS Nao${periodSuffix}`.trim();
    return `BTTS Sim${periodSuffix}`.trim();
  }
  if (type === "double_chance") {
    if (/\b1x\b/.test(lower)) return `Dupla Chance 1X${periodSuffix}`.trim();
    if (/\bx2\b/.test(lower)) return `Dupla Chance X2${periodSuffix}`.trim();
    if (/\b12\b/.test(lower)) return `Dupla Chance 12${periodSuffix}`.trim();
  }
  if (type === "x1x2") {
    if (/empate|draw|\bx\b/.test(lower)) return `Empate${periodSuffix}`.trim();
  }
  return raw;
}

/**
 * Sinonimos de "mando": retorna "all", "home" ou "away" se conseguir inferir
 * o escopo casa/fora a partir do texto.
 */
export function detectLocationScope(text: string): "all" | "home_away" {
  return /casa\s*\/\s*fora|home\s*\/\s*away|\(casa\/fora\)/.test(norm(text)) ? "home_away" : "all";
}
