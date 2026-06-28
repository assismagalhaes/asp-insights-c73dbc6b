/**
 * ASP Validator — parser de texto colado (Gemini / ChatGPT / PackBall / OCR externo).
 *
 * Converte um bloco de texto livre em estrutura compativel com StructuredValidatorJson:
 *   - match, market, corners.home/away (medias gerais + casa/fora, over/under, race, first, 1x2)
 *   - prediction (odds, probabilidade, EV)
 *   - input_source: "pasted_text", extracted_from_ocr: false
 *
 * Mantem o EV no formato original (0.18 → 0.18%, NAO 18%).
 * Mapeia +N escanteios → Over N.5 e -N → Under N.5.
 */

import {
  detectFootballMarketType,
  type FootballMarketType,
  type FootballPeriod,
  type ValidatorModel,
} from "./asp-validator-market-detector";
import {
  parseFootballGoalsData,
  parseFootballCardsData,
  parseFootballGeneralPerformance,
  parseFootballBttsData,
  partitionByLocationScope,
  type GoalsBlock,
  type CardsBlock,
  type GeneralPerformanceBlock,
  type BttsBlock,
} from "./asp-validator-football-parsers";



export type PasteCornerLines = Record<string, number>;

export type PasteCornerSide = {
  total_for: number | null;
  total_against: number | null;
  total_corners: number | null;
  avg_for: number | null;
  avg_against: number | null;
  avg_total: number | null;
  home_away_avg_for: number | null;
  home_away_avg_against: number | null;
  home_away_avg_total: number | null;
  first_corner_pct: number | null;
  race_to_3_pct: number | null;
  race_to_5_pct: number | null;
  race_to_7_pct: number | null;
  race_to_9_pct: number | null;
  most_corners_1x2_pct: number | null;
  over_lines: PasteCornerLines;
  under_lines: PasteCornerLines;
  home_away_over_lines: PasteCornerLines;
  home_away_under_lines: PasteCornerLines;
  normalized_market_lines: Array<{
    label: string;
    side: "over" | "under";
    line_value: number;
    market_normalized: string;
    value_pct: number;
    scope: "general" | "home_away";
  }>;
};

export type PasteFormPatch = {
  sport: string;
  league: string;
  match_date: string; // YYYY-MM-DD
  match_time: string; // HH:mm
  home_team: string;
  away_team: string;
  market: string;
  pick: string;
  line: string;
  offered_odd: string;
  source_probability: string;
  source_ev: string;
};

export type PastedParsedData = {
  input_source: "pasted_text";
  extracted_from_ocr: false;
  raw_pasted_text: string;
  data_quality_score: number;
  structured_fields_count: number;
  has_structured_ocr_data: boolean;
  missing_critical_fields: string[];
  match: {
    sport: string;
    competition: string;
    round: string;
    date: string; // DD/MM/YYYY
    time: string; // HH:mm
    home_team: string;
    away_team: string;
  };
  market: {
    name: string;
    normalized_market: string;
    line: number | null;
    pick: string;
    offered_odd: number | null;
    fair_odd_original: number | null;
    probability_original: number | null;
    ev_original: number | null;
    market_normalized: string;
  };
  corners: {
    general: { home: PasteCornerSide; away: PasteCornerSide };
    home_away: { home: PasteCornerSide; away: PasteCornerSide };
    home: PasteCornerSide; // alias para compatibilidade com runAspValidatorSimulation
    away: PasteCornerSide; // alias para compatibilidade com runAspValidatorSimulation
  };
  prediction: {
    market: string;
    pick: string;
    line: number | null;
    offered_odd: number | null;
    source_probability: number | null;
    source_ev: number | null;
    source_fair_odd: number | null;
    source_ev_raw: number | null;
    source_ev_display: string | null;
    source_ev_type: "percent" | "odd_gap_or_unknown" | null;
    calculated_ev_pct: number | null;
    odd_gap: number | null;
    home_moneyline_odd: number | null;
    away_moneyline_odd: number | null;
  };
  fixture: {
    league: string;
    date: string;
    home_team: string;
    away_team: string;
  };
  form_patch: PasteFormPatch;
  notes: string[];
  market_type: FootballMarketType | null;
  period: FootballPeriod;
  pick_normalized: string;
  validator_model: ValidatorModel;
  goals: GoalsBlock | null;
  cards: CardsBlock | null;
  general_performance: GeneralPerformanceBlock | null;
  general_performance_home_away: GeneralPerformanceBlock | null;
  btts: BttsBlock | null;
  btts_home_away: BttsBlock | null;
};


