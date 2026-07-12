import type { Prognostico } from "@/lib/db";

const PACKBALL_MAX_STAKE = 1;
const PACKBALL_CONFLICT_MAX_STAKE = 0.25;

type PackballFields = Pick<
  Prognostico,
  | "mercado"
  | "origem_modelo"
  | "pick"
  | "odd_ofertada"
  | "odd_ajustada"
  | "odd_valor"
  | "probabilidade_final"
  | "dados_tecnicos"
  | "contexto_modelo"
  | "observacoes"
>;

export type PackballValidationRequirements = {
  modelName: "ASP GoalMatrix" | "ASP CornerMatrix" | "ASP BackMatrix";
  requiredEdge: number;
  minimumExecutableOdd: number;
  referenceOdd: number;
  strongMarketConflict: boolean;
  kellyFraction: number;
};

function combinedText(prognostico: Partial<PackballFields>): string {
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

export function getPackballModelName(
  prognostico: Partial<PackballFields>,
): PackballValidationRequirements["modelName"] | null {
  const value = `${prognostico.mercado ?? ""} ${prognostico.origem_modelo ?? ""}`;
  if (/backmatrix/i.test(value)) return "ASP BackMatrix";
  if (/goalmatrix/i.test(value)) return "ASP GoalMatrix";
  if (/cornermatrix/i.test(value)) return "ASP CornerMatrix";
  return null;
}

function fallbackRequiredEdge(
  prognostico: Partial<PackballFields>,
  modelName: PackballValidationRequirements["modelName"],
): number {
  const pick = String(prognostico.pick ?? "");
  const referenceOdd = Number(prognostico.odd_ofertada);
  if (modelName === "ASP BackMatrix") {
    if (referenceOdd <= 1.3) return 3;
    if (referenceOdd >= 2) return 5;
    return 4;
  }
  if (modelName === "ASP GoalMatrix") return /btts/i.test(pick) ? 5 : 4;
  return /mais cantos|race/i.test(pick) ? 6 : 5;
}

export function isPackballMatrixPrognostico(prognostico: Partial<PackballFields>): boolean {
  return getPackballModelName(prognostico) != null;
}

export function hasPackballExecutableOdd(prognostico: Partial<PackballFields>): boolean {
  return (
    isPackballMatrixPrognostico(prognostico) &&
    Number.isFinite(Number(prognostico.odd_ajustada)) &&
    Number(prognostico.odd_ajustada) > 1
  );
}

export function getPackballValidationRequirements(
  prognostico: Partial<PackballFields>,
): PackballValidationRequirements | null {
  const modelName = getPackballModelName(prognostico);
  if (!modelName) return null;
  const referenceOdd = Number(prognostico.odd_ofertada);
  const fairOdd = Number(prognostico.odd_valor);
  if (!(referenceOdd > 1) || !(fairOdd > 1)) return null;
  const text = combinedText(prognostico);
  const requiredEdge =
    parseNumber(text, /Edge exigido:\s*([0-9]+(?:[.,][0-9]+)?)%/i) ??
    fallbackRequiredEdge(prognostico, modelName);
  const spread = parseNumber(
    text,
    /(?:Spread componentes|component_spread_pp)\s*[:=]\s*([0-9]+(?:[.,][0-9]+)?)/i,
  );
  const strongConflictThreshold = modelName === "ASP GoalMatrix" ? 20 : 22;
  return {
    modelName,
    requiredEdge,
    minimumExecutableOdd: fairOdd * (1 + requiredEdge / 100),
    referenceOdd,
    strongMarketConflict:
      /CONFLITO_FORTE_COM_MERCADO/i.test(text) || (spread ?? 0) >= strongConflictThreshold,
    kellyFraction: modelName === "ASP BackMatrix" ? 0.1 : 0.125,
  };
}

export function calculatePackballKelly(
  probabilityPct: number,
  executableOdd: number,
  requirements: Pick<PackballValidationRequirements, "kellyFraction" | "strongMarketConflict">,
): number {
  const probability = Number(probabilityPct) / 100;
  const odd = Number(executableOdd);
  if (!(probability > 0 && probability < 1) || !(odd > 1)) return 0;
  const b = odd - 1;
  const fullKelly = Math.max(0, (b * probability - (1 - probability)) / b);
  const cap = requirements.strongMarketConflict ? PACKBALL_CONFLICT_MAX_STAKE : PACKBALL_MAX_STAKE;
  const units = Math.min(cap, fullKelly * requirements.kellyFraction * 100);
  return Math.floor((units + 1e-9) * 4) / 4;
}
