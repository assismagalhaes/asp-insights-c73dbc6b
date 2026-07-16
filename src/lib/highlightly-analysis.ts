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
  country_code?: string | null;
  country_flag_url?: string | null;
  country_name?: string | null;
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
  baseball: "Baseball",
  basketball: "Basketball",
};

const WNBA_TEAM_NAMES: Record<string, string> = {
  atlanta: "Atlanta Dream W",
  "atlanta dream": "Atlanta Dream W",
  chicago: "Chicago Sky W",
  "chicago sky": "Chicago Sky W",
  connecticut: "Connecticut Sun W",
  "connecticut sun": "Connecticut Sun W",
  dallas: "Dallas Wings W",
  "dallas wings": "Dallas Wings W",
  "golden state": "Golden State Valkyries W",
  "golden state valkyries": "Golden State Valkyries W",
  indiana: "Indiana Fever W",
  "indiana fever": "Indiana Fever W",
  "las vegas": "Las Vegas Aces W",
  "las vegas aces": "Las Vegas Aces W",
  "los angeles": "Los Angeles Sparks W",
  "los angeles sparks": "Los Angeles Sparks W",
  minnesota: "Minnesota Lynx W",
  "minnesota lynx": "Minnesota Lynx W",
  "new york": "New York Liberty W",
  "new york liberty": "New York Liberty W",
  phoenix: "Phoenix Mercury W",
  "phoenix mercury": "Phoenix Mercury W",
  portland: "Portland Fire W",
  "portland fire": "Portland Fire W",
  seattle: "Seattle Storm W",
  "seattle storm": "Seattle Storm W",
  toronto: "Toronto Tempo W",
  "toronto tempo": "Toronto Tempo W",
  washington: "Washington Mystics W",
  "washington mystics": "Washington Mystics W",
};

export type AnalysisDetailTab =
  | "summary"
  | "odds"
  | "statistics"
  | "form"
  | "lineups"
  | "events"
  | "standings"
  | "source";

export type AnalysisDataSource = "statistics" | "form" | "startingPitchers";

export interface AnalysisPreset {
  id: string;
  label: string;
  tab: AnalysisDetailTab;
  source?: AnalysisDataSource;
  metricTerms?: string[];
  marketFamilies?: string[];
}

export const analysisPresets: Record<AnalysisSportFilter, AnalysisPreset[]> = {
  all: [
    { id: "overview", label: "Visão geral", tab: "summary" },
    { id: "odds", label: "Odds e movimento", tab: "odds" },
  ],
  football: [
    { id: "general", label: "Geral / forma", tab: "form", source: "form" },
    {
      id: "goals",
      label: "Gols e xG",
      tab: "statistics",
      source: "statistics",
      metricTerms: ["goal", "gol", "xg", "expected", "shot", "finaliza"],
    },
    {
      id: "result-btts",
      label: "1X2 / BTTS",
      tab: "odds",
      marketFamilies: ["moneyline", "1x2", "result", "btts", "both"],
    },
    {
      id: "corners",
      label: "Cantos",
      tab: "statistics",
      source: "statistics",
      metricTerms: ["corner", "canto", "escanteio"],
    },
    {
      id: "handicap",
      label: "Handicap",
      tab: "odds",
      marketFamilies: ["handicap", "spread"],
    },
    { id: "odds", label: "Odds e movimento", tab: "odds" },
  ],
  baseball: [
    { id: "general", label: "Geral / forma", tab: "form", source: "form" },
    {
      id: "attack",
      label: "Ataque",
      tab: "statistics",
      source: "statistics",
      metricTerms: ["batting", "run", "hit", "attack", "offense", "rebat"],
    },
    {
      id: "starting-pitchers",
      label: "Arremessadores titulares",
      tab: "statistics",
      source: "startingPitchers",
    },
    {
      id: "bullpen",
      label: "Bullpen",
      tab: "statistics",
      source: "statistics",
      metricTerms: ["bullpen", "relief", "save", "pitch"],
    },
    { id: "totals", label: "Totais", tab: "odds", marketFamilies: ["total"] },
    { id: "odds", label: "Odds e movimento", tab: "odds" },
  ],
  basketball: [
    { id: "general", label: "Geral / forma", tab: "form", source: "form" },
    {
      id: "efficiency",
      label: "Eficiência e ritmo",
      tab: "statistics",
      source: "statistics",
      metricTerms: ["rating", "pace", "ritmo", "efficien", "possession", "posse"],
    },
    {
      id: "shooting",
      label: "Arremessos",
      tab: "statistics",
      source: "statistics",
      metricTerms: ["field goal", "pointer", "free throw", "shoot", "arremesso"],
    },
    {
      id: "rebounds-turnovers",
      label: "Rebotes / perdas de bola",
      tab: "statistics",
      source: "statistics",
      metricTerms: ["rebound", "turnover", "rebote", "perda de bola"],
    },
    { id: "totals", label: "Totais", tab: "odds", marketFamilies: ["total"] },
    { id: "odds", label: "Odds e movimento", tab: "odds" },
  ],
};

