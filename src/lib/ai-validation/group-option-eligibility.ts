import { evaluateMlbOperationalGateInput } from "@/lib/critical-validation/critical-shortlist-ranking";

export type AiGroupOptionEligibilityInput = {
  esporte: string;
  liga: string;
  mercado: string;
  pick: string;
  odd_original: number;
  odd_ajustada?: number | null;
  odd_valor: number;
  edge_original: number;
  edge_ajustado?: number | null;
  context: string;
};

export type AiGroupOptionEligibility = {
  eligible: boolean;
  status: "ELEGÍVEL" | "BLOQUEADA";
  reasons: string[];
};

export function evaluateAiGroupOptionEligibility(
  option: AiGroupOptionEligibilityInput,
): AiGroupOptionEligibility {
  const effectiveOdd = option.odd_ajustada ?? option.odd_original;
  const effectiveEdge = option.edge_ajustado ?? option.edge_original;
  const reasons: string[] = [];

  if (!Number.isFinite(effectiveEdge) || effectiveEdge < 0) {
    reasons.push(`Edge executável ${effectiveEdge.toFixed(2)}% não permite confirmação.`);
  }
  if (!Number.isFinite(effectiveOdd) || effectiveOdd < option.odd_valor) {
    reasons.push(
      `Odd executável ${effectiveOdd.toFixed(3)} abaixo da odd de valor ${option.odd_valor.toFixed(3)}.`,
    );
  }

  const mlbGate = evaluateMlbOperationalGateInput({
    esporte: option.esporte,
    liga: option.liga,
    mercado: option.mercado,
    pick: option.pick,
    edge: option.edge_original,
    edge_ajustado: option.edge_ajustado ?? null,
    context: option.context,
  });
  if (mlbGate.applicable && !mlbGate.approved) reasons.push(...mlbGate.reasons);

  return {
    eligible: reasons.length === 0,
    status: reasons.length === 0 ? "ELEGÍVEL" : "BLOQUEADA",
    reasons,
  };
}
