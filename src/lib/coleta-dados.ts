import { supabase } from "@/lib/supabase-public";

export interface NormalizedOdd {
  data: string | null;
  hora: string | null;
  esporte: string | null;
  liga: string | null;
  jogo: string;
  mandante: string;
  visitante: string;
  mercado: string;
  pick: string;
  linha: string | null;
  odd: number;
  odd_media?: number | null;
  odd_mediana?: number | null;
  odd_minima?: number | null;
  odd_maxima?: number | null;
  odd_melhor?: number | null;
  bookmaker_melhor?: string | null;
  odd_desvio_padrao?: number | null;
  casas_count?: number | null;
  odds_disponiveis?: number | null;
  probabilidade_implicita_media?: number | null;
  probabilidade_implicita_mediana?: number | null;
  margem_mercado_media?: number | null;
  margem_mercado_mediana?: number | null;
  bookmaker: string | null;
  fonte: string | null;
  capturado_em: string | null;
  raw_ref: Record<string, unknown>;
}

export interface NormalizedCollection {
  esporte: string | null;
  liga: string | null;
  data_inicio: string | null;
  data_fim: string | null;
  mercados: string[];
  total_jogos: number;
  total_odds: number;
  rows: NormalizedOdd[];
}

export interface ImportResult {
  inserted: number;
  duplicated: number;
}

export interface ColetaOdds {
  id: string;
  job_id: string | null;
  status: string;
  esporte: string | null;
  liga: string | null;
  data_inicio: string | null;
  data_fim: string | null;
  mercados: string[] | null;
  parametros: Record<string, unknown> | null;
  raw_json: unknown;
  normalized_json: unknown;
  total_jogos: number;
  total_odds: number;
  erro: string | null;
  created_at: string;
  updated_at: string;
}

export interface OddsJogo extends NormalizedOdd {
  id: string;
  coleta_id: string | null;
  created_at: string;
}

export type FetchOddsRowsParams = {
  date?: string | null;
  esporte?: string | null;
  liga?: string | null;
  limit?: number;
  includeCollectionFallback?: boolean;
};

export type VmPayloadRow = Record<string, unknown>;

export const NORMALIZED_PREVIEW_STORAGE_KEY = "asp:last-normalized-odds-preview";

type QueryErrorLike = { message: string };
type QueryResultLike<T = unknown> = { data: T | null; error: QueryErrorLike | null };
type ColetaQueryLike<T = unknown> = PromiseLike<QueryResultLike<T>> & {
  select: (columns?: string) => ColetaQueryLike<T>;
  insert: (values: Record<string, unknown> | Record<string, unknown>[]) => ColetaQueryLike<T>;
  update: (values: Record<string, unknown>) => ColetaQueryLike<T>;
  delete: () => ColetaQueryLike<T>;
  eq: (column: string, value: unknown) => ColetaQueryLike<T>;
  lte: (column: string, value: unknown) => ColetaQueryLike<T>;
  gte: (column: string, value: unknown) => ColetaQueryLike<T>;
  order: (column: string, opts?: { ascending?: boolean }) => ColetaQueryLike<T>;
  limit: (count: number) => ColetaQueryLike<T>;
  single: () => PromiseLike<QueryResultLike<T>>;
};

const coletaDb = supabase as unknown as {
  from: (table: string) => ColetaQueryLike;
};
const ODDS_INSERT_BATCH_SIZE = 50;
const ODDS_JOGOS_LIST_COLUMNS = [
  "id",
  "coleta_id",
  "data",
  "hora",
  "esporte",
  "liga",
  "jogo",
  "mandante",
  "visitante",
  "mercado",
  "pick",
  "linha",
  "odd",
  "odd_media",
  "odd_mediana",
  "odd_minima",
  "odd_maxima",
  "odd_melhor",
  "bookmaker_melhor",
  "odd_desvio_padrao",
  "casas_count",
  "odds_disponiveis",
  "probabilidade_implicita_media",
  "probabilidade_implicita_mediana",
  "margem_mercado_media",
  "margem_mercado_mediana",
  "bookmaker",
  "fonte",
  "capturado_em",
  "raw_ref",
  "created_at",
].join(",");

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const n = Number(String(value).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function isHalfPointLine(value: unknown): boolean {
  const n = toNumber(value);
  if (n == null) return false;
  return Math.abs((Math.abs(n) % 1) - 0.5) < 1e-9;
}

function requiresBaseballHalfPointLine(row: Pick<NormalizedOdd, "esporte" | "mercado">): boolean {
  const sport = String(row.esporte ?? "").toLowerCase();
  const market = String(row.mercado ?? "").toLowerCase();
  return (
    /baseball|mlb/.test(sport) && /over\/under|asian handicap|handicap asi[aá]tico/.test(market)
  );
}

function keepAllowedMarketLine(row: NormalizedOdd): boolean {
  return !requiresBaseballHalfPointLine(row) || isHalfPointLine(row.linha);
}

const flashscoreIdPattern = /^[A-Za-z0-9]{6,12}$/;
const flashscoreTeamSlugPattern = /^[a-z0-9-]+-[A-Za-z0-9]{6,12}$/i;
const flashscoreSportParts = new Set([
  "american-football",
  "baseball",
  "basketball",
  "football",
  "hockey",
  "soccer",
  "tennis",
  "volleyball",
]);

function parseFlashscoreUrl(value: unknown): URL | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  try {
    return new URL(text);
  } catch {
    try {
      return new URL(text.startsWith("/") ? text : `/${text}`, "https://www.flashscore.com");
    } catch {
      return null;
    }
  }
}