const ANALYTICS_LABELS: Record<string, string> = {
  home: "Casa",
  away: "Fora",
  total: "Geral",
  "round:post_season": "Pós-temporada",
  "round:postseason": "Pós-temporada",
  "round:preseason": "Pré-temporada",
  "round:regular_season": "Temporada regular",
  "round:regularseason": "Temporada regular",
  "games.played": "Jogos disputados",
  "games.wins": "Vitórias",
  "games.loses": "Derrotas",
  "games.losses": "Derrotas",
  "points.scored": "Pontos marcados",
  "points.received": "Pontos sofridos",
  pace: "Ritmo",
  offensive_rating: "Eficiência ofensiva",
  defensive_rating: "Eficiência defensiva",
  net_rating: "Saldo de eficiência",
  effective_field_goal_percentage: "Aproveitamento efetivo de arremessos",
  true_shooting_percentage: "Aproveitamento real de arremessos",
  "succesful field goals": "Arremessos de quadra convertidos",
  "successful field goals": "Arremessos de quadra convertidos",
  "field goals": "Arremessos de quadra",
  "succesful 3 pointers": "Cestas de 3 convertidas",
  "successful 3 pointers": "Cestas de 3 convertidas",
  "3 pointers": "Arremessos de 3 pontos",
  "succesful free throws": "Lances livres convertidos",
  "successful free throws": "Lances livres convertidos",
  "free throws": "Lances livres",
  assists: "Assistências",
  rebounds: "Rebotes",
  "offensive rebounds": "Rebotes ofensivos",
  "defensive rebounds": "Rebotes defensivos",
  steals: "Roubos de bola",
  blocks: "Tocos",
  turnover: "Perda de bola",
  turnovers: "Perdas de bola",
  "fast break points": "Pontos em contra-ataque",
  "points off turnovers": "Pontos após perdas de bola",
  "points in the paint": "Pontos no garrafão",
  "personal fouls": "Faltas pessoais",
  "second chance points": "Pontos de segunda chance",
  "biggest lead": "Maior vantagem",
  "flagrant fouls": "Faltas flagrantes",
  "technical fouls": "Faltas técnicas",
  batting: "Ataque",
  pitching: "Arremessos",
  fielding: "Defesa",
  starter: "Titular",
  relief: "Bullpen",
};

export function translateAnalyticsLabel(value: string): string {
  const normalized = value.trim().toLocaleLowerCase("en-US");
  const direct = ANALYTICS_LABELS[normalized];
  if (direct) return direct;
  const readable = value.replaceAll("_", " ").replaceAll(".", " ").replaceAll(":", " · ");
  return readable.charAt(0).toLocaleUpperCase("pt-BR") + readable.slice(1);
}

export function normalizeCompetitionName(
  match: Pick<DailyMatch, "sport" | "competition_name" | "competition_short_name">,
): string {
  const name = match.competition_name?.trim() ?? "";
  const shortName = match.competition_short_name?.trim() ?? "";
  if (
    match.sport === "basketball" &&
    (shortName.toUpperCase() === "WNBA" || /^(nba women|wnba)$/i.test(name))
  ) {
    return "WNBA";
  }
  return name || shortName || analysisSportLabels[match.sport];
}

export function normalizeTeamName(
  sport: AnalysisSport,
  value: string | null,
  competitionName?: string | null,
  competitionShortName?: string | null,
): string | null {
  if (!value) return null;
  if (sport !== "basketball") return value;
  const isWnba =
    competitionShortName?.toUpperCase() === "WNBA" ||
    /^(nba women|wnba)$/i.test(competitionName?.trim() ?? "");
  const baseName = value.replace(/\s+(women|woman|w)$/i, "").trim();
  const canonical = WNBA_TEAM_NAMES[baseName.toLocaleLowerCase("en-US")];
  if (!isWnba) return value;
  if (isWnba && canonical) return canonical;
  return `${baseName} W`;
}

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
  const result: DailyMatch[] = [];
  let cursorKickoff: string | undefined;
  let cursorMatchId: string | undefined;

  for (let page = 0; page < 20; page += 1) {
    const { data, error } = await supabase.rpc(fn, {
      p_from: from,
      p_to: to,
      p_limit: 200,
      ...(cursorKickoff && cursorMatchId
        ? { p_cursor_kickoff: cursorKickoff, p_cursor_match_id: cursorMatchId }
        : {}),
    });

    if (error) throw new Error(error.message);
    const rows = (data ?? []).filter((match) => Boolean(match.match_id));
    result.push(...(rows.map((match) => ({ ...match, sport })) as DailyMatch[]));
    if (rows.length < 200) break;

    const last = rows.at(-1);
    if (!last?.kickoff_at || !last.match_id) break;
    cursorKickoff = last.kickoff_at;
    cursorMatchId = last.match_id;
  }

  return result.map((match) => ({
    ...match,
    competition_name: normalizeCompetitionName(match),
    home_team_name: normalizeTeamName(
      sport,
      match.home_team_name,
      match.competition_name,
      match.competition_short_name,
    ),
    away_team_name: normalizeTeamName(
      sport,
      match.away_team_name,
      match.competition_name,
      match.competition_short_name,
    ),
  }));
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
