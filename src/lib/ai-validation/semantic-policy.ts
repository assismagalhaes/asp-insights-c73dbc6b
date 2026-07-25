import { AiLocalGenerationOutputSchema } from "./schema";

const IN_PLAY_INVALIDATION_PATTERN =
  /\b(?:at[eé]\s+a\s+\d+[ªa]?\s+(?:entrada|inning|minuto)|durante\s+o\s+jogo|no\s+decorrer\s+do\s+jogo|placar\s+(?:permane(?:ça|ca)|seguir|continuar)|jogo\s+(?:permane(?:ça|ca)|seguir|continuar)|ao\s+vivo|live)\b/i;

const STRUCTURAL_REASON_PATTERN =
  /\b(?:starters?|pitchers?|arremessadores?|bullpen|lineups?|escala[cç][aã]o|desfalque|les[aã]o|clima|vento|temperatura|chuva|park factor|est[aá]dio|gramado|goalies?|quarterback|qb)\b/i;

const TECHNICAL_REASON_PATTERN =
  /\b(?:probabilidade|edge|odd|pre[cç]o|linha|mercado|pick|c[aá]lculo|matem[aá]tic|ev\b|valor esperado|incompat[ií]vel|incoerente)\b/i;

const SAFE_PREGAME_INVALIDATION =
  "Mudança material pré-jogo em starter ou escalação, clima, linha ou odd executável.";

const SEMANTIC_POLICY_LIMITATION =
  "A condição de invalidação produzida pela IA dependia do jogo iniciado e foi substituída pela política pré-jogo.";

export function applyAiSemanticPolicy(input: unknown) {
  const output = AiLocalGenerationOutputSchema.parse(input);
  let next = output;

  if (IN_PLAY_INVALIDATION_PATTERN.test(output.invalidation_condition)) {
    next = {
      ...next,
      invalidation_condition: SAFE_PREGAME_INVALIDATION,
      limitations: Array.from(new Set([...next.limitations, SEMANTIC_POLICY_LIMITATION])).slice(
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
