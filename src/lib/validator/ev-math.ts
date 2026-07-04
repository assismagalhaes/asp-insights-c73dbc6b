// Canonical EV helpers for the ASP Validator.
// The IA can suggest an adjusted probability, but the ADJUSTED EV displayed
// to the user MUST always be recomputed here from probability x odd.
//
// Convention:
// - probabilityPercent: percentage points in 0..100 (ex.: 47.50 = 47.50%)
// - offeredOdd: decimal odd (ex.: 2.10)
// - evPercent: percentage points (ex.: -0.25 = -0.25%)
// - evDecimal: pure decimal (ex.: -0.0025 for -0.25%)

export function normalizeProbabilityPercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  // 0..1 fraction -> percent
  if (value > 0 && value <= 1) return round(value * 100);
  return round(value);
}

export function calculateEvPercent(
  probabilityPercent: number | null,
  offeredOdd: number | null,
): number | null {
  if (probabilityPercent === null || offeredOdd === null) return null;
  if (!Number.isFinite(probabilityPercent) || !Number.isFinite(offeredOdd) || offeredOdd <= 0)
    return null;
  const evPercent = ((probabilityPercent / 100) * offeredOdd - 1) * 100;
  return round(evPercent);
}

export function formatEvPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

// Dev-only sanity check. If the IA-suggested EV diverges from the recomputed
// EV by more than 0.25 p.p., log a warning; return the recomputed value.
export function assertEvConsistency(
  suggestedEvPercent: number | null,
  probabilityPercent: number | null,
  offeredOdd: number | null,
  tag = "asp-validator",
): number | null {
  const canonical = calculateEvPercent(probabilityPercent, offeredOdd);
  if (canonical === null || suggestedEvPercent === null) return canonical;
  if (Math.abs(canonical - suggestedEvPercent) > 0.25) {
    // eslint-disable-next-line no-console
    console.warn(
      `[${tag}] EV divergente: sugerido=${suggestedEvPercent} recalculado=${canonical} (prob=${probabilityPercent}%, odd=${offeredOdd}). Exibindo recalculado.`,
    );
  }
  return canonical;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
