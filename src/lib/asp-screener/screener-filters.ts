import { normalizeText } from "@/lib/asp-screener/screener-formatters";
import type { MlbPreparedCriticalValidationPayload } from "@/types/mlbCriticalValidation";
import type {
  MlbHandicapFilter,
  MlbHandicapScreenerRow,
  MlbOpportunityFilter,
  MlbTotalsFilter,
  MlbTotalsScreenerRow,
  MlbUnifiedOpportunity,
} from "@/types/mlbProjections";
import type {
  MlbScreenerHandoffAuditRecord,
  MlbScreenerHandoffAuditStatus,
} from "@/types/mlbScreenerHandoffAudit";
import type { MlbOpportunitySnapshotRecord } from "@/types/mlbScreenerSnapshots";

export function filterSnapshotOpportunityRows(
  rows: MlbOpportunitySnapshotRecord[],
  filters: {
    market: string;
    status: string;
    sent: "all" | "sent" | "not_sent";
    decision: "all" | "CONFIRMAR" | "PULAR" | "pending";
    minScore: number;
    minEv: number;
  },
) {
  return rows.filter((row) => {
    if (filters.market !== "all" && row.market_label !== filters.market) return false;
    if (filters.status !== "all" && row.priority_status !== filters.status) return false;
    if (filters.sent === "sent" && !row.sent_to_validator) return false;
    if (filters.sent === "not_sent" && row.sent_to_validator) return false;
    if (filters.decision === "pending" && row.validator_decision) return false;
    if (
      filters.decision !== "all" &&
      filters.decision !== "pending" &&
      row.validator_decision !== filters.decision
    )
      return false;
    if (
      Number.isFinite(filters.minScore) &&
      filters.minScore > 0 &&
      (row.opportunity_score ?? 0) < filters.minScore
    )
      return false;
    if (Number.isFinite(filters.minEv) && filters.minEv > 0 && (row.ev ?? 0) * 100 < filters.minEv)
      return false;
    return true;
  });
}

export function findOpportunityForCriticalPayload(
  rows: MlbUnifiedOpportunity[],
  payload: MlbPreparedCriticalValidationPayload,
) {
  return rows.find(
    (row) =>
      row.game_id === payload.game.game_id &&
      row.market_label === payload.opportunity.market &&
      (row.pick_label ?? null) === (payload.opportunity.pick ?? null) &&
      row.line === payload.opportunity.line,
  );
}

export function filterHandoffAuditRows(
  rows: MlbScreenerHandoffAuditRecord[],
  filters: {
    status: MlbScreenerHandoffAuditStatus | "all";
    market: string;
    decision: "all" | "CONFIRMAR" | "PULAR" | "pending";
    minScore: number;
    minEv: number;
  },
) {
  return rows.filter((row) => {
    if (filters.status !== "all" && row.status !== filters.status) return false;
    if (filters.market !== "all" && row.market !== filters.market) return false;
    if (filters.decision === "pending" && row.validator_decision) return false;
    if (
      filters.decision !== "all" &&
      filters.decision !== "pending" &&
      row.validator_decision !== filters.decision
    )
      return false;
    if (
      Number.isFinite(filters.minScore) &&
      filters.minScore > 0 &&
      (row.opportunity_score ?? 0) < filters.minScore
    )
      return false;
    if (Number.isFinite(filters.minEv) && filters.minEv > 0 && (row.ev ?? 0) * 100 < filters.minEv)
      return false;
    return true;
  });
}

