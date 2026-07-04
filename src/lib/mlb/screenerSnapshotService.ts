import { supabase } from "@/lib/supabase-public";
import type { MlbUnifiedOpportunity } from "@/types/mlbProjections";
import type {
  MlbDailyScreenerSnapshotRecord,
  MlbOpportunitySnapshotRecord,
  MlbScreenerSnapshotRunInput,
  MlbScreenerSnapshotRunResult,
  MlbSnapshotOpportunityFilters,
} from "@/types/mlbScreenerSnapshots";

const snapshotDb = supabase as unknown as {
  from: (table: "asp_screener_mlb_daily_snapshots") => {
    select: (columns: string) => SnapshotQuery<MlbDailyScreenerSnapshotRecord>;
    insert: (payload: unknown) => {
      select: (columns: string) => {
        single: () => Promise<{ data: MlbDailyScreenerSnapshotRecord | null; error: Error | null }>;
      };
    };
    update: (payload: unknown) => SnapshotUpdate;
  };
} & {
  from: (table: "asp_screener_mlb_opportunity_snapshots") => {
    select: (columns: string) => SnapshotQuery<MlbOpportunitySnapshotRecord>;
    insert: (payload: unknown) => {
      select: (columns: string) => Promise<{ data: MlbOpportunitySnapshotRecord[] | null; error: Error | null }>;
    };
    update: (payload: unknown) => SnapshotUpdate;
  };
};

type SnapshotQuery<T> = {
  eq: (column: string, value: string | boolean) => SnapshotQuery<T>;
  order: (column: string, options: { ascending: boolean }) => SnapshotQuery<T>;
  limit: (count: number) => Promise<{ data: T[] | null; error: Error | null }>;
  single: () => Promise<{ data: T | null; error: Error | null }>;
};

type SnapshotUpdate = {
  eq: (column: string, value: string | boolean) => Promise<{ error: Error | null }>;
};

export async function createMlbDailyScreenerSnapshot(input: MlbScreenerSnapshotRunInput) {
  const runId = input.runId ?? buildMlbScreenerRunId(input.snapshotDate);
  const counts = getOpportunityCounts(input.opportunities);
  const payload = {
    snapshot_date: input.snapshotDate,
    run_id: runId,
    season: input.season,
    source_module: "asp_screener",
    source_sport: "baseball",
    source_league: "MLB",
    odds_rows_count: input.oddsRowsCount,
    games_count: input.gamesCount,
    standings_snapshot_date: input.standingsSnapshot?.snapshot_date ?? null,
    standings_source: input.standingsSnapshot?.source ?? null,
    moneyline_rows_count: input.moneylineRowsCount,
    totals_rows_count: input.totalsRowsCount,
    handicap_rows_count: input.handicapRowsCount,
    unified_opportunities_count: input.opportunities.length,
    shortlist_primary_count: counts.shortlistPrimary,
    analyze_count: counts.ANALISAR,
    monitor_count: counts.MONITORAR,
    skip_count: counts.PULAR,
    missing_data_count: counts.MISSING_DATA,
    unsupported_line_count: counts.UNSUPPORTED_LINE,
    status: "created",
    execution_summary: toJsonSafe({
      counts,
      generated_at: new Date().toISOString(),
    }),
    filters_payload: toJsonSafe(input.filtersPayload ?? {}),
    metadata: toJsonSafe(input.metadata ?? {}),
  };
  const { data, error } = await snapshotDb.from("asp_screener_mlb_daily_snapshots").insert(payload).select("*").single();
  if (error) throw error;
  if (!data) throw new Error("Snapshot diario nao retornou registro criado.");
  return data;
}

export async function saveMlbOpportunitySnapshots(
  daily: MlbDailyScreenerSnapshotRecord,
  opportunities: MlbUnifiedOpportunity[],
) {
  if (!opportunities.length) return [];
  const payloads = opportunities.map((opportunity) => buildOpportunitySnapshotPayload(daily, opportunity));
  const { data, error } = await snapshotDb.from("asp_screener_mlb_opportunity_snapshots").insert(payloads).select("*");
  if (error) throw error;
  return data ?? [];
}

export async function saveMlbScreenerRunSnapshot(input: MlbScreenerSnapshotRunInput): Promise<MlbScreenerSnapshotRunResult> {
  const daily = await createMlbDailyScreenerSnapshot(input);
  try {
    const opportunities = await saveMlbOpportunitySnapshots(daily, input.opportunities);
    await snapshotDb.from("asp_screener_mlb_daily_snapshots").update({ status: "completed" }).eq("id", daily.id);
    return { daily: { ...daily, status: "completed" }, opportunities };
  } catch (error) {
    await snapshotDb
      .from("asp_screener_mlb_daily_snapshots")
      .update({
        status: "partially_completed",
        metadata: {
          ...toJsonSafe(daily.metadata ?? {}),
          opportunity_save_error: error instanceof Error ? error.message : String(error ?? "Erro desconhecido"),
        },
      })
      .eq("id", daily.id);
    throw error;
  }
}

