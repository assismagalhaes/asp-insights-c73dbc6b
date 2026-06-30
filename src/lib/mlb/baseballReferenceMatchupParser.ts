import type {
  MlbBaseballReferenceMatchupContext,
  MlbParsedStartingPitcher,
  MlbParsedTeamSummary,
  MlbParsedWinLossRecord,
} from "@/types/mlbCriticalValidation";
import { matchMlbTeamName } from "@/utils/mlbTeamNameMap";

const EMPTY_RECORD = null;

export function parseBaseballReferenceMatchupText(rawText: string): MlbBaseballReferenceMatchupContext {
  const text = normalizeRawText(rawText);
  const teamNames = extractKnownTeamNames(text);
  const awayName = teamNames[0] ?? null;
  const homeName = teamNames[1] ?? teamNames.find((team) => team !== awayName) ?? null;
  const awayBlock = awayName ? extractTeamBlock(text, awayName, homeName) : "";
  const homeBlock = homeName ? extractTeamBlock(text, homeName, null) : "";
  const pitcherCandidates = extractPitcherCandidates(text);
  const awayPitcher = buildPitcherFromBlock(pitcherCandidates[0] ?? awayBlock, pitcherCandidates[0]?.name ?? null);
  const homePitcher = buildPitcherFromBlock(pitcherCandidates[1] ?? homeBlock, pitcherCandidates[1]?.name ?? null);

  const context: MlbBaseballReferenceMatchupContext = {
    source: "baseball_reference_matchup_text",
    parser_version: "1.0.0",
    raw_text: rawText,
    parsed_at: new Date().toISOString(),
    teams: {
      away: buildTeamSummary(awayName, awayBlock || text),
      home: buildTeamSummary(homeName, homeBlock || text),
    },
    starting_pitchers: {
      away: awayPitcher,
      home: homePitcher,
    },
    recent_games: {
      away_last_10: [],
      home_last_10: [],
    },
    season_series: extractSeasonSeries(text),
    head_to_head: extractHeadToHead(text),
    data_quality: {
      parsed_fields_count: 0,
      missing_fields: [],
      warnings: [],
      confidence: 0,
    },
  };

  context.data_quality = calculateParserQuality(context);
  return context;
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
    away: buildPitcherFromBlock(candidates[0] ?? "", candidates[0]?.name ?? null),
    home: buildPitcherFromBlock(candidates[1] ?? "", candidates[1]?.name ?? null),
  };
}

export function extractMlbRecentGames() {
  return [];
}

export function extractMlbHeadToHead(rawText: string) {
  return extractHeadToHead(normalizeRawText(rawText));
}

