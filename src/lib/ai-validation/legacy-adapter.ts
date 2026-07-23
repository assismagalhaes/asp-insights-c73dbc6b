import { parseLegacyAiDecision } from "./legacy-parser";
import { AiOperationalOutputSchema } from "./schema";
import { AI_VALIDATION_SCHEMA_VERSION, type AiGateName, type AiOperationalOutput } from "./types";

type LegacySource = {
  titulo: string;
  url: string;
};

type LegacyAdapterInput = {
  text: string;
  sources?: LegacySource[];
  searches?: string[];
};

const LEGACY_GATE_REASON =
  "Gate narrativo não estruturado no formato legado; o árbitro determinístico revalida o estado operacional atual.";
const MISSING_SECTION = "Não informado pelo modelo no parecer legado.";

function extractSingleLine(text: string, labels: RegExp[]): string | null {
  for (const label of labels) {
    const match = text.match(label);
    const value = match?.[1]?.trim();
    if (value) return value;
  }
  return null;
}

function extractSection(text: string, start: RegExp, end: RegExp): string | null {
  const startMatch = start.exec(text);
  if (startMatch?.index == null) return null;
  const contentStart = startMatch.index + startMatch[0].length;
  const remainder = text.slice(contentStart);
  const endMatch = end.exec(remainder);
  const value = remainder.slice(0, endMatch?.index ?? remainder.length).trim();
  return value || null;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function extractBulletItems(section: string | null): string[] {
  if (!section) return [];
  return section
    .split(/\r?\n/)
    .map((item) =>
      item
        .replace(/^\s*[-*•\d.)]+\s*/, "")
        .trim()
        .slice(0, 2_000),
    )
    .filter(Boolean);
}

function extractRisks(text: string): string[] {
  const sectionRisks = extractBulletItems(
    extractSection(text, /^\s*E\)\s*Riscos principais\s*$/im, /^\s*F\)/im),
  );
  const inline = extractSingleLine(text, [/^\s*riscos\s*:\s*(.+)$/im]);
  const inlineRisks = inline
    ? inline
        .split(/\s*[;|]\s*/)
        .map((item) => item.trim().slice(0, 2_000))
        .filter(Boolean)
    : [];
  const risks = Array.from(new Set([...sectionRisks, ...inlineRisks])).slice(0, 10);
  return risks.length
    ? risks
    : ["Riscos descritos apenas no parecer legado; revisar o texto auditável de origem."];
}

const GATE_LABELS: Array<{ name: AiGateName; aliases: string[] }> = [
  { name: "technical_consistency", aliases: ["coerencia tecnica"] },
  { name: "critical_information", aliases: ["informacao critica"] },
  { name: "structural_risk", aliases: ["risco estrutural"] },
  { name: "context", aliases: ["contexto", "contexto online/manual", "contexto online"] },
  {
    name: "correlation",
    aliases: ["duplicidade/correlacao", "duplicidade e correlacao", "correlacao"],
  },
];

function extractGates(text: string): AiOperationalOutput["gates"] {
  const fallback = { status: "UNKNOWN" as const, reason: LEGACY_GATE_REASON };
  const gates: AiOperationalOutput["gates"] = {
    technical_consistency: fallback,
    critical_information: fallback,
    structural_risk: fallback,
    context: fallback,
    correlation: fallback,
  };
  const section = extractSection(text, /^\s*D\)\s*Gates de validação\s*$/im, /^\s*E\)/im);
  if (!section) return gates;

  for (const line of section.split(/\r?\n/)) {
    const match = line
      .trim()
      .match(/^([^:]+):\s*(aprovado|reprovado|unknown|desconhecido)\b\s*(?:[-—:]\s*)?(.*)$/i);
    if (!match) continue;
    const label = normalize(match[1]);
    const gate = GATE_LABELS.find(({ aliases }) => aliases.includes(label));
    if (!gate) continue;
    const declaredStatus = normalize(match[2]);
    const reason =
      match[3]
        ?.replace(/^motivo\s*:\s*/i, "")
        .trim()
        .slice(0, 2_000) || "Gate declarado sem justificativa detalhada.";
    gates[gate.name] = {
      status:
        declaredStatus === "aprovado"
          ? "APPROVED"
          : declaredStatus === "reprovado"
            ? "REJECTED"
            : "UNKNOWN",
      reason,
    };
  }
  return gates;
}

