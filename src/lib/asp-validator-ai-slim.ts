// Trim ASP Validator AI payload to drastically reduce token usage.
// Removes redundant blocks based on input_source and market_type, and
// compacts simulation_json to the fields actually cited by the prompt.

type Ctx = Record<string, unknown>;

const STRUCTURED_KEEP_ALWAYS = new Set([
  "market_type",
  "period",
  "pick",
  "line",
  "league",
  "date",
  "time",
  "home",
  "away",
  "odds",
  "probability",
  "ev",
  "fair_odd",
  "source",
  "normalized_market_lines",
]);

const STRUCTURED_BY_MARKET: Record<string, string[]> = {
  corners: ["corners"],
  goals_total: ["goals", "btts"],
  btts: ["goals", "btts"],
  cards: ["cards"],
  x1x2: ["general_performance", "goals"],
  double_chance: ["general_performance", "goals"],
};

function isObj(v: unknown): v is Ctx {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function slimStructuredJson(structured: unknown, marketType: string | null): unknown {
  if (!isObj(structured)) return structured;
  const allowedMarketBlocks = marketType ? STRUCTURED_BY_MARKET[marketType] ?? [] : [];
  const out: Ctx = {};
  for (const [k, v] of Object.entries(structured)) {
    if (STRUCTURED_KEEP_ALWAYS.has(k) || allowedMarketBlocks.includes(k)) {
      out[k] = v;
    }
  }
  // If no market filter matched, keep whatever exists (safer)
  if (marketType && allowedMarketBlocks.length === 0) return structured;
  return out;
}

function slimSimulationJson(sim: unknown): unknown {
  if (!isObj(sim)) return sim;
  const keep = [
    "status",
    "model",
    "market",
    "line",
    "pick",
    "market_probability",
    "fair_odd",
    "ev",
    "offered_odd",
    "lambda_home",
    "lambda_away",
    "expected_home",
    "expected_away",
    "expected_total",
    "technical_composition",
    "notes",
  ];
  const out: Ctx = {};
  for (const k of keep) {
    if (k in sim) out[k] = (sim as Ctx)[k];
  }
  // Compact over_lines: keep only line analyzed + 2 neighbours
  const overLines = (sim as Ctx).over_lines;
  if (isObj(overLines)) {
    const line = Number((sim as Ctx).line);
    const entries = Object.entries(overLines).map(([k, v]) => [Number(k), v] as const).filter(([n]) => Number.isFinite(n));
    entries.sort((a, b) => Math.abs(a[0] - line) - Math.abs(b[0] - line));
    const top = entries.slice(0, 5);
    out.over_lines = Object.fromEntries(top.map(([n, v]) => [String(n), v]));
  }
  return out;
}

export function slimAspValidatorContext(input: Ctx): Ctx {
  const ctx: Ctx = { ...input };
  const usage = isObj(ctx.data_usage) ? (ctx.data_usage as Ctx) : {};
  const isPasted = ctx.input_source === "pasted_text" || usage.used_pasted_text === true;

  // 1. Drop OCR + uploads when source is pasted text
  if (isPasted) {
    delete ctx.ocr_structured_data;
    delete ctx.ocr_text;
    delete ctx.uploads;
    delete ctx.uploads_comments;
    delete ctx.upload_summaries;
  }

  // 2. Drop empty/large debug-ish fields
  delete ctx.raw_form;
  delete ctx.raw_record;

  // 3. Filter structured_json by market_type
  const structured = isObj(ctx.structured_json) ? (ctx.structured_json as Ctx) : null;
  const marketType = structured && typeof structured.market_type === "string" ? structured.market_type : null;
  if (structured) {
    ctx.structured_json = slimStructuredJson(structured, marketType);
  }

  // 4. Compact simulation_json
  if (ctx.simulation_json) {
    ctx.simulation_json = slimSimulationJson(ctx.simulation_json);
  }

  // 5. Trim long string fields (pasted_text raw)
  if (typeof ctx.pasted_text === "string" && ctx.pasted_text.length > 4000) {
    ctx.pasted_text = ctx.pasted_text.slice(0, 4000) + "\n...[truncado]";
  }

  return ctx;
}
