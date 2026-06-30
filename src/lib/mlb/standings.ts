import type {
  EnrichedMlbGame,
  MlbLeagueAverageSnapshot,
  MlbOddsRow,
  MlbStandingRawRow,
  MlbStandingsSnapshot,
  MlbStandingsSource,
  MlbStandingsValidation,
  MlbTeamStanding,
} from "@/types/mlbStandings";
import { matchMlbTeamName, normalizeMlbTeamText } from "@/utils/mlbTeamNameMap";

export const MLB_STANDINGS_SOURCE_URL = "https://www.baseball-reference.com/leagues/MLB-standings.shtml";

type ParsedStandingsPayload = {
  teams: MlbTeamStanding[];
  league_average: MlbLeagueAverageSnapshot | null;
  validation: MlbStandingsValidation;
};

type Cell = {
  text: string;
  dataStat: string | null;
};

const REQUIRED_KEYS = [
  "team",
  "wins",
  "losses",
  "win_pct",
  "runs",
  "runs_allowed",
  "run_diff",
  "sos",
  "srs",
  "pyth_wl",
  "luck",
  "home",
  "road",
  "vs_rhp",
  "vs_lhp",
  "last10",
  "last20",
  "last30",
];

export function fetchMlbDetailedStandings(): Promise<string> {
  return fetch(MLB_STANDINGS_SOURCE_URL, {
    headers: {
      "User-Agent": "ASP Insights MLB Daily Screener/1.0 (standings import)",
      Accept: "text/html,application/xhtml+xml",
    },
  }).then(async (response) => {
    const html = await response.text();
    if (!response.ok) {
      throw new Error(`Baseball-Reference retornou HTTP ${response.status}. Use o CSV manual como fallback.`);
    }
    return html;
  });
}

export function parseMlbStandingsHtml(
  html: string,
  opts: { snapshotDate: string; season: number; source?: MlbStandingsSource } = defaultParseOptions(),
): ParsedStandingsPayload {
  const tables = Array.from(html.matchAll(/<table[\s\S]*?<\/table>/gi)).map((match) => match[0]);
  const candidates = tables
    .map((table) => parseTableRows(table))
    .map(rowsToCanonicalRecords)
    .filter((rows) => rows.some((row) => isStandingsLikeRow(row)));

  const rows = candidates
    .sort((a, b) => countTeamRows(b) - countTeamRows(a))
    .at(0);

  if (!rows?.length) {
    throw new Error("Tabela Major League Baseball Detailed Standings nao encontrada no HTML.");
  }

  return normalizeRows(rows, {
    snapshotDate: opts.snapshotDate,
    season: opts.season,
    source: opts.source ?? "baseball_reference",
    sourceUrl: MLB_STANDINGS_SOURCE_URL,
  });
}

export function parseMlbStandingsCsv(
  csv: string,
  opts: { snapshotDate: string; season: number; source?: MlbStandingsSource } = defaultParseOptions(),
): ParsedStandingsPayload {
  const records = parseCsv(csv);
  if (!records.length) throw new Error("CSV manual vazio ou sem linhas validas.");
  return normalizeRows(records.map(normalizeRecordKeys), {
    snapshotDate: opts.snapshotDate,
    season: opts.season,
    source: opts.source ?? "csv_manual",
    sourceUrl: MLB_STANDINGS_SOURCE_URL,
  });
}

