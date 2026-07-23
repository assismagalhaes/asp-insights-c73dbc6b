import type { ArbitratedAiValidation } from "./types";

const GATE_LABELS = {
  technical_consistency: "Coerência técnica",
  critical_information: "Informação crítica",
  structural_risk: "Risco estrutural",
  context: "Contexto",
  correlation: "Duplicidade/correlação",
} as const;

export function formatArbitratedAiValidation(result: ArbitratedAiValidation): string {
  const output = result.output;
  const lines = [
    `Contrato: ${output.schema_version}`,
    `Status do árbitro: ${result.status}`,
    `Decisão: ${output.decision}`,
    `ID escolhido: ${output.selected_prediction_id ?? "-"}`,
    `Pick escolhida: ${output.selected_pick ?? "-"}`,
    `Stake: ${output.stake.toFixed(1)}u`,
  ];

  if (result.blocks.length) {
    lines.push(
      "",
      "Bloqueios determinísticos:",
      ...result.blocks.map((block) => `- [${block.code}] ${block.reason}`),
    );
  }

  lines.push(
    "",
    "Gates declarados pela IA:",
    ...Object.entries(output.gates).map(
      ([name, gate]) =>
        `- ${GATE_LABELS[name as keyof typeof GATE_LABELS]}: ${gate.status} — ${gate.reason}`,
    ),
    "",
    "Justificativa:",
    output.rationale,
    "",
    "Riscos:",
    ...(output.risks.length ? output.risks.map((risk) => `- ${risk}`) : ["- Nenhum informado."]),
    "",
    "Condição de invalidação:",
    output.invalidation_condition,
  );

  if (output.limitations.length) {
    lines.push("", "Limitações:", ...output.limitations.map((item) => `- ${item}`));
  }
  if (output.sources.length) {
    lines.push(
      "",
      "Fontes:",
      ...output.sources.map((source) => `- ${source.title}: ${source.url}`),
    );
  }
  if (output.searches.length) {
    lines.push("", "Buscas realizadas:", ...output.searches.map((search) => `- ${search}`));
  }

  return lines.join("\n");
}
