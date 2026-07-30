import { supabase } from "@/lib/supabase-public";

export interface HighlightlyOddsQualitySport {
  sport: string;
  matches_discovered: number;
  matches_due: number;
  matches_available: number;
  matches_stale: number;
  availability_pct: number | null;
  target_availability_pct: number;
  gate_status: "ready" | "below_target" | "no_due_matches" | "provider_unavailable";
  freshness_p95_seconds: number | null;
  raw_availability_pct?: number | null;
  eligible_availability_pct?: number | null;
  provider_empty_pct?: number | null;
  matches_eligible?: number;
  matches_provider_empty?: number;
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
  quality_contract_version?: string;
  gate_denominator?: string;
  league_coverage: HighlightlyOddsLeagueCoverageReport;
}

export interface HighlightlyOddsLeagueCoverage {
  sport: string;
  country_name: string | null;
  competition_name: string;
  competition_id: string;
  observed_days: number;
  matches_due: number;
  matches_available: number;
  matches_provider_empty: number;
  matches_other_unavailable: number;
  raw_availability_pct: number | null;
  eligible_availability_pct: number | null;
  provider_empty_pct: number | null;
  refreshed_at: string;
  recommendation:
    | "insufficient_sample"
    | "candidate_t60m_only"
    | "monitor_provider_coverage"
    | "keep_full_cadence";
}

export interface HighlightlyOddsLeagueCoverageReport {
  generated_at: string;
  window_days: number;
  minimum_sample: number;
  automatic_exclusions: false;
  leagues: HighlightlyOddsLeagueCoverage[];
}

export async function fetchHighlightlyOddsQualityReport(): Promise<HighlightlyOddsQualityReport> {
  const [qualityResult, leagueResult] = await Promise.all([
    supabase.rpc("get_highlightly_odds_quality_report_v2", {}),
    supabase.rpc("get_highlightly_odds_league_coverage_report", {
      p_days: 7,
      p_min_matches: 20,
    }),
  ]);
  if (qualityResult.error) throw new Error(qualityResult.error.message);
  if (leagueResult.error) throw new Error(leagueResult.error.message);
  if (
    !qualityResult.data ||
    typeof qualityResult.data !== "object" ||
    Array.isArray(qualityResult.data)
  ) {
    throw new Error("O diagnóstico de odds retornou um payload inválido.");
  }
  if (
    !leagueResult.data ||
    typeof leagueResult.data !== "object" ||
    Array.isArray(leagueResult.data)
  ) {
    throw new Error("A cobertura de odds por liga retornou um payload inválido.");
  }
  return {
    ...(qualityResult.data as unknown as Omit<HighlightlyOddsQualityReport, "league_coverage">),
    league_coverage: leagueResult.data as unknown as HighlightlyOddsLeagueCoverageReport,
  };
}