export function adaptLegacyAiResponse({
  text,
  sources = [],
  searches = [],
}: LegacyAdapterInput): AiOperationalOutput {
  const parsed = parseLegacyAiDecision(text);
  const allowedStake =
    parsed.stake === 0.5 || parsed.stake === 1 || parsed.stake === 1.5 ? parsed.stake : 0;
  const unsupportedStake =
    parsed.decisao === "CONFIRMA" && parsed.stake != null && allowedStake === 0;
  const finalRationale = extractSingleLine(text, [
    /^\s*justificativa final objetiva\s*:\s*(.+)$/im,
    /^\s*justificativa_pick\s*:\s*(.+)$/im,
    /^\s*justificativa da pick escolhida\s*:\s*(.+)$/im,
  ]);
  const evaluatedEntry =
    extractSection(text, /^\s*A\)\s*Entrada avaliada\s*$/im, /^\s*B\)/im)?.slice(0, 5_000) ??
    MISSING_SECTION;
  const thesisForSection = extractSection(text, /^\s*B\)\s*Tese a favor\s*$/im, /^\s*C\)/im)?.slice(
    0,
    10_000,
  );
  const thesisFor = thesisForSection ?? MISSING_SECTION;
  const thesisAgainstSection = extractSection(
    text,
    /^\s*C\)\s*Tese contra a entrada\s*$/im,
    /^\s*D\)/im,
  )?.slice(0, 10_000);
  const thesisAgainst = thesisAgainstSection ?? MISSING_SECTION;
  const internalHistory =
    extractSection(text, /^\s*F\)\s*Histórico interno semelhante\s*$/im, /^\s*G\)/im)?.slice(
      0,
      5_000,
    ) ?? MISSING_SECTION;
  const rationale =
    [thesisForSection, thesisAgainstSection, finalRationale]
      .filter((value): value is string => Boolean(value))
      .join("\n\n")
      .slice(0, 10_000) ||
    extractSingleLine(text, [
      /^\s*justificativa final objetiva\s*:\s*(.+)$/im,
      /^\s*justificativa_pick\s*:\s*(.+)$/im,
      /^\s*justificativa da pick escolhida\s*:\s*(.+)$/im,
    ])?.slice(0, 10_000) ||
    "Decisão recebida pelo adaptador de compatibilidade do parecer legado.";
  const invalidationCondition =
    extractSingleLine(text, [
      /^\s*condicao_invalidacao\s*:\s*(.+)$/im,
      /^\s*condição que faria mudar a decisão\s*:\s*(.+)$/im,
      /^\s*condicao que faria mudar a decisao\s*:\s*(.+)$/im,
    ])?.slice(0, 5_000) ??
    "Reavaliar diante de alteração de odd, edge, lineup, starter, preview ou contexto.";
  const decisionChangeCondition = extractSingleLine(text, [
    /^\s*condição que faria mudar a decisão\s*:\s*(.+)$/im,
    /^\s*condicao que faria mudar a decisao\s*:\s*(.+)$/im,
  ])?.slice(0, 5_000);

  return AiOperationalOutputSchema.parse({
    schema_version: AI_VALIDATION_SCHEMA_VERSION,
    decision: parsed.decisao,
    stake: allowedStake,
    selected_prediction_id: parsed.prognostico_id_escolhido?.slice(0, 200) ?? null,
    selected_pick: parsed.pick_escolhida?.slice(0, 1_000) ?? null,
    gates: extractGates(text),
    narrative: {
      evaluated_entry: evaluatedEntry,
      thesis_for: thesisFor,
      thesis_against: thesisAgainst,
      internal_history: internalHistory,
      final_justification:
        finalRationale?.slice(0, 5_000) ??
        "A decisão final não trouxe justificativa objetiva separada.",
      decision_change_condition: decisionChangeCondition ?? null,
    },
    rationale,
    risks: extractRisks(text),
    invalidation_condition: invalidationCondition,
    limitations: [
      "Saída recebida em texto legado; a seleção operacional foi submetida ao árbitro determinístico.",
      ...(unsupportedStake
        ? [`Stake legado fora da lista permitida: ${String(parsed.stake)}u.`]
        : []),
    ],
    sources: sources
      .filter((source) => URL.canParse(source.url))
      .map((source) => ({
        title: source.titulo.trim().slice(0, 500) || source.url,
        url: source.url,
      })),
    searches: searches
      .map((search) => search.trim().slice(0, 1_000))
      .filter(Boolean)
      .slice(0, 50),
  });
}