export function extractLegacyFlashscoreMatchIdFromPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] !== "match") continue;
    let candidate = parts[i + 1] ?? "";
    if (flashscoreSportParts.has(candidate.toLowerCase())) candidate = parts[i + 2] ?? "";
    if (flashscoreIdPattern.test(candidate) && !flashscoreTeamSlugPattern.test(candidate))
      return candidate;
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] === "odds") break;
    if (flashscoreIdPattern.test(parts[i]) && !flashscoreTeamSlugPattern.test(parts[i]))
      return parts[i];
  }
  return null;
}

export function extractFlashscoreMatchId(url: unknown): string | null {
  const parsed = parseFlashscoreUrl(url);
  if (!parsed) return null;
  const mid = parsed.searchParams.get("mid")?.trim();
  if (mid) return mid;
  return extractLegacyFlashscoreMatchIdFromPath(parsed.pathname);
}

export function normalizeFlashscoreUrl(url: unknown): string | null {
  const parsed = parseFlashscoreUrl(url);
  if (!parsed) return null;
  const mid = extractFlashscoreMatchId(parsed.toString());
  const normalized = new URL(parsed.toString());
  normalized.hash = "";
  normalized.search = "";
  if (mid) normalized.searchParams.set("mid", mid);
  return normalized.toString();
}

export function flashscoreMarketUrl(url: unknown, market: string): string | null {
  const parsed = parseFlashscoreUrl(url);
  if (!parsed) return null;
  const parts = parsed.pathname.split("/").filter(Boolean);
  const oddsIdx = parts.indexOf("odds");
  if (oddsIdx < 0) return normalizeFlashscoreUrl(parsed.toString());
  parts[oddsIdx + 1] = market.replace(/^\/+|\/+$/g, "");
  parsed.pathname = `/${parts.join("/")}/`;
  parsed.hash = "";
  parsed.search = "";
  const mid = extractFlashscoreMatchId(url);
  if (mid) parsed.searchParams.set("mid", mid);
  return parsed.toString();
}

function parseDate(value: unknown): string | null {
  if (!value) return null;
  const s = String(value).trim();
  const br = s.match(/^(\d{2})[/.](\d{2})[/.](\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function parseTime(value: unknown): string | null {
  if (!value) return null;
  const m = String(value)
    .trim()
    .match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function normalizeSport(input: string | null | undefined, source?: unknown): string | null {
  const raw = (input ?? inferSportFromSource(source) ?? "").toLowerCase();
  if (/basket/.test(raw)) return "Basketball";
  if (/baseball|mlb/.test(raw)) return "Baseball";
  if (/hockey|nhl/.test(raw)) return "Hockey";
  if (/american|nfl|ncaa|football americano/.test(raw)) return "American Football";
  if (/football|soccer|futebol/.test(raw)) return "Futebol";
  return input ?? null;
}

function inferSportFromSource(source?: unknown): string | null {
  const text = JSON.stringify(source ?? "").toLowerCase();
  if (text.includes("/basketball/")) return "Basketball";
  if (text.includes("/baseball/")) return "Baseball";
  if (text.includes("/hockey/")) return "Hockey";
  if (text.includes("/american-football/")) return "American Football";
  if (text.includes("/football/")) return "Futebol";
  return null;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text || (!text.startsWith("{") && !text.startsWith("["))) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function getGames(raw: unknown): Array<Record<string, unknown>> {
  raw = parseMaybeJson(raw);
  if (Array.isArray(raw)) return raw.filter(isRecord);
  if (!isRecord(raw)) return [];
  const nested = raw.data ?? raw.result ?? raw.raw_json ?? raw.normalized_json;
  if (nested && nested !== raw) {
    const nestedGames = getGames(nested);
    if (nestedGames.length) return nestedGames;
  }
  if (isRecord(raw._default)) return Object.values(raw._default).filter(isRecord);
  if (Array.isArray(raw.games)) return raw.games.filter(isRecord);
  if (Array.isArray(raw.jogos)) return raw.jogos.filter(isRecord);
  return Object.values(raw).filter(isRecord);
}

function extractRowsByPriority(payload: unknown, keys: string[], depth = 0): VmPayloadRow[] {
  payload = parseMaybeJson(payload);
  if (depth > 6 || payload == null) return [];
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];

  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      const rows = value.filter(isRecord);
      if (rows.length || key === "linhas" || key === "jogos") return rows;
      continue;
    }
    if (key === "_default" && isRecord(value)) {
      const rows = Object.values(value).filter(isRecord);
      if (rows.length) return rows;
    }
    if (isRecord(value)) {
      const nested = extractRowsByPriority(value, keys, depth + 1);
      if (nested.length) return nested;
    }
  }

  return [];
}

export function extractNormalizedRows(payload: unknown): VmPayloadRow[] {
  return extractRowsByPriority(payload, [
    "linhas",
    "rows",
    "odds",
    "data",
    "items",
    "results",
    "normalized_json",
  ]);
}

export function extractRawGames(payload: unknown): VmPayloadRow[] {
  return extractRowsByPriority(payload, [
    "jogos",
    "games",
    "_default",
    "data",
    "result",
    "raw_json",
  ]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function toText(value: unknown): string | null {
  if (value == null || value === "") return null;
  return String(value);
}

function requiredText(value: unknown, fallback: string): string {
  const text = toText(value)?.trim();
  return text || fallback;
}

function invertLine(line: string | null): string | null {
  if (!line) return null;
  const n = Number(line.replace(",", "."));
  if (!Number.isFinite(n) || n === 0) return line;
  const inv = -n;
  return inv > 0 ? `+${inv}` : String(inv);
}

function baseGame(game: Record<string, unknown>, esporteHint?: string | null) {
  const mandante = String(game.home ?? game.mandante ?? game.casa ?? "");
  const visitante = String(game.away ?? game.visitante ?? game.fora ?? "");
  const data = parseDate(game.date ?? game.data);
  const hora = parseTime(game.hour ?? game.hora ?? game.time);
  const fonte = String(game.link ?? game.fonte ?? "");
  const capturado = parseCapturedAt(game.att ?? game.capturado_em);
  const normalizedFonte = normalizeFlashscoreUrl(fonte) ?? fonte;
  return {
    data,
    hora,
    esporte: normalizeSport(esporteHint ?? String(game.sport ?? game.esporte ?? ""), game),
    liga: String(game.league ?? game.liga ?? ""),
    jogo: String(game.jogo ?? `${mandante} vs ${visitante}`),
    mandante,
    visitante,
    fonte: normalizedFonte || null,
    capturado_em: capturado,
  };
}

// Fuso horário fixo de Brasília (UTC-3). O Brasil não observa mais horário
// de verão desde 2019, então o offset é constante.
const BRASILIA_OFFSET = "-03:00";

function parseCapturedAt(value: unknown): string | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;

  // Já veio com fuso (Z ou ±HH:MM) — preservar.
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) return s;

  // Formato brasileiro "DD/MM/YYYY HH:MM[:SS]" — assumir horário de Brasília.
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (br) {
    const ss = (br[6] ?? "00").padStart(2, "0");
    return `${br[3]}-${br[2]}-${br[1]}T${br[4].padStart(2, "0")}:${br[5]}:${ss}${BRASILIA_OFFSET}`;
  }

  // ISO sem fuso ("YYYY-MM-DDTHH:MM[:SS]" ou "YYYY-MM-DD HH:MM[:SS]") — assumir horário de Brasília.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (iso) {
    const ss = (iso[6] ?? "00").padStart(2, "0");
    return `${iso[1]}-${iso[2]}-${iso[3]}T${iso[4]}:${iso[5]}:${ss}${BRASILIA_OFFSET}`;
  }

  return null;
}

