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

const coletaDb = supabase as unknown as {
  from: (table: string) => any;
};

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const n = Number(String(value).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
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
    if (flashscoreIdPattern.test(candidate) && !flashscoreTeamSlugPattern.test(candidate)) return candidate;
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] === "odds") break;
    if (flashscoreIdPattern.test(parts[i]) && !flashscoreTeamSlugPattern.test(parts[i])) return parts[i];
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
  const m = String(value).trim().match(/(\d{1,2}):(\d{2})/);
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

function getGames(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw.filter(isRecord);
  if (!isRecord(raw)) return [];
  if (isRecord(raw._default)) return Object.values(raw._default).filter(isRecord);
  if (Array.isArray(raw.games)) return raw.games.filter(isRecord);
  if (Array.isArray(raw.jogos)) return raw.jogos.filter(isRecord);
  return Object.values(raw).filter(isRecord);
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

function parseCapturedAt(value: unknown): string | null {
  if (!value) return null;
  const s = String(value);
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4].padStart(2, "0")}:${m[5]}:00`;
  return null;
}

function marketPick(market: string, header: string, base: { mandante: string; visitante: string }): string {
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

function normalizeMarketRows(game: Record<string, unknown>, esporteHint?: string | null): NormalizedOdd[] {
  const base = baseGame(game, esporteHint);
  const gameId =
    extractFlashscoreMatchId(game.link ?? game.url ?? game.fonte) ??
    toText(game.id ?? game.match_id ?? game.game_id ?? game.fixture_id);
  const odds = isRecord(game.odds) ? game.odds : {};
  const rows: NormalizedOdd[] = [];

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
          const linha = /asian handicap/i.test(marketName) && header === "2" ? invertLine(line) : line;
          rows.push({
            ...base,
            mercado: marketName,
            pick,
            linha: linha || null,
            odd,
            bookmaker: bookmaker || null,
            raw_ref: { game_id: gameId, market: marketName, period, header, row: item },
          });
        }
      }
    }
  }

  return rows;
}

export function normalizeOddsJson(raw: unknown, opts?: { esporte?: string | null }): NormalizedCollection {
  const games = getGames(raw);
  const rows = games.flatMap((game) => normalizeMarketRows(game, opts?.esporte));
  const dates = rows.map((row) => row.data).filter(Boolean).sort() as string[];
  const mercados = [...new Set(rows.map((row) => row.mercado).filter(Boolean))].sort();
  const ligas = [...new Set(rows.map((row) => row.liga).filter(Boolean))];
  const esportes = [...new Set(rows.map((row) => row.esporte).filter(Boolean))];
  return {
    esporte: esportes.length === 1 ? esportes[0] : opts?.esporte ?? null,
    liga: ligas.length === 1 ? ligas[0] : null,
    data_inicio: dates[0] ?? null,
    data_fim: dates[dates.length - 1] ?? null,
    mercados,
    total_jogos: games.length,
    total_odds: rows.length,
    rows,
  };
}

export function normalizeVmNormalizedPayload(payload: unknown, opts?: { esporte?: string | null }): NormalizedCollection {
  const root = isRecord(payload) ? payload : {};
  const nested = isRecord(root.data) ? root.data : isRecord(root.result) ? root.result : root;
  const linhas = Array.isArray(nested.linhas)
    ? nested.linhas
    : Array.isArray(nested.rows)
      ? nested.rows
      : Array.isArray(nested.normalized_json)
        ? nested.normalized_json
        : Array.isArray(payload)
          ? payload
          : [];

  const rows = linhas
    .filter(isRecord)
    .map((row) => normalizeVmRow(row, opts?.esporte))
    .filter((row) => row.odd > 0);
  const dates = rows.map((row) => row.data).filter(Boolean).sort() as string[];
  const mercados = [...new Set(rows.map((row) => row.mercado).filter(Boolean))].sort();
  const ligas = [...new Set(rows.map((row) => row.liga).filter(Boolean))];
  const esportes = [...new Set(rows.map((row) => row.esporte).filter(Boolean))];
  const jogos = new Set(
    rows
      .map((row) => (row.raw_ref?.game_id ? String(row.raw_ref.game_id) : `${row.data ?? ""}|${row.jogo}`))
      .filter(Boolean),
  );

  return {
    esporte: esportes.length === 1 ? esportes[0] : opts?.esporte ?? null,
    liga: ligas.length === 1 ? ligas[0] : null,
    data_inicio: dates[0] ?? null,
    data_fim: dates[dates.length - 1] ?? null,
    mercados,
    total_jogos: jogos.size,
    total_odds: rows.length,
    rows,
  };
}

function normalizeVmRow(row: Record<string, unknown>, esporteHint?: string | null): NormalizedOdd {
  const mandante = requiredText(row.mandante ?? row.home ?? row.casa, "");
  const visitante = requiredText(row.visitante ?? row.away ?? row.fora, "");
  const rawRef = isRecord(row.raw_ref) ? row.raw_ref : { vm_row: row };
  const gameId =
    extractFlashscoreMatchId(row.fonte ?? row.source ?? row.link ?? row.url) ??
    toText(row.game_id ?? row.match_id ?? row.fixture_id ?? rawRef.game_id);
  const fonte = toText(row.fonte ?? row.source ?? row.link ?? row.url);
  if (gameId && !rawRef.game_id) rawRef.game_id = gameId;
  return {
    data: parseDate(row.data ?? row.date),
    hora: parseTime(row.hora ?? row.hour ?? row.time),
    esporte: normalizeSport(toText(row.esporte ?? row.sport) ?? esporteHint ?? null, row),
    liga: toText(row.liga ?? row.league),
    jogo: requiredText(row.jogo ?? row.game, mandante && visitante ? `${mandante} vs ${visitante}` : "Jogo sem nome"),
    mandante,
    visitante,
    mercado: requiredText(row.mercado ?? row.market, "Mercado"),
    pick: requiredText(row.pick ?? row.selecao ?? row.selection, "Pick"),
    linha: toText(row.linha ?? row.line),
    odd: toNumber(row.odd ?? row.price ?? row.odds) ?? 0,
    bookmaker: toText(row.bookmaker ?? row.book ?? row.casa_aposta),
    fonte: normalizeFlashscoreUrl(fonte) ?? fonte,
    capturado_em: toText(row.capturado_em ?? row.captured_at) ?? parseCapturedAt(row.att),
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
    ].join("|").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueRows.push(row);
  }

  return { rows: uniqueRows, duplicated: rows.length - uniqueRows.length };
}

export function toCsv(rows: NormalizedOdd[]): string {
  const headers = ["data", "hora", "esporte", "liga", "jogo", "mandante", "visitante", "mercado", "pick", "linha", "odd", "bookmaker", "fonte", "capturado_em"];
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [headers.join(","), ...rows.map((row) => headers.map((h) => escape(row[h as keyof NormalizedOdd])).join(","))].join("\n");
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

export async function saveCollection(raw: unknown, normalized: NormalizedCollection, parametros: Record<string, unknown>) {
  const deduped = dedupeRows(normalized.rows);
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
      raw_json: raw,
      normalized_json: deduped.rows,
      total_jogos: normalized.total_jogos,
      total_odds: deduped.rows.length,
      erro: null,
    })
    .select("*")
    .single();
  if (error) throw error;

  if (deduped.rows.length) {
    const payload = deduped.rows.map((row) => ({ ...row, coleta_id: coleta.id }));
    const { error: rowsError } = await coletaDb.from("odds_jogos").insert(payload);
    if (rowsError) throw rowsError;
  }

  return coleta as ColetaOdds;
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
  const { error } = await coletaDb
    .from("coletas_odds")
    .update({
      status,
      esporte: normalized.esporte,
      liga: normalized.liga,
      data_inicio: normalized.data_inicio,
      data_fim: normalized.data_fim,
      mercados: normalized.mercados,
      raw_json: raw,
      normalized_json: deduped.rows,
      total_jogos: normalized.total_jogos,
      total_odds: deduped.rows.length,
      erro: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", coletaId);
  if (error) throw error;

  const { error: deleteError } = await coletaDb.from("odds_jogos").delete().eq("coleta_id", coletaId);
  if (deleteError) throw deleteError;

  if (deduped.rows.length) {
    const payload = deduped.rows.map((row) => ({ ...row, coleta_id: coletaId }));
    const { error: rowsError } = await coletaDb.from("odds_jogos").insert(payload);
    if (rowsError) throw rowsError;
  }

  return { inserted: deduped.rows.length, duplicated: deduped.duplicated };
}

export async function fetchCollections(): Promise<ColetaOdds[]> {
  const { data, error } = await coletaDb
    .from("coletas_odds")
    .select("id,job_id,status,esporte,liga,data_inicio,data_fim,mercados,parametros,total_jogos,total_odds,erro,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as ColetaOdds[];
}

export async function fetchOddsRows(): Promise<OddsJogo[]> {
  const { data, error } = await coletaDb
    .from("odds_jogos")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) throw error;
  return (data ?? []) as OddsJogo[];
}
