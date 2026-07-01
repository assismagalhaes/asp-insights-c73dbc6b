// Sport routing for validator IA. Detects sport family and market family
// from consolidated context to pick the right rule fragments.

export type SportFamily = "football" | "baseball" | "basketball" | "generic";
export type MarketFamily = "moneyline" | "totals" | "handicap" | "corners" | "btts" | "1x2" | "generic";

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
  const market = readStr(context.market) || readStr(getPath(context, ["structured_json", "market"]));
  const src = `${declared} ${market}`.toLowerCase();
  if (/corner|escanteio/.test(src)) return "corners";
  if (/btts|ambos.*marc|both.*score/.test(src)) return "btts";
  if (/(over|under|total|o\/u|totals|mais de|menos de)/.test(src)) return "totals";
  if (/(handicap|spread|line|asian)/.test(src)) return "handicap";
  if (/moneyline|ml\b|money line|vencedor|match odds|match winner|1x2/.test(src)) {
    if (/1x2/.test(src)) return "1x2";
    return "moneyline";
  }
  return "generic";
}
export type ValidatorRoute = { sport: SportFamily; market: MarketFamily };

export function routeValidator(context: Record<string, unknown>): ValidatorRoute {
  return { sport: detectSport(context), market: detectMarketFamily(context) };
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
