import { supabase } from "@/lib/supabase-public";

export interface HighlightlyOddsQualitySport {
  sport: string;
  matches_discovered: number;
  matches_due: number;
  matches_available: number;
  matches_stale: number;
  availability_pct: number | null;
  target_availability_pct: number;
  gate_status: "ready" | "below_target" | "no_due_matches";
  freshness_p95_seconds: number | null;
}

export interface HighlightlyOddsQualityCause {
  sport: string;
  cause: string;
  matches: number;
}

export interface HighlightlyOddsQualityMatch {
  match_id: string;
  sport: string;
  external_match_id: string;
  kickoff_at: string;
  country_name: string | null;
  competition_name: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  odds_due: boolean;
  cause: string;
  open_quotes: number;
  bookmaker_count: number;
  market_count: number;
  last_quote_at: string | null;
  freshness_seconds: number | null;
  freshness_target_seconds: number;
  latest_job_status: string | null;
  issue_codes: string[];
}

export interface HighlightlyOddsQualityReport {
  generated_at: string;
  from: string;
  to: string;
  cadence: string[];
  by_sport: HighlightlyOddsQualitySport[];
  by_cause: HighlightlyOddsQualityCause[];
  matches: HighlightlyOddsQualityMatch[];
}

export async function fetchHighlightlyOddsQualityReport(): Promise<HighlightlyOddsQualityReport> {
  const { data, error } = await supabase.rpc("get_highlightly_odds_quality_report", {});
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("O diagnóstico de odds retornou um payload inválido.");
  }
  return data as unknown as HighlightlyOddsQualityReport;
}
