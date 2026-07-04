import { toast } from "sonner";
import { todayIso } from "@/lib/asp-screener/screener-formatters";
import {
  getRiskFlags,
  getSnapshotPayloadNumber,
  getSnapshotPayloadString,
} from "@/lib/asp-screener/screener-stats";
import type { MlbScreenerHandoffAuditRecord } from "@/types/mlbScreenerHandoffAudit";
import type {
  MlbDailyScreenerSnapshotRecord,
  MlbOpportunitySnapshotRecord,
} from "@/types/mlbScreenerSnapshots";

export async function copyCalibrationPayload(row: MlbScreenerHandoffAuditRecord) {
  try {
    await navigator.clipboard.writeText(
      JSON.stringify(row.handoff_payload || row.critical_payload, null, 2),
    );
    toast.success("Payload de calibracao copiado.");
  } catch {
    toast.error("Nao foi possivel copiar o payload.");
  }
}

export function exportCalibrationCsv(rows: MlbScreenerHandoffAuditRecord[]) {
  const headers = [
    "handoff_id",
    "created_at",
    "game_id",
    "matchup",
    "market",
    "pick",
    "line",
    "odd",
    "ev",
    "opportunity_score",
    "confidence_score",
    "readiness_status",
    "alignment_status",
    "status",
    "validator_decision",
    "validator_record_id",
    "risk_flags",
  ];
  const csvRows = rows.map((row) => [
    row.handoff_id,
    row.created_at,
    row.game_id,
    row.matchup,
    row.market,
    row.pick,
    row.line,
    row.odd,
    row.ev,
    row.opportunity_score,
    row.confidence_score,
    row.readiness_status,
    row.alignment_status,
    row.status,
    row.validator_decision,
    row.validator_record_id,
    getRiskFlags(row).join("|"),
  ]);
  const csv = [headers, ...csvRows].map((line) => line.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `asp-screener-mlb-calibracao-${todayIso()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportDailySnapshotsCsv(rows: MlbDailyScreenerSnapshotRecord[]) {
  const headers = [
    "run_id",
    "snapshot_date",
    "created_at",
    "games_count",
    "unified_opportunities_count",
    "analyze_count",
    "monitor_count",
    "skip_count",
    "shortlist_primary_count",
    "status",
  ];
  const csvRows = rows.map((row) => [
    row.run_id,
    row.snapshot_date,
    row.created_at,
    row.games_count,
    row.unified_opportunities_count,
    row.analyze_count,
    row.monitor_count,
    row.skip_count,
    row.shortlist_primary_count,
    row.status,
  ]);
  downloadCsv(`asp-screener-mlb-daily-snapshots-${todayIso()}.csv`, [headers, ...csvRows]);
}

export function exportOpportunitySnapshotsCsv(rows: MlbOpportunitySnapshotRecord[]) {
  const headers = [
    "run_id",
    "created_at",
    "game_id",
    "matchup",
    "market_family",
    "market_label",
    "pick_label",
    "line",
    "offered_odd",
    "median_odd",
    "market_base_odd",
    "bookmaker_melhor",
    "model_prob",
    "market_prob_no_vig",
    "probability_edge",
    "fair_odd",
    "ev",
    "opportunity_score",
    "confidence_score",
    "priority_status",
    "is_primary_shortlist",
    "sent_to_validator",
    "validator_decision",
    "risk_flags",
    "alerts",
  ];
  const csvRows = rows.map((row) => [
    row.run_id,
    row.created_at,
    row.game_id,
    row.matchup,
    row.market_family,
    row.market_label,
    row.pick_label,
    row.line,
    row.offered_odd,
    getSnapshotPayloadNumber(row, "median_odd"),
    getSnapshotPayloadNumber(row, "market_base_odd"),
    getSnapshotPayloadString(row, "bookmaker_melhor"),
    row.model_prob,
    row.market_prob_no_vig,
    row.probability_edge,
    row.fair_odd,
    row.ev,
    row.opportunity_score,
    row.confidence_score,
    row.priority_status,
    row.is_primary_shortlist,
    row.sent_to_validator,
    row.validator_decision,
    row.risk_flags.join("|"),
    row.alerts.join("|"),
  ]);
  downloadCsv(`asp-screener-mlb-opportunity-snapshots-${todayIso()}.csv`, [headers, ...csvRows]);
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map((line) => line.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
