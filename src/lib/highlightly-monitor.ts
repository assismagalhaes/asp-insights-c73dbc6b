import type { Json } from "@/integrations/supabase/types";
import { supabase } from "@/lib/supabase-public";

export interface MonitorScope {
  scope: string;
  status: string;
  sports: string[];
  started_at: string | null;
  ended_at: string | null;
  updated_at: string | null;
}

export interface MonitorDailyUsage {
  request_date: string;
  daily_limit: number;
  reserve_requests: number;
  usable_ceiling: number;
  requests_used: number;
  remaining_before_reserve: number;
}

export interface MonitorQueue {
  total: number;
  pending: number;
  running: number;
  retry: number;
  succeeded: number;
  dead: number;
  cancelled: number;
  active: number;
  latest_activity_at: string | null;
}

export interface MonitorSportRow {
  sport: string;
  total: number;
  pending: number;
  running: number;
  retry: number;
  succeeded: number;
  dead: number;
  latest_activity_at: string | null;
}

export interface MonitorEndpointRow {
  sport: string;
  endpoint_key: string;
  total: number;
  active: number;
  succeeded: number;
  retry: number;
  dead: number;
  latest_activity_at: string | null;
}

export interface MonitorDateRow {
  data_date: string;
  discovery_jobs: number;
  succeeded: number;
  active: number;
  latest_activity_at: string | null;
}

export interface MonitorRunningJob {
  id: string;
  sport: string;
  endpoint_key: string;
  worker_id: string | null;
  locked_at: string | null;
  lock_expires_at: string | null;
  lock_state: "active" | "expired";
}

export interface MonitorErrorRow {
  id: string;
  sport: string;
  endpoint_key: string;
  status: string;
  attempts: number;
  max_attempts: number;
  error: string;
  updated_at: string | null;
}

export interface MonitorQualityRow {
  severity: string;
  sport: string;
  open_issues: number;
}

export interface MonitorCurrentSlice {
  data_start?: string;
  data_end?: string;
  backfill_days?: number;
  status?: string;
  started_at?: string;
  worker_id?: string;
}

export interface HighlightlyCollectionMonitor {
  generated_at: string;
  scope: string | null;
  provider_enabled: boolean;
  daily_usage: MonitorDailyUsage;
  scopes: MonitorScope[];
  window: {
    id?: string;
    status?: string;
    sports?: string[];
    started_at?: string;
    planned_end_at?: string;
    ended_at?: string | null;
    daily_request_budget?: number;
    reserve_requests?: number;
    current_slice?: MonitorCurrentSlice | null;
    updated_at?: string;
  };
  queue: MonitorQueue;
  running_jobs: MonitorRunningJob[];
  by_sport: MonitorSportRow[];
  by_endpoint: MonitorEndpointRow[];
  by_date: MonitorDateRow[];
  recent_errors: MonitorErrorRow[];
  quality: MonitorQualityRow[];
  health: Record<string, Json | undefined>;
}

export async function fetchHighlightlyCollectionMonitor(
  scope?: string | null,
): Promise<HighlightlyCollectionMonitor> {
  const { data, error } = await supabase.rpc("get_highlightly_collection_monitor", {
    p_scope: scope || undefined,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("O monitor Highlightly retornou um payload inválido.");
  }
  return data as unknown as HighlightlyCollectionMonitor;
}