export function extractMlbSeasonSeries(rawText: string) {
  return extractSeasonSeries(normalizeRawText(rawText));
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

function buildPitcherFromBlock(candidate: string | { name: string; block: string }, fallbackName: string | null): MlbParsedStartingPitcher {
  const block = typeof candidate === "string" ? candidate : candidate.block;
  const name = typeof candidate === "string" ? fallbackName ?? extractPitcherName(block) : candidate.name;
  const seasonRecord = findRecord(block, /(?:record|w-l)\D{0,20}(\d+\s*-\s*\d+)/i) ?? firstRecord(block);
  const ip = parseBaseballInnings(findText(block, /(\d+\.\d)\s*IP/i));
  const last7Ip = parseBaseballInnings(findText(block, /last\s*7[\s\S]{0,80}?(\d+\.\d)\s*IP/i));
  const pitcher: MlbParsedStartingPitcher = {
    name,
    jersey_number: findNumber(block, /#\s*(\d+)/),
    age: findNumber(block, /age[:\s]+(\d+)/i),
    throwing_hand: findHand(block),
    season_record: seasonRecord,
    wins: seasonRecord?.wins ?? null,
    losses: seasonRecord?.losses ?? null,
    era: findDecimal(block, /ERA\D{0,10}(\d+(?:\.\d+)?)/i),
    innings_pitched_display: ip.innings_pitched_display,
    innings_pitched_decimal: ip.innings_pitched_decimal,
    hits_allowed: findNumber(block, /(\d+)\s*H\b/),
    runs_allowed: findNumber(block, /(\d+)\s*R\b/),
    earned_runs: findNumber(block, /(\d+)\s*ER\b/),
    walks: findNumber(block, /(\d+)\s*BB\b/),
    strikeouts: findNumber(block, /(\d+)\s*(?:SO|K)\b/),
    home_runs_allowed: findNumber(block, /(\d+)\s*HR\b/),
    last_7_games_record: findRecord(block, /last\s*7[\s\S]{0,80}?(\d+\s*-\s*\d+)/i),
    last_7_ip_display: last7Ip.innings_pitched_display,
    last_7_ip_decimal: last7Ip.innings_pitched_decimal,
    last_7_era: findDecimal(block, /last\s*7[\s\S]{0,120}?ERA\D{0,10}(\d+(?:\.\d+)?)/i),
    last_7_hits: findNumber(block, /last\s*7[\s\S]{0,120}?(\d+)\s*H\b/i),
    last_7_walks: findNumber(block, /last\s*7[\s\S]{0,120}?(\d+)\s*BB\b/i),
    last_7_strikeouts: findNumber(block, /last\s*7[\s\S]{0,120}?(\d+)\s*(?:SO|K)\b/i),
    last_7_home_runs: findNumber(block, /last\s*7[\s\S]{0,120}?(\d+)\s*HR\b/i),
    recent_starts: [],
    vs_opponent_summary: findText(block, /(?:vs\.?|versus|against)\s+[A-Z][^\n]+/i),
    has_faced_opponent: /never faced|has never faced|no starts/i.test(block) ? false : null,
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

function calculateStarterDerivedMetrics(pitcher: MlbParsedStartingPitcher): MlbParsedStartingPitcher {
  const ip = pitcher.innings_pitched_decimal;
  const last7Ip = pitcher.last_7_ip_decimal;
  const kPer9 = ratePer9(pitcher.strikeouts, ip);
  const bbPer9 = ratePer9(pitcher.walks, ip);
  const hrPer9 = ratePer9(pitcher.home_runs_allowed, ip);
  let quality = 50;
  if (pitcher.era != null && pitcher.era < 3) quality += 15;
  else if (pitcher.era != null && pitcher.era < 4) quality += 8;
  else if (pitcher.era != null && pitcher.era > 5) quality -= 10;
  if (hrPer9 != null && hrPer9 > 1.5) quality -= 10;
  if (hrPer9 != null && hrPer9 < 0.8) quality += 8;
  const kbb = pitcher.strikeouts != null && pitcher.walks ? pitcher.strikeouts / pitcher.walks : null;
  if (kbb != null && kbb > 3) quality += 8;
  if (kbb != null && kbb < 2) quality -= 6;
  if (pitcher.last_7_era != null && pitcher.era != null && pitcher.last_7_era < pitcher.era) quality += 5;
  if (pitcher.last_7_era != null && pitcher.era != null && pitcher.last_7_era > pitcher.era) quality -= 5;

  return {
    ...pitcher,
    k_per_9: kPer9,
    bb_per_9: bbPer9,
    hr_per_9: hrPer9,
    k_bb_ratio: kbb == null ? null : round(kbb, 2),
    er_per_9: ratePer9(pitcher.earned_runs, ip),
    recent_k_per_9: ratePer9(pitcher.last_7_strikeouts, last7Ip),
    recent_hr_per_9: ratePer9(pitcher.last_7_home_runs, last7Ip),
    starter_quality_score: clamp(quality, 0, 100),
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

function extractPitcherCandidates(text: string): Array<{ name: string; block: string }> {
  const matches = [...text.matchAll(/([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)+)[^\n]{0,80}\b([LR]HP)\b/gi)];
  return matches.slice(0, 2).map((match, index) => {
    const start = Math.max(0, match.index ?? 0);
    const end = matches[index + 1]?.index ?? Math.min(text.length, start + 1600);
    return { name: match[1].trim(), block: text.slice(start, end) };
  });
}

function extractSeasonSeries(text: string) {
  const lines = text.split("\n").filter((line) => /season series|series|@\s*[A-Z]{2,3}|[A-Z]{2,3}\s*@/i.test(line)).slice(0, 12);
  return { games: lines, summary: lines.find((line) => /season series/i.test(line)) ?? null };
}

function extractHeadToHead(text: string) {
  const lines = text.split("\n").filter((line) => /head.?to.?head|all-time|leads|won|lost/i.test(line)).slice(0, 12);
  return { games: lines, summary: lines.find((line) => /all-time|leads/i.test(line)) ?? null };
}

function calculateParserQuality(context: MlbBaseballReferenceMatchupContext) {
  const missing: string[] = [];
  const warnings: string[] = [];
  let count = 0;
  for (const side of ["away", "home"] as const) {
    const team = context.teams[side];
    const pitcher = context.starting_pitchers[side];
    if (!team.team_name) missing.push(`${side}_team_name`);
    else count += 1;
    if (!team.record) missing.push(`${side}_record`);
    else count += 1;
    if (!team.last10) warnings.push(`${side}: last10 nao identificado`);
    else count += 1;
    if (!pitcher.name) missing.push(`${side}_starter_name`);
    else count += 1;
    if (!pitcher.throwing_hand) warnings.push(`${side}: mao do starter nao identificada`);
    else count += 1;
    if (pitcher.era == null) warnings.push(`${side}: ERA do starter nao identificada`);
    else count += 1;
  }
  return {
    parsed_fields_count: count,
    missing_fields: missing,
    warnings,
    confidence: clamp(Math.round((count / 12) * 100), 0, 100),
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

function findDecimal(block: string, pattern: RegExp) {
  const value = Number(block.match(pattern)?.[1]);
  return Number.isFinite(value) ? value : null;
}

function findHand(block: string): "LHP" | "RHP" | null {
  const match = block.match(/\b([LR]HP)\b/i);
  return match ? match[1].toUpperCase() as "LHP" | "RHP" : null;
}

function extractPitcherName(block: string) {
  return block.match(/([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)+)/)?.[1]?.trim() ?? null;
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