export function normalizeMlbStandingsRow(
  row: MlbStandingRawRow,
  opts: { snapshotDate: string; season: number; source: MlbStandingsSource; sourceUrl: string | null },
): MlbTeamStanding | null {
  const teamName = cleanTeamName(textValue(row.team));
  if (!teamName || /^average$/i.test(teamName)) return null;
  const teamKey = matchMlbTeamName(teamName) ?? normalizeMlbTeamText(teamName);
  const pyth = parseWinLoss(textValue(row.pyth_wl));
  const home = parseWinLoss(textValue(row.home));
  const road = parseWinLoss(textValue(row.road));
  const extra = parseWinLoss(textValue(row.extra_innings));
  const oneRun = parseWinLoss(textValue(row.one_run));
  const rhp = parseWinLoss(textValue(row.vs_rhp));
  const lhp = parseWinLoss(textValue(row.vs_lhp));
  const plus500 = parseWinLoss(textValue(row.vs_500_plus));
  const minus500 = parseWinLoss(textValue(row.vs_500_minus));
  const last10 = parseWinLoss(textValue(row.last10));
  const last20 = parseWinLoss(textValue(row.last20));
  const last30 = parseWinLoss(textValue(row.last30));
  const vEast = parseWinLoss(textValue(row.v_east));
  const vCent = parseWinLoss(textValue(row.v_cent));
  const vWest = parseWinLoss(textValue(row.v_west));
  const interleague = parseWinLoss(textValue(row.interleague));
  const streak = parseStreak(textValue(row.streak));
  const wins = parseInteger(row.wins);
  const losses = parseInteger(row.losses);

  return {
    snapshot_date: opts.snapshotDate,
    season: opts.season,
    source: opts.source,
    source_url: opts.sourceUrl,
    rank: parseInteger(row.rank),
    team_name: teamName,
    team_key: teamKey,
    wins,
    losses,
    win_pct: parsePercentage(row.win_pct),
    streak_result: streak.result,
    streak_count: streak.count,
    runs_per_game: parseDecimal(row.runs),
    runs_allowed_per_game: parseDecimal(row.runs_allowed),
    run_diff_per_game: parseDecimal(row.run_diff),
    sos: parseDecimal(row.sos),
    srs: parseDecimal(row.srs),
    pyth_wins: pyth.wins,
    pyth_losses: pyth.losses,
    pyth_win_pct: winPct(pyth.wins, pyth.losses),
    luck: parseInteger(row.luck),
    v_east_wins: vEast.wins,
    v_east_losses: vEast.losses,
    v_cent_wins: vCent.wins,
    v_cent_losses: vCent.losses,
    v_west_wins: vWest.wins,
    v_west_losses: vWest.losses,
    interleague_wins: interleague.wins,
    interleague_losses: interleague.losses,
    home_wins: home.wins,
    home_losses: home.losses,
    home_win_pct: winPct(home.wins, home.losses),
    road_wins: road.wins,
    road_losses: road.losses,
    road_win_pct: winPct(road.wins, road.losses),
    extra_innings_wins: extra.wins,
    extra_innings_losses: extra.losses,
    one_run_wins: oneRun.wins,
    one_run_losses: oneRun.losses,
    vs_rhp_wins: rhp.wins,
    vs_rhp_losses: rhp.losses,
    vs_lhp_wins: lhp.wins,
    vs_lhp_losses: lhp.losses,
    vs_500_plus_wins: plus500.wins,
    vs_500_plus_losses: plus500.losses,
    vs_500_minus_wins: minus500.wins,
    vs_500_minus_losses: minus500.losses,
    last10_wins: last10.wins,
    last10_losses: last10.losses,
    last20_wins: last20.wins,
    last20_losses: last20.losses,
    last30_wins: last30.wins,
    last30_losses: last30.losses,
    raw: row,
  };
}

export function validateMlbStandings(
  teams: MlbTeamStanding[],
  oddsRows: MlbOddsRow[] = [],
): MlbStandingsValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const unmatchedTeams = teams
    .filter((team) => !matchMlbTeamName(team.team_name))
    .map((team) => team.team_name);

  if (teams.length < 30) errors.push(`Foram identificados apenas ${teams.length} times MLB. O minimo esperado e 30.`);
  if (teams.some((team) => !team.team_key)) errors.push("Ha times sem team_key normalizado.");
  for (const team of teams) {
    if (team.wins == null || team.losses == null) errors.push(`${team.team_name}: W/L ausente ou nao numerico.`);
    if (team.win_pct == null) errors.push(`${team.team_name}: W-L% ausente ou nao numerico.`);
    if (team.runs_per_game == null || team.runs_allowed_per_game == null) errors.push(`${team.team_name}: R ou RA ausente.`);
    if (team.sos == null || team.srs == null) errors.push(`${team.team_name}: SOS ou SRS ausente.`);
    if (team.pyth_wins == null || team.pyth_losses == null) errors.push(`${team.team_name}: pythWL nao foi separado.`);
    if (team.home_wins == null || team.home_losses == null) errors.push(`${team.team_name}: Home nao foi separado.`);
    if (team.road_wins == null || team.road_losses == null) errors.push(`${team.team_name}: Road nao foi separado.`);
    if (team.vs_rhp_wins == null || team.vs_rhp_losses == null) errors.push(`${team.team_name}: vRHP nao foi separado.`);
    if (team.vs_lhp_wins == null || team.vs_lhp_losses == null) errors.push(`${team.team_name}: vLHP nao foi separado.`);
    if (team.last10_wins == null || team.last10_losses == null) errors.push(`${team.team_name}: last10 nao foi separado.`);
    if (team.last20_wins == null || team.last20_losses == null) errors.push(`${team.team_name}: last20 nao foi separado.`);
    if (team.last30_wins == null || team.last30_losses == null) errors.push(`${team.team_name}: last30 nao foi separado.`);
    if (!team.snapshot_date) errors.push(`${team.team_name}: snapshot_date indefinido.`);
    if (!team.season) errors.push(`${team.team_name}: season indefinido.`);
  }

  const oddsTeamKeys = new Set(
    oddsRows.flatMap((row) => [row.mandante, row.visitante]).filter(Boolean).map((name) => matchMlbTeamName(name)),
  );
  oddsTeamKeys.delete(null);
  const standingKeys = new Set(teams.map((team) => team.team_key));
  const matchedOddsTeams = [...oddsTeamKeys].filter((key) => key && standingKeys.has(key)).length;
  const matchRate = oddsTeamKeys.size ? matchedOddsTeams / oddsTeamKeys.size : 1;
  if (oddsTeamKeys.size && matchRate < 0.9) {
    errors.push(`Apenas ${Math.round(matchRate * 100)}% dos times nas odds do dia foram conciliados com standings.`);
  }

  if (unmatchedTeams.length) warnings.push(`Times sem alias explicito: ${unmatchedTeams.join(", ")}`);

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    warnings,
    importedTeams: teams.length,
    matchedTeams: teams.length - unmatchedTeams.length,
    unmatchedTeams,
  };
}