export async function listMlbDailyScreenerSnapshots(limit = 25) {
  const { data, error } = await snapshotDb
    .from("asp_screener_mlb_daily_snapshots")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function listMlbOpportunitySnapshots(filters: MlbSnapshotOpportunityFilters = {}) {
  let query = snapshotDb
    .from("asp_screener_mlb_opportunity_snapshots")
    .select("*")
    .order("created_at", { ascending: false });
  if (filters.dailySnapshotId) query = query.eq("daily_snapshot_id", filters.dailySnapshotId);
  if (filters.runId) query = query.eq("run_id", filters.runId);
  const { data, error } = await query.limit(filters.limit ?? 1000);
  if (error) throw error;
  return data ?? [];
}

export async function getMlbScreenerSnapshotByRunId(runId: string) {
  const { data, error } = await snapshotDb.from("asp_screener_mlb_daily_snapshots").select("*").eq("run_id", runId).single();
  if (error) throw error;
  return data;
}

export async function updateMlbOpportunitySentToValidator(opportunityId: string, handoffId: string) {
  const { error } = await snapshotDb
    .from("asp_screener_mlb_opportunity_snapshots")
    .update({
      sent_to_validator: true,
      handoff_id: handoffId,
    })
    .eq("opportunity_id", opportunityId);
  if (error) throw error;
  return true;
}

export function linkMlbOpportunitySnapshotToHandoff(opportunityId: string, handoffId: string) {
  return updateMlbOpportunitySentToValidator(opportunityId, handoffId);
}

export async function linkMlbOpportunitySnapshotToValidatorRecord(
  handoffId: string,
  validatorRecordId: string,
  validatorDecision: string,
) {
  const { error } = await snapshotDb
    .from("asp_screener_mlb_opportunity_snapshots")
    .update({
      validator_record_id: validatorRecordId,
      validator_decision: validatorDecision,
    })
    .eq("handoff_id", handoffId);
  if (error) throw error;
  return true;
}

export function buildMlbScreenerRunId(snapshotDate: string) {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${snapshotDate}_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${suffix}`;
}

function buildOpportunitySnapshotPayload(daily: MlbDailyScreenerSnapshotRecord, opportunity: MlbUnifiedOpportunity) {
  return {
    daily_snapshot_id: daily.id,
    run_id: daily.run_id,
    opportunity_id: opportunity.opportunity_id,
    game_id: opportunity.game_id,
    event_date: opportunity.date,
    event_time: opportunity.time,
    home_team: opportunity.home_team,
    away_team: opportunity.away_team,
    matchup: opportunity.matchup,
    market_family: opportunity.market_family,
    market_label: opportunity.market_label,
    pick_label: opportunity.pick_label,
    selection_team: opportunity.selection_team,
    side: opportunity.side,
    line: opportunity.line == null ? null : String(opportunity.line),
    line_type: opportunity.line_type,
    is_main_line: opportunity.is_main_line,
    distance_from_main_line: opportunity.distance_from_main_line,
    offered_odd: opportunity.offered_odd,
    bookmaker: opportunity.bookmaker_melhor,
    market_prob_no_vig: opportunity.market_prob_no_vig,
    model_prob: opportunity.model_prob,
    probability_edge: opportunity.probability_edge,
    fair_odd: opportunity.fair_odd,
    ev: opportunity.ev,
    opportunity_score: opportunity.opportunity_score,
    confidence_score: opportunity.confidence_score,
    priority_status: opportunity.priority_status,
    base_candidate_status: opportunity.base_candidate_status,
    projection_status: opportunity.projection_status,
    rank: opportunity.rank,
    is_primary_shortlist: opportunity.is_primary_shortlist,
    correlation_group_id: opportunity.correlation_group_id,
    correlation_status: opportunity.correlation_status,
    correlated_with: opportunity.correlated_with,
    reasons: toJsonSafe(opportunity.reasons),
    alerts: toJsonSafe(opportunity.alerts),
    risk_flags: toJsonSafe(opportunity.risk_flags),
    source_projection_payload: toJsonSafe(opportunity.source_projection_payload),
    opportunity_payload: toJsonSafe(opportunity),
    metadata: toJsonSafe({
      score_components: opportunity.score_components,
      score_explanation: opportunity.score_explanation,
    }),
  };
}

function toJsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => {
      if (item === undefined) return null;
      if (typeof item === "number" && !Number.isFinite(item)) return null;
      return item;
    }),
  ) as T;
}

function getOpportunityCounts(opportunities: MlbUnifiedOpportunity[]) {
  return opportunities.reduce(
    (acc, opportunity) => {
      acc[opportunity.priority_status] += 1;
      if (opportunity.is_primary_shortlist) acc.shortlistPrimary += 1;
      return acc;
    },
    {
      ANALISAR: 0,
      MONITORAR: 0,
      PULAR: 0,
      MISSING_DATA: 0,
      UNSUPPORTED_LINE: 0,
      shortlistPrimary: 0,
    },
  );
}
