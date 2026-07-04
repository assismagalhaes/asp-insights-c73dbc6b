import { supabase } from "@/lib/supabase-public";
import type {
  MlbScreenerHandoffAuditCompletion,
  MlbScreenerHandoffAuditListFilters,
  MlbScreenerHandoffAuditRecord,
} from "@/types/mlbScreenerHandoffAudit";
import type {
  MlbScreenerHandoffAuditStatus,
  MlbValidatorHandoffPayload,
} from "@/types/mlbValidatorHandoff";

type HandoffTarget = Pick<MlbValidatorHandoffPayload, "handoff_id" | "audit"> | string;
type ValidatorCompletionResult = {
  decision: string;
  adjusted_probability: number;
  adjusted_ev: number | null;
  final_analysis: string;
};

const auditDb = supabase as unknown as {
  from: (table: "asp_screener_validator_handoffs") => {
    select: (columns: string) => AuditQuery;
    insert: (payload: unknown) => {
      select: (columns: string) => {
        single: () => Promise<{ data: MlbScreenerHandoffAuditRecord | null; error: Error | null }>;
      };
    };
    update: (payload: unknown) => AuditFilter;
  };
};

const HANDOFF_AUDIT_COLUMNS = [
  "id",
  "user_id",
  "created_at",
  "updated_at",
  "handoff_id",
  "handoff_version",
  "source_module",
  "source_sport",
  "source_league",
  "source_stage",
  "status",
  "sent_at",
  "applied_at",
  "discarded_at",
  "expires_at",
  "validation_started_at",
  "validation_completed_at",
  "game_id",
  "event_date",
  "event_time",
  "home_team",
  "away_team",
  "matchup",
  "market",
  "pick",
  "line",
  "odd",
  "bookmaker",
  "model_probability",
  "market_probability_no_vig",
  "fair_odd",
  "ev",
  "opportunity_score",
  "confidence_score",
  "priority_status",
  "readiness_status",
  "alignment_status",
  "alignment_score",
  "validator_record_id",
  "validator_decision",
  "validator_adjusted_probability",
  "validator_final_ev",
  "validator_reason",
  "opportunity_payload",
  "critical_payload",
  "handoff_payload",
  "validator_context_payload",
  "metadata",
].join(",");

type AuditQuery = {
  eq: (column: string, value: string) => AuditQuery;
  order: (column: string, options: { ascending: boolean }) => AuditQuery;
  limit: (
    count: number,
  ) => Promise<{ data: MlbScreenerHandoffAuditRecord[] | null; error: Error | null }>;
  single: () => Promise<{ data: MlbScreenerHandoffAuditRecord | null; error: Error | null }>;
};

type AuditFilter = {
  eq: (
    column: string,
    value: string,
  ) => Promise<{ data?: MlbScreenerHandoffAuditRecord[] | null; error: Error | null }>;
};

export async function createScreenerValidatorHandoffAudit(
  handoff: MlbValidatorHandoffPayload,
): Promise<MlbScreenerHandoffAuditRecord> {
  const payload = buildAuditInsertPayload(handoff, "sent_to_validator");
  const { data, error } = await auditDb
    .from("asp_screener_validator_handoffs")
    .insert(payload)
    .select(HANDOFF_AUDIT_COLUMNS)
    .single();
  if (error) throw error;
  if (!data) throw new Error("Auditoria do handoff nao retornou registro criado.");
  return data;
}

export async function updateScreenerValidatorHandoffStatus(
  target: HandoffTarget,
  status: MlbScreenerHandoffAuditStatus,
  extra: object = {},
) {
  const identifier = resolveHandoffIdentifier(target);
  if (!identifier) return null;
  const payload = {
    status,
    ...timestampPatch(status),
    ...extra,
  };
  const query = auditDb.from("asp_screener_validator_handoffs").update(payload);
  const { error } = await query.eq(identifier.column, identifier.value);
  if (error) throw error;
  return true;
}

export function markHandoffSentToValidator(handoff: MlbValidatorHandoffPayload) {
  return updateScreenerValidatorHandoffStatus(handoff, "sent_to_validator");
}

export function markHandoffAppliedInValidator(handoff: MlbValidatorHandoffPayload) {
  return updateScreenerValidatorHandoffStatus(handoff, "applied_in_validator");
}

export function markHandoffDiscarded(handoff: MlbValidatorHandoffPayload) {
  return updateScreenerValidatorHandoffStatus(handoff, "discarded");
}

export function markHandoffExpired(handoff: MlbValidatorHandoffPayload) {
  return updateScreenerValidatorHandoffStatus(handoff, "expired");
}

export function markHandoffValidationStarted(handoff: MlbValidatorHandoffPayload) {
  return updateScreenerValidatorHandoffStatus(handoff, "validation_started");
}