export function enrichMlbGamesWithStandings(
  oddsRows: MlbOddsRow[],
  standings: MlbTeamStanding[],
): EnrichedMlbGame[] {
  const byTeam = new Map(standings.map((team) => [team.team_key, team]));
  const groups = new Map<string, EnrichedMlbGame>();

  for (const row of oddsRows) {
    const home = String(row.mandante ?? "").trim();
    const away = String(row.visitante ?? "").trim();
    if (!home || !away) continue;
    const homeKey = matchMlbTeamName(home);
    const awayKey = matchMlbTeamName(away);
    const gameId = [
      row.data ?? "sem_data",
      String(row.hora ?? "sem_hora").slice(0, 5),
      homeKey ?? normalizeMlbTeamText(home),
      awayKey ?? normalizeMlbTeamText(away),
    ].join("_");

    if (!groups.has(gameId)) {
      const homeStanding = homeKey ? byTeam.get(homeKey) ?? null : null;
      const awayStanding = awayKey ? byTeam.get(awayKey) ?? null : null;
      const missing = [
        !homeStanding ? home : null,
        !awayStanding ? away : null,
      ].filter(Boolean) as string[];
      groups.set(gameId, {
        game_id: gameId,
        date: row.data,
        time: row.hora?.slice(0, 5) ?? null,
        home_team: home,
        away_team: away,
        home_team_key: homeKey,
        away_team_key: awayKey,
        home_standings: homeStanding,
        away_standings: awayStanding,
        markets: [],
        standings_status: missing.length === 0 ? "matched" : missing.length === 2 ? "missing_standings" : "partial_match",
        missing_teams: missing,
      });
    }

    groups.get(gameId)?.markets.push({
      market: row.mercado,
      pick: row.pick,
      line: row.linha,
      odd: Number.isFinite(Number(row.odd)) ? Number(row.odd) : null,
      bookmaker: row.bookmaker,
      source: row.fonte,
    });
  }

  return [...groups.values()].sort((a, b) => `${a.date ?? ""}${a.time ?? ""}`.localeCompare(`${b.date ?? ""}${b.time ?? ""}`));
}

export function getMlbStandingsSnapshot(
  teams: MlbTeamStanding[],
  opts: {
    snapshotDate: string;
    season: number;
    source: MlbStandingsSource;
    sourceUrl?: string | null;
    importedAt?: string | null;
    leagueAverage?: MlbLeagueAverageSnapshot | null;
    oddsRows?: MlbOddsRow[];
  },
): MlbStandingsSnapshot {
  return {
    snapshot_date: opts.snapshotDate,
    season: opts.season,
    source: opts.source,
    source_url: opts.sourceUrl ?? MLB_STANDINGS_SOURCE_URL,
    imported_at: opts.importedAt ?? null,
    teams,
    league_average: opts.leagueAverage ?? null,
    validation: validateMlbStandings(teams, opts.oddsRows),
  };
}

function normalizeRows(
  rows: MlbStandingRawRow[],
  opts: { snapshotDate: string; season: number; source: MlbStandingsSource; sourceUrl: string | null },
): ParsedStandingsPayload {
  const normalizedRows = rows.map(normalizeRecordKeys);
  const teams = normalizedRows
    .map((row) => normalizeMlbStandingsRow(row, opts))
    .filter(Boolean) as MlbTeamStanding[];
  const averageRow = normalizedRows.find((row) => /^average$/i.test(textValue(row.team)));
  const leagueAverage = averageRow ? normalizeAverageRow(averageRow, opts) : null;
  return {
    teams,
    league_average: leagueAverage,
    validation: validateMlbStandings(teams),
  };
}