export function filterCalibrationRows(
  rows: MlbScreenerHandoffAuditRecord[],
  filters: {
    status: MlbScreenerHandoffAuditStatus | "all";
    market: string;
    decision: "all" | "CONFIRMAR" | "PULAR" | "pending";
    priorityStatus: string;
    readinessStatus: string;
    alignmentStatus: string;
    minScore: number;
    maxScore: number;
    minConfidence: number;
    maxConfidence: number;
    minEv: number;
    homeTeam: string;
    awayTeam: string;
  },
) {
  return rows.filter((row) => {
    if (filters.status !== "all" && row.status !== filters.status) return false;
    if (filters.market !== "all" && row.market !== filters.market) return false;
    if (filters.decision === "pending" && row.validator_decision) return false;
    if (
      filters.decision !== "all" &&
      filters.decision !== "pending" &&
      row.validator_decision !== filters.decision
    )
      return false;
    if (filters.priorityStatus !== "all" && row.priority_status !== filters.priorityStatus)
      return false;
    if (filters.readinessStatus !== "all" && row.readiness_status !== filters.readinessStatus)
      return false;
    if (filters.alignmentStatus !== "all" && row.alignment_status !== filters.alignmentStatus)
      return false;
    if (
      Number.isFinite(filters.minScore) &&
      filters.minScore > 0 &&
      (row.opportunity_score ?? 0) < filters.minScore
    )
      return false;
    if (
      Number.isFinite(filters.maxScore) &&
      filters.maxScore > 0 &&
      (row.opportunity_score ?? 0) > filters.maxScore
    )
      return false;
    if (
      Number.isFinite(filters.minConfidence) &&
      filters.minConfidence > 0 &&
      (row.confidence_score ?? 0) < filters.minConfidence
    )
      return false;
    if (
      Number.isFinite(filters.maxConfidence) &&
      filters.maxConfidence > 0 &&
      (row.confidence_score ?? 0) > filters.maxConfidence
    )
      return false;
    if (Number.isFinite(filters.minEv) && filters.minEv > 0 && (row.ev ?? 0) * 100 < filters.minEv)
      return false;
    if (
      filters.homeTeam.trim() &&
      !normalizeText(row.home_team).includes(normalizeText(filters.homeTeam))
    )
      return false;
    if (
      filters.awayTeam.trim() &&
      !normalizeText(row.away_team).includes(normalizeText(filters.awayTeam))
    )
      return false;
    return true;
  });
}

export function filterTotalsRows(rows: MlbTotalsScreenerRow[], filter: MlbTotalsFilter) {
  if (filter === "todos") return rows;
  if (filter === "main") return rows.filter((row) => row.is_main_total_line);
  if (filter === "alternate") return rows.filter((row) => !row.is_main_total_line);
  return rows.filter((row) => row.candidate_status === filter);
}

export function filterHandicapRows(rows: MlbHandicapScreenerRow[], filter: MlbHandicapFilter) {
  if (filter === "todos") return rows;
  if (filter === "main") return rows.filter((row) => row.is_main_handicap_line);
  if (filter === "alternate") return rows.filter((row) => !row.is_main_handicap_line);
  return rows.filter((row) => row.candidate_status === filter);
}

export function filterOpportunityRows(
  rows: MlbUnifiedOpportunity[],
  opts: {
    filter: MlbOpportunityFilter;
    hideCorrelatedAlternatives: boolean;
    minEv: number;
    minScore: number;
  },
) {
  const minEv = Number.isFinite(opts.minEv) ? opts.minEv / 100 : null;
  const minScore = Number.isFinite(opts.minScore) ? opts.minScore : null;
  return rows.filter((row) => {
    if (opts.hideCorrelatedAlternatives && row.correlation_status === "correlated_alternative")
      return false;
    if (minEv != null && (row.ev == null || row.ev < minEv)) return false;
    if (minScore != null && row.opportunity_score < minScore) return false;
    if (opts.filter === "todos") return true;
    if (opts.filter === "shortlist") return row.is_primary_shortlist;
    if (opts.filter === "analisar") return row.priority_status === "ANALISAR";
    if (opts.filter === "monitorar") return row.priority_status === "MONITORAR";
    if (opts.filter === "pular") return row.priority_status === "PULAR";
    if (opts.filter === "missing_data") return row.priority_status === "MISSING_DATA";
    if (opts.filter === "unsupported_line") return row.priority_status === "UNSUPPORTED_LINE";
    if (opts.filter === "moneyline") return row.market_family === "moneyline";
    if (opts.filter === "totals") return row.market_family === "totals";
    if (opts.filter === "handicap") return row.market_family === "handicap";
    if (opts.filter === "main") return row.is_main_line;
    if (opts.filter === "alternate") return !row.is_main_line;
    return true;
  });
}