function marketPick(
  market: string,
  header: string,
  base: { mandante: string; visitante: string },
): string {
  const h = header.trim();
  if (h === "1") return base.mandante || "Casa";
  if (h === "2") return base.visitante || "Fora";
  if (h.toUpperCase() === "X") return "Empate";
  if (h.toUpperCase() === "YES") return "Sim";
  if (h.toUpperCase() === "NO") return "Não";
  if (h.toUpperCase() === "OVER") return "Over";
  if (h.toUpperCase() === "UNDER") return "Under";
  return h || market;
}

function normalizeMarketRows(
  game: Record<string, unknown>,
  esporteHint?: string | null,
): NormalizedOdd[] {
  const base = baseGame(game, esporteHint);
  const gameId =
    extractFlashscoreMatchId(game.link ?? game.url ?? game.fonte) ??
    toText(game.id ?? game.match_id ?? game.game_id ?? game.fixture_id);
  const odds = isRecord(game.odds) ? game.odds : {};
  const rows: NormalizedOdd[] = [];

  if (Array.isArray(game.mercados) && !Object.keys(odds).length) {
    for (const item of game.mercados.filter(isRecord)) {
      const odd = toNumber(item.odd ?? item.price ?? item.odds);
      if (!odd) continue;
      const row = {
        ...base,
        mercado: requiredText(item.mercado ?? item.market, "Mercado"),
        pick: requiredText(item.pick ?? item.selecao ?? item.selection, "Pick"),
        linha: toText(item.linha ?? item.line),
        odd,
        bookmaker: toText(item.bookmaker ?? item.book ?? item.casa_aposta),
        raw_ref: {
          game_id: gameId,
          market: item.mercado ?? item.market,
          row: item,
        },
      };
      if (keepAllowedMarketLine(row)) rows.push(row);
    }
    return rows;
  }

  for (const [marketName, periods] of Object.entries(odds)) {
    if (!isRecord(periods)) continue;
    for (const [period, table] of Object.entries(periods)) {
      if (!Array.isArray(table) || table.length < 2 || !Array.isArray(table[0])) continue;
      const headers = table[0].map((h) => String(h));
      const bookmakerIndex = headers.findIndex((h) => /bookmaker/i.test(h));
      const lineIndex = headers.findIndex((h) => /total|handicap|line|linha/i.test(h));

      for (const item of table.slice(1)) {
        if (!Array.isArray(item)) continue;
        const bookmaker = bookmakerIndex >= 0 ? String(item[bookmakerIndex] ?? "") : null;
        const line = lineIndex >= 0 ? String(item[lineIndex] ?? "") : null;
        for (let i = 0; i < headers.length; i++) {
          if (i === bookmakerIndex || i === lineIndex) continue;
          const odd = toNumber(item[i]);
          if (!odd) continue;
          const header = headers[i];
          const pick = marketPick(marketName, header, base);
          const linha =
            /asian handicap/i.test(marketName) && header === "2" ? invertLine(line) : line;
          const row = {
            ...base,
            mercado: marketName,
            pick,
            linha: linha || null,
            odd,
            bookmaker: bookmaker || null,
            raw_ref: { game_id: gameId, market: marketName, period, header, row: item },
          };
          if (keepAllowedMarketLine(row)) rows.push(row);
        }
      }
    }
  }

  return rows;
}