function normalizeAverageRow(
  row: MlbStandingRawRow,
  opts: { snapshotDate: string; season: number; source: MlbStandingsSource; sourceUrl: string | null },
): MlbLeagueAverageSnapshot {
  return {
    snapshot_date: opts.snapshotDate,
    season: opts.season,
    source: opts.source,
    source_url: opts.sourceUrl,
    runs_per_game_average: parseDecimal(row.runs),
    runs_allowed_per_game_average: parseDecimal(row.runs_allowed),
    home_record_average: textValue(row.home) || null,
    road_record_average: textValue(row.road) || null,
    last10_average: textValue(row.last10) || null,
    raw: row,
  };
}

function parseTableRows(tableHtml: string): Cell[][] {
  return Array.from(tableHtml.matchAll(/<tr\b[\s\S]*?<\/tr>/gi))
    .map((rowMatch) =>
      Array.from(rowMatch[0].matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi)).map((cellMatch) => ({
        text: cleanHtml(cellMatch[3]),
        dataStat: getAttr(cellMatch[2], "data-stat"),
      })),
    )
    .filter((row) => row.length > 0);
}

function rowsToCanonicalRecords(rows: Cell[][]): MlbStandingRawRow[] {
  const recordsFromDataStats = rows
    .map((cells) => {
      const record: MlbStandingRawRow = {};
      for (const cell of cells) {
        const key = canonicalHeader(cell.dataStat ?? "");
        if (key) record[key] = cell.text;
      }
      return record;
    })
    .filter((row) => Object.keys(row).length > 0);

  if (recordsFromDataStats.some(isStandingsLikeRow)) return recordsFromDataStats;

  const headerIndex = rows.findIndex((cells) => {
    const keys = cells.map((cell) => canonicalHeader(cell.text));
    return REQUIRED_KEYS.filter((key) => keys.includes(key)).length >= 8;
  });
  if (headerIndex < 0) return [];

  const headers = rows[headerIndex].map((cell) => canonicalHeader(cell.text));
  return rows.slice(headerIndex + 1).map((cells) => {
    const record: MlbStandingRawRow = {};
    cells.forEach((cell, index) => {
      const key = headers[index];
      if (key) record[key] = cell.text;
    });
    return record;
  });
}

function isStandingsLikeRow(row: MlbStandingRawRow) {
  return REQUIRED_KEYS.filter((key) => key in row).length >= 14 && Boolean(textValue(row.team));
}

function countTeamRows(rows: MlbStandingRawRow[]) {
  return rows.filter((row) => matchMlbTeamName(textValue(row.team))).length;
}

function normalizeRecordKeys(row: MlbStandingRawRow): MlbStandingRawRow {
  const next: MlbStandingRawRow = {};
  for (const [key, value] of Object.entries(row)) {
    const canonical = canonicalHeader(key);
    if (canonical) next[canonical] = value;
  }
  return next;
}

