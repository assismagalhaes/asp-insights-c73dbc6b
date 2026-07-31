import { AiLocalGenerationOutputSchema } from "./schema";

const IN_PLAY_INVALIDATION_PATTERN =
  /\b(?:at[eé]\s+a\s+\d+[ªa]?\s+(?:entrada|inning|minuto)|durante\s+o\s+jogo|no\s+decorrer\s+do\s+jogo|placar\s+(?:permane(?:ça|ca)|seguir|continuar)|jogo\s+(?:permane(?:ça|ca)|seguir|continuar)|ao\s+vivo|live)\b/i;

const ALTERNATIVE_MARKET_CONDITION_PATTERN =
  /\b(?:ajuste|mudan[cç]a|altera[cç][aã]o)\s+(?:na|da|para\s+a)\s+linha[^.;]{0,80}\bpara\s+\d+(?:[.,]\d+)?\b/i;

const STRUCTURAL_REASON_PATTERN =
  /\b(?:starters?|pitchers?|arremessadores?|bullpen|lineups?|escala[cç][aã]o|desfalque|les[aã]o|clima|vento|temperatura|chuva|park factor|est[aá]dio|gramado|goalies?|quarterback|qb)\b/i;

const TECHNICAL_REASON_PATTERN =
  /\b(?:probabilidade|edge|odd|pre[cç]o|linha|mercado|pick|c[aá]lculo|matem[aá]tic|ev\b|valor esperado|incompat[ií]vel|incoerente)\b/i;

const SAFE_PREGAME_INVALIDATION =
  "Mudança material pré-jogo em starter, escalação ou desfalque, linha ou odd executável.";

const SEMANTIC_POLICY_LIMITATION =
  "A condição de invalidação produzida pela IA dependia do jogo iniciado e foi substituída pela política pré-jogo.";

const ALTERNATIVE_MARKET_LIMITATION =
  "A condição produzida pela IA propunha outro mercado em vez de invalidar a pick atual e foi substituída pela política pré-jogo.";

const PULAR_SELECTION_LIMITATION =
  "A seleção operacional residual da IA foi removida porque a decisão PULAR não possui ID ou pick selecionada.";

function normalizeOperationalCondition(condition: string | null): {
  condition: string | null;
  limitation: string | null;
} {
  if (condition == null) return { condition, limitation: null };
  if (IN_PLAY_INVALIDATION_PATTERN.test(condition)) {
    return { condition: SAFE_PREGAME_INVALIDATION, limitation: SEMANTIC_POLICY_LIMITATION };
  }
  if (ALTERNATIVE_MARKET_CONDITION_PATTERN.test(condition)) {
    return { condition: SAFE_PREGAME_INVALIDATION, limitation: ALTERNATIVE_MARKET_LIMITATION };
  }
  return { condition, limitation: null };
}

export function applyAiSemanticPolicy(input: unknown) {
  const output = AiLocalGenerationOutputSchema.parse(input);
  let next = output;

  const invalidation = normalizeOperationalCondition(output.invalidation_condition);
  const decisionChange = normalizeOperationalCondition(output.narrative.decision_change_condition);
  const conditionLimitations = [invalidation.limitation, decisionChange.limitation].filter(
    (value): value is string => value != null,
  );

  if (
    invalidation.condition !== output.invalidation_condition ||
    decisionChange.condition !== output.narrative.decision_change_condition
  ) {
    next = {
      ...next,
      invalidation_condition: invalidation.condition ?? SAFE_PREGAME_INVALIDATION,
      narrative: {
        ...next.narrative,
        decision_change_condition: decisionChange.condition,
      },
      limitations: Array.from(new Set([...next.limitations, ...conditionLimitations])).slice(0, 10),
    };
  }

  if (
    next.decision === "PULAR" &&
    (next.selected_prediction_id != null || next.selected_pick != null)
  ) {
    next = {
      ...next,
      selected_prediction_id: null,
      selected_pick: null,
      limitations: Array.from(new Set([...next.limitations, PULAR_SELECTION_LIMITATION])).slice(
        0,
        10,
      ),
    };
  }

  const technicalGate = next.gates.technical_consistency;
  const structuralGate = next.gates.structural_risk;
  const structuralOnlyReason =
    technicalGate.status === "REJECTED" &&
    STRUCTURAL_REASON_PATTERN.test(technicalGate.reason) &&
    !TECHNICAL_REASON_PATTERN.test(technicalGate.reason);

  if (structuralOnlyReason) {
    next = {
      ...next,
      gates: {
        ...next.gates,
        technical_consistency: {
          status: "APPROVED",
          reason:
            "Probabilidade, mercado, pick, odd e edge permanecem tecnicamente coerentes; o veto contextual foi classificado em risco estrutural.",
        },
        structural_risk: {
          status: "REJECTED",
          reason:
            structuralGate.status === "REJECTED" ? structuralGate.reason : technicalGate.reason,
        },
      },
    };
  }

  return AiLocalGenerationOutputSchema.parse(next);
}