export function normalizeOddsJson(
  raw: unknown,
  opts?: { esporte?: string | null },
): NormalizedCollection {
  const games = getGames(raw);
  const rows = games.flatMap((game) => normalizeMarketRows(game, opts?.esporte));
  const dates = rows
    .map((row) => row.data)
    .filter(Boolean)
    .sort() as string[];
  const mercados = [...new Set(rows.map((row) => row.mercado).filter(Boolean))].sort();
  const ligas = [...new Set(rows.map((row) => row.liga).filter(Boolean))];
  const esportes = [...new Set(rows.map((row) => row.esporte).filter(Boolean))];
  return {
    esporte: esportes.length === 1 ? esportes[0] : (opts?.esporte ?? null),
    liga: ligas.length === 1 ? ligas[0] : null,
    data_inicio: dates[0] ?? null,
    data_fim: dates[dates.length - 1] ?? null,
    mercados,
    total_jogos: games.length,
    total_odds: rows.length,
    rows,
  };
}

export function normalizeVmNormalizedPayload(
  payload: unknown,
  opts?: { esporte?: string | null },
): NormalizedCollection {
  payload = parseMaybeJson(payload);
  const root = isRecord(payload) ? payload : {};
  const nested = isRecord(root.data)
    ? root.data
    : isRecord(root.result)
      ? root.result
      : isRecord(root.normalized_json)
        ? (root.normalized_json as Record<string, unknown>)
        : root;

  const flatCandidate = extractNormalizedRows(nested);

  // Só trata como "linhas planas" quando os itens parecem registros de odd.
  const flat = flatCandidate
    .filter(isRecord)
    .filter(
      (r) =>
        "odd" in r ||
        "price" in r ||
        "odds" in r ||
        "mercado" in r ||
        "market" in r ||
        "pick" in r ||
        "selection" in r,
    );

  const recursiveFlat = collectRecords(nested, isFlatOddRecord);
  const rows: NormalizedOdd[] = (recursiveFlat.length ? recursiveFlat : flat)
    .map((row) => normalizeVmRow(row, opts?.esporte))
    .filter((row) => row.odd > 0)
    .filter(keepAllowedMarketLine);

  // Fallback: payload com estrutura de jogos (odds: { market: { period: [[headers],[row]] } })
  if (!rows.length) {
    const rawGames = extractRawGames(payload);
    const gameRows = (rawGames.length ? rawGames : collectRecords(payload, isGameRecord)).flatMap(
      (game) => normalizeMarketRows(game, opts?.esporte),
    );
    if (gameRows.length) {
      if (import.meta.env.DEV) {
        console.debug(
          "[normalizeVmNormalizedPayload] jogos encontrados por varredura:",
          gameRows.length,
          "linhas",
        );
      }
      return buildCollection(gameRows, opts?.esporte);
    }

    try {
      const gameShaped = normalizeOddsJson(payload, opts);
      if (gameShaped.rows.length) {
        if (import.meta.env.DEV) {
          console.debug(
            "[normalizeVmNormalizedPayload] fallback games-shape utilizado:",
            gameShaped.rows.length,
            "linhas",
          );
        }
        return gameShaped;
      }
    } catch (err) {
      if (typeof console !== "undefined") {
        console.warn("[normalizeVmNormalizedPayload] fallback games-shape falhou:", err);
      }
    }
  }

  if (!rows.length && typeof console !== "undefined") {
    const topKeys = isRecord(payload) ? Object.keys(payload).join(", ") : typeof payload;
    console.warn(
      "[normalizeVmNormalizedPayload] nenhuma linha extraída. chaves de topo:",
      topKeys,
      "payload:",
      payload,
    );
  }

  const dates = rows
    .map((row) => row.data)
    .filter(Boolean)
    .sort() as string[];
  const mercados = [...new Set(rows.map((row) => row.mercado).filter(Boolean))].sort();
  const ligas = [...new Set(rows.map((row) => row.liga).filter(Boolean))];
  const esportes = [...new Set(rows.map((row) => row.esporte).filter(Boolean))];
  const jogos = new Set(
    rows
      .map((row) =>
        row.raw_ref?.game_id ? String(row.raw_ref.game_id) : `${row.data ?? ""}|${row.jogo}`,
      )
      .filter(Boolean),
  );

  return {
    esporte: esportes.length === 1 ? esportes[0] : (opts?.esporte ?? null),
    liga: ligas.length === 1 ? ligas[0] : null,
    data_inicio: dates[0] ?? null,
    data_fim: dates[dates.length - 1] ?? null,
    mercados,
    total_jogos: jogos.size,
    total_odds: rows.length,
    rows,
  };
}

function buildCollection(rows: NormalizedOdd[], esporteHint?: string | null): NormalizedCollection {
  const dates = rows
    .map((row) => row.data)
    .filter(Boolean)
    .sort() as string[];
  const mercados = [...new Set(rows.map((row) => row.mercado).filter(Boolean))].sort();
  const ligas = [...new Set(rows.map((row) => row.liga).filter(Boolean))];
  const esportes = [...new Set(rows.map((row) => row.esporte).filter(Boolean))];
  const jogos = new Set(
    rows
      .map((row) =>
        row.raw_ref?.game_id ? String(row.raw_ref.game_id) : `${row.data ?? ""}|${row.jogo}`,
      )
      .filter(Boolean),
  );

  return {
    esporte: esportes.length === 1 ? esportes[0] : (esporteHint ?? null),
    liga: ligas.length === 1 ? ligas[0] : null,
    data_inicio: dates[0] ?? null,
    data_fim: dates[dates.length - 1] ?? null,
    mercados,
    total_jogos: jogos.size,
    total_odds: rows.length,
    rows,
  };
}

function collectRecords(
  value: unknown,
  predicate: (record: Record<string, unknown>) => boolean,
  depth = 0,
  seen = new WeakSet<object>(),
): Record<string, unknown>[] {
  value = parseMaybeJson(value);
  if (depth > 8 || value == null || typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);

  if (Array.isArray(value)) {
    const direct = value.filter(isRecord).filter(predicate);
    if (direct.length) return direct;
    return value.flatMap((item) => collectRecords(item, predicate, depth + 1, seen));
  }

  if (!isRecord(value)) return [];
  const direct = predicate(value) ? [value] : [];
  const nested = Object.values(value).flatMap((item) =>
    collectRecords(item, predicate, depth + 1, seen),
  );
  return [...direct, ...nested];
}