function emptySide(): PasteCornerSide {
  return {
    total_for: null,
    total_against: null,
    total_corners: null,
    avg_for: null,
    avg_against: null,
    avg_total: null,
    home_away_avg_for: null,
    home_away_avg_against: null,
    home_away_avg_total: null,
    first_corner_pct: null,
    race_to_3_pct: null,
    race_to_5_pct: null,
    race_to_7_pct: null,
    race_to_9_pct: null,
    most_corners_1x2_pct: null,
    over_lines: {},
    under_lines: {},
    home_away_over_lines: {},
    home_away_under_lines: {},
    normalized_market_lines: [],
  };
}

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Normaliza texto colado em formato compacto (uma unica linha longa ou
 * blocos sem quebras) para o formato que os extratores esperam. NAO altera
 * conteudo, apenas reintroduz quebras logicas antes de cabecalhos, titulos
 * de secao, bullets e linhas de mercado.
 */
export function normalizeCompactPastedText(raw: string): string {
  if (!raw) return "";
  let t = raw.replace(/\r\n?/g, "\n");

  // Separadores principais
  t = t
    .replace(/\s+(Partida\s*:)/gi, "\n$1")
    .replace(/\s+(Campeonato\s*:)/gi, "\n$1")
    .replace(/\s+(Data\s*\/\s*Hora\s*:)/gi, "\n$1")
    .replace(/\s+(Filtro\s*:)/gi, "\n$1")
    .replace(/\s+(Mercado\s*:)/gi, "\n$1")
    .replace(/\s+(Pick\s*:)/gi, "\n$1")
    .replace(/\s+(Odd\s+(?:Oferecida|Ofertada|Esperada|Justa)\s*:)/gi, "\n$1")
    .replace(/\s+(Chance\s*\(?%?\)?\s*:)/gi, "\n$1")
    .replace(/\s+(Probabilidade\s*:)/gi, "\n$1")
    .replace(/\s+(EV\s*:)/gi, "\n$1")
    .replace(/\s+(VE\s*:)/gi, "\n$1");

  // Titulos de secao "--- ... ---"
  t = t.replace(/\s+(---\s*[^-\n]+?\s*---)/g, "\n\n$1\n");

  // Cabecalhos de time antes de metricas inline
  t = t
    .replace(
      /\s+([A-Za-zÀ-ÿ0-9 .'-]+?(?:\s*\((?:Casa|Fora|Casa\s*\/\s*Fora)\))?\s*:)\s+-\s+(Marcados\s*:)/g,
      "\n$1\n  - $2",
    )
    .replace(
      /\s+([A-Za-zÀ-ÿ0-9 .'-]+?(?:\s*\((?:Casa|Fora|Casa\s*\/\s*Fora)\))?\s*:)\s+-\s+(Vit[oó]rias\s*:)/g,
      "\n$1\n  - $2",
    )
    .replace(
      /\s+([A-Za-zÀ-ÿ0-9 .'-]+?(?:\s*\((?:Casa|Fora|Casa\s*\/\s*Fora)\))?\s*:)\s+-\s+(Amarelos?\s*:|Vermelhos?\s*:|Total\s+cart[oõ]es\s*:)/gi,
      "\n$1\n  - $2",
    );

  // Bullets de metricas comuns
  t = t
    .replace(/\s+-\s+(Marcados\s*:)/gi, "\n  - $1")
    .replace(/\s+-\s+(Sofridos\s*:)/gi, "\n  - $1")
    .replace(/\s+-\s+(Total(?:\s*\([^)]*\))?\s*:)/gi, "\n  - $1")
    .replace(/\s+-\s+(Vit[oó]rias\s*:)/gi, "\n  - $1")
    .replace(/\s+-\s+(Empates\s*:)/gi, "\n  - $1")
    .replace(/\s+-\s+(Derrotas\s*:)/gi, "\n  - $1")
    .replace(/\s+-\s+(Efici[eê]ncia\s*:)/gi, "\n  - $1")
    .replace(/\s+-\s+(Aproveitamento\s*:)/gi, "\n  - $1");

  // Linhas de mercado
  t = t
    .replace(/\s+(Mais\s+de\s+\d+(?:[.,]\d+)?\s*(?:gols?|escanteios?|cart[oõ]es?)?\s*:)/gi, "\n$1")
    .replace(/\s+(Menos\s+de\s+\d+(?:[.,]\d+)?\s*(?:gols?|escanteios?|cart[oõ]es?)?\s*:)/gi, "\n$1")
    .replace(/\s+(Over\s+\d+(?:[.,]\d+)?\s*:)/gi, "\n$1")
    .replace(/\s+(Under\s+\d+(?:[.,]\d+)?\s*:)/gi, "\n$1")
    .replace(/\s+(Sim\s*:)/gi, "\n$1")
    .replace(/\s+(N[aã]o\s*:)/gi, "\n$1");

  // Posse e placares
  t = t
    .replace(/\s+(Porcentagem\s*:)/gi, "\n$1")
    .replace(/\s+(M[ée]dia\s+posse\s+de\s+bola[^:]*:)/gi, "\n$1")
    .replace(/\s+(Mais\s+posse\s+de\s+bola\s*\(?1X2\)?\s*:)/gi, "\n$1")
    .replace(/\s+(Placares?\s*:)/gi, "\n$1")
    .replace(/\s+-\s+(\d+\s*x\s*\d+\s*:)/g, "\n  - $1");

  // Race / corrida ate N
  t = t.replace(/\s+-?\s+(\d+\s+escanteios?\s*:)/gi, "\n  - $1");

  // Reduz excesso de linhas em branco
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  return t;
}

function teamKey(s: string): string {
  return normalize(s).replace(/[^a-z0-9]/g, "");
}

function parseNum(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const v = Number(String(raw).replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

function brDateToIso(date: string): string {
  const m = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

function normalizeCornerLine(label: string, side: "over" | "under"): { line_value: number; market_normalized: string } {
  const num = Number(label.replace(/[^0-9.]/g, ""));
  const isInteger = !label.includes(".");
  const line_value = isInteger ? num + 0.5 : num;
  const prefix = side === "over" ? "Mais de" : "Menos de";
  return { line_value, market_normalized: `${prefix} ${line_value} escanteios` };
}

/**
 * Para uma linha do tipo "Mais de 9.5: Atlético GO 100% | Ponte Preta 80%"
 * retorna { home: 100, away: 80, line: "9.5" }.
 */
function parseTwoSidedPercentLine(
  line: string,
  homeTeam: string,
  awayTeam: string,
): { home: number | null; away: number | null } {
  const hKey = teamKey(homeTeam);
  const aKey = teamKey(awayTeam);
  const parts = line.split(/\s*\|\s*/);
  let home: number | null = null;
  let away: number | null = null;
  for (const part of parts) {
    const pct = part.match(/(-?\d+(?:[.,]\d+)?)\s*%/);
    if (!pct) continue;
    const value = parseNum(pct[1]);
    const key = teamKey(part);
    if (hKey && key.includes(hKey)) home = value;
    else if (aKey && key.includes(aKey)) away = value;
    else if (home === null) home = value;
    else if (away === null) away = value;
  }
  return { home, away };
}

/**
 * Extrai blocos por time: linhas iniciando com "TeamName:" ou "TeamName (Casa):" ate
 * proxima ocorrencia de time/secao/linha em branco dupla.
 */
function extractTeamBlocks(text: string, team: string): string[] {
  const tKey = teamKey(team);
  if (!tKey) return [];
  const lines = text.split(/\r?\n/);
  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const stripped = line.replace(/\s*\([^)]*\)\s*$/, "").trim();
    const isHeader = /:\s*$/.test(stripped) && teamKey(stripped).includes(tKey);
    if (!isHeader) {
      i += 1;
      continue;
    }
    const buf: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      if (/^\s*$/.test(next)) break;
      // Stop when a new "Team:" header line appears
      if (/:\s*$/.test(next.trim()) && !/^\s*-/.test(next)) break;
      // Stop when next section marker
      if (/^---/.test(next.trim())) break;
      buf.push(next);
      j += 1;
    }
    blocks.push(buf.join("\n"));
    i = j;
  }
  return blocks;
}

function parseSideFromBlock(block: string): {
  marcados: number | null;
  sofridos: number | null;
  total: number | null;
  isAverage: boolean;
} {
  const marcados = parseNum(block.match(/Marcados\s*:?\s*(-?\d+(?:[.,]\d+)?)/i)?.[1]);
  const sofridos = parseNum(block.match(/Sofridos\s*:?\s*(-?\d+(?:[.,]\d+)?)/i)?.[1]);
  const total = parseNum(block.match(/Total(?:\s*\([^)]*\))?\s*:?\s*(-?\d+(?:[.,]\d+)?)/i)?.[1]);
  const isAverage =
    (marcados !== null && !Number.isInteger(marcados)) ||
    (sofridos !== null && !Number.isInteger(sofridos)) ||
    (total !== null && !Number.isInteger(total));
  return { marcados, sofridos, total, isAverage };
}

function fillSideFromText(side: PasteCornerSide, sectionText: string, team: string, otherTeam: string, scope: "general" | "home_away"): void {
  // 1) blocos TIME: ... (totais inteiros vs medias decimais)
  for (const block of extractTeamBlocks(sectionText, team)) {
    const parsed = parseSideFromBlock(block);
    if (parsed.isAverage) {
      if (scope === "general") {
        side.avg_for = side.avg_for ?? parsed.marcados;
        side.avg_against = side.avg_against ?? parsed.sofridos;
        side.avg_total = side.avg_total ?? parsed.total;
      } else {
        side.home_away_avg_for = side.home_away_avg_for ?? parsed.marcados;
        side.home_away_avg_against = side.home_away_avg_against ?? parsed.sofridos;
        side.home_away_avg_total = side.home_away_avg_total ?? parsed.total;
      }
    } else {
      side.total_for = side.total_for ?? parsed.marcados;
      side.total_against = side.total_against ?? parsed.sofridos;
      side.total_corners = side.total_corners ?? parsed.total;
    }
  }

  // 2) Over/Under: "Mais de 9.5: Atlético GO 100% | Ponte Preta 80%"
  for (const line of sectionText.split(/\r?\n/)) {
    const overM = line.match(/^\s*(?:Mais\s+de|Over|\+)\s*(\d+(?:[.,]\d+)?)\s*[:\-]?\s*(.+)$/i);
    const underM = line.match(/^\s*(?:Menos\s+de|Under|-)\s*(\d+(?:[.,]\d+)?)\s*[:\-]?\s*(.+)$/i);
    if (overM) {
      const lineKey = overM[1].replace(",", ".");
      const sides = parseTwoSidedPercentLine(overM[2], team, otherTeam);
      const value = sides.home; // "home" here = the team whose name appears first/matched
      if (value !== null) {
        if (scope === "general") side.over_lines[lineKey] = value;
        else side.home_away_over_lines[lineKey] = value;
      }
    } else if (underM) {
      const lineKey = underM[1].replace(",", ".");
      const sides = parseTwoSidedPercentLine(underM[2], team, otherTeam);
      const value = sides.home;
      if (value !== null) {
        if (scope === "general") side.under_lines[lineKey] = value;
        else side.home_away_under_lines[lineKey] = value;
      }
    }
  }

  // 3) Marcou primeiro / Mais escanteios 1x2: blocos com "- Atlético GO: 80%"
  const firstSect = sectionText.match(/Marcou\s+o?\s*primeiro\s+escanteio:?([\s\S]*?)(?:Corrida|Mais\s+escanteios|---|\n\n|$)/i)?.[1] ?? "";
  const firstVal = extractTeamPercent(firstSect, team);
  if (firstVal !== null) side.first_corner_pct = side.first_corner_pct ?? firstVal;

  const mostSect = sectionText.match(/Mais\s+escanteios\s+no\s+jogo[^\n]*([\s\S]*?)(?:---|Partida|$)/i)?.[1] ?? "";
  const mostVal = extractTeamPercent(mostSect, team);
  if (mostVal !== null) side.most_corners_1x2_pct = side.most_corners_1x2_pct ?? mostVal;

  // 4) Race to N
  for (const line of sectionText.split(/\r?\n/)) {
    const m = line.match(/^\s*-?\s*(\d+)\s*escanteios?\s*:\s*(.+)$/i);
    if (!m) continue;
    const n = Number(m[1]);
    if (![3, 5, 7, 9].includes(n)) continue;
    const sides = parseTwoSidedPercentLine(m[2], team, otherTeam);
    const value = sides.home;
    if (value === null) continue;
    const key = `race_to_${n}_pct` as keyof PasteCornerSide;
    // @ts-expect-error dynamic assignment
    if (side[key] == null) side[key] = value;
  }
}

function extractTeamPercent(block: string, team: string): number | null {
  const tKey = teamKey(team);
  if (!tKey) return null;
  for (const line of block.split(/\r?\n/)) {
    if (!teamKey(line).includes(tKey)) continue;
    const pct = line.match(/(-?\d+(?:[.,]\d+)?)\s*%/);
    if (pct) return parseNum(pct[1]);
  }
  return null;
}

function buildNormalizedLines(side: PasteCornerSide): PasteCornerSide["normalized_market_lines"] {
  const out: PasteCornerSide["normalized_market_lines"] = [];
  const push = (lineKey: string, value_pct: number, dir: "over" | "under", scope: "general" | "home_away") => {
    const { line_value, market_normalized } = normalizeCornerLine(lineKey, dir);
    out.push({
      label: `${dir === "under" ? "-" : "+"}${lineKey}`,
      side: dir,
      line_value,
      market_normalized,
      value_pct,
      scope,
    });
  };
  for (const [k, v] of Object.entries(side.over_lines)) push(k, v, "over", "general");
  for (const [k, v] of Object.entries(side.under_lines)) push(k, v, "under", "general");
  for (const [k, v] of Object.entries(side.home_away_over_lines)) push(k, v, "over", "home_away");
  for (const [k, v] of Object.entries(side.home_away_under_lines)) push(k, v, "under", "home_away");
  return out;
}

function countNonNull(obj: unknown): number {
  if (obj === null || obj === undefined || obj === "") return 0;
  if (typeof obj === "number") return Number.isFinite(obj) ? 1 : 0;
  if (typeof obj === "string") return obj.trim() ? 1 : 0;
  if (Array.isArray(obj)) return obj.reduce<number>((acc, v) => acc + countNonNull(v), 0);
  if (typeof obj === "object") return Object.values(obj as Record<string, unknown>).reduce<number>((acc, v) => acc + countNonNull(v), 0);
  return 0;
}

function extractPerformanceScopeTexts(text: string): { generalText: string; homeAwayText: string } {
  const starts = [...text.matchAll(/^\s*---\s*DESEMPENHO\s+GERAL[^(\n]*(?:\([^\n]*\))?\s*---\s*$/gim)];
  if (starts.length === 0) return { generalText: "", homeAwayText: "" };

  const generalChunks: string[] = [];
  const homeAwayChunks: string[] = [];

  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i].index ?? 0;
    const nextStart = i + 1 < starts.length ? (starts[i + 1].index ?? text.length) : text.length;
    const previousPartida = text.lastIndexOf("Partida:", start);
    const previousFiltro = text.lastIndexOf("Filtro:", start);
    const contextStart = Math.max(0, previousPartida, previousFiltro);
    const chunk = text.slice(contextStart, nextStart);
    const firstHeader = chunk.match(/Filtro\s*:\s*([^\n\r]+)/i)?.[1] ?? chunk.slice(0, 260);
    const isHomeAway = /casa\s*\/\s*fora/i.test(firstHeader);
    if (isHomeAway) homeAwayChunks.push(chunk);
    else generalChunks.push(chunk);
  }

  const chooseChunk = (chunks: string[]) => {
    const withFt = chunks.filter((chunk) => /\bft\b|jogo\s+completo|full\s*time/i.test(chunk.match(/Filtro\s*:\s*([^\n\r]+)/i)?.[1] ?? chunk));
    return (withFt.at(-1) ?? chunks.at(-1) ?? "") + "\n";
  };

  return { generalText: chooseChunk(generalChunks), homeAwayText: chooseChunk(homeAwayChunks) };
}

function inferSport(market: string): string {
  const n = normalize(market);
  if (n.includes("escanteio") || n.includes("corner") || n.includes("gol") || n.includes("btts")) return "Futebol";
  return "Futebol";
}

function classifyMarket(rawMarket: string): { name: string; pick: string; line: number | null; normalized: string } {
  const m = rawMarket.trim();
  const lineN = parseNum(m.match(/(\d+(?:[.,]\d+)?)/)?.[1]);
  const n = normalize(m);
  if (n.includes("escanteio") || n.includes("corner") || n.includes("canto")) {
    const isUnder = n.includes("menos") || n.includes("under");
    const pick = m;
    const name = "Escanteios";
    const dir = isUnder ? "under" : "over";
    const normalized = lineN !== null ? (dir === "over" ? `Mais de ${lineN} escanteios` : `Menos de ${lineN} escanteios`) : m;
    return { name, pick, line: lineN, normalized };
  }
  return { name: m, pick: m, line: lineN, normalized: m };
}

export function parsePastedPrognostico(raw: string): PastedParsedData {
  const text = (raw || "").trim();
  const notes: string[] = [];

  // --- Cabecalho do prognostico ---
  // Aceita "Cusco FC (2.62) x Cienciano (2.44)" e tambem "TimeA x TimeB"
  const cleanTeamName = (s: string): string =>
    s.replace(/\(\s*\d+(?:[.,]\d+)?\s*\)/g, "").replace(/\s+/g, " ").trim();
  const extractOdd = (s: string): number | null =>
    parseNum(s.match(/\(\s*(\d+(?:[.,]\d+)?)\s*\)/)?.[1] ?? null);

  const partidaLine =
    text.match(/Partida\s*:\s*([^\n\r]+)/i)?.[1] ??
    text.match(/^\s*([^\n\r]+?\s+(?:x|vs)\s+[^\n\r]+)\s*$/im)?.[1] ??
    "";
  const fixtureSplit = partidaLine.match(/^\s*(.+?)\s+(?:x|vs)\s+(.+?)\s*$/i);
  const homeRaw = fixtureSplit?.[1] ?? "";
  const awayRaw = fixtureSplit?.[2] ?? "";
  const home_team = cleanTeamName(homeRaw);
  const away_team = cleanTeamName(awayRaw);
  const home_moneyline_odd = extractOdd(homeRaw);
  const away_moneyline_odd = extractOdd(awayRaw);

  const compM = text.match(/Campeonato\s*:\s*([^\n\r]+)/i);
  let competition = "";
  let round = "";
  if (compM) {
    const value = compM[1].trim();
    const parts = value.split(/-\s*Rodada\s*:?\s*/i);
    competition = (parts[0] ?? "").trim();
    round = (parts[1] ?? "").trim();
  }

  const dateM = text.match(/Data\/Hora\s*:\s*(\d{2}\/\d{2}\/\d{4})(?:\s+(\d{1,2}:\d{2}))?/i);
  const date = dateM?.[1] ?? "";
  const time = dateM?.[2] ?? "";

  const marketRaw = text.match(/Mercado\s*:\s*([^\n\r]+)/i)?.[1]?.trim() ?? "";
  const marketInfo = classifyMarket(marketRaw);
  const detection = detectFootballMarketType(text, marketRaw, marketInfo.pick, home_team, away_team);


  const probability = parseNum(
    text.match(/Chance\s*\(?%?\)?\s*:\s*(-?\d+(?:[.,]\d+)?)/i)?.[1] ??
      text.match(/Probabilidade\s*:\s*(-?\d+(?:[.,]\d+)?)/i)?.[1],
  );
  const offered_odd = parseNum(text.match(/Odd\s+(?:Oferecida|Ofertada|Oferecidas)\s*:\s*(-?\d+(?:[.,]\d+)?)/i)?.[1]);
  const fair_odd = parseNum(
    text.match(/Odd\s+Esperada(?:\s*\(VE\))?\s*:\s*(-?\d+(?:[.,]\d+)?)/i)?.[1] ??
      text.match(/Odd\s+Justa\s*:\s*(-?\d+(?:[.,]\d+)?)/i)?.[1],
  );
  // EV bruto da fonte (PackBall pode mandar "0.47" como gap odd-odd, nao percentual real).
  const ev_raw_match = text.match(/\bEV\s*:\s*(-?\d+(?:[.,]\d+)?)/i) ?? text.match(/\bVE\s*:\s*(-?\d+(?:[.,]\d+)?)/i);
  const ev_original = parseNum(ev_raw_match?.[1]);
  const ev_display = ev_raw_match?.[1] ?? null;

  // EV recalculado pelo ASP: EV% = (probabilidade × odd ofertada) - 1, em %.
  const calculated_ev_pct =
    probability !== null && offered_odd !== null
      ? Math.round(((probability / 100) * offered_odd - 1) * 10000) / 100
      : null;
  const odd_gap =
    offered_odd !== null && fair_odd !== null
      ? Math.round((offered_odd - fair_odd) * 100) / 100
      : null;
  // Classifica o EV bruto: se ele bate (aprox.) com calculated_ev_pct → percentual real;
  // se bate com odd_gap → gap de odd; caso contrario, desconhecido.
  let source_ev_type: "percent" | "odd_gap_or_unknown" | null = null;
  if (ev_original !== null) {
    if (calculated_ev_pct !== null && Math.abs(ev_original - calculated_ev_pct) <= 1.5) source_ev_type = "percent";
    else if (odd_gap !== null && Math.abs(ev_original - odd_gap) <= 0.05) source_ev_type = "odd_gap_or_unknown";
    else source_ev_type = "odd_gap_or_unknown";
  }

  // --- Particiona em "Todos os locais" (geral) e "Casa/Fora" (home_away),
  //     respeitando ordem intercalada das secoes (Total Gols, Ambas Marcam, etc.) ---
  const { generalText, homeAwayText } = partitionByLocationScope(text);
  const hasHomeAwaySection = homeAwayText.trim().length > 0;


  const general = { home: emptySide(), away: emptySide() };
  fillSideFromText(general.home, generalText, home_team, away_team, "general");
  fillSideFromText(general.away, generalText, away_team, home_team, "general");

  const homeAway = { home: emptySide(), away: emptySide() };
  if (homeAwayText) {
    fillSideFromText(homeAway.home, homeAwayText, home_team, away_team, "home_away");
    fillSideFromText(homeAway.away, homeAwayText, away_team, home_team, "home_away");
    // Espelhar campos casa/fora nos sides "general" para o simulador (que le home_away_avg_total etc.)
    general.home.home_away_avg_for = homeAway.home.home_away_avg_for ?? homeAway.home.avg_for;
    general.home.home_away_avg_against = homeAway.home.home_away_avg_against ?? homeAway.home.avg_against;
    general.home.home_away_avg_total = homeAway.home.home_away_avg_total ?? homeAway.home.avg_total;
    general.home.home_away_over_lines = { ...homeAway.home.home_away_over_lines, ...homeAway.home.over_lines };
    general.home.home_away_under_lines = { ...homeAway.home.home_away_under_lines, ...homeAway.home.under_lines };
    general.away.home_away_avg_for = homeAway.away.home_away_avg_for ?? homeAway.away.avg_for;
    general.away.home_away_avg_against = homeAway.away.home_away_avg_against ?? homeAway.away.avg_against;
    general.away.home_away_avg_total = homeAway.away.home_away_avg_total ?? homeAway.away.avg_total;
    general.away.home_away_over_lines = { ...homeAway.away.home_away_over_lines, ...homeAway.away.over_lines };
    general.away.home_away_under_lines = { ...homeAway.away.home_away_under_lines, ...homeAway.away.under_lines };
  }

  general.home.normalized_market_lines = buildNormalizedLines(general.home);
  general.away.normalized_market_lines = buildNormalizedLines(general.away);

  const sport = inferSport(marketRaw);
  const league = [competition, round ? `Rodada ${round}` : ""].filter(Boolean).join(" - ");

  const form_patch: PasteFormPatch = {
    sport,
    league: competition,
    match_date: brDateToIso(date),
    match_time: time,
    home_team,
    away_team,
    market: marketInfo.name,
    pick: marketInfo.pick,
    line: marketInfo.line !== null ? String(marketInfo.line) : "",
    offered_odd: offered_odd !== null ? String(offered_odd) : "",
    source_probability: probability !== null ? String(probability) : "",
    source_ev: ev_original !== null ? String(ev_original) : "",
  };

  const corners = {
    general,
    home_away: homeAway,
    home: general.home,
    away: general.away,
  };

  const goalsBlock: GoalsBlock | null =
    detection.market_type === "goals_total" ||
    detection.market_type === "btts" ||
    detection.market_type === "x1x2" ||
    detection.market_type === "double_chance"
      ? parseFootballGoalsData(text, home_team, away_team, detection.period)
      : null;
  const cardsBlock: CardsBlock | null =
    detection.market_type === "cards"
      ? parseFootballCardsData(text, home_team, away_team, detection.period)
      : null;
  const wantsGeneralPerf =
    detection.market_type === "x1x2" ||
    detection.market_type === "double_chance" ||
    detection.market_type === "goals_total" ||
    detection.market_type === "btts";
  let generalPerf: GeneralPerformanceBlock | null = wantsGeneralPerf
    ? parseFootballGeneralPerformance(generalText, home_team, away_team, detection.period)
    : null;
  // Fallback: se o bloco "Desempenho geral" aparece sem o marcador "(Todos os locais)",
  // ele pode nao cair em generalText. Reparseia do texto completo nesse caso.
  const isPerfEmpty = (b: GeneralPerformanceBlock | null) =>
    !b ||
    (b.home.wins === null && b.home.draws === null && b.home.losses === null &&
      b.home.efficiency_pct === null && b.home.avg_possession_pct === null &&
      b.away.wins === null && b.away.draws === null && b.away.losses === null &&
      b.away.efficiency_pct === null && b.away.avg_possession_pct === null);
  if (wantsGeneralPerf && isPerfEmpty(generalPerf)) {
    const performanceBlocks = extractPerformanceScopeTexts(text);
    if (performanceBlocks.generalText) {
      generalPerf = parseFootballGeneralPerformance(performanceBlocks.generalText, home_team, away_team, detection.period);
    }
  }
  const performanceBlocks = wantsGeneralPerf ? extractPerformanceScopeTexts(text) : { generalText: "", homeAwayText: "" };
  const generalPerfHA: GeneralPerformanceBlock | null = wantsGeneralPerf
    ? parseFootballGeneralPerformance(performanceBlocks.homeAwayText || homeAwayText, home_team, away_team, detection.period)
    : null;
  const bttsBlock: BttsBlock | null = goalsBlock ? parseFootballBttsData(goalsBlock) : null;
  const bttsBlockHA: BttsBlock | null = goalsBlock
    ? {
        home: {
          yes_pct: goalsBlock.home_away.home.btts_yes_pct,
          no_pct: goalsBlock.home_away.home.btts_no_pct,
          first_goal_pct: goalsBlock.home_away.home.first_goal_pct,
        },
        away: {
          yes_pct: goalsBlock.home_away.away.btts_yes_pct,
          no_pct: goalsBlock.home_away.away.btts_no_pct,
          first_goal_pct: goalsBlock.home_away.away.first_goal_pct,
        },
      }
    : null;


  const missing_critical_fields: string[] = [];
  if (!home_team) missing_critical_fields.push("mandante");
  if (!away_team) missing_critical_fields.push("visitante");
  if (!marketRaw) missing_critical_fields.push("mercado");
  if (offered_odd === null) missing_critical_fields.push("odd ofertada");
  if (probability === null) missing_critical_fields.push("probabilidade");

  const structured_fields_count = countNonNull({
    match: { home_team, away_team, competition, round, date, time },
    market: { name: marketInfo.name, line: marketInfo.line, offered_odd, fair_odd, probability, ev_original },
    corners,
  });
  const has_structured_ocr_data = structured_fields_count >= 4;
  const data_quality_score = Math.max(
    0,
    Math.min(
      1,
      0.2 + Math.min(0.6, structured_fields_count * 0.02) - Math.min(0.4, missing_critical_fields.length * 0.08),
    ),
  );

  notes.push("Dados interpretados a partir de texto colado (input_source: pasted_text).");
  if (hasHomeAwaySection) notes.push("Identificadas duas secoes: medias gerais e medias casa/fora.");
  if (ev_original !== null) {
    if (source_ev_type === "percent") {
      notes.push(`EV bruto da fonte (${ev_display}) compativel com EV percentual recalculado (${calculated_ev_pct}%).`);
    } else {
      notes.push(
        `EV bruto da fonte (${ev_display}) NAO e percentual confiavel — provavel gap de odd. EV recalculado pelo ASP: ${calculated_ev_pct ?? "n/d"}%.`,
      );
    }
  }
  if (home_moneyline_odd !== null || away_moneyline_odd !== null) {
    notes.push(`Odds 1x2 detectadas na linha "Partida": ${home_team} ${home_moneyline_odd ?? "?"} x ${away_moneyline_odd ?? "?"} ${away_team}.`);
  }

  return {
    input_source: "pasted_text",
    extracted_from_ocr: false,
    raw_pasted_text: raw,
    data_quality_score: Math.round(data_quality_score * 100) / 100,
    structured_fields_count,
    has_structured_ocr_data,
    missing_critical_fields,
    match: {
      sport,
      competition,
      round,
      date,
      time,
      home_team,
      away_team,
    },
    market: {
      name: marketInfo.name,
      normalized_market: marketInfo.normalized,
      line: marketInfo.line,
      pick: marketInfo.pick,
      offered_odd,
      fair_odd_original: fair_odd,
      probability_original: probability,
      ev_original,
      market_normalized: marketInfo.normalized,
    },
    corners,
    prediction: {
      market: marketInfo.name,
      pick: marketInfo.pick,
      line: marketInfo.line,
      offered_odd,
      source_probability: probability,
      source_ev: ev_original,
      source_fair_odd: fair_odd,
      source_ev_raw: ev_original,
      source_ev_display: ev_display,
      source_ev_type,
      calculated_ev_pct,
      odd_gap,
      home_moneyline_odd,
      away_moneyline_odd,
    },
    fixture: {
      league,
      date,
      home_team,
      away_team,
    },
    form_patch,
    notes,
    market_type: detection.market_type,
    period: detection.period,
    pick_normalized: detection.pick_normalized,
    validator_model: detection.validator_model,
    goals: goalsBlock,
    cards: cardsBlock,
    general_performance: generalPerf,
    general_performance_home_away: generalPerfHA,
    btts: bttsBlock,
    btts_home_away: bttsBlockHA,

  };
}

