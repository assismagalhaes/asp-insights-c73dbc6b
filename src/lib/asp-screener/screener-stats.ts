import type {
  MlbHandicapScreenerRow,
  MlbMoneylineScreenerRow,
  MlbTotalsScreenerRow,
  MlbUnifiedOpportunity,
} from "@/types/mlbProjections";
import type { MlbScreenerHandoffAuditRecord } from "@/types/mlbScreenerHandoffAudit";
import type { MlbOpportunitySnapshotRecord } from "@/types/mlbScreenerSnapshots";

export type CalibrationAverageStats = ReturnType<typeof getCalibrationAverages>;
export type CalibrationGroupRow = {
  label: string;
  total: number;
  applied: number;
  completed: number;
  confirmed: number;
  skipped: number;
  confirmRate: number;
  averageEv: number | null;
  averageScore: number | null;
  averageConfidence: number | null;
  averageReadiness: number | null;
  averageAlignment: number | null;
};
export type CalibrationRankingRow = {
  label: string;
  count: number;
  confirmRate: number;
  skipRate: number;
};

export function getOpportunitySnapshotStats(rows: MlbOpportunitySnapshotRecord[]) {
  const total = rows.length;
  const sent = rows.filter((row) => row.sent_to_validator).length;
  return {
    total,
    sent,
    sentRate: total ? (sent / total) * 100 : 0,
    analyzeNotSent: rows.filter(
      (row) => row.priority_status === "ANALISAR" && !row.sent_to_validator,
    ).length,
    highScoreNotSent: rows.filter(
      (row) => (row.opportunity_score ?? 0) >= 80 && !row.sent_to_validator,
    ).length,
    highEvNotSent: rows.filter((row) => (row.ev ?? 0) >= 0.08 && !row.sent_to_validator).length,
  };
}

export function getHandoffAuditStats(rows: MlbScreenerHandoffAuditRecord[]) {
  const sent = rows.length;
  const applied = rows.filter(
    (row) => row.status === "applied_in_validator" || row.applied_at,
  ).length;
  const discarded = rows.filter((row) => row.status === "discarded").length;
  const expired = rows.filter((row) => row.status === "expired").length;
  const completed = rows.filter((row) => row.status === "validation_completed").length;
  const confirmed = rows.filter((row) => row.validator_decision === "CONFIRMAR").length;
  const skipped = rows.filter((row) => row.validator_decision === "PULAR").length;
  return {
    sent,
    applied,
    discarded,
    expired,
    completed,
    confirmed,
    skipped,
    sentToValidationRate: sent ? (completed / sent) * 100 : 0,
    validationToConfirmRate: completed ? (confirmed / completed) * 100 : 0,
  };
}

export function buildCalibrationOptionSets(rows: MlbScreenerHandoffAuditRecord[]) {
  return {
    priorityStatuses: uniqueValues(rows.map((row) => row.priority_status)),
    readinessStatuses: uniqueValues(rows.map((row) => row.readiness_status)),
    alignmentStatuses: uniqueValues(rows.map((row) => row.alignment_status)),
  };
}

export function buildCalibrationModel(rows: MlbScreenerHandoffAuditRecord[]) {
  const completedRows = rows.filter(isValidationCompleted);
  const confirmedRows = rows.filter((row) => row.validator_decision === "CONFIRMAR");
  const skippedRows = rows.filter((row) => row.validator_decision === "PULAR");
  const applied = rows.filter(isAppliedInValidator).length;
  const started = rows.filter(isValidationStarted).length;
  const completed = completedRows.length;
  const confirmed = confirmedRows.length;
  const skipped = skippedRows.length;

  return {
    funnel: {
      sent: rows.length,
      applied,
      discarded: rows.filter((row) => row.status === "discarded").length,
      expired: rows.filter((row) => row.status === "expired").length,
      started,
      completed,
      failed: rows.filter((row) => row.status === "validation_failed").length,
      confirmed,
      skipped,
      sentToAppliedRate: rows.length ? (applied / rows.length) * 100 : 0,
      appliedToCompletedRate: applied ? (completed / applied) * 100 : 0,
      completedToConfirmRate: completed ? (confirmed / completed) * 100 : 0,
      completedToSkipRate: completed ? (skipped / completed) * 100 : 0,
    },
    averages: {
      all: getCalibrationAverages(rows),
      completed: getCalibrationAverages(completedRows),
      confirmed: getCalibrationAverages(confirmedRows),
      skipped: getCalibrationAverages(skippedRows),
    },
    scoreBands: groupByRanges(
      rows,
      [
        ["0-59", 0, 59],
        ["60-69", 60, 69],
        ["70-79", 70, 79],
        ["80-89", 80, 89],
        ["90-100", 90, 100],
      ],
      (row) => row.opportunity_score,
    ),
    confidenceBands: groupByRanges(
      rows,
      [
        ["0-49", 0, 49],
        ["50-57", 50, 57],
        ["58-65", 58, 65],
        ["66-72", 66, 72],
        ["73-78", 73, 78],
      ],
      (row) => row.confidence_score,
    ),
    marketGroups: groupByValue(rows, (row) => row.market ?? "Sem mercado"),
    readinessGroups: groupByValue(rows, (row) => row.readiness_status ?? "Sem readiness"),
    alignmentGroups: groupByValue(rows, (row) => row.alignment_status ?? "Sem alignment"),
    riskFlagRanking: rankCalibrationItems(rows, getRiskFlags),
    alertRanking: rankCalibrationItems(rows, getAlerts),
  };
}