function hasAnyKey(record: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => key in record);
}

function isFlatOddRecord(record: Record<string, unknown>) {
  const hasOdd = hasAnyKey(record, [
    "odd",
    "odds",
    "price",
    "cotacao",
    "cota",
    "decimal",
    "odd_decimal",
    "valor",
  ]);
  const hasMarketOrPick = hasAnyKey(record, [
    "mercado",
    "market",
    "market_name",
    "marketName",
    "pick",
    "selecao",
    "selection",
    "selection_name",
    "outcome",
  ]);
  return hasOdd && hasMarketOrPick;
}

function isGameRecord(record: Record<string, unknown>) {
  return (
    isRecord(record.odds) &&
    (hasAnyKey(record, ["home", "mandante", "casa", "home_team", "time_casa"]) ||
      hasAnyKey(record, ["away", "visitante", "fora", "away_team", "time_fora"]) ||
      hasAnyKey(record, ["jogo", "game", "match"]))
  );
}

function normalizeVmRow(row: Record<string, unknown>, esporteHint?: string | null): NormalizedOdd {
  const mandante = requiredText(
    row.mandante ?? row.home ?? row.casa ?? row.home_team ?? row.time_casa,
    "",
  );
  const visitante = requiredText(
    row.visitante ?? row.away ?? row.fora ?? row.away_team ?? row.time_fora,
    "",
  );
  const rawRef = isRecord(row.raw_ref) ? row.raw_ref : { vm_row: row };
  const gameId =
    extractFlashscoreMatchId(row.fonte ?? row.source ?? row.url ?? row.link) ??
    toText(row.game_id ?? row.match_id ?? row.fixture_id ?? rawRef.game_id);
  const fonte = toText(row.fonte ?? row.source ?? row.url ?? row.link);
  if (gameId && !rawRef.game_id) rawRef.game_id = gameId;
  return {
    data: parseDate(row.data ?? row.date ?? row.match_date ?? row.event_date),
    hora: parseTime(row.hora ?? row.hour ?? row.time ?? row.match_time),
    esporte: normalizeSport(toText(row.esporte ?? row.sport) ?? esporteHint ?? null, row),
    liga: toText(row.liga ?? row.league),
    jogo: requiredText(
      row.jogo ?? row.game ?? row.match,
      mandante && visitante ? `${mandante} vs ${visitante}` : "Jogo sem nome",
    ),
    mandante,
    visitante,
    mercado: requiredText(
      row.mercado ?? row.market ?? row.market_name ?? row.marketName,
      "Mercado",
    ),
    pick: requiredText(
      row.pick ?? row.selecao ?? row.selection ?? row.selection_name ?? row.outcome,
      "Pick",
    ),
    linha: toText(row.linha ?? row.line ?? row.handicap ?? row.total),
    odd:
      toNumber(
        row.odd ??
          row.price ??
          row.odds ??
          row.cotacao ??
          row.cota ??
          row.decimal ??
          row.odd_decimal ??
          row.valor,
      ) ?? 0,
    odd_media: toNumber(row.odd_media ?? row.odd_avg),
    odd_mediana: toNumber(row.odd_mediana ?? row.odd_median),
    odd_minima: toNumber(row.odd_minima ?? row.odd_min),
    odd_maxima: toNumber(row.odd_maxima ?? row.odd_max),
    odd_melhor: toNumber(row.odd_melhor ?? row.odd_best),
    bookmaker_melhor: toText(row.bookmaker_melhor ?? row.bookmaker_best),
    odd_desvio_padrao: toNumber(row.odd_desvio_padrao ?? row.odd_std),
    casas_count: toNumber(row.casas_count ?? row.bookmakers_count),
    odds_disponiveis: toNumber(row.odds_disponiveis ?? row.odds_available),
    probabilidade_implicita_media: toNumber(
      row.probabilidade_implicita_media ?? row.market_prob_consensus_avg,
    ),
    probabilidade_implicita_mediana: toNumber(
      row.probabilidade_implicita_mediana ?? row.market_prob_consensus_median,
    ),
    margem_mercado_media: toNumber(row.margem_mercado_media ?? row.market_overround_avg),
    margem_mercado_mediana: toNumber(row.margem_mercado_mediana ?? row.market_overround_median),
    bookmaker: toText(row.bookmaker ?? row.book ?? row.casa_aposta ?? row.bookmaker_name),
    fonte: normalizeFlashscoreUrl(fonte) ?? fonte,
    capturado_em: parseCapturedAt(row.capturado_em ?? row.captured_at ?? row.updated_at ?? row.att),
    raw_ref: rawRef,
  };
}

function dedupeRows(rows: NormalizedOdd[]): { rows: NormalizedOdd[]; duplicated: number } {
  const seen = new Set<string>();
  const uniqueRows: NormalizedOdd[] = [];

  for (const row of rows) {
    const key = [
      row.data ?? "",
      row.hora ?? "",
      row.esporte ?? "",
      row.liga ?? "",
      row.jogo,
      row.mercado,
      row.pick,
      row.linha ?? "",
      row.bookmaker ?? "",
      row.odd,
    ]
      .join("|")
      .toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueRows.push(row);
  }

  return { rows: uniqueRows, duplicated: rows.length - uniqueRows.length };
}

