// Cores semânticas para gráficos — alinhadas com os tokens do design system.
// Verde = positivo, Vermelho = negativo, Cinza = neutro/zero.
export const COLOR_POS = "oklch(0.78 0.20 150)"; // green / success
export const COLOR_NEG = "oklch(0.65 0.24 25)"; // red / destructive
export const COLOR_NEUTRAL = "oklch(0.62 0.02 250)"; // gray neutral
export const COLOR_REFERENCE = "oklch(0.55 0.02 250)"; // linha de referência discreta
export const COLOR_GRID = "oklch(0.28 0.02 250)";
export const COLOR_AXIS = "oklch(0.72 0.02 250)";

/** Retorna cor verde/vermelha/cinza conforme sinal do valor. */
export function signColor(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return COLOR_NEUTRAL;
  if (v > 0) return COLOR_POS;
  if (v < 0) return COLOR_NEG;
  return COLOR_NEUTRAL;
}

/** Tom semântico p/ classes Tailwind (text-success, etc.). */
export function signClass(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "text-muted-foreground";
  if (v > 0) return "text-success";
  if (v < 0) return "text-destructive";
  return "text-muted-foreground";
}

export const TOOLTIP_STYLE: React.CSSProperties = {
  background: "oklch(0.205 0.018 250)",
  border: "1px solid oklch(0.28 0.02 250)",
  borderRadius: 8,
  fontSize: 12,
  padding: "8px 10px",
};

export const TOOLTIP_LABEL_STYLE: React.CSSProperties = {
  color: "oklch(0.85 0.02 250)",
  fontWeight: 600,
  marginBottom: 4,
};

export const TOOLTIP_ITEM_STYLE: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

/** Formata número com sinal explícito (ex: +12.50 / -3.10). */
export function withSign(n: number, digits = 2): string {
  const s = n.toFixed(digits);
  return n > 0 ? `+${s}` : s;
}