export function getCalibrationAverages(rows: MlbScreenerHandoffAuditRecord[]) {
  return {
    opportunityScore: average(rows.map((row) => row.opportunity_score)),
    confidenceScore: average(rows.map((row) => row.confidence_score)),
    ev: average(rows.map((row) => row.ev)),
    modelProbability: average(rows.map((row) => row.model_probability)),
    marketProbability: average(rows.map((row) => row.market_probability_no_vig)),
    edge: average(rows.map((row) => getProbabilityEdge(row))),
    readinessScore: average(rows.map((row) => getReadinessScore(row.readiness_status))),
    alignmentScore: average(rows.map((row) => row.alignment_score)),
  };
}

function groupByRanges(
  rows: MlbScreenerHandoffAuditRecord[],
  ranges: Array<[string, number, number]>,
  getValue: (row: MlbScreenerHandoffAuditRecord) => number | null,
) {
  return ranges.map(([label, min, max]) =>
    buildCalibrationGroupRow(
      label,
      rows.filter((row) => {
        const value = getValue(row);
        return value != null && value >= min && value <= max;
      }),
    ),
  );
}

function groupByValue(
  rows: MlbScreenerHandoffAuditRecord[],
  getValue: (row: MlbScreenerHandoffAuditRecord) => string,
) {
  return uniqueValues(rows.map(getValue)).map((label) =>
    buildCalibrationGroupRow(
      label,
      rows.filter((row) => getValue(row) === label),
    ),
  );
}

function buildCalibrationGroupRow(
  label: string,
  rows: MlbScreenerHandoffAuditRecord[],
): CalibrationGroupRow {
  const completed = rows.filter(isValidationCompleted).length;
  const confirmed = rows.filter((row) => row.validator_decision === "CONFIRMAR").length;
  return {
    label,
    total: rows.length,
    applied: rows.filter(isAppliedInValidator).length,
    completed,
    confirmed,
    skipped: rows.filter((row) => row.validator_decision === "PULAR").length,
    confirmRate: completed ? (confirmed / completed) * 100 : 0,
    averageEv: average(rows.map((row) => row.ev)),
    averageScore: average(rows.map((row) => row.opportunity_score)),
    averageConfidence: average(rows.map((row) => row.confidence_score)),
    averageReadiness: average(rows.map((row) => getReadinessScore(row.readiness_status))),
    averageAlignment: average(rows.map((row) => row.alignment_score)),
  };
}

function rankCalibrationItems(
  rows: MlbScreenerHandoffAuditRecord[],
  getItems: (row: MlbScreenerHandoffAuditRecord) => string[],
): CalibrationRankingRow[] {
  const counts = new Map<string, MlbScreenerHandoffAuditRecord[]>();
  for (const row of rows) {
    for (const item of getItems(row)) {
      counts.set(item, [...(counts.get(item) ?? []), row]);
    }
  }
  return [...counts.entries()]
    .map(([label, itemRows]) => {
      const completed = itemRows.filter(isValidationCompleted).length;
      const confirmed = itemRows.filter((row) => row.validator_decision === "CONFIRMAR").length;
      const skipped = itemRows.filter((row) => row.validator_decision === "PULAR").length;
      return {
        label,
        count: itemRows.length,
        confirmRate: completed ? (confirmed / completed) * 100 : 0,
        skipRate: completed ? (skipped / completed) * 100 : 0,
      };
    })
    .sort((a, b) => b.count - a.count || b.confirmRate - a.confirmRate)
    .slice(0, 12);
}

