import type { Database, Json } from "@/integrations/supabase/types";
import { supabase } from "@/lib/supabase-public";

export type AnalysisSport = "football" | "baseball" | "basketball";
export type AnalysisSportFilter = "all" | AnalysisSport;

type FootballMatch =
  Database["public"]["Functions"]["get_football_daily_matches"]["Returns"][number];
type BaseballMatch =
  Database["public"]["Functions"]["get_baseball_daily_matches"]["Returns"][number];
type BasketballMatch =
  Database["public"]["Functions"]["get_basketball_daily_matches"]["Returns"][number];

export type DailyMatch = (FootballMatch | BaseballMatch | BasketballMatch) & {
  sport: AnalysisSport;
};

export type JsonRecord = Record<string, Json | undefined>;

export interface MatchDetail {
  match: JsonRecord;
  periodScores: JsonRecord[];
  teamStatistics: JsonRecord[];
  teamFormStatistics: JsonRecord[];
  odds: JsonRecord[];
  oddsConsensus: JsonRecord[];
  oddsMovement: JsonRecord[];
  lineups: JsonRecord[];
  events: JsonRecord[];
  playerBoxScores: JsonRecord[];
  startingPitcherStatistics: JsonRecord[];
  standings: JsonRecord[];
  highlights: JsonRecord[];
  analyticsPresets: JsonRecord;
}

export const analysisSportLabels: Record<AnalysisSportFilter, string> = {
  all: "Todos",
  football: "Football",
  baseball: "MLB",
  basketball: "WNBA",
};

const sportFunctions = {
  football: {
    daily: "get_football_daily_matches",
    detail: "get_football_match_detail",
  },
  baseball: {
    daily: "get_baseball_daily_matches",
    detail: "get_baseball_match_detail",
  },
  basketball: {
    daily: "get_basketball_daily_matches",
    detail: "get_basketball_match_detail",
  },
} as const;

export function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function jsonArray(value: Json | undefined): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isJsonRecord) : [];
}

export function jsonString(value: Json | undefined): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function jsonNumber(value: Json | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function localDateRange(date: string): { from: string; to: string } {
  const fromDate = new Date(`${date}T00:00:00`);
  if (Number.isNaN(fromDate.getTime())) throw new Error("Data inválida");
  const toDate = new Date(fromDate);
  toDate.setDate(toDate.getDate() + 1);
  return { from: fromDate.toISOString(), to: toDate.toISOString() };
}

async function fetchSportMatches(sport: AnalysisSport, date: string): Promise<DailyMatch[]> {
  const { from, to } = localDateRange(date);
  const fn = sportFunctions[sport].daily;
  const { data, error } = await supabase.rpc(fn, {
    p_from: from,
    p_to: to,
    p_limit: 200,
  });

  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((match) => Boolean(match.match_id))
    .map((match) => ({ ...match, sport })) as DailyMatch[];
}

export async function fetchDailyMatches(
  sport: AnalysisSportFilter,
  date: string,
): Promise<DailyMatch[]> {
  const sports: AnalysisSport[] =
    sport === "all" ? ["football", "baseball", "basketball"] : [sport];
  const groups = await Promise.all(sports.map((item) => fetchSportMatches(item, date)));
  return groups.flat().sort((a, b) => {
    const byTime = String(a.kickoff_at ?? "").localeCompare(String(b.kickoff_at ?? ""));
    return byTime || String(a.match_id).localeCompare(String(b.match_id));
  });
}

function detailFromJson(value: Json): MatchDetail {
  const root = isJsonRecord(value) ? value : {};
  return {
    match: isJsonRecord(root.match) ? root.match : {},
    periodScores: jsonArray(root.periodScores),
    teamStatistics: jsonArray(root.teamStatistics),
    teamFormStatistics: jsonArray(root.teamFormStatistics),
    odds: jsonArray(root.odds),
    oddsConsensus: jsonArray(root.oddsConsensus),
    oddsMovement: jsonArray(root.oddsMovement),
    lineups: jsonArray(root.lineups),
    events: jsonArray(root.events),
    playerBoxScores: jsonArray(root.playerBoxScores),
    startingPitcherStatistics: jsonArray(root.startingPitcherStatistics),
    standings: jsonArray(root.standings),
    highlights: jsonArray(root.highlights),
    analyticsPresets: isJsonRecord(root.analyticsPresets) ? root.analyticsPresets : {},
  };
}

export async function fetchMatchDetail(
  sport: AnalysisSport,
  matchId: string,
): Promise<MatchDetail> {
  const fn = sportFunctions[sport].detail;
  const { data, error } = await supabase.rpc(fn, { p_match_id: matchId });
  if (error) throw new Error(error.message);
  return detailFromJson(data);
}

function numericFromRecord(record: JsonRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = jsonNumber(record[key]);
    if (value !== null) return value;
  }
  return null;
}

export function getMatchScore(match: DailyMatch, side: "home" | "away"): number | null {
  const sideData = isJsonRecord(side === "home" ? match.home_score_data : match.away_score_data)
    ? side === "home"
      ? match.home_score_data
      : match.away_score_data
    : null;
  if (sideData && isJsonRecord(sideData)) {
    const direct = numericFromRecord(sideData, ["current", "total", "runs", "score"]);
    if (direct !== null) return direct;
  }

  if (isJsonRecord(match.score_data)) {
    const current = match.score_data.current;
    if (Array.isArray(current)) {
      return jsonNumber(current[side === "home" ? 0 : 1]);
    }
    const sideScore = match.score_data[side];
    if (isJsonRecord(sideScore)) {
      return numericFromRecord(sideScore, ["current", "total", "runs", "score"]);
    }
  }
  return null;
}

export function formatAnalysisDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
  })
    .format(parsed)
    .replace(" de ", " ");
}

export function matchStatusLabel(status: string | null): string {
  const value = String(status ?? "").toLowerCase();
  if (["finished", "final", "ended", "complete"].includes(value)) return "Finalizado";
  if (["live", "in_progress", "playing", "halftime"].includes(value)) return "Ao vivo";
  if (["cancelled", "canceled", "postponed"].includes(value)) return "Adiado";
  return "Agendado";
}
