export function hasJsonContent(value: Record<string, unknown> | null): boolean {
  return Boolean(value && Object.keys(value).length > 0);
}

export function parseNumber(value: string): number | null {
  const clean = String(value || "")
    .replace("%", "")
    .replace(",", ".")
    .trim();
  if (!clean) return null;
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeProbability(value: number | null): number | null {
  if (value === null) return null;
  if (value > 0 && value <= 1) return round(value * 100, 2);
  return round(Math.max(0, Math.min(100, value)), 2);
}

export function normalizeSourceEv(
  value: number | null,
  sourcePlatform?: string | null,
): number | null {
  if (value === null) return null;
  const platform = normalize(sourcePlatform || "");
  // PackBall: EV vem como inteiro percentual (ex.: 18 = 0.18%, 41 = 0.41%).
  // Se o usuario digitar 0.18 mantemos. Threshold > 1 cobre 18, 41, etc.
  if (platform.includes("packball") && value > 1 && value < 100) return round(value / 100, 2);
  return round(value, 2);
}

export function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${round(value, 2).toFixed(2)}`;
}

export function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function formatPercent(value: number | null): string {
  return value === null ? "-" : `${round(value, 2).toFixed(2)}%`;
}

export function formatDecimalProbability(value: number | null): string {
  return value === null ? "-" : `${round(value * 100, 2).toFixed(2)}%`;
}

export function formatDecimalEv(value: number | null): string {
  return value === null ? "-" : `${round(value * 100, 2).toFixed(2)}%`;
}

export function formatOdd(value: number | null): string {
  return value === null ? "-" : value.toFixed(2);
}

export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "-"
    : round(value, 2).toFixed(2);
}

export function numberToInput(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

export function percentToInput(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? ""
    : String(round(value * 100, 2));
}

// Remove previous imported-screener block(s) from a user_context value.
// Keeps only the free-form manual portion, avoiding "Importado do ASP Screener..." duplication.
export function extractManualOnlyContext(value: string | null | undefined): string {
  if (!value) return "";
  const text = String(value);
  const importedMarker = "Importado do ASP Screener MLB";
  const manualMarker = "Contexto adicional manual:";
  if (!text.includes(importedMarker)) return text.trim();
  // If a manual section exists after the imported block, keep only that section content.
  const manualIdx = text.lastIndexOf(manualMarker);
  if (manualIdx >= 0) {
    return text.slice(manualIdx + manualMarker.length).trim();
  }
  // Only imported context, no manual addition -> nothing to preserve.
  return "";
}

export function formatDate(value: string | null): string {
  if (!value) return "-";
  const parsed = new Date(`${value}T00:00:00-03:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${round(bytes / 1024 ** index, index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatUploadSource(source?: string | null): string {
  if (source === "clipboard") return "CTRL+V";
  if (source === "drag_drop") return "drag/drop";
  if (source === "manual") return "upload manual";
  return "nao informado";
}
