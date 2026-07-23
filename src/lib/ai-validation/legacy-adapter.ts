import { parseLegacyAiDecision } from "./legacy-parser";
import { AiOperationalOutputSchema } from "./schema";
import { AI_VALIDATION_SCHEMA_VERSION, type AiOperationalOutput } from "./types";

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

function extractRisks(text: string): string[] {
  const inline = extractSingleLine(text, [/^\s*riscos\s*:\s*(.+)$/im]);
  if (inline) {
    return inline
      .split(/\s*[;|]\s*/)
      .map((item) => item.trim().slice(0, 2_000))
      .filter(Boolean)
      .slice(0, 10);
  }
  const section = extractSection(text, /^\s*E\)\s*Riscos principais\s*$/im, /^\s*F\)/im);
  if (section) {
    return section
      .split(/\r?\n/)
      .map((item) =>
        item
          .replace(/^\s*[-*•\d.)]+\s*/, "")
          .trim()
          .slice(0, 2_000),
      )
      .filter(Boolean)
      .slice(0, 10);
  }
  return ["Riscos descritos apenas no parecer legado; revisar o texto auditável de origem."];
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
  const rationale =
    [
      extractSection(text, /^\s*B\)\s*Tese a favor\s*$/im, /^\s*C\)/im),
      extractSection(text, /^\s*C\)\s*Tese contra a entrada\s*$/im, /^\s*D\)/im),
      finalRationale,
    ]
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

  return AiOperationalOutputSchema.parse({
    schema_version: AI_VALIDATION_SCHEMA_VERSION,
    decision: parsed.decisao,
    stake: allowedStake,
    selected_prediction_id: parsed.prognostico_id_escolhido?.slice(0, 200) ?? null,
    selected_pick: parsed.pick_escolhida?.slice(0, 1_000) ?? null,
    gates: {
      technical_consistency: { status: "UNKNOWN", reason: LEGACY_GATE_REASON },
      critical_information: { status: "UNKNOWN", reason: LEGACY_GATE_REASON },
      structural_risk: { status: "UNKNOWN", reason: LEGACY_GATE_REASON },
      context: { status: "UNKNOWN", reason: LEGACY_GATE_REASON },
      correlation: { status: "UNKNOWN", reason: LEGACY_GATE_REASON },
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
