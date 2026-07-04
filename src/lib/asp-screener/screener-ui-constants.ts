import type { MlbScreenerHandoffAuditStatus } from "@/types/mlbScreenerHandoffAudit";

export const MLB_SCREENER_ODDS_LIMIT = 5000;
export const SNAPSHOT_OPPORTUNITY_PAGE_SIZE = 500;

export const HANDOFF_AUDIT_STATUSES: MlbScreenerHandoffAuditStatus[] = [
  "created",
  "sent_to_validator",
  "applied_in_validator",
  "discarded",
  "expired",
  "validation_started",
  "validation_completed",
  "validation_failed",
];

export const SNAPSHOT_PRIORITY_STATUSES = [
  "ANALISAR",
  "MONITORAR",
  "PULAR",
  "MISSING_DATA",
  "UNSUPPORTED_LINE",
];
