import { supabase } from "@/lib/supabase-public";

export interface HighlightlyLifecyclePolicy {
  sport: string;
  enabled: boolean;
  imminent_window_minutes: number;
  prematch_poll_seconds: number;
  live_poll_seconds: number;
  postgame_horizons_minutes: number[];
  required_resources: string[];
  optional_resources: string[];
}

export interface HighlightlyLifecycleStage {
  sport: string;
  lifecycle_stage: string;
  matches: number;
}

export interface HighlightlyLifecycleResource {
  sport: string;
  resource: string;
  status: string;
  matches: number;
}

export interface HighlightlyLifecycleMatch {
  match_id: string;
  sport: string;
  external_match_id: string;
  kickoff_at: string;
  stage: string;
  provider_status: string | null;
  competition_name: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  missing_resources: string[];
  last_polled_at: string | null;
  next_poll_at: string | null;
  updated_at: string;
}

export interface HighlightlyMatchLifecycleReport {
  generated_at: string;
  from: string;
  to: string;
  policies: HighlightlyLifecyclePolicy[];
  by_stage: HighlightlyLifecycleStage[];
  by_resource: HighlightlyLifecycleResource[];
  matches: HighlightlyLifecycleMatch[];
}

export async function fetchHighlightlyMatchLifecycleReport(): Promise<HighlightlyMatchLifecycleReport> {
  const { data, error } = await supabase.rpc("get_highlightly_match_lifecycle_report", {});
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("O monitor do ciclo das partidas retornou um payload inválido.");
  }
  return data as unknown as HighlightlyMatchLifecycleReport;
}