export function toCsv(rows: NormalizedOdd[]): string {
  const headers = [
    "data",
    "hora",
    "esporte",
    "liga",
    "jogo",
    "mandante",
    "visitante",
    "mercado",
    "pick",
    "linha",
    "odd",
    "odd_media",
    "odd_mediana",
    "odd_minima",
    "odd_maxima",
    "odd_melhor",
    "bookmaker_melhor",
    "odd_desvio_padrao",
    "casas_count",
    "odds_disponiveis",
    "probabilidade_implicita_media",
    "probabilidade_implicita_mediana",
    "margem_mercado_media",
    "margem_mercado_mediana",
    "bookmaker",
    "fonte",
    "capturado_em",
  ];
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h as keyof NormalizedOdd])).join(",")),
  ].join("\n");
}

function toOddsJogoInsert(row: NormalizedOdd, coletaId: string) {
  return {
    coleta_id: coletaId,
    data: row.data,
    hora: row.hora,
    esporte: row.esporte,
    liga: row.liga,
    jogo: row.jogo,
    mandante: row.mandante,
    visitante: row.visitante,
    mercado: row.mercado,
    pick: row.pick,
    linha: row.linha,
    odd: row.odd,
    odd_media: row.odd_media ?? null,
    odd_mediana: row.odd_mediana ?? null,
    odd_minima: row.odd_minima ?? null,
    odd_maxima: row.odd_maxima ?? null,
    odd_melhor: row.odd_melhor ?? null,
    bookmaker_melhor: row.bookmaker_melhor ?? null,
    odd_desvio_padrao: row.odd_desvio_padrao ?? null,
    casas_count: row.casas_count ?? null,
    odds_disponiveis: row.odds_disponiveis ?? null,
    probabilidade_implicita_media: row.probabilidade_implicita_media ?? null,
    probabilidade_implicita_mediana: row.probabilidade_implicita_mediana ?? null,
    margem_mercado_media: row.margem_mercado_media ?? null,
    margem_mercado_mediana: row.margem_mercado_mediana ?? null,
    bookmaker: row.bookmaker,
    fonte: row.fonte,
    capturado_em: row.capturado_em,
    raw_ref: compactRawRef(row.raw_ref),
  };
}

function compactRawRef(
  rawRef: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!rawRef) return {};
  return {
    game_id: rawRef.game_id ?? null,
    source_url: rawRef.source_url ?? rawRef.url ?? rawRef.link ?? null,
    market: rawRef.market ?? null,
  };
}

function compactNormalizedRow(row: NormalizedOdd): NormalizedOdd {
  return {
    ...row,
    raw_ref: compactRawRef(row.raw_ref),
  };
}

function compactScreenerRow(row: NormalizedOdd): NormalizedOdd {
  return {
    data: row.data,
    hora: row.hora,
    esporte: row.esporte,
    liga: row.liga,
    jogo: row.jogo,
    mandante: row.mandante,
    visitante: row.visitante,
    mercado: row.mercado,
    pick: row.pick,
    linha: row.linha,
    odd: row.odd,
    odd_media: row.odd_media ?? null,
    odd_mediana: row.odd_mediana ?? null,
    odd_minima: row.odd_minima ?? null,
    odd_maxima: row.odd_maxima ?? null,
    odd_melhor: row.odd_melhor ?? null,
    bookmaker_melhor: row.bookmaker_melhor ?? null,
    casas_count: row.casas_count ?? null,
    odds_disponiveis: row.odds_disponiveis ?? null,
    bookmaker: row.bookmaker,
    fonte: row.fonte,
    capturado_em: row.capturado_em,
    raw_ref: compactRawRef(row.raw_ref),
  };
}

export function serializeNormalizedPreview(normalized: NormalizedCollection): string {
  return JSON.stringify({
    version: 1,
    saved_at: new Date().toISOString(),
    normalized: {
      ...normalized,
      rows: normalized.rows.map(compactScreenerRow),
    },
  });
}

export function parseStoredNormalizedPreview(payload: unknown): NormalizedCollection | null {
  const parsed = parseMaybeJson(payload);
  const root = isRecord(parsed) && "normalized" in parsed ? parsed.normalized : parsed;
  const normalized = normalizeVmNormalizedPayload(root);
  return normalized.total_odds ? normalized : null;
}

function compactNormalizedForStorage(normalized: NormalizedCollection, rows: NormalizedOdd[]) {
  const markets = Array.from(new Set(rows.map((row) => row.mercado).filter(Boolean)));
  const games = new Map<
    string,
    {
      jogo: string;
      mandante: string;
      visitante: string;
      data: string | null;
      hora: string | null;
      mercados: Set<string>;
    }
  >();
  for (const row of rows) {
    const key = [row.data ?? "", row.hora ?? "", row.jogo, row.mandante, row.visitante].join("|");
    const current = games.get(key) ?? {
      jogo: row.jogo,
      mandante: row.mandante,
      visitante: row.visitante,
      data: row.data,
      hora: row.hora,
      mercados: new Set<string>(),
    };
    if (row.mercado) current.mercados.add(row.mercado);
    games.set(key, current);
  }
  return {
    esporte: normalized.esporte,
    liga: normalized.liga,
    data_inicio: normalized.data_inicio,
    data_fim: normalized.data_fim,
    mercados: normalized.mercados,
    total_jogos: normalized.total_jogos,
    total_odds: rows.length,
    mercados_encontrados: markets,
    jogos: Array.from(games.values()).map((game) => ({
      ...game,
      mercados: Array.from(game.mercados),
    })),
    rows: rows.map(compactScreenerRow),
    aggregate_fields: [
      "odd_media",
      "odd_mediana",
      "odd_minima",
      "odd_maxima",
      "odd_melhor",
      "bookmaker_melhor",
      "casas_count",
      "odds_disponiveis",
      "probabilidade_implicita_media",
      "probabilidade_implicita_mediana",
      "margem_mercado_media",
      "margem_mercado_mediana",
    ],
  };
}

