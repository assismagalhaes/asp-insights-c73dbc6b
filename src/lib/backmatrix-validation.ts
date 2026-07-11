import type { Prognostico } from "@/lib/db";

const BACKMATRIX_KELLY_FRACTION = 0.1;
const BACKMATRIX_MAX_STAKE = 1;
const BACKMATRIX_CONFLICT_MAX_STAKE = 0.25;

type BackMatrixFields = Pick<
  Prognostico,
  | "mercado"
  | "origem_modelo"
  | "odd_ofertada"
  | "odd_ajustada"
  | "odd_valor"
  | "probabilidade_final"
  | "dados_tecnicos"
  | "contexto_modelo"
  | "observacoes"
>;

export type BackMatrixValidationRequirements = {
  requiredEdge: number;
  minimumExecutableOdd: number;
  referenceOdd: number;
  strongMarketConflict: boolean;
};

function combinedText(prognostico: Partial<BackMatrixFields>): string {
  return [prognostico.dados_tecnicos, prognostico.contexto_modelo, prognostico.observacoes]
    .map((value) => String(value ?? ""))
    .join("\n");
}

function parseNumber(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  if (!match?.[1]) return null;
  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function fallbackRequiredEdge(referenceOdd: number): number {
  if (referenceOdd <= 1.3) return 3;
  if (referenceOdd >= 2) return 5;
  return 4;
}

export function isBackMatrixPrognostico(prognostico: Partial<BackMatrixFields>): boolean {
  return /backmatrix/i.test(`${prognostico.mercado ?? ""} ${prognostico.origem_modelo ?? ""}`);
}

export function hasBackMatrixExecutableOdd(prognostico: Partial<BackMatrixFields>): boolean {
  return (
    isBackMatrixPrognostico(prognostico) &&
    Number.isFinite(Number(prognostico.odd_ajustada)) &&
    Number(prognostico.odd_ajustada) > 1
  );
}

export function getBackMatrixValidationRequirements(
  prognostico: Partial<BackMatrixFields>,
): BackMatrixValidationRequirements | null {
  if (!isBackMatrixPrognostico(prognostico)) return null;
  const referenceOdd = Number(prognostico.odd_ofertada);
  const fairOdd = Number(prognostico.odd_valor);
  if (!(referenceOdd > 1) || !(fairOdd > 1)) return null;
  const text = combinedText(prognostico);
  const requiredEdge =
    parseNumber(text, /Edge exigido:\s*([0-9]+(?:[.,][0-9]+)?)%/i) ??
    fallbackRequiredEdge(referenceOdd);
  const spread = parseNumber(text, /Spread componentes:\s*([0-9]+(?:[.,][0-9]+)?)\s*p\.p\./i);
  return {
    requiredEdge,
    minimumExecutableOdd: fairOdd * (1 + requiredEdge / 100),
    referenceOdd,
    strongMarketConflict: /CONFLITO_FORTE_COM_MERCADO/i.test(text) || (spread ?? 0) >= 22,
  };
}

export function calculateBackMatrixKelly(
  probabilityPct: number,
  executableOdd: number,
  strongMarketConflict = false,
): number {
  const probability = Number(probabilityPct) / 100;
  const odd = Number(executableOdd);
  if (!(probability > 0 && probability < 1) || !(odd > 1)) return 0;
  const b = odd - 1;
  const fullKelly = Math.max(0, (b * probability - (1 - probability)) / b);
  const cap = strongMarketConflict ? BACKMATRIX_CONFLICT_MAX_STAKE : BACKMATRIX_MAX_STAKE;
  const units = Math.min(cap, fullKelly * BACKMATRIX_KELLY_FRACTION * 100);
  return Math.floor((units + 1e-9) * 4) / 4;
}
