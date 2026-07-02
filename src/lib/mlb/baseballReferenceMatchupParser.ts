import type {
  MlbBaseballReferenceMatchupContext,
  MlbHeadToHeadGame,
  MlbParsedStartingPitcher,
  MlbParsedTeamSummary,
  MlbParsedWinLossRecord,
  MlbSeasonSeriesCompletedGame,
  MlbSeasonSeriesUpcomingGame,
} from "@/types/mlbCriticalValidation";
import { matchMlbTeamName } from "@/utils/mlbTeamNameMap";

const CURRENT_SEASON = new Date().getFullYear();

// Strict pitcher header: "José Soriano (#59, 27, RHP, 8-4, 3.32)"
const PITCHER_HEADER_REGEX =
  /^(.+?)\s*\(#(\d+),\s*(\d+),\s*(RHP|LHP),\s*(\d+-\d+),\s*(\d+(?:\.\d+)?)\)\s*$/i;

// Season row: "2026   8-4   95.0   77 38 35 48 102 12 3.32"
const SEASON_ROW_REGEX =
  /^(20\d{2})\s+(\d+-\d+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)/;

// Last 7 GS row (ERA + optional GSc)
const LAST7_ROW_REGEX =
  /^Last\s+7\s+GS\s+(\d+-\d+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)(?:\s+(\d+))?/i;

// Last 5 v.XXX row
const LAST5_VS_REGEX =
  /^Last\s+5\s+v\.?([A-Z]{2,4})\s+(\d+-\d+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)(?:\s+(\d+))?/i;

export interface MlbMatchupExpectedTeams {
  home_team?: string | null;
  away_team?: string | null;
  home_team_key?: string | null;
  away_team_key?: string | null;
}

export function parseBaseballReferenceMatchupText(
  rawText: string,
  expectedTeams?: MlbMatchupExpectedTeams,
): MlbBaseballReferenceMatchupContext {
  const text = normalizeRawText(rawText);
  // Team names in TEXT ORDER (not alphabetical), with character position.
  const teamsInOrder = extractKnownTeamNames(text)
    .map((name) => ({ name, index: text.search(new RegExp(`\\b${escapeRegex(name)}\\b`, "i")) }))
    .filter((entry) => entry.index >= 0)
    .sort((a, b) => a.index - b.index);

  const firstName = teamsInOrder[0]?.name ?? null;
  const secondName = teamsInOrder[1]?.name ?? null;
  const firstStart = teamsInOrder[0]?.index ?? -1;
  const secondStart = teamsInOrder[1]?.index ?? -1;
  const firstEnd = secondStart > firstStart ? secondStart : text.length;
  const secondEnd = text.length;
  const firstBlock = firstName ? text.slice(firstStart, firstEnd) : "";
  const secondBlock = secondName ? text.slice(secondStart, secondEnd) : "";

  // Pitcher candidates with absolute character position in text.
  const pitcherCandidates = extractPitcherCandidates(text);
  const firstSummary = buildTeamSummary(firstName, firstBlock || text);
  const secondSummary = buildTeamSummary(secondName, secondBlock || text);

  // Strict block-based association: each pitcher is assigned to the team whose
  // block contains the pitcher header line. Once assigned, a candidate cannot
  // be re-used for the other team.
  const warnings: string[] = [];
  const usedIndices = new Set<number>();
  const pickForRange = (start: number, end: number): PitcherCandidate | null => {
    if (start < 0) return null;
    for (let i = 0; i < pitcherCandidates.length; i += 1) {
      if (usedIndices.has(i)) continue;
      const cand = pitcherCandidates[i];
      if (cand.absoluteIndex >= start && cand.absoluteIndex < end) {
        usedIndices.add(i);
        return cand;
      }
    }
    return null;
  };

  const firstCand = pickForRange(firstStart, firstEnd);
  const secondCand = pickForRange(secondStart, secondEnd);
  const firstPitcher = buildPitcher(firstCand);
  const secondPitcher = buildPitcher(secondCand);

  if (firstName && !firstCand) warnings.push(`Starter do bloco de ${firstName} nao encontrado.`);
  if (secondName && !secondCand) warnings.push(`Starter do bloco de ${secondName} nao encontrado.`);

  // Default assumption: BRef often shows away first, then home. This may be
  // overridden below by expectedTeams/season-series alignment.
  let awaySummary = firstSummary;
  let homeSummary = secondSummary;
  let awayPitcher = firstPitcher;
  let homePitcher = secondPitcher;

  const expectedHomeKey = expectedTeams?.home_team_key ?? (expectedTeams?.home_team ? matchMlbTeamName(expectedTeams.home_team) : null);
  const expectedAwayKey = expectedTeams?.away_team_key ?? (expectedTeams?.away_team ? matchMlbTeamName(expectedTeams.away_team) : null);

  if (expectedHomeKey || expectedAwayKey) {
    const firstKey = firstSummary.team_key;
    const secondKey = secondSummary.team_key;
    const firstIsHome = expectedHomeKey && firstKey === expectedHomeKey;
    const firstIsAway = expectedAwayKey && firstKey === expectedAwayKey;
    const secondIsHome = expectedHomeKey && secondKey === expectedHomeKey;
    const secondIsAway = expectedAwayKey && secondKey === expectedAwayKey;
    if (firstIsHome || secondIsAway) {
      // First block is HOME → swap team AND its associated starter together.
      awaySummary = secondSummary; homeSummary = firstSummary;
      awayPitcher = secondPitcher; homePitcher = firstPitcher;
    } else if (firstIsAway || secondIsHome) {
      // Default already correct.
    } else if (firstKey || secondKey) {
      warnings.push("Times do Baseball-Reference nao conferem com a oportunidade selecionada.");
    }
  } else {
    // No expected teams: use season series line "AAA @BBB" as fallback hint.
    const hint = detectAwayFromSeasonSeries(text);
    if (hint && firstSummary.team_key && secondSummary.team_key) {
      if (hint === firstSummary.team_key) {
        // away=first, home=second — already default.
      } else if (hint === secondSummary.team_key) {
        awaySummary = secondSummary; homeSummary = firstSummary;
        awayPitcher = secondPitcher; homePitcher = firstPitcher;
      }
    }
  }

  // Final safety: never allow silent duplication of the same pitcher in the payload.
  if (
    awayPitcher.name && homePitcher.name &&
    awayPitcher.name === homePitcher.name &&
    awayPitcher.jersey_number === homePitcher.jersey_number
  ) {
    warnings.push("Possivel duplicacao de starter: mesmo pitcher atribuido aos dois times — starter mandante removido.");
    homePitcher = emptyPitcher();
  }

  const context: MlbBaseballReferenceMatchupContext = {
    source: "baseball_reference_matchup_text",
    parser_version: "1.2.0",
    raw_text: rawText,
    parsed_at: new Date().toISOString(),
    teams: {
      away: awaySummary,
      home: homeSummary,
    },
    starting_pitchers: {
      away: awayPitcher,
      home: homePitcher,
    },
    recent_games: {
      away_last_10: [],
      home_last_10: [],
    },
    ...extractSeasonSeriesAndHeadToHead(text),
    data_quality: {
      parsed_fields_count: 0,
      missing_fields: [],
      warnings: [],
      confidence: 0,
    },
  };

  context.data_quality = calculateParserQuality(context);
  if (warnings.length) {
    context.data_quality.warnings = [...warnings, ...context.data_quality.warnings];
  }
  return context;
}


function detectAwayFromSeasonSeries(text: string): string | null {
  // Look for patterns like "LAD @ATH" or "LAD @ ATH"
  const match = text.match(/\b([A-Z]{2,4})\s*@\s*([A-Z]{2,4})\b/);
  if (!match) return null;
  const awayAbbrev = match[1].toUpperCase();
  return abbrevToTeamKey(awayAbbrev);
}

function abbrevToTeamKey(abbrev: string): string | null {
  const map: Record<string, string> = {
    ARI: "arizona_diamondbacks", ATH: "athletics", OAK: "athletics", ATL: "atlanta_braves",
    BAL: "baltimore_orioles", BOS: "boston_red_sox", CHC: "chicago_cubs", CHW: "chicago_white_sox",
    CWS: "chicago_white_sox", CIN: "cincinnati_reds", CLE: "cleveland_guardians", COL: "colorado_rockies",
    DET: "detroit_tigers", HOU: "houston_astros", KC: "kansas_city_royals", KCR: "kansas_city_royals",
    LAA: "los_angeles_angels", LAD: "los_angeles_dodgers", MIA: "miami_marlins", MIL: "milwaukee_brewers",
    MIN: "minnesota_twins", NYM: "new_york_mets", NYY: "new_york_yankees", PHI: "philadelphia_phillies",
    PIT: "pittsburgh_pirates", SD: "san_diego_padres", SDP: "san_diego_padres", SF: "san_francisco_giants",
    SFG: "san_francisco_giants", SEA: "seattle_mariners", STL: "st_louis_cardinals", TB: "tampa_bay_rays",
    TBR: "tampa_bay_rays", TEX: "texas_rangers", TOR: "toronto_blue_jays", WSH: "washington_nationals",
    WSN: "washington_nationals",
  };
  return map[abbrev] ?? null;
}

export function normalizeMlbMatchupContext(context: MlbBaseballReferenceMatchupContext) {
  return {
    ...context,
    teams: {
      away: { ...context.teams.away, team_key: context.teams.away.team_key ?? matchMlbTeamName(context.teams.away.team_name ?? "") },
      home: { ...context.teams.home, team_key: context.teams.home.team_key ?? matchMlbTeamName(context.teams.home.team_name ?? "") },
    },
  };
}

export function extractMlbTeamSummary(rawText: string, teamName: string | null): MlbParsedTeamSummary {
  return buildTeamSummary(teamName, rawText);
}

export function extractMlbStartingPitchers(rawText: string) {
  const candidates = extractPitcherCandidates(normalizeRawText(rawText));
  return {
    away: buildPitcher(candidates[0] ?? null),
    home: buildPitcher(candidates[1] ?? null),
  };
}

export function extractMlbRecentGames() {
  return [];
}

export function extractMlbHeadToHead(rawText: string) {
  return extractSeasonSeriesAndHeadToHead(normalizeRawText(rawText)).head_to_head;
}

export function extractMlbSeasonSeries(rawText: string) {
  return extractSeasonSeriesAndHeadToHead(normalizeRawText(rawText)).season_series;
}

export function parseWinLossRecord(value: string | null | undefined): MlbParsedWinLossRecord | null {
  const raw = String(value ?? "").trim();
  const match = raw.match(/(\d+)\s*-\s*(\d+)/);
  if (!match) return null;
  const wins = Number(match[1]);
  const losses = Number(match[2]);
  return {
    raw,
    wins,
    losses,
    win_pct: wins + losses > 0 ? round(wins / (wins + losses), 3) : null,
  };
}

export function parseBaseballInnings(value: string | null | undefined) {
  const display = String(value ?? "").trim();
  const match = display.match(/^(\d+)(?:\.(\d))?$/);
  if (!match) return { innings_pitched_display: display || null, innings_pitched_decimal: null };
  const innings = Number(match[1]);
  const outs = Number(match[2] ?? 0);
  return {
    innings_pitched_display: display,
    innings_pitched_decimal: round(innings + Math.min(outs, 2) / 3, 4),
  };
}

function buildTeamSummary(teamName: string | null, block: string): MlbParsedTeamSummary {
  return {
    team_name: teamName,
    team_key: teamName ? matchMlbTeamName(teamName) : null,
    record: findRecord(block, /(?:record|overall|w-l)\D{0,20}(\d+\s*-\s*\d+)/i) ?? firstRecord(block),
    wins: null,
    losses: null,
    win_pct: null,
    manager: findText(block, /manager[:\s]+([A-Z][A-Za-z.' -]+)/i),
    game_number: findNumber(block, /game\s*(?:number|#)?\D{0,8}(\d+)/i),
    standing: findText(block, /(?:standing|standings)[:\s]+([^\n]+)/i),
    games_back: findText(block, /(\d+(?:\.\d+)?\s*(?:up|back|gb))/i),
    last10: findRecord(block, /last\s*10\D{0,20}(\d+\s*-\s*\d+)/i),
    last20: findRecord(block, /last\s*20\D{0,20}(\d+\s*-\s*\d+)/i),
    last30: findRecord(block, /last\s*30\D{0,20}(\d+\s*-\s*\d+)/i),
    home_record: findRecord(block, /home\D{0,20}(\d+\s*-\s*\d+)/i),
    away_record: findRecord(block, /(?:away|road)\D{0,20}(\d+\s*-\s*\d+)/i),
    extra_innings_record: findRecord(block, /(?:extra|exinn)\D{0,20}(\d+\s*-\s*\d+)/i),
    one_run_record: findRecord(block, /(?:1-run|one run)\D{0,20}(\d+\s*-\s*\d+)/i),
    vs_rhp_record: findRecord(block, /v(?:s)?\.?\s*RHP\D{0,20}(\d+\s*-\s*\d+)/i),
    vs_lhp_record: findRecord(block, /v(?:s)?\.?\s*LHP\D{0,20}(\d+\s*-\s*\d+)/i),
    vs_east_record: findRecord(block, /v(?:s)?\.?\s*east\D{0,20}(\d+\s*-\s*\d+)/i),
    vs_central_record: findRecord(block, /v(?:s)?\.?\s*(?:cent|central)\D{0,20}(\d+\s*-\s*\d+)/i),
    vs_west_record: findRecord(block, /v(?:s)?\.?\s*west\D{0,20}(\d+\s*-\s*\d+)/i),
    interleague_record: findRecord(block, /interleague\D{0,20}(\d+\s*-\s*\d+)/i),
  };
}

interface PitcherCandidate {
  name: string;
  jersey_number: number | null;
  age: number | null;
  throwing_hand: "LHP" | "RHP";
  season_record: MlbParsedWinLossRecord | null;
  displayed_era: number | null;
  block: string;
  absoluteIndex: number;
}

function extractPitcherCandidates(text: string): PitcherCandidate[] {
  const lines = text.split("\n");
  // Precompute absolute char index at the start of each line.
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1; // +1 for the "\n"
  }

  const candidates: Array<PitcherCandidate & { startIndex: number }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line.includes("(#")) continue;
    const match = line.match(PITCHER_HEADER_REGEX);
    if (!match) continue;
    candidates.push({
      name: cleanPitcherName(match[1]),
      jersey_number: toInt(match[2]),
      age: toInt(match[3]),
      throwing_hand: match[4].toUpperCase() as "LHP" | "RHP",
      season_record: parseWinLossRecord(match[5]),
      displayed_era: toDecimal(match[6]),
      block: "",
      absoluteIndex: lineOffsets[i] ?? 0,
      startIndex: i,
    });
  }
  // Build blocks: from this pitcher line until next pitcher line (max 2).
  return candidates.slice(0, 2).map((cand, idx) => {
    const end = candidates[idx + 1]?.startIndex ?? Math.min(lines.length, cand.startIndex + 40);
    const block = lines.slice(cand.startIndex, end).join("\n");
    const { startIndex: _s, ...rest } = cand;
    void _s;
    return { ...rest, block };
  });
}


function cleanPitcherName(raw: string): string {
  // Remove leading garbage like "gb ", "up ", or standings prefixes
  return raw
    .replace(/^.*?\b(?:gb|up|back)\b\s+/i, "")
    .trim();
}

function buildPitcher(candidate: PitcherCandidate | null): MlbParsedStartingPitcher {
  if (!candidate) {
    return emptyPitcher();
  }
  const block = candidate.block;
  const seasonLine = findSeasonRow(block);
  const last7 = findLast7Row(block);
  const last5 = findLast5VsRow(block);

  const era = seasonLine?.era ?? candidate.displayed_era;
  const ip = parseBaseballInnings(seasonLine?.ip ?? null);
  const last7Ip = parseBaseballInnings(last7?.ip ?? null);

  const record = candidate.season_record ?? (seasonLine ? parseWinLossRecord(seasonLine.dec) : null);

  const pitcher: MlbParsedStartingPitcher = {
    name: candidate.name || null,
    jersey_number: candidate.jersey_number,
    age: candidate.age,
    throwing_hand: candidate.throwing_hand,
    season_record: record,
    wins: record?.wins ?? null,
    losses: record?.losses ?? null,
    era,
    innings_pitched_display: ip.innings_pitched_display,
    innings_pitched_decimal: ip.innings_pitched_decimal,
    hits_allowed: seasonLine?.h ?? null,
    runs_allowed: seasonLine?.r ?? null,
    earned_runs: seasonLine?.er ?? null,
    walks: seasonLine?.bb ?? null,
    strikeouts: seasonLine?.so ?? null,
    home_runs_allowed: seasonLine?.hr ?? null,
    last_7_games_record: last7 ? parseWinLossRecord(last7.dec) : null,
    last_7_ip_display: last7Ip.innings_pitched_display,
    last_7_ip_decimal: last7Ip.innings_pitched_decimal,
    last_7_era: last7?.era ?? null,
    last_7_hits: last7?.h ?? null,
    last_7_walks: last7?.bb ?? null,
    last_7_strikeouts: last7?.so ?? null,
    last_7_home_runs: last7?.hr ?? null,
    recent_starts: [],
    vs_opponent_summary: last5
      ? `Last 5 v.${last5.opp}: ${last5.dec}, ${last5.ip} IP, ${last5.so} K, ERA ${last5.era}`
      : null,
    has_faced_opponent: last5 ? true : null,
    current_form_notes: [],
    k_per_9: null,
    bb_per_9: null,
    hr_per_9: null,
    k_bb_ratio: null,
    er_per_9: null,
    recent_k_per_9: null,
    recent_hr_per_9: null,
    starter_quality_score: null,
  };
  return calculateStarterDerivedMetrics(pitcher);
}

function emptyPitcher(): MlbParsedStartingPitcher {
  return {
    name: null,
    jersey_number: null,
    age: null,
    throwing_hand: null,
    season_record: null,
    wins: null,
    losses: null,
    era: null,
    innings_pitched_display: null,
    innings_pitched_decimal: null,
    hits_allowed: null,
    runs_allowed: null,
    earned_runs: null,
    walks: null,
    strikeouts: null,
    home_runs_allowed: null,
    last_7_games_record: null,
    last_7_ip_display: null,
    last_7_ip_decimal: null,
    last_7_era: null,
    last_7_hits: null,
    last_7_walks: null,
    last_7_strikeouts: null,
    last_7_home_runs: null,
    recent_starts: [],
    vs_opponent_summary: null,
    has_faced_opponent: null,
    current_form_notes: [],
    k_per_9: null,
    bb_per_9: null,
    hr_per_9: null,
    k_bb_ratio: null,
    er_per_9: null,
    recent_k_per_9: null,
    recent_hr_per_9: null,
    starter_quality_score: null,
  };
}

interface SeasonRow {
  season: number;
  dec: string;
  ip: string;
  h: number;
  r: number;
  er: number;
  bb: number;
  so: number;
  hr: number;
  era: number;
}

function findSeasonRow(block: string): SeasonRow | null {
  for (const rawLine of block.split("\n")) {
    const line = rawLine.trim();
    const match = line.match(SEASON_ROW_REGEX);
    if (!match) continue;
    const season = Number(match[1]);
    // Prefer current season; fall back to any season row (last one wins).
    if (season !== CURRENT_SEASON) continue;
    return {
      season,
      dec: match[2],
      ip: match[3],
      h: Number(match[4]),
      r: Number(match[5]),
      er: Number(match[6]),
      bb: Number(match[7]),
      so: Number(match[8]),
      hr: Number(match[9]),
      era: Number(match[10]),
    };
  }
  // Fallback: any season row
  for (const rawLine of block.split("\n")) {
    const match = rawLine.trim().match(SEASON_ROW_REGEX);
    if (!match) continue;
    return {
      season: Number(match[1]),
      dec: match[2],
      ip: match[3],
      h: Number(match[4]),
      r: Number(match[5]),
      er: Number(match[6]),
      bb: Number(match[7]),
      so: Number(match[8]),
      hr: Number(match[9]),
      era: Number(match[10]),
    };
  }
  return null;
}

interface Last7Row {
  dec: string;
  ip: string;
  h: number;
  r: number;
  er: number;
  bb: number;
  so: number;
  hr: number;
  era: number;
  gsc: number | null;
}

function findLast7Row(block: string): Last7Row | null {
  for (const rawLine of block.split("\n")) {
    const match = rawLine.trim().match(LAST7_ROW_REGEX);
    if (!match) continue;
    return {
      dec: match[1],
      ip: match[2],
      h: Number(match[3]),
      r: Number(match[4]),
      er: Number(match[5]),
      bb: Number(match[6]),
      so: Number(match[7]),
      hr: Number(match[8]),
      era: Number(match[9]),
      gsc: match[10] ? Number(match[10]) : null,
    };
  }
  return null;
}

interface Last5VsRow {
  opp: string;
  dec: string;
  ip: string;
  h: number;
  r: number;
  er: number;
  bb: number;
  so: number;
  hr: number;
  era: number;
  gsc: number | null;
}

function findLast5VsRow(block: string): Last5VsRow | null {
  for (const rawLine of block.split("\n")) {
    const match = rawLine.trim().match(LAST5_VS_REGEX);
    if (!match) continue;
    return {
      opp: match[1].toUpperCase(),
      dec: match[2],
      ip: match[3],
      h: Number(match[4]),
      r: Number(match[5]),
      er: Number(match[6]),
      bb: Number(match[7]),
      so: Number(match[8]),
      hr: Number(match[9]),
      era: Number(match[10]),
      gsc: match[11] ? Number(match[11]) : null,
    };
  }
  return null;
}

function calculateStarterDerivedMetrics(pitcher: MlbParsedStartingPitcher): MlbParsedStartingPitcher {
  const ip = pitcher.innings_pitched_decimal;
  const last7Ip = pitcher.last_7_ip_decimal;
  const kPer9 = ratePer9(pitcher.strikeouts, ip);
  const bbPer9 = ratePer9(pitcher.walks, ip);
  const hrPer9 = ratePer9(pitcher.home_runs_allowed, ip);
  const kbb = pitcher.strikeouts != null && pitcher.walks ? pitcher.strikeouts / pitcher.walks : null;

  // Quality score only if we have real data; otherwise null.
  const hasData = pitcher.era != null || ip != null || pitcher.strikeouts != null;
  let quality: number | null = null;
  if (hasData) {
    quality = 50;
    if (pitcher.era != null) {
      if (pitcher.era < 3) quality += 15;
      else if (pitcher.era < 4) quality += 8;
      else if (pitcher.era > 5) quality -= 10;
      else quality -= 2;
    }
    if (hrPer9 != null) {
      if (hrPer9 > 1.5) quality -= 10;
      else if (hrPer9 < 0.8) quality += 8;
    }
    if (bbPer9 != null) {
      if (bbPer9 > 4) quality -= 6;
      else if (bbPer9 < 2.5) quality += 4;
    }
    if (kbb != null) {
      if (kbb > 3) quality += 8;
      else if (kbb < 2) quality -= 6;
    }
    if (pitcher.last_7_era != null && pitcher.era != null) {
      if (pitcher.last_7_era < pitcher.era) quality += 5;
      else if (pitcher.last_7_era > pitcher.era) quality -= 5;
    }
    if (ip != null && ip < 30) quality -= 5;
    quality = clamp(quality, 0, 100);
  }

  return {
    ...pitcher,
    k_per_9: kPer9,
    bb_per_9: bbPer9,
    hr_per_9: hrPer9,
    k_bb_ratio: kbb == null ? null : round(kbb, 2),
    er_per_9: ratePer9(pitcher.earned_runs, ip),
    recent_k_per_9: ratePer9(pitcher.last_7_strikeouts, last7Ip),
    recent_hr_per_9: ratePer9(pitcher.last_7_home_runs, last7Ip),
    starter_quality_score: quality,
  };
}

function extractKnownTeamNames(text: string) {
  const names = [
    "Arizona Diamondbacks", "Athletics", "Atlanta Braves", "Baltimore Orioles", "Boston Red Sox", "Chicago Cubs",
    "Chicago White Sox", "Cincinnati Reds", "Cleveland Guardians", "Colorado Rockies", "Detroit Tigers",
    "Houston Astros", "Kansas City Royals", "Los Angeles Angels", "Los Angeles Dodgers", "Miami Marlins",
    "Milwaukee Brewers", "Minnesota Twins", "New York Mets", "New York Yankees", "Philadelphia Phillies",
    "Pittsburgh Pirates", "San Diego Padres", "San Francisco Giants", "Seattle Mariners", "St. Louis Cardinals",
    "Tampa Bay Rays", "Texas Rangers", "Toronto Blue Jays", "Washington Nationals",
  ];
  return names.filter((name) => new RegExp(`\\b${escapeRegex(name)}\\b`, "i").test(text));
}

function extractTeamBlock(text: string, teamName: string, nextTeamName: string | null) {
  const start = text.search(new RegExp(escapeRegex(teamName), "i"));
  if (start < 0) return "";
  const rest = text.slice(start);
  if (!nextTeamName) return rest;
  const next = rest.slice(teamName.length).search(new RegExp(escapeRegex(nextTeamName), "i"));
  return next > 0 ? rest.slice(0, teamName.length + next) : rest;
}

const DATE_LINE_REGEX = /^([A-Za-z]{3}),\s*([A-Za-z]{3})\s+(\d{1,2}),\s*(20\d{2})\b/;
const TIME_TOKEN_REGEX = /^\d{1,2}:\d{2}\s*(?:am|pm)?$/i;
const YEARLY_LINE_REGEX = /^(20\d{2}|all[-\s]?time)\b[\s\S]*$/i;

interface ParsedGameLine {
  kind: "completed" | "upcoming";
  date: string;
  away_team: string | null;
  home_team: string | null;
  away_score: number | null;
  home_score: number | null;
  time: string | null;
  extra_innings: boolean;
  raw_line: string;
}

function parseGameLine(line: string): ParsedGameLine | null {
  const dateMatch = line.match(DATE_LINE_REGEX);
  if (!dateMatch) return null;
  const date = dateMatch[0];
  const rest = line.slice(dateMatch[0].length);
  const tokens = rest
    .split("|")
    .flatMap((chunk) => chunk.trim().split(/\s+/))
    .filter(Boolean);
  const extraInnings = /extra\s*innings|\(\s*\d+\s*innings?\s*\)/i.test(line);
  const timeIdx = tokens.findIndex((t) => TIME_TOKEN_REGEX.test(t));

  if (timeIdx >= 0) {
    const time = tokens[timeIdx];
    const teamTokens = tokens.filter((_, i) => i !== timeIdx).filter((t) => /^@?[A-Za-z]{2,4}$/.test(t));
    if (teamTokens.length < 2) return null;
    const [t1, t2] = teamTokens;
    const t1Home = t1.startsWith("@");
    const t2Home = t2.startsWith("@");
    const home = t1Home ? t1.slice(1) : t2Home ? t2.slice(1) : t2;
    const away = t1Home ? t2.replace(/^@/, "") : t1.replace(/^@/, "");
    return {
      kind: "upcoming", date,
      away_team: away, home_team: home,
      away_score: null, home_score: null,
      time, extra_innings: extraInnings, raw_line: line,
    };
  }

  // Completed: expect (TEAM, SCORE) pairs where one team is prefixed with '@'
  const pairs: Array<{ team: string; score: number; isHome: boolean }> = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const t = tokens[i];
    const s = tokens[i + 1];
    if (/^@?[A-Za-z]{2,4}$/.test(t) && /^\d+$/.test(s)) {
      pairs.push({ team: t.replace(/^@/, ""), score: Number(s), isHome: t.startsWith("@") });
      i += 1;
    }
  }
  if (pairs.length !== 2) return null;
  const home = pairs.find((p) => p.isHome);
  const away = pairs.find((p) => !p.isHome);
  if (!home || !away) return null;
  return {
    kind: "completed", date,
    away_team: away.team, home_team: home.team,
    away_score: away.score, home_score: home.score,
    time: null, extra_innings: extraInnings, raw_line: line,
  };
}

function extractSeasonSeriesAndHeadToHead(text: string) {
  const completed: MlbSeasonSeriesCompletedGame[] = [];
  const upcoming: MlbSeasonSeriesUpcomingGame[] = [];
  const h2h: MlbHeadToHeadGame[] = [];
  const yearly: Record<string, string> = {};
  let ssSummary: string | null = null;
  let h2hSummary: string | null = null;

  const rawLines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  type Mode = "none" | "ss" | "h2h";
  let mode: Mode = "none";

  for (const line of rawLines) {
    if (/^last\s*10\s*games?\s*head[- ]?to[- ]?head\b/i.test(line)) {
      mode = "h2h";
      h2hSummary = h2hSummary ?? line;
      continue;
    }
    if (/^season\s*series\b/i.test(line)) {
      mode = "ss";
      ssSummary = ssSummary ?? line;
      continue;
    }
    // Yearly summary lines belong to season_series.yearly_summary regardless of mode
    const yearlyMatch = line.match(YEARLY_LINE_REGEX);
    if (yearlyMatch && !DATE_LINE_REGEX.test(line)) {
      const rawKey = yearlyMatch[1];
      const key = /^all/i.test(rawKey) ? "All-time" : rawKey;
      yearly[key] = line;
      continue;
    }
    if (mode === "none") continue;
    if (!DATE_LINE_REGEX.test(line)) continue;
    const parsed = parseGameLine(line);
    if (!parsed) continue;

    if (mode === "ss") {
      if (parsed.kind === "upcoming") {
        upcoming.push({
          date: parsed.date,
          away_team: parsed.away_team,
          home_team: parsed.home_team,
          time: parsed.time,
          is_completed: false,
          raw_line: parsed.raw_line,
        });
      } else {
        const winner =
          parsed.home_score != null && parsed.away_score != null
            ? parsed.home_score > parsed.away_score ? parsed.home_team : parsed.away_team
            : null;
        const loser =
          parsed.home_score != null && parsed.away_score != null
            ? parsed.home_score > parsed.away_score ? parsed.away_team : parsed.home_team
            : null;
        completed.push({
          date: parsed.date,
          away_team: parsed.away_team,
          home_team: parsed.home_team,
          away_score: parsed.away_score,
          home_score: parsed.home_score,
          winner_team: winner,
          loser_team: loser,
          is_completed: true,
          raw_line: parsed.raw_line,
        });
      }
    } else if (mode === "h2h") {
      if (parsed.kind !== "completed") continue; // upcoming can't be H2H
      if (h2h.length >= 10) continue;
      const winner =
        parsed.home_score != null && parsed.away_score != null
          ? parsed.home_score > parsed.away_score ? parsed.home_team : parsed.away_team
          : null;
      const loser =
        parsed.home_score != null && parsed.away_score != null
          ? parsed.home_score > parsed.away_score ? parsed.away_team : parsed.home_team
          : null;
      h2h.push({
        date: parsed.date,
        away_team: parsed.away_team,
        home_team: parsed.home_team,
        away_score: parsed.away_score,
        home_score: parsed.home_score,
        winner,
        loser,
        extra_innings: parsed.extra_innings,
        winning_pitcher: null,
        losing_pitcher: null,
        save_pitcher: null,
        raw_line: parsed.raw_line,
      });
    }
  }

  return {
    season_series: {
      completed_games: completed,
      upcoming_games: upcoming,
      yearly_summary: yearly,
      summary: ssSummary,
    },
    head_to_head: {
      last_10_games: h2h,
      summary: h2hSummary,
    },
  };
}

function isPitcherValid(p: MlbParsedStartingPitcher): boolean {
  return Boolean(p.name && p.throwing_hand && p.era != null && p.innings_pitched_decimal != null);
}

function calculateParserQuality(context: MlbBaseballReferenceMatchupContext) {
  const missing: string[] = [];
  const warnings: string[] = [];
  let score = 0;

  // Team summaries: up to +35 (team name + record on each side)
  for (const side of ["away", "home"] as const) {
    const team = context.teams[side];
    if (team.team_name) score += 8;
    else missing.push(`${side}_team_name`);
    if (team.record) score += 7;
    else missing.push(`${side}_record`);
    if (team.last10) score += 2;
    else warnings.push(`${side}: last10 nao identificado`);
    if (team.home_record || team.away_record) score += 1;
  }

  // Starters identified: up to +30
  for (const side of ["away", "home"] as const) {
    const p = context.starting_pitchers[side];
    if (p.name && p.throwing_hand) score += 8;
    else {
      missing.push(`${side}_starter_name`);
      warnings.push(side === "away"
        ? "Starter visitante nao foi extraido corretamente."
        : "Starter mandante nao foi extraido corretamente.");
    }
    if (p.season_record) score += 3;
    if (p.age != null) score += 2;
    if (p.jersey_number != null) score += 2;
  }

  // Season stats: up to +20 (10 per starter with era+ip+so+bb+hr)
  for (const side of ["away", "home"] as const) {
    const p = context.starting_pitchers[side];
    const seasonStatsOk =
      p.era != null && p.innings_pitched_decimal != null && p.strikeouts != null &&
      p.walks != null && p.home_runs_allowed != null;
    if (seasonStatsOk) score += 10;
    else warnings.push(`${side}: estatisticas de temporada do starter ausentes.`);
  }

  // Last 7 GS: up to +10
  for (const side of ["away", "home"] as const) {
    const p = context.starting_pitchers[side];
    if (p.last_7_era != null && p.last_7_ip_decimal != null) score += 5;
  }

  // H2H / season series: up to +5
  if (context.season_series.completed_games.length + context.season_series.upcoming_games.length > 0) score += 3;
  if (context.head_to_head.last_10_games.length > 0) score += 2;

  let confidence = clamp(score, 0, 100);

  // Hard caps for broken parses
  const awayValid = isPitcherValid(context.starting_pitchers.away);
  const homeValid = isPitcherValid(context.starting_pitchers.home);
  if (!awayValid || !homeValid) confidence = Math.min(confidence, 65);

  return {
    parsed_fields_count: score,
    missing_fields: missing,
    warnings,
    confidence,
  };
}

function firstRecord(block: string) {
  return parseWinLossRecord(block.match(/(\d+\s*-\s*\d+)/)?.[1] ?? null);
}

function findRecord(block: string, pattern: RegExp) {
  return parseWinLossRecord(block.match(pattern)?.[1] ?? null);
}

function findText(block: string, pattern: RegExp) {
  return block.match(pattern)?.[1]?.trim() ?? null;
}

function findNumber(block: string, pattern: RegExp) {
  const value = Number(block.match(pattern)?.[1]);
  return Number.isFinite(value) ? value : null;
}

function toInt(value: string | null | undefined) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toDecimal(value: string | null | undefined) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function ratePer9(value: number | null, innings: number | null) {
  if (value == null || innings == null || innings <= 0) return null;
  return round((value / innings) * 9, 2);
}

function normalizeRawText(rawText: string) {
  return rawText.replace(/\r/g, "\n").replace(/\t/g, " ").replace(/[ ]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
