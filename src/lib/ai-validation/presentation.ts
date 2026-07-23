import type { ArbitratedAiValidation } from "./types";

const GATE_LABELS = {
  technical_consistency: "Coerência técnica",
  critical_information: "Informação crítica",
  structural_risk: "Risco estrutural",
  context: "Contexto",
  correlation: "Duplicidade/correlação",
} as const;

const GATE_STATUS_LABELS = {
  APPROVED: "aprovado",
  REJECTED: "reprovado",
  UNKNOWN: "não informado",
} as const;

export function formatArbitratedAiValidation(result: ArbitratedAiValidation): string {
  const output = result.output;
  const modelOutput = result.model_output;
  const narrative = (modelOutput ?? output).narrative;
  const declaredGates = (modelOutput ?? output).gates;
  const validationLabel = result.blocks.length
    ? "BLOQUEADO — recomendação convertida para PULAR"
    : output.decision === "CONFIRMA"
      ? "CONFIRMA VALIDADO"
      : "PULAR VALIDADO";
  const lines = [
    "A) Entrada avaliada",
    narrative.evaluated_entry,
    "",
    "B) Tese a favor",
    narrative.thesis_for,
    "",
    "C) Tese contra a entrada",
    narrative.thesis_against,
    "",
    "D) Gates de validação",
    ...Object.entries(declaredGates).map(
      ([name, gate]) =>
        `${GATE_LABELS[name as keyof typeof GATE_LABELS]}: ${GATE_STATUS_LABELS[gate.status]} - ${gate.reason}`,
    ),
    "",
    `Validação determinística: ${validationLabel}`,
  ];

  if (result.blocks.length) {
    lines.push(
      "Bloqueios determinísticos:",
      ...result.blocks.map((block) => `- [${block.code}] ${block.reason}`),
    );
  }

  lines.push(
    "",
    "E) Riscos principais",
    ...(output.risks.length
      ? output.risks.map((risk, index) => `${index + 1}. ${risk}`)
      : ["Nenhum informado."]),
    "",
    "F) Histórico interno semelhante",
    narrative.internal_history,
    "",
    "G) Decisão final",
    `Contrato: ${output.schema_version}`,
    `Decisão original da IA: ${modelOutput?.decision ?? "indisponível"}`,
    `Decisão final validada: ${output.decision}`,
    `decisao_grupo: ${output.decision}`,
    `prognostico_id_escolhido: ${output.selected_prediction_id ?? "null"}`,
    `pick_escolhida: ${output.selected_pick ?? "null"}`,
    `stake_confirmada: ${output.stake.toFixed(1)}`,
    `Stake sugerida: ${output.stake.toFixed(1)}u`,
    `justificativa_pick: ${narrative.final_justification}`,
    `riscos: ${output.risks.join("; ") || "Nenhum informado."}`,
    `condicao_invalidacao: ${output.invalidation_condition}`,
    `Justificativa final objetiva: ${narrative.final_justification}`,
    "",
    `Condição que faria mudar a decisão: ${
      narrative.decision_change_condition ?? output.invalidation_condition
    }`,
  );

  if (output.limitations.length) {
    lines.push("", "Limitações operacionais:", ...output.limitations.map((item) => `- ${item}`));
  }
  if (output.sources.length) {
    lines.push(
      "",
      "H) Rastreabilidade online",
      "Fontes consultadas:",
      ...output.sources.map((source) => `- ${source.title}: ${source.url}`),
    );
  }
  if (output.searches.length) {
    lines.push("", "Buscas realizadas:", ...output.searches.map((search) => `- ${search}`));
  }

  return lines.join("\n");
}
