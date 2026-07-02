// Shared helpers for the ASP Validator IA (offline + online).
// Keep pure/deterministic — no I/O, no side effects.

export type Confidence = "Baixo" | "Medio" | "Alto";

export function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace("%", "").replace(",", ".").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

export function clampNumber(value: number | null, min: number, max: number): number | null {
  return value === null ? null : Math.max(min, Math.min(max, value));
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// Percentual (0-100). Fracao decimal 0<x<=1 vira x*100.
export function normalizeProbabilityPercent(value: number | null): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (value > 0 && value <= 1) return round(value * 100);
  return round(value);
}

// EV em percentual (ex.: 5 = 5%). |x|<1 e !=0 vira x*100.
export function normalizeEvPercent(value: number | null): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (value !== 0 && Math.abs(value) < 1) return round(value * 100);
  return round(value);
}

export function normalizeConfidence(value: unknown): Confidence {
  const text = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (text.includes("alto")) return "Alto";
  if (text.includes("medio") || text.includes("moderado")) return "Medio";
  return "Baixo";
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

export function extractManualPrediction(context: Record<string, unknown>) {
  const prediction =
    context.prediction && typeof context.prediction === "object"
      ? (context.prediction as Record<string, unknown>)
      : {};
  return {
    source_probability: readNumber(prediction.source_probability),
    source_fair_odd: readNumber(prediction.source_fair_odd),
    offered_odd: readNumber(prediction.offered_odd),
    source_ev: readNumber(prediction.source_ev),
  };
}

export function hasSimulationData(context: Record<string, unknown>): boolean {
  const sim = context.simulation_json;
  if (!sim || typeof sim !== "object") return false;
  const status = (sim as Record<string, unknown>).status;
  if (status === "not_applicable" || status === "failed") return false;
  return Object.keys(sim as Record<string, unknown>).length > 0;
}

// Post-hoc guard: strip raw-token dumps and rewrite common technical tokens
// into human phrasing when the model slips past the system prompt.
const RAW_TOKEN_PATTERN =
  /\b(source_ev|adjusted_ev|source_probability|adjusted_probability|market_no_vig_probability|market_no_vig|no_vig_probability|online_results|structured_json|simulation_json|fair_odd_original|probability_original|ev_original)\b/gi;

export function sanitizeBlocks(items: string[]): string[] {
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    let text = String(raw).trim();
    if (!text) continue;
    const looksLikeTokenDump = /^[\s\-*]*[a-z_]+\s*[:=]\s*[-+\d.%]+\s*$/i.test(text);
    if (looksLikeTokenDump && RAW_TOKEN_PATTERN.test(text)) continue;
    text = text
      .replace(/market_no_vig_probability/gi, "probabilidade no-vig do mercado")
      .replace(/no_vig_probability/gi, "probabilidade no-vig do mercado")
      .replace(/market_no_vig/gi, "mercado no-vig")
      .replace(/source_probability/gi, "probabilidade da fonte")
      .replace(/adjusted_probability/gi, "probabilidade ajustada")
      .replace(/source_ev/gi, "EV da fonte")
      .replace(/adjusted_ev/gi, "EV ajustado")
      .replace(/online_results/gi, "pesquisa online")
      .replace(/structured_json/gi, "dados estruturados")
      .replace(/simulation_json/gi, "simulacao")
      // Typos comuns / labels ruins vindos da IA
      .replace(/\bStartes\b/g, "Starters")
      .replace(/taxa de censores base por bolas/gi, "walks concedidos (BB/9)")
      .replace(/censores base por bolas/gi, "walks concedidos (BB/9)")
      .replace(/concessao de bases por bolas/gi, "walks concedidos (BB/9)");
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(text);
  }
  return cleaned;
}

// Detect starters (home/away pitcher names) inside consolidated context.
export function hasIdentifiedMlbStarters(context: Record<string, unknown>): boolean {
  const paths: string[][] = [
    ["baseball_reference_context", "starting_pitchers", "home", "name"],
    ["baseball_reference_context", "starting_pitchers", "away", "name"],
    ["structured_json", "home_starter"],
    ["structured_json", "away_starter"],
    ["prediction", "home_starter"],
    ["prediction", "away_starter"],
  ];
  const names: string[] = [];
  for (const path of paths) {
    let cur: unknown = context;
    for (const key of path) {
      if (!cur || typeof cur !== "object") { cur = undefined; break; }
      cur = (cur as Record<string, unknown>)[key];
    }
    if (typeof cur === "string" && cur.trim().length > 2) names.push(cur.trim());
  }
  const summary = String((context as { imported_context_summary?: unknown }).imported_context_summary ?? "");
  if (/\[STARTERS\][\s\S]*n[aã]o identificado/i.test(summary)) return names.length >= 2;
  return names.length >= 2;
}

export interface HardGuardrailInput {
  decision: "CONFIRMAR" | "PULAR";
  adjusted_ev: number | null;
  adjusted_fair_odd: number | null;
  offered_odd: number | null;
  alerts: string[];
  final_analysis: string;
}

// Enforce items 11 (EV/fair-odd guardrail) and 12 (MLB Totals starter gate).
// Returns adjusted decision + alerts + final_analysis. Never widens CONFIRMAR.
export function enforceHardGuardrails<T extends HardGuardrailInput>(
  result: T,
  context: Record<string, unknown>,
  route: { sport: string; market: string },
): T {
  const alerts = [...result.alerts];
  let decision = result.decision;
  let final = result.final_analysis;

  // Item 12 — MLB Totals starter gate
  if (route.sport === "baseball" && route.market === "totals" && !hasIdentifiedMlbStarters(context)) {
    if (decision === "CONFIRMAR") {
      decision = "PULAR";
      final = `${final ? final + " " : ""}Decisao rebaixada para PULAR: starters nao confirmados (gate MLB Totals).`.trim();
    }
    if (!alerts.some((a) => /starters/i.test(a) && /gate/i.test(a))) {
      alerts.push("Starters nao confirmados — gate MLB Totals (PULAR obrigatorio ate confirmacao).");
    }
  }

  // Item 11 — adjusted_ev >= 3 e adjusted_fair_odd < offered_odd
  if (decision === "CONFIRMAR") {
    const ev = result.adjusted_ev;
    const fair = result.adjusted_fair_odd;
    const offered = result.offered_odd;
    const evFail = ev === null || !Number.isFinite(ev) || ev < 3;
    const fairFail = fair !== null && offered !== null && Number.isFinite(fair) && Number.isFinite(offered) && fair >= offered;
    if (evFail || fairFail) {
      decision = "PULAR";
      const reason = evFail
        ? `EV ajustado ${ev === null ? "indefinido" : ev.toFixed(2) + "%"} abaixo do minimo de 3%`
        : `odd justa ajustada ${fair} >= odd ofertada ${offered}`;
      alerts.push(`Guardrail acionado: ${reason}. Decisao forcada para PULAR.`);
      final = `${final ? final + " " : ""}Guardrail de banca: ${reason}; decisao ajustada para PULAR.`.trim();
    }
  }

  return { ...result, decision, alerts, final_analysis: final };
}
