// Sport routing for validator IA. Detects sport family and market family
// from consolidated context to pick the right rule fragments.

export type SportFamily = "football" | "baseball" | "basketball" | "generic";
export type MarketFamily = "moneyline" | "totals" | "handicap" | "corners" | "btts" | "1x2" | "generic";

// Fine-grained label used in UIs and prompts (e.g. baseball_total_runs).
export type MarketDetectedLabel =
  | "baseball_total_runs"
  | "baseball_moneyline"
  | "baseball_run_line"
  | "football_corners"
  | "football_btts"
  | "football_1x2"
  | "football_goals_total"
  | "generic_totals"
  | "generic_moneyline"
  | "generic_handicap"
  | "generic";

export interface ValidatorRoute {
  sport: SportFamily;
  market: MarketFamily;
  marketDetected: MarketDetectedLabel;
}

export function detectSport(context: Record<string, unknown>): SportFamily {
  const raw = readStr(context.sport) || readStr(getPath(context, ["structured_json", "sport"]));
  const t = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (!t) return "generic";
  if (t.startsWith("futebol") || t.startsWith("football") || t.startsWith("soccer")) return "football";
  if (t.startsWith("baseball") || t.includes("mlb")) return "baseball";
  if (t.startsWith("basquete") || t.startsWith("basketball") || t.includes("nba")) return "basketball";
  return "generic";
}

export function detectMarketFamily(context: Record<string, unknown>): MarketFamily {
  const declared = readStr(getPath(context, ["structured_json", "market_family"])) || readStr(getPath(context, ["structured_json", "market_type"]));
  const market = readStr(context.market) || readStr(getPath(context, ["structured_json", "market"])) || readStr(getPath(context, ["prediction", "market"]));
  const pick = readStr(getPath(context, ["prediction", "pick"])) || readStr(getPath(context, ["structured_json", "pick"]));
  const src = `${declared} ${market} ${pick}`.toLowerCase();
  if (/corner|escanteio/.test(src)) return "corners";
  if (/btts|ambos.*marc|both.*score/.test(src)) return "btts";
  if (/(over|under|total|o\/u|totals|mais de|menos de|runs over|runs under)/.test(src)) return "totals";
  if (/(handicap|spread|run line|runline|asian)/.test(src)) return "handicap";
  if (/moneyline|ml\b|money line|vencedor|match odds|match winner|1x2/.test(src)) {
    if (/1x2/.test(src)) return "1x2";
    return "moneyline";
  }
  return "generic";
}

export function detectMarketLabel(sport: SportFamily, market: MarketFamily): MarketDetectedLabel {
  if (sport === "baseball") {
    if (market === "totals") return "baseball_total_runs";
    if (market === "moneyline") return "baseball_moneyline";
    if (market === "handicap") return "baseball_run_line";
  }
  if (sport === "football") {
    if (market === "corners") return "football_corners";
    if (market === "btts") return "football_btts";
    if (market === "1x2") return "football_1x2";
    if (market === "totals") return "football_goals_total";
  }
  if (market === "totals") return "generic_totals";
  if (market === "moneyline") return "generic_moneyline";
  if (market === "handicap") return "generic_handicap";
  return "generic";
}

export function routeValidator(context: Record<string, unknown>): ValidatorRoute {
  const sport = detectSport(context);
  const market = detectMarketFamily(context);
  const marketDetected = detectMarketLabel(sport, market);
  return { sport, market, marketDetected };
}

function readStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function getPath(obj: Record<string, unknown>, path: string[]): unknown {
  let cur: unknown = obj;
  for (const p of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}