function compactRawForStorage(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const source = String(raw.source ?? raw.fonte ?? "").toLowerCase();
  const games = Array.isArray(raw.games) ? raw.games : Array.isArray(raw.jogos) ? raw.jogos : null;
  if (source !== "oddsagora" || !games) return raw;
  const compactGames = games.filter(isRecord).map((game) => {
    const markets = isRecord(game.markets) ? game.markets : {};
    const markets_summary = Object.fromEntries(
      Object.entries(markets).map(([market, rows]) => [
        market,
        Array.isArray(rows) ? rows.length : 0,
      ]),
    );
    return {
      game_id: game.game_id ?? game.id ?? null,
      date: game.date ?? game.data ?? null,
      time: game.time ?? game.hora ?? null,
      home_team: game.home_team ?? game.home ?? game.mandante ?? null,
      away_team: game.away_team ?? game.away ?? game.visitante ?? null,
      match_url: game.match_url ?? game.url ?? game.link ?? null,
      markets_summary,
    };
  });
  return {
    job_id: raw.job_id ?? null,
    source: raw.source ?? "OddsAgora",
    sport: raw.sport ?? raw.esporte ?? null,
    league: raw.league ?? raw.liga ?? null,
    created_at: raw.created_at ?? null,
    status: raw.status ?? null,
    mensagem: raw.mensagem ?? null,
    summary: raw.summary ?? null,
    games_count: compactGames.length,
    games: compactGames,
  };
}

async function insertOddsRowsInBatches(rows: NormalizedOdd[], coletaId: string) {
  for (let index = 0; index < rows.length; index += ODDS_INSERT_BATCH_SIZE) {
    const batch = rows
      .slice(index, index + ODDS_INSERT_BATCH_SIZE)
      .map((row) => toOddsJogoInsert(row, coletaId));
    const { error } = await coletaDb.from("odds_jogos").insert(batch);
    if (error) throw error;
  }
}