export function markHandoffValidationCompleted(
  handoff: MlbValidatorHandoffPayload,
  completion: MlbScreenerHandoffAuditCompletion,
) {
  return updateScreenerValidatorHandoffStatus(handoff, "validation_completed", completion);
}

export function markHandoffValidationFailed(handoff: MlbValidatorHandoffPayload, error: unknown) {
  return updateScreenerValidatorHandoffStatus(handoff, "validation_failed", {
    metadata: {
      validation_error:
        error instanceof Error ? error.message : String(error ?? "Erro desconhecido"),
      failed_at: new Date().toISOString(),
    },
  });
}

export function linkHandoffToValidatorRecord(
  handoff: MlbValidatorHandoffPayload,
  validatorRecordId: string,
  result: ValidatorCompletionResult,
) {
  return markHandoffValidationCompleted(handoff, {
    validator_record_id: validatorRecordId,
    validator_decision: result.decision,
    validator_adjusted_probability: result.adjusted_probability,
    validator_final_ev: result.adjusted_ev,
    validator_reason: result.final_analysis,
  });
}

export async function listScreenerValidatorHandoffs(
  filters: MlbScreenerHandoffAuditListFilters = {},
) {
  const limit = filters.limit ?? 500;
  const { data, error } = await auditDb
    .from("asp_screener_validator_handoffs")
    .select(HANDOFF_AUDIT_COLUMNS)
    .eq("source_module", "asp_screener")
    .eq("source_sport", "baseball")
    .eq("source_league", "MLB")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return filterByPeriod(data ?? [], filters.period ?? "all");
}

export async function getScreenerValidatorHandoffById(id: string) {
  const { data, error } = await auditDb
    .from("asp_screener_validator_handoffs")
    .select(HANDOFF_AUDIT_COLUMNS)
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

function buildAuditInsertPayload(
  handoff: MlbValidatorHandoffPayload,
  status: MlbScreenerHandoffAuditStatus,
) {
  const critical = handoff.raw_critical_payload;
  const prefill = handoff.validator_prefill;
  return {
    handoff_id: handoff.handoff_id,
    handoff_version: handoff.handoff_version,
    source_module: "asp_screener",
    source_sport: "baseball",
    source_league: "MLB",
    source_stage: critical.stage,
    status,
    sent_at: new Date().toISOString(),
    expires_at: handoff.expires_at,
    game_id: critical.game.game_id,
    event_date: prefill.event_date,
    event_time: prefill.event_time,
    home_team: prefill.home_team,
    away_team: prefill.away_team,
    matchup: prefill.matchup,
    market: prefill.market,
    pick: prefill.pick,
    line: prefill.line == null ? null : String(prefill.line),
    odd: prefill.odd,
    bookmaker: critical.opportunity.bookmaker_melhor,
    model_probability: prefill.model_probability,
    market_probability_no_vig: prefill.market_probability_no_vig,
    fair_odd: prefill.fair_odd,
    ev: prefill.ev,
    opportunity_score: prefill.opportunity_score,
    confidence_score: prefill.confidence_score,
    priority_status: critical.opportunity.priority_status,
    readiness_status: prefill.readiness_status,
    alignment_status: critical.context_alignment.alignment_status,
    alignment_score: critical.context_alignment.alignment_score,
    opportunity_payload: critical.opportunity,
    critical_payload: critical,
    handoff_payload: handoff,
    validator_context_payload: handoff.imported_context,
    metadata: {
      created_by: "asp_screener_mlb",
      source_created_at: critical.created_at,
    },
  };
}

function resolveHandoffIdentifier(target: HandoffTarget) {
  if (typeof target === "string") return { column: "id", value: target };
  if (target.audit?.record_id) return { column: "id", value: target.audit.record_id };
  if (target.handoff_id) return { column: "handoff_id", value: target.handoff_id };
  return null;
}

function timestampPatch(status: MlbScreenerHandoffAuditStatus) {
  const now = new Date().toISOString();
  if (status === "sent_to_validator") return { sent_at: now };
  if (status === "applied_in_validator") return { applied_at: now };
  if (status === "discarded") return { discarded_at: now };
  if (status === "validation_started") return { validation_started_at: now };
  if (status === "validation_completed") return { validation_completed_at: now };
  return {};
}

function filterByPeriod(
  rows: MlbScreenerHandoffAuditRecord[],
  period: MlbScreenerHandoffAuditListFilters["period"],
) {
  if (!period || period === "all") return rows;
  const now = Date.now();
  const minTime =
    period === "today"
      ? new Date(new Date().toISOString().slice(0, 10)).getTime()
      : now - (period === "7d" ? 7 : 30) * 24 * 60 * 60 * 1000;
  return rows.filter((row) => new Date(row.created_at).getTime() >= minTime);
}