function canonicalHeader(header: string): string | null {
  const raw = header.trim();
  const key = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/a‰¥/gi, ">=")
    .replace(/a‰¤/gi, "<=")
    .replace(/â‰¥/gi, ">=")
    .replace(/â‰¤/gi, "<=")
    .replace(/\u2265/g, ">=")
    .replace(/\s+/g, "")
    .toLowerCase();
  const compact = key.replace(/[^a-z0-9<>=%+.-]/g, "");
  const map: Record<string, string> = {
    rk: "rank",
    ranker: "rank",
    tm: "team",
    team: "team",
    teamid: "team",
    team_id: "team",
    teamname: "team",
    wins: "wins",
    w: "wins",
    losses: "losses",
    l: "losses",
    "w-l%": "win_pct",
    "wl%": "win_pct",
    win_loss_perc: "win_pct",
    winlossperc: "win_pct",
    win_pct: "win_pct",
    winpct: "win_pct",
    "win%": "win_pct",

    strk: "streak",
    streak: "streak",
    r: "runs",
    "r/g": "runs",
    runs: "runs",
    runs_per_game: "runs",
    runspergame: "runs",
    ra: "runs_allowed",
    "ra/g": "runs_allowed",
    runs_allowed_per_game: "runs_allowed",
    runsallowedpergame: "runs_allowed",
    runsallowed: "runs_allowed",
    rdiff: "run_diff",
    run_diff: "run_diff",
    run_diff_per_game: "run_diff",
    rundiffpergame: "run_diff",
    rundiff: "run_diff",
    sos: "sos",
    strength_of_schedule: "sos",
    strengthofschedule: "sos",
    srs: "srs",
    simple_rating_system: "srs",
    simpleratingsystem: "srs",
    pythwl: "pyth_wl",
    pythagorean_wl: "pyth_wl",
    pythagoreanwl: "pyth_wl",
    luck: "luck",
    veast: "v_east",
    vs_east: "v_east",
    vcent: "v_cent",
    vcentral: "v_cent",
    vs_central: "v_cent",
    vwest: "v_west",
    vs_west: "v_west",
    inter: "interleague",
    interleague: "interleague",
    home: "home",
    home_record: "home",
    homerecord: "home",
    road: "road",
    road_record: "road",
    roadrecord: "road",
    exinn: "extra_innings",
    extra_innings: "extra_innings",
    extrainnings: "extra_innings",
    "1run": "one_run",
    one_run: "one_run",
    onerun: "one_run",
    vrhp: "vs_rhp",
    vs_rhp: "vs_rhp",
    vsrhp: "vs_rhp",
    vlhp: "vs_lhp",
    vs_lhp: "vs_lhp",
    vslhp: "vs_lhp",
    ">=.500": "vs_500_plus",
    ">.500": "vs_500_plus",
    ".500+": "vs_500_plus",
    v500plus: "vs_500_plus",
    vs500plus: "vs_500_plus",
    vs_over_500: "vs_500_plus",
    vsover500: "vs_500_plus",
    "<.500": "vs_500_minus",
    "<=.500": "vs_500_minus",
    ".500-": "vs_500_minus",
    v500minus: "vs_500_minus",
    vs500minus: "vs_500_minus",
    vs_under_500: "vs_500_minus",
    vsunder500: "vs_500_minus",
    last10: "last10",
    lastten: "last10",
    last_ten: "last10",
    last20: "last20",
    lasttwenty: "last20",
    last_twenty: "last20",
    last30: "last30",
    lastthirty: "last30",
    last_thirty: "last30",
  };
  return map[compact] ?? map[key] ?? null;
}

function parseCsv(csv: string): MlbStandingRawRow[] {
  const rows = splitCsvRows(csv);
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values) => {
    const row: MlbStandingRawRow = {};
    headers.forEach((header, index) => {
      row[header] = values[index]?.trim() ?? "";
    });
    return row;
  });
}

function splitCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i++;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function parseWinLoss(input: string): { wins: number | null; losses: number | null } {
  const match = input.replace(/\s+/g, "").match(/^(-?\d+)-(-?\d+)$/);
  if (!match) return { wins: null, losses: null };
  return { wins: Number(match[1]), losses: Number(match[2]) };
}

function parseStreak(input: string): { result: "W" | "L" | null; count: number | null } {
  const match = input.trim().match(/^([WL])\s*(\d+)$/i);
  if (!match) return { result: null, count: null };
  return { result: match[1].toUpperCase() as "W" | "L", count: Number(match[2]) };
}

function parsePercentage(input: unknown): number | null {
  let text = textValue(input).replace(",", ".").replace("%", "").trim();
  if (!text) return null;
  if (text.startsWith(".")) text = `0${text}`;
  if (text.startsWith("-.")) text = `-0${text.slice(1)}`;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}


function parseDecimal(input: unknown): number | null {
  const value = Number(textValue(input).replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function parseInteger(input: unknown): number | null {
  const value = Number.parseInt(textValue(input), 10);
  return Number.isFinite(value) ? value : null;
}

function winPct(wins: number | null, losses: number | null): number | null {
  if (wins == null || losses == null || wins + losses <= 0) return null;
  return Number((wins / (wins + losses)).toFixed(3));
}

function cleanTeamName(input: string) {
  return input.replace(/\(\d+\)/g, "").replace(/\*/g, "").trim();
}

function textValue(input: unknown) {
  return String(input ?? "").trim();
}

function cleanHtml(input: string) {
  return decodeHtml(
    input
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function decodeHtml(input: string) {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2265;|&#8805;/gi, "\u2265")
    .replace(/&#x2019;|&#8217;/gi, "'")
    .replace(/&#x27;|&#39;/gi, "'");
}

function getAttr(attrs: string, name: string) {
  const match = attrs.match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
  return match?.[1] ?? null;
}

function defaultParseOptions() {
  const now = new Date();
  return {
    snapshotDate: now.toISOString().slice(0, 10),
    season: now.getUTCFullYear(),
    source: "baseball_reference" as MlbStandingsSource,
  };
}
