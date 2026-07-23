import type { Prognostico } from "@/lib/db";
import {
  evaluateMatchMatrixOperationalGate,
  evaluateMlbOperationalGate,
} from "@/lib/critical-validation/critical-shortlist-ranking";
import {
  getPackballValidationRequirements,
  hasPackballExecutableOdd,
} from "@/lib/packball-validation";
import { parseAiOperationalOutput } from "./schema";
import {
  AI_VALIDATION_SCHEMA_VERSION,
  type AiOperationalOutput,
  type AiValidationBlock,
  type AiValidationBlockingCode,
  type AiValidationMode,
  type ArbitratedAiValidation,
} from "./types";

export type AiArbiterOption = {
  prediction: Prognostico;
  pick: string;
};

export type AiArbiterContext = {
  mode: AiValidationMode;
  options: AiArbiterOption[];
};

function normalize(value: unknown): string {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function fallbackOutput(reason: string): AiOperationalOutput {
  const gate = { status: "UNKNOWN" as const, reason };
  return {
    schema_version: AI_VALIDATION_SCHEMA_VERSION,
    decision: "PULAR",
    stake: 0,
    selected_prediction_id: null,
    selected_pick: null,
    gates: {
      technical_consistency: gate,
      critical_information: gate,
      structural_risk: gate,
      context: gate,
      correlation: gate,
    },
    rationale: "Saída da IA bloqueada pelo contrato operacional.",
    risks: ["O parecer não pôde ser validado com segurança."],
    invalidation_condition: "Gerar uma nova análise compatível com o contrato vigente.",
    limitations: [reason],
    sources: [],
    searches: [],
  };
}

function blockedOutput(modelOutput: AiOperationalOutput, blocks: AiValidationBlock[]) {
  return {
    ...modelOutput,
    decision: "PULAR" as const,
    stake: 0 as const,
    selected_prediction_id: null,
    selected_pick: null,
    limitations: Array.from(
      new Set([...modelOutput.limitations, ...blocks.map((block) => block.reason)]),
    ).slice(0, 10),
  };
}

function addBlock(blocks: AiValidationBlock[], code: AiValidationBlockingCode, reason: string) {
  if (!blocks.some((block) => block.code === code)) blocks.push({ code, reason });
}

function effectiveOdd(prediction: Prognostico): number | null {
  const value = prediction.odd_ajustada ?? prediction.odd_ofertada;
  return Number.isFinite(value) ? value : null;
}

function effectiveEdge(prediction: Prognostico): number | null {
  const value = prediction.edge_ajustado ?? prediction.edge;
  return Number.isFinite(value) ? value : null;
}

function validateConfirmation(
  output: AiOperationalOutput,
  context: AiArbiterContext,
  blocks: AiValidationBlock[],
) {
  if (output.stake === 0) {
    addBlock(blocks, "CONFIRMA_STAKE_ZERO", "CONFIRMA exige stake operacional positiva.");
  }
  if (!output.selected_prediction_id) {
    addBlock(
      blocks,
      "SELECTION_ID_REQUIRED",
      "CONFIRMA exige selected_prediction_id pertencente ao grupo atual.",
    );
  }
  if (!output.selected_pick) {
    addBlock(blocks, "SELECTED_PICK_REQUIRED", "CONFIRMA exige selected_pick.");
  }

  const duplicateIds = context.options
    .map((option) => option.prediction.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicateIds.length) {
    addBlock(
      blocks,
      "CORRELATED_SELECTION_CONFLICT",
      "O grupo atual contém opções correlatas duplicadas e não pode ser confirmado.",
    );
  }

  const selected = context.options.find(
    (option) => option.prediction.id === output.selected_prediction_id,
  );
  if (!selected) {
    if (output.selected_prediction_id) {
      addBlock(
        blocks,
        "SELECTION_ID_NOT_IN_GROUP",
        "O ID escolhido pela IA não pertence ao grupo atual.",
      );
    }
    return;
  }

  if (output.selected_pick && normalize(output.selected_pick) !== normalize(selected.pick)) {
    addBlock(
      blocks,
      "SELECTED_PICK_MISMATCH",
      "A pick escolhida não corresponde ao ID selecionado no grupo atual.",
    );
  }

  const prediction = selected.prediction;
  const edge = effectiveEdge(prediction);
  if (edge == null || edge < 0) {
    addBlock(
      blocks,
      "EFFECTIVE_EDGE_INVALID",
      `Edge efetivo ${edge?.toFixed(2) ?? "ausente"}% não permite confirmação.`,
    );
  }

  const packball = getPackballValidationRequirements(prediction);
  if (!packball) {
    const odd = effectiveOdd(prediction);
    if (odd == null || odd < prediction.odd_valor) {
      addBlock(
        blocks,
        "ODD_BELOW_FAIR_VALUE",
        "A odd efetiva atual não supera a odd de valor do modelo.",
      );
    }
  }

  const mlbGate = evaluateMlbOperationalGate(prediction);
  if (mlbGate.applicable && !mlbGate.approved) {
    addBlock(blocks, "MLB_GATE_BLOCKED", mlbGate.reasons.join(" "));
    if (mlbGate.missingStarters) {
      addBlock(
        blocks,
        "MLB_STARTERS_MISSING",
        "Os dois starters não estão confirmados no contexto atual.",
      );
      if (!String(prediction.dados_tecnicos ?? "").includes("[MATCHUPS / PREVIEW ENRIQUECIDO]")) {
        addBlock(
          blocks,
          "MLB_PREVIEW_MISSING",
          "O Preview enriquecido vigente não foi aplicado ao prognóstico MLB.",
        );
      }
    }
  }

  const matchMatrixGate = evaluateMatchMatrixOperationalGate(prediction);
  if (matchMatrixGate.applicable && !matchMatrixGate.approved) {
    addBlock(blocks, "MATCHMATRIX_GATE_BLOCKED", matchMatrixGate.reasons.join(" "));
  }

  if (packball) {
    if (!hasPackballExecutableOdd(prediction)) {
      addBlock(
        blocks,
        "PACKBALL_EXECUTABLE_ODD_MISSING",
        `${packball.modelName} exige odd executável antes da confirmação.`,
      );
      if (packball.priceFeasibility === "SEM_PRECO") {
        addBlock(
          blocks,
          "PACKBALL_SEM_PRECO",
          "SEM_PRECO permanece reserva e não pode ser confirmado pela IA.",
        );
      }
    }
    if (packball.executableEdge == null || packball.executableEdge < packball.requiredEdge) {
      addBlock(
        blocks,
        "PACKBALL_EDGE_BELOW_MIN",
        `Edge executável abaixo do mínimo de ${packball.requiredEdge.toFixed(2)}% do ${packball.modelName}.`,
      );
    }
    if (output.stake > packball.maxStake) {
      addBlock(
        blocks,
        "PACKBALL_STAKE_CAP_EXCEEDED",
        `Stake de ${output.stake.toFixed(2)}u excede o cap de ${packball.maxStake.toFixed(2)}u do ${packball.modelName}.`,
      );
    }
  }
}

export function arbitrateAiOutput(
  input: unknown,
  context: AiArbiterContext,
): ArbitratedAiValidation {
  const parsed = parseAiOperationalOutput(input);
  if (!parsed.success) {
    const reason = `Schema inválido: ${parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "root"} ${issue.message}`)
      .join("; ")}`;
    const output = fallbackOutput(reason);
    return {
      status: "BLOCKED",
      output,
      model_output: null,
      blocks: [{ code: "SCHEMA_INVALID", reason }],
    };
  }

  const modelOutput = parsed.data;
  const blocks: AiValidationBlock[] = [];
  const rejectedGates = Object.entries(modelOutput.gates).filter(
    ([, gate]) => gate.status === "REJECTED",
  );
  if (modelOutput.decision === "CONFIRMA" && rejectedGates.length) {
    addBlock(
      blocks,
      "MODEL_GATE_REJECTED",
      `A própria IA reprovou os gates: ${rejectedGates.map(([name]) => name).join(", ")}.`,
    );
  }

  if (modelOutput.decision === "PULAR") {
    if (modelOutput.stake !== 0) {
      addBlock(blocks, "PULAR_STAKE_NON_ZERO", "PULAR sempre implica stake zero.");
    }
    if (modelOutput.selected_prediction_id || modelOutput.selected_pick) {
      addBlock(
        blocks,
        "PULAR_SELECTION_PRESENT",
        "PULAR não pode manter ID ou pick operacional selecionada.",
      );
    }
  } else {
    validateConfirmation(modelOutput, context, blocks);
  }

  return {
    status: blocks.length ? "BLOCKED" : "APPROVED",
    output: blocks.length ? blockedOutput(modelOutput, blocks) : modelOutput,
    model_output: modelOutput,
    blocks,
  };
}