export function getRiskFlags(row: MlbScreenerHandoffAuditRecord) {
  return safeStringArray(row.opportunity_payload?.risk_flags);
}

function getAlerts(row: MlbScreenerHandoffAuditRecord) {
  return safeStringArray(row.opportunity_payload?.alerts);
}

export function getSnapshotPayloadNumber(row: MlbOpportunitySnapshotRecord, key: string) {
  const value = row.opportunity_payload?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function getSnapshotPayloadString(row: MlbOpportunitySnapshotRecord, key: string) {
  const value = row.opportunity_payload?.[key];
  return typeof value === "string" && value ? value : null;
}

function getProbabilityEdge(row: MlbScreenerHandoffAuditRecord) {
  if (row.model_probability == null || row.market_probability_no_vig == null) return null;
  return row.model_probability - row.market_probability_no_vig;
}

function getReadinessScore(status: string | null) {
  if (status === "pronto_para_validator") return 100;
  if (status === "revisar_antes_do_validator") return 70;
  if (status === "contexto_incompleto") return 40;
  if (status === "nao_recomendado_para_validator") return 0;
  return null;
}

function isAppliedInValidator(row: MlbScreenerHandoffAuditRecord) {
  return (
    Boolean(row.applied_at) ||
    [
      "applied_in_validator",
      "validation_started",
      "validation_completed",
      "validation_failed",
    ].includes(row.status)
  );
}

function isValidationStarted(row: MlbScreenerHandoffAuditRecord) {
  return (
    Boolean(row.validation_started_at) ||
    ["validation_started", "validation_completed", "validation_failed"].includes(row.status)
  );
}

function isValidationCompleted(row: MlbScreenerHandoffAuditRecord) {
  return (
    row.status === "validation_completed" ||
    Boolean(row.validation_completed_at) ||
    Boolean(row.validator_record_id)
  );
}

function average(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function uniqueValues(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort(
    (a, b) => a.localeCompare(b),
  );
}

function safeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

export function getProjectionStats(rows: MlbMoneylineScreenerRow[]) {
  return rows.reduce(
    (acc, row) => {
      acc.total += 1;
      acc[row.candidate_status] += 1;
      return acc;
    },
    { total: 0, analisar: 0, monitorar: 0, pular: 0, missing_data: 0 },
  );
}

export function getTotalsStats(rows: MlbTotalsScreenerRow[]) {
  return rows.reduce(
    (acc, row) => {
      acc.total += 1;
      acc[row.candidate_status] += 1;
      if (row.is_main_total_line) acc.main += 1;
      else acc.alternate += 1;
      acc.gameIds.add(row.game_id);
      return acc;
    },
    {
      total: 0,
      analisar: 0,
      monitorar: 0,
      pular: 0,
      missing_data: 0,
      main: 0,
      alternate: 0,
      gameIds: new Set<string>(),
      get games() {
        return this.gameIds.size;
      },
    },
  );
}

export function getHandicapStats(rows: MlbHandicapScreenerRow[]) {
  return rows.reduce(
    (acc, row) => {
      acc.total += 1;
      acc[row.candidate_status] += 1;
      if (row.is_main_handicap_line) acc.main += 1;
      else acc.alternate += 1;
      acc.gameIds.add(row.game_id);
      return acc;
    },
    {
      total: 0,
      analisar: 0,
      monitorar: 0,
      pular: 0,
      missing_data: 0,
      unsupported_line: 0,
      main: 0,
      alternate: 0,
      gameIds: new Set<string>(),
      get games() {
        return this.gameIds.size;
      },
    },
  );
}

export function getOpportunityStats(rows: MlbUnifiedOpportunity[]) {
  return rows.reduce(
    (acc, row) => {
      acc.total += 1;
      acc[row.priority_status] += 1;
      if (row.is_primary_shortlist) acc.primaryShortlist += 1;
      if (row.correlation_status === "correlated_alternative") acc.correlatedAlternatives += 1;
      if (acc.bestScore == null || row.opportunity_score > acc.bestScore)
        acc.bestScore = row.opportunity_score;
      if (row.ev != null && (acc.bestEv == null || row.ev > acc.bestEv)) acc.bestEv = row.ev;
      return acc;
    },
    {
      total: 0,
      ANALISAR: 0,
      MONITORAR: 0,
      PULAR: 0,
      MISSING_DATA: 0,
      UNSUPPORTED_LINE: 0,
      primaryShortlist: 0,
      correlatedAlternatives: 0,
      bestScore: null as number | null,
      bestEv: null as number | null,
    },
  );
}
