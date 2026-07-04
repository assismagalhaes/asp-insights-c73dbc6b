import type {
  MlbHandicapCandidateStatus,
  MlbProjectionCandidateStatus,
  MlbTotalsScreenerRow,
  MlbUnifiedOpportunity,
} from "@/types/mlbProjections";

export function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function normalizeDateValue(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  const br = text.match(/^(\d{2})[/.](\d{2})[/.](\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return text;
}

export function isSameDate(value: string | null | undefined, expected: string) {
  return normalizeDateValue(value) === normalizeDateValue(expected);
}

export function isBaseballSport(value: string | null | undefined) {
  const normalized = normalizeText(value);
  return /baseball|beisebol|mlb/.test(normalized);
}

export function isMlbLeague(value: string | null | undefined) {
  const normalized = normalizeText(value);
  return !normalized || /mlb|major league baseball/.test(normalized);
}

export function todayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function sourceLabel(source: string | null | undefined) {
  if (source === "baseball_reference") return "Baseball-Reference";
  if (source === "csv_manual") return "CSV manual";
  return "-";
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

export function formatRecord(wins: number | null, losses: number | null) {
  return wins == null || losses == null ? "-" : `${wins}-${losses}`;
}

export function formatPct(value: number | null) {
  if (value == null) return "-";
  return value.toFixed(3).replace(/^0/, "");
}

export function formatNumber(value: number | null) {
  return value == null ? "-" : Number(value).toFixed(1);
}

export function formatNumber2(value: number | null) {
  return value == null ? "-" : Number(value).toFixed(2);
}

export function formatOdd(value: number | null) {
  return value == null ? "-" : Number(value).toFixed(2);
}

export function formatProbability(value: number | null) {
  return value == null ? "-" : `${(value * 100).toFixed(1)}%`;
}

export function formatProbabilitySigned(value: number | null) {
  if (value == null) return "-";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${(value * 100).toFixed(1)} p.p.`;
}

export function formatEv(value: number | null) {
  if (value == null) return "-";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${(value * 100).toFixed(2)}%`;
}

export function formatPercentDecimal(value: number | null) {
  return value == null ? "-" : `${(value * 100).toFixed(2)}%`;
}

export function formatRate(value: number) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "-";
}

export function formatSignedNumber(value: number | null) {
  if (value == null) return "-";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}`;
}

export function formatHandicapLine(value: number | null) {
  if (value == null) return "-";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}`;
}

export function formatScore(value: number | null) {
  return value == null || !Number.isFinite(value) ? "-" : value.toFixed(1);
}

export function evClass(value: number | null) {
  const base = "px-3 py-2 font-mono";
  if (value == null) return base;
  if (value >= 0.05) return `${base} text-success`;
  if (value >= 0.02) return `${base} text-warning`;
  if (value < 0) return `${base} text-muted-foreground`;
  return base;
}

export function edgeClass(value: number | null) {
  const base = "px-3 py-2 font-mono";
  if (value == null) return base;
  if (value >= 0.05) return `${base} text-success`;
  if (value >= 0.025) return `${base} text-warning`;
  return `${base} text-muted-foreground`;
}

export function scoreClass(value: number | null) {
  const base = "px-3 py-2 font-mono font-semibold";
  if (value == null) return base;
  if (value >= 75) return `${base} text-success`;
  if (value >= 60) return `${base} text-warning`;
  return `${base} text-muted-foreground`;
}

export function gapClass(value: number | null) {
  const base = "px-3 py-2 font-mono";
  if (value == null) return base;
  if (Math.abs(value) >= 0.7) return `${base} text-success`;
  if (Math.abs(value) >= 0.45) return `${base} text-warning`;
  return `${base} text-muted-foreground`;
}

export function correlationLabel(row: MlbUnifiedOpportunity) {
  if (row.correlation_status === "primary") return "Primaria do jogo";
  if (row.correlation_status === "correlated_alternative") return "Alternativa correlacionada";
  return "Standalone";
}

export function opportunityStatusBadgeVariant(status: MlbUnifiedOpportunity["priority_status"]) {
  if (status === "MISSING_DATA" || status === "UNSUPPORTED_LINE") return "destructive";
  if (status === "ANALISAR") return "outline";
  return "secondary";
}

export function leagueAverageSourceLabel(source: MlbTotalsScreenerRow["league_average_source"]) {
  if (source === "average_row") return "Average";
  if (source === "computed_from_teams") return "times";
  return "fallback";
}

export function statusLabel(status: MlbProjectionCandidateStatus | MlbHandicapCandidateStatus) {
  const labels: Record<MlbProjectionCandidateStatus | MlbHandicapCandidateStatus, string> = {
    analisar: "ANALISAR",
    monitorar: "MONITORAR",
    pular: "PULAR",
    missing_data: "MISSING_DATA",
    unsupported_line: "UNSUPPORTED_LINE",
  };
  return labels[status];
}

export function statusBadgeVariant(
  status: MlbProjectionCandidateStatus | MlbHandicapCandidateStatus,
) {
  if (status === "missing_data" || status === "unsupported_line") return "destructive";
  if (status === "analisar") return "outline";
  if (status === "monitorar") return "secondary";
  return "secondary";
}

export function formatError(error: unknown) {
  return formatAlertMessage(error);
}

export function formatAlertMessage(alert: unknown): string {
  if (alert == null) return "Alerta desconhecido";
  if (typeof alert === "string") return alert;
  if (typeof alert === "number" || typeof alert === "boolean") return String(alert);
  if (alert instanceof Error) return alert.message || "Erro desconhecido";
  if (typeof alert === "object") {
    const obj = alert as Record<string, unknown>;
    if (typeof obj.message === "string" && obj.message) return obj.message;
    if (typeof obj.error === "string" && obj.error) return obj.error;
    if (typeof obj.details === "string" && obj.details) return obj.details;
    if (typeof obj.description === "string" && obj.description) return obj.description;
    if (typeof obj.statusText === "string" && obj.statusText) return obj.statusText;
    try {
      const json = JSON.stringify(obj);
      if (json && json !== "{}") return json;
    } catch {
      /* fallthrough */
    }
    return "Alerta nao estruturado";
  }
  return String(alert);
}
