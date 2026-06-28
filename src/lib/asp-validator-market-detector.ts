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

export type FootballSelectionSide = "home" | "away" | "draw" | null;

export type FootballMarketDetection = {
  market_type: FootballMarketType | null;
  period: FootballPeriod;
  line: number | null;
  pick_normalized: string;
  validator_model: ValidatorModel;
  selection: string;
  selection_side: FootballSelectionSide;
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

/**
 * Classifica o mercado a partir APENAS da linha "Mercado:" + pick (sem o blob).
 * Retorna null se nao houver sinal claro. Garante que blocos estatisticos
 * auxiliares ("AMBAS MARCAM", "OVER/UNDER") nao sobrescrevam o mercado
 * principal declarado pelo prognostico.
 */
function detectTypeFromMarketLine(line: string): FootballMarketType | null {
  if (!line.trim()) return null;
  const t = norm(line);
  if (/escanteio|corner|canto/.test(t)) return "corners";
  if (/cartao|cartoes|cards?|amarel|vermelh/.test(t)) return "cards";
  if (
    /\b1\s*x\s*2\b|match\s*odds|moneyline|resultado\s+final|vencedor|\b(home|away)\s*win\b|para\s+vencer|vit[oó]ria\s+(do\s+)?(mandante|visitante|casa|fora)|mandante\s+vence|visitante\s+vence|^empate$|\sempate\s|\bdraw\b/.test(
      t,
    )
  ) {
    return "x1x2";
  }
  if (/dupla\s*chance|double\s*chance/.test(t)) return "double_chance";
  if (/\b(1x|x2|12)\b/.test(t) && !/\b1\s*x\s*2\b/.test(t)) return "double_chance";
  if (/ambas\s+(marcam|equipes)|btts|both\s*teams?\s*to\s*score/.test(t)) return "btts";
  if (/(mais\s+de|menos\s+de|over|under|total\s+de\s+gols?|\bgols?\b|\bgoals?\b)/.test(t))
    return "goals_total";
  return null;
}

function detectSelectionSide(
  type: FootballMarketType | null,
  pick: string,
  market: string,
  homeTeam?: string | null,
  awayTeam?: string | null,
): FootballSelectionSide {
  if (type !== "x1x2" && type !== "double_chance") return null;
  const t = norm(`${pick} ${market}`);
  const home = norm(homeTeam ?? "");
  const away = norm(awayTeam ?? "");
  if (/empate|draw|\bx\b/.test(t) && type === "x1x2") return "draw";
  if (/visitante|away|\bfora\b/.test(t)) return "away";
  if (/mandante|home|\bcasa\b/.test(t)) return "home";
  if (away && t.includes(away)) return "away";
  if (home && t.includes(home)) return "home";
  return null;
}

export function detectFootballMarketType(
  rawText: string,
  formMarket?: string | null,
  formPick?: string | null,
  homeTeam?: string | null,
  awayTeam?: string | null,
): FootballMarketDetection {
  const blob = norm(`${rawText || ""}\n${formMarket || ""}\n${formPick || ""}`);
  const marketLine = `${formMarket || ""} ${formPick || ""}`;
  const period = detectFootballPeriod(marketLine.trim() ? marketLine : blob);

  // 1. Prioridade maxima: mercado declarado no proprio prognostico.
  let market_type: FootballMarketType | null = detectTypeFromMarketLine(marketLine);

  // 2. So depois caimos para deteccao por blocos estatisticos auxiliares.
  if (!market_type) {
    if (/escanteio|corner|canto/.test(blob)) market_type = "corners";
    else if (/cartao|cartoes|cards?|amarel|vermelh/.test(blob)) market_type = "cards";
    else if (
      /\b1\s*x\s*2\b|match\s*odds|moneyline|resultado\s+final|vencedor|\b(home|away)\s*win\b|para\s+vencer/.test(
        blob,
      )
    )
      market_type = "x1x2";
    else if (/dupla\s*chance|double\s*chance/.test(blob)) market_type = "double_chance";
    else if (/ambas\s+(marcam|equipes)|btts|both\s*teams?\s*to\s*score/.test(blob))
      market_type = "btts";
    else if (/(mais\s+de|menos\s+de|over|under|gol|goal|total)/.test(blob))
      market_type = "goals_total";
  }

  const line = extractLine(`${formPick || ""} ${formMarket || ""}`);
  const pick_normalized = normalizePick(formMarket || "", formPick || "", market_type, period, line, homeTeam, awayTeam);
  const validator_model = inferValidatorModelFromType(market_type);
  const selection_side = detectSelectionSide(market_type, formPick || "", formMarket || "", homeTeam, awayTeam);

  return {
    market_type,
    period,
    line,
    pick_normalized,
    validator_model,
    selection: pick_normalized,
    selection_side,
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
  homeTeam?: string | null,
  awayTeam?: string | null,
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
    const aw = norm(awayTeam ?? "");
    const hm = norm(homeTeam ?? "");
    if (/visitante|away|\bfora\b/.test(lower) || (aw && lower.includes(aw))) {
      return `Visitante vence${awayTeam ? ` (${awayTeam})` : ""}${periodSuffix}`.trim();
    }
    if (/mandante|home|\bcasa\b/.test(lower) || (hm && lower.includes(hm))) {
      return `Mandante vence${homeTeam ? ` (${homeTeam})` : ""}${periodSuffix}`.trim();
    }
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
