import { todayBR } from "@/lib/date-br";
import type { ValidatorDashboardFilters, ValidatorRecord } from "./types";
import { average } from "./formatters";

export type DashboardStats = {
  total: number;
  confirmed: number;
  skipped: number;
  confirmedGreen: number;
  confirmedRed: number;
  confirmedRoi: number;
  confirmedYield: number;
  confirmedProfitUnits: number;
  confirmedProfitBrl: number;
  confirmedWinRate: number;
  skippedGreen: number;
  skippedRed: number;
  skipAccuracy: number;
};

export type GroupRow = {
  label: string;
  total: number;
  green: number;
  red: number;
  pushVoid: number;
  winRate: number;
  profitUnits: number;
  profitBrl: number;
  roi: number;
  averageOdd: number;
  averageProbability: number;
};

export function buildDashboardOptions(records: ValidatorRecord[]) {
  const unique = (values: Array<string | null | undefined>) =>
    Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort((a, b) =>
      a.localeCompare(b),
    );
  return {
    sports: unique(records.map((record) => record.sport)),
    leagues: unique(records.map((record) => record.league)),
    platforms: unique(records.map((record) => record.source_platform)),
    models: unique(records.map((record) => record.validator_model)),
    markets: unique(records.map((record) => record.market)),
  };
}

export function filterDashboardRecords(
  records: ValidatorRecord[],
  filters: ValidatorDashboardFilters,
): ValidatorRecord[] {
  const minDate = getDashboardMinDate(filters.period);
  return records.filter((record) => {
    const date = record.result_settled_at || record.match_date || record.created_at.slice(0, 10);
    if (minDate && date < minDate) return false;
    if (filters.sport !== "all" && record.sport !== filters.sport) return false;
    if (filters.league !== "all" && record.league !== filters.league) return false;
    if (filters.source_platform !== "all" && record.source_platform !== filters.source_platform)
      return false;
    if (filters.validator_model !== "all" && record.validator_model !== filters.validator_model)
      return false;
    if (filters.market !== "all" && record.market !== filters.market) return false;
    if (filters.decision !== "all" && record.decision !== filters.decision) return false;
    if (filters.result !== "all") {
      const result = record.result_status || "PENDENTE";
      if (result !== filters.result) return false;
    }
    return true;
  });
}

export function calculateValidatorDashboardStats(records: ValidatorRecord[]): DashboardStats {
  const confirmed = records.filter(
    (record) =>
      record.decision === "CONFIRMAR" && record.bankroll_applied && !record.is_simulated_result,
  );
  const skipped = records.filter(
    (record) => record.decision === "PULAR" && record.is_simulated_result,
  );
  const confirmedResolved = confirmed.filter(isResolvedResult);
  const confirmedStake = confirmedResolved.reduce(
    (sum, record) => sum + Number(record.stake_units ?? 0),
    0,
  );
  const confirmedProfitUnits = confirmed.reduce(
    (sum, record) => sum + Number(record.profit_units ?? 0),
    0,
  );
  const confirmedProfitBrl = confirmed.reduce(
    (sum, record) => sum + Number(record.profit_brl ?? 0),
    0,
  );
  const confirmedGreen = confirmed.filter((record) => record.result_status === "GREEN").length;
  const confirmedRed = confirmed.filter((record) => record.result_status === "RED").length;
  const skippedGreen = skipped.filter((record) => record.result_status === "GREEN").length;
  const skippedRed = skipped.filter((record) => record.result_status === "RED").length;
  const skippedResolved = skipped.filter(isResolvedResult);
  return {
    total: records.length,
    confirmed: records.filter((record) => record.decision === "CONFIRMAR").length,
    skipped: records.filter((record) => record.decision === "PULAR").length,
    confirmedGreen,
    confirmedRed,
    confirmedRoi: confirmedStake > 0 ? (confirmedProfitUnits / confirmedStake) * 100 : 0,
    confirmedYield: confirmedStake > 0 ? (confirmedProfitUnits / confirmedStake) * 100 : 0,
    confirmedProfitUnits,
    confirmedProfitBrl,
    confirmedWinRate: confirmedResolved.length
      ? (confirmedGreen / confirmedResolved.length) * 100
      : 0,
    skippedGreen,
    skippedRed,
    skipAccuracy: skippedResolved.length ? (skippedRed / skippedResolved.length) * 100 : 0,
  };
}

export function groupValidatorRecords(
  records: ValidatorRecord[],
  keyFn: (record: ValidatorRecord) => string,
): GroupRow[] {
  const map = new Map<string, ValidatorRecord[]>();
  for (const record of records) {
    const key = keyFn(record) || "-";
    map.set(key, [...(map.get(key) ?? []), record]);
  }
  return Array.from(map.entries())
    .map(([label, rows]) => {
      const resolved = rows.filter((row) => isResolvedResult(row));
      const green = rows.filter((row) => row.result_status === "GREEN").length;
      const red = rows.filter((row) => row.result_status === "RED").length;
      const pushVoid = rows.filter(
        (row) => row.result_status === "PUSH" || row.result_status === "VOID",
      ).length;
      const stake = resolved.reduce(
        (sum, row) => sum + Number(row.stake_units ?? (row.decision === "PULAR" ? 1 : 0)),
        0,
      );
      const profitUnits = rows.reduce((sum, row) => sum + Number(row.profit_units ?? 0), 0);
      const profitBrl = rows.reduce((sum, row) => sum + Number(row.profit_brl ?? 0), 0);
      const odds = rows.map((row) => Number(row.offered_odd ?? 0)).filter((value) => value > 0);
      const probs = rows
        .map((row) => Number(row.adjusted_probability ?? 0))
        .filter((value) => value > 0);
      return {
        label,
        total: rows.length,
        green,
        red,
        pushVoid,
        winRate: resolved.length ? (green / resolved.length) * 100 : 0,
        profitUnits,
        profitBrl,
        roi: stake > 0 ? (profitUnits / stake) * 100 : 0,
        averageOdd: odds.length ? average(odds) : 0,
        averageProbability: probs.length ? average(probs) : 0,
      };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);
}

function getDashboardMinDate(period: ValidatorDashboardFilters["period"]): string | null {
  if (period === "all") return null;
  // Trabalha em fuso BR: usa componentes da data BR para construir a data local coerente.
  const todayStr = todayBR();
  const [y, m, d] = todayStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (period === "7d") date.setDate(date.getDate() - 6);
  if (period === "30d") date.setDate(date.getDate() - 29);
  if (period === "month") date.setDate(1);
  if (period === "year") {
    date.setMonth(0);
    date.setDate(1);
  }
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function isResolvedResult(record: ValidatorRecord): boolean {
  return record.result_status === "GREEN" || record.result_status === "RED";
}