export function downloadText(filename: string, content: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function saveCollection(
  raw: unknown,
  normalized: NormalizedCollection,
  parametros: Record<string, unknown>,
) {
  const deduped = dedupeRows(normalized.rows);
  const compactRows = deduped.rows.map(compactNormalizedRow);
  const normalizedSnapshot = compactNormalizedForStorage(normalized, compactRows);
  const { data: coleta, error } = await coletaDb
    .from("coletas_odds")
    .insert({
      status: "PROCESSADO",
      esporte: normalized.esporte,
      liga: normalized.liga,
      data_inicio: normalized.data_inicio,
      data_fim: normalized.data_fim,
      mercados: normalized.mercados,
      parametros,
      raw_json: compactRawForStorage(raw),
      normalized_json: normalizedSnapshot,
      total_jogos: normalized.total_jogos,
      total_odds: deduped.rows.length,
      erro: null,
    })
    .select("*")
    .single();
  if (error) throw error;

  const coletaRow = coleta as ColetaOdds;
  if (deduped.rows.length) {
    await insertOddsRowsInBatches(deduped.rows, coletaRow.id);
  }

  return coletaRow;
}

export async function createRemoteCollection(params: {
  job_id: string;
  esporte: string;
  liga?: string | null;
  data_inicio?: string | null;
  data_fim?: string | null;
  mercados?: string[];
  bookmaker?: string | null;
  fonte?: string | null;
}) {
  const { data, error } = await coletaDb
    .from("coletas_odds")
    .insert({
      job_id: params.job_id,
      status: "PENDENTE",
      esporte: params.esporte,
      liga: params.liga || null,
      data_inicio: params.data_inicio || null,
      data_fim: params.data_fim || null,
      mercados: params.mercados ?? [],
      parametros: {
        origem: "api_vm",
        esporte: params.esporte,
        liga: params.liga || null,
        data_inicio: params.data_inicio || null,
        data_fim: params.data_fim || null,
        mercados: params.mercados ?? [],
        bookmaker: params.bookmaker || null,
        fonte: params.fonte || null,
      },
      total_jogos: 0,
      total_odds: 0,
      erro: null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as ColetaOdds;
}

export async function updateCollectionStatus(id: string, status: string, erro?: string | null) {
  const { error } = await coletaDb
    .from("coletas_odds")
    .update({ status, erro: erro ?? null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function completeRemoteCollection(
  coletaId: string,
  raw: unknown,
  normalized: NormalizedCollection,
  status = "CONCLUIDA",
): Promise<ImportResult> {
  const deduped = dedupeRows(normalized.rows);
  const compactRows = deduped.rows.map(compactNormalizedRow);
  const normalizedSnapshot = compactNormalizedForStorage(normalized, compactRows);
  const { error } = await coletaDb
    .from("coletas_odds")
    .update({
      status,
      esporte: normalized.esporte,
      liga: normalized.liga,
      data_inicio: normalized.data_inicio,
      data_fim: normalized.data_fim,
      mercados: normalized.mercados,
      raw_json: compactRawForStorage(raw),
      normalized_json: normalizedSnapshot,
      total_jogos: normalized.total_jogos,
      total_odds: deduped.rows.length,
      erro: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", coletaId);
  if (error) throw error;

  const { error: deleteError } = await coletaDb
    .from("odds_jogos")
    .delete()
    .eq("coleta_id", coletaId);
  if (deleteError) throw deleteError;

  if (deduped.rows.length) {
    await insertOddsRowsInBatches(deduped.rows, coletaId);
  }

  return { inserted: deduped.rows.length, duplicated: deduped.duplicated };
}

export async function fetchCollections(): Promise<ColetaOdds[]> {
  const { data, error } = await coletaDb
    .from("coletas_odds")
    .select(
      "id,job_id,status,esporte,liga,data_inicio,data_fim,mercados,parametros,total_jogos,total_odds,erro,created_at,updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as ColetaOdds[];
}

export async function fetchOddsRows(params: FetchOddsRowsParams = {}): Promise<OddsJogo[]> {
  let query = coletaDb
    .from("odds_jogos")
    .select(ODDS_JOGOS_LIST_COLUMNS)
    .order("created_at", { ascending: false });

  if (params.date) {
    query = query.eq("data", params.date);
  }

  const { data, error } = await query.limit(params.limit ?? 5000);
  if (error) throw error;
  const rows = filterOddsRowsForParams((data ?? []) as OddsJogo[], params);

  if (!params.includeCollectionFallback || rows.length || !params.date) {
    return rows;
  }

  const fallbackRows = await fetchOddsRowsFromCollectionPayloads(params);
  return filterOddsRowsForParams(fallbackRows, params);
}

async function fetchOddsRowsFromCollectionPayloads(
  params: FetchOddsRowsParams,
): Promise<OddsJogo[]> {
  let query = coletaDb
    .from("coletas_odds")
    .select(
      "id,job_id,status,esporte,liga,data_inicio,data_fim,raw_json,normalized_json,created_at,updated_at",
    )
    .order("created_at", { ascending: false });

  if (params.date) {
    query = query.lte("data_inicio", params.date).gte("data_fim", params.date);
  }

  const { data, error } = await query.limit(10);
  if (error) throw error;

  const rows: OddsJogo[] = [];
  for (const coleta of (data ?? []) as Array<Partial<ColetaOdds>>) {
    if (!collectionCanContainRows(coleta, params)) continue;
    const payloads = [coleta.raw_json, coleta.normalized_json];
    for (const payload of payloads) {
      const normalized = normalizeVmNormalizedPayload(payload, {
        esporte: coleta.esporte ?? params.esporte ?? null,
      });
      const payloadRows = filterOddsRowsForParams(
        normalized.rows.map((row, index) => ({
          ...row,
          raw_ref: {
            ...row.raw_ref,
            screener_source: "coletas_odds_payload",
          },
          id: `${coleta.id ?? "coleta"}:${rows.length + index}`,
          coleta_id: coleta.id ?? null,
          created_at: coleta.created_at ?? coleta.updated_at ?? new Date(0).toISOString(),
        })),
        params,
      );
      if (payloadRows.length) {
        rows.push(...payloadRows);
        break;
      }
    }
  }

  return dedupeOddsJogoRows(rows).slice(0, params.limit ?? rows.length);
}

function collectionCanContainRows(
  coleta: Partial<ColetaOdds>,
  params: FetchOddsRowsParams,
): boolean {
  const status = normalizeComparableText(coleta.status);
  if (/erro|cancel/.test(status)) return false;
  if (params.date && !dateWithinRange(params.date, coleta.data_inicio, coleta.data_fim))
    return false;
  if (params.esporte && coleta.esporte && !sportMatches(coleta.esporte, params.esporte))
    return false;
  if (params.liga && coleta.liga && !leagueMatches(coleta.liga, params.liga)) return false;
  return true;
}

function filterOddsRowsForParams(rows: OddsJogo[], params: FetchOddsRowsParams): OddsJogo[] {
  return rows.filter((row) => {
    if (params.date && !sameDate(row.data, params.date)) return false;
    if (params.esporte && !sportMatches(row.esporte, params.esporte)) return false;
    if (params.liga && !leagueMatches(row.liga, params.liga)) return false;
    return true;
  });
}

function dedupeOddsJogoRows(rows: OddsJogo[]): OddsJogo[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = [
      row.data ?? "",
      row.hora ?? "",
      row.esporte ?? "",
      row.liga ?? "",
      row.jogo,
      row.mercado,
      row.pick,
      row.linha ?? "",
      row.bookmaker ?? "",
      row.odd,
    ]
      .join("|")
      .toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sameDate(value: unknown, expected: string): boolean {
  return parseDate(value) === parseDate(expected);
}

function dateWithinRange(
  date: string,
  start: string | null | undefined,
  end: string | null | undefined,
): boolean {
  const target = parseDate(date);
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  if (!target) return true;
  if (startDate && target < startDate) return false;
  if (endDate && target > endDate) return false;
  return true;
}

function sportMatches(value: string | null | undefined, expected: string): boolean {
  const current = normalizeComparableText(value);
  const target = normalizeComparableText(expected);
  if (!current) return true;
  if (/baseball|beisebol|mlb/.test(target)) return /baseball|beisebol|mlb/.test(current);
  if (/basketball|basquete|nba|wnba/.test(target))
    return /basketball|basquete|nba|wnba/.test(current);
  if (/hockey|hoquei|nhl/.test(target)) return /hockey|hoquei|nhl/.test(current);
  if (/american football|futebol americano|nfl|ncaa/.test(target)) {
    return /american football|futebol americano|nfl|ncaa/.test(current);
  }
  if (/football|futebol|soccer/.test(target)) return /football|futebol|soccer/.test(current);
  return current === target || current.includes(target) || target.includes(current);
}

function leagueMatches(value: string | null | undefined, expected: string): boolean {
  const current = normalizeComparableText(value);
  const target = normalizeComparableText(expected);
  if (!current) return true;
  if (isAllLeagueValue(current)) return true;
  if (/mlb|major league baseball/.test(target)) return /mlb|major league baseball/.test(current);
  return current === target || current.includes(target) || target.includes(current);
}

function isAllLeagueValue(value: string): boolean {
  return /^(all|todos?|todas?|multiplas|multiple|varias?)$/.test(value);
}

function normalizeComparableText(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
