import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  Sparkles,
  ShieldAlert,
  Loader2,
  RefreshCw,
  Trash2,
  Trophy,
  ClipboardList,
  BrainCircuit,
  CircleCheckBig,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  ChevronDown,
  Gauge,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { StatusBadge } from "@/components/status-badge";
import { LeagueFilter } from "@/components/league-filter";
import { SportFilterSelect } from "@/components/sport-filter-select";
import { SportMark } from "@/components/sport-filter-select";
import { AmbientBackdrop, PageIntro } from "@/components/command-center";
import { StatCard } from "@/components/stat-card";
import { PeriodFilter } from "@/components/period-filter";
import { AiAnalysisPanel } from "@/components/ai-validation/ai-analysis-panel";
import { rangeFromPeriodo, dateInRange, isStatusConfirma, type PeriodoFiltro } from "@/lib/metrics";
import {
  usePrognosticos,
  useCreateValidacao,
  useUpdatePrognostico,
  useDeletePrognostico,
  useConfiguracao,
  calcEdge,
  getEdgeEfetivo,
  getDadosTecnicos,
  saveAnaliseIaSnapshot,
  ESPORTES_DEFAULT,
  MERCADOS_DEFAULT,
  type Prognostico,
  type FonteIa,
  type Status,
} from "@/lib/db";
import { analisarValidacao } from "@/lib/validacao-ia.functions";
import { analisarValidacaoOnline } from "@/lib/validacao-ia-online.functions";
import { getAiCalibrationSummary } from "@/lib/ai-learning";
import {
  buildAiObservabilitySnapshot,
  type AiServerRunTelemetry,
} from "@/lib/ai-validation/observability";
import { formatBR, formatHora } from "@/lib/date-br";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  calculatePackballKelly,
  getPackballValidationRequirements,
  isPackballMatrixPrognostico,
} from "@/lib/packball-validation";
import {
  buildPreAiShortlist,
  calculatePreliminaryOpportunityScore,
  DEFAULT_PRE_AI_SHORTLIST_LIMIT,
  getOpportunityMarketLabel,
  getOpportunityPickLabel,
  getOpportunitySourceLabel,
  useApplyCriticalValidationToOpportunityRanking,
  useGeneratePreAiOpportunityShortlist,
  useEnrichOpportunityRankingItemPreview,
  useRefreshOpportunityRankingForPrognostico,
  usePreAiOpportunityShortlistHistory,
  type PersistedOpportunityRankingRun,
  type RankedOpportunityAlternative,
  type RankedOpportunityCandidate,
} from "@/lib/opportunity-ranking";
import {
  evaluateMatchMatrixOperationalGate,
  evaluateMlbOperationalGate,
} from "@/lib/critical-validation/critical-shortlist-ranking";
import {
  arbitrateAiGenerationFailure,
  arbitrateAiOutput,
  arbitrateAiSchemaFailure,
} from "@/lib/ai-validation/arbiter";
import { formatArbitratedAiValidation } from "@/lib/ai-validation/presentation";
import type { AiOperationalOutput } from "@/lib/ai-validation/types";

export const Route = createFileRoute("/_authenticated/validacao")({
  head: () => ({ meta: [{ title: "Validação Crítica - ASP Insights" }] }),
  component: Validacao,
});

const decisoes: { label: Status; texto: string; color: string }[] = [
  {
    label: "CONFIRMA",
    texto: "Confirmar",
    color: "bg-success text-success-foreground hover:bg-success/90",
  },
  {
    label: "PULAR",
    texto: "Pular",
    color: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  },
];

const STAKES = ["0.5", "1.0", "1.5"];

const PARECER_TEMPLATE = "PULAR - risco/contexto insuficiente";
const MATCHUP_PREVIEW_CONTEXT_MARKER = "[MATCHUPS / PREVIEW ENRIQUECIDO]";

interface IAResult extends AiServerRunTelemetry {
  parecer: string;
  decisao_sugerida: string | null;
  stake_sugerida: number | null;
  prompt_versao: string;
  modo: "local" | "online";
  prognostico_id_escolhido?: string | null;
  pick_escolhida?: string | null;
  aviso_opcao?: string | null;
  fontes_consultadas?: FonteIa[];
  buscas_realizadas?: string[];
  odd_analisada?: number | null;
  odd_analisada_por_opcao?: Record<string, number>;
  blocking_codes?: string[];
  model_output?: AiOperationalOutput;
  parse_status?: "VALID" | "FAILED" | "LEGACY_ROLLBACK";
  parse_error?: string | null;
  provider?: string;
  model?: string;
  latency_ms?: number;
  observability: ReturnType<typeof buildAiObservabilitySnapshot>;
}

interface ServerAiResult extends AiServerRunTelemetry {
  model_output: unknown;
  raw_model_text: string;
  prompt_versao: string;
  parse_status?: "VALID" | "FAILED" | "LEGACY_ROLLBACK";
  parse_error?: string | null;
  error_code?: string | null;
  provider?: string;
  model?: string;
  latency_ms?: number;
  fontes_consultadas?: FonteIa[];
  buscas_realizadas?: string[];
}

type ValidationGroup = {
  key: string;
  eventKey: string;
  familyKey: string;
  esporte: string;
  liga: string;
  data: string;
  hora: string | null;
  jogo: string;
  mercado: string;
  opcoes: Prognostico[];
};

function normalizeGroupValue(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function getEventKey(prognostico: Prognostico): string {
  const jogoBase =
    prognostico.jogo || `${prognostico.mandante ?? ""} vs ${prognostico.visitante ?? ""}`;
  const mandante = prognostico.mandante || jogoBase.split(/\s+vs\s+/i)[0] || jogoBase;
  const visitante = prognostico.visitante || jogoBase.split(/\s+vs\s+/i)[1] || "";

  return [
    prognostico.esporte,
    prognostico.liga,
    prognostico.data,
    prognostico.hora,
    mandante,
    visitante,
  ]
    .map(normalizeGroupValue)
    .join("|");
}

function getMarketFamilyKey(prognostico: Prognostico): string {
  const mercado = normalizeGroupValue(getOpportunityMarketLabel(prognostico));
  if (
    /moneyline|backmatrix|1x2|resultado final|vencedor|handicap|h[áa]ndicap|dupla chance|double chance/.test(
      mercado,
    )
  ) {
    return "resultado-protecao";
  }
  return `mercado:${mercado}`;
}

function getMarketFamilyLabel(prognostico: Prognostico): string {
  return getMarketFamilyKey(prognostico) === "resultado-protecao"
    ? "Resultado / Proteção de Resultado"
    : getOpportunityMarketLabel(prognostico);
}

function getValidationGroupKey(prognostico: Prognostico): string {
  return `${getEventKey(prognostico)}|${getMarketFamilyKey(prognostico)}`;
}

function formatOptionalOdd(value: number | null | undefined): string {
  return value != null && Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "-";
}

function getOddMercadoBase(prognostico: Prognostico): number | null {
  return prognostico.odd_mercado_base ?? prognostico.odd_mediana ?? null;
}

function getBookmakerMelhor(prognostico: Prognostico): string {
  return prognostico.bookmaker_melhor?.trim() || "-";
}

function groupPendentes(prognosticos: Prognostico[]): ValidationGroup[] {
  const map = new Map<string, ValidationGroup>();

  for (const p of prognosticos) {
    const key = getValidationGroupKey(p);
    const group = map.get(key);
    if (group) {
      group.opcoes.push(p);
      continue;
    }
    map.set(key, {
      key,
      eventKey: getEventKey(p),
      familyKey: getMarketFamilyKey(p),
      esporte: p.esporte,
      liga: p.liga,
      data: p.data,
      hora: p.hora,
      jogo: p.jogo || `${p.mandante} vs ${p.visitante}`,
      mercado: getMarketFamilyLabel(p),
      opcoes: [p],
    });
  }

  return Array.from(map.values()).map((group) => ({
    ...group,
    opcoes: group.opcoes.slice().sort((a, b) => {
      const pa = getOpportunityPickLabel(a);
      const pb = getOpportunityPickLabel(b);
      return `${getOpportunityMarketLabel(a)} ${pa}`.localeCompare(
        `${getOpportunityMarketLabel(b)} ${pb}`,
      );
    }),
  }));
}

function getBestGroupCandidate(
  group: ValidationGroup,
  candidates: Map<string, RankedOpportunityCandidate>,
): RankedOpportunityCandidate | null {
  return (
    group.opcoes
      .map((option) => candidates.get(option.id) ?? null)
      .filter((candidate): candidate is RankedOpportunityCandidate => Boolean(candidate))
      .sort(
        (a, b) =>
          b.opportunity_score_pre - a.opportunity_score_pre ||
          b.confidence_score - a.confidence_score,
      )[0] ?? null
  );
}

function formatOptionCount(count: number): string {
  return count === 1 ? "1 opção pendente" : `${count} opções pendentes`;
}

function normalizeAiChoice(value: unknown): string {
  return normalizeGroupValue(value).replace(/\s+/g, " ").trim();
}

function findAiChosenOption(g: ValidationGroup, ia: IAResult): Prognostico | null {
  const id = ia.prognostico_id_escolhido?.trim();
  if (id && id.toLowerCase() !== "null") {
    const byId = g.opcoes.find((p) => p.id === id);
    if (byId) return byId;
  }

  const pick = normalizeAiChoice(ia.pick_escolhida);
  if (!pick || pick === "null") return null;

  return (
    g.opcoes.find((p) => {
      const optionLabel = normalizeAiChoice(getOpportunityPickLabel(p));
      const optionPick = normalizeAiChoice(getOpportunityPickLabel(p));
      return optionLabel === pick || optionPick === pick || optionLabel.includes(pick);
    }) ?? null
  );
}

function getContextoInicialGrupo(g: ValidationGroup): string {
  for (const option of g.opcoes) {
    const dados = getDadosTecnicos(option);
    if (dados?.trim()) return dados.trim();
  }
  return "";
}

function mergeMatchupPreviewContext(baseContext: string, previewContext: string): string {
  const base = baseContext.split(MATCHUP_PREVIEW_CONTEXT_MARKER)[0]?.trim() ?? "";
  const preview = previewContext.trim();
  return [base, preview].filter(Boolean).join("\n\n");
}

function extractMatchupPreviewContext(context: string): string {
  const markerIndex = context.indexOf(MATCHUP_PREVIEW_CONTEXT_MARKER);
  return markerIndex >= 0 ? context.slice(markerIndex).trim() : "";
}

function getIaResumo(ia: IAResult): string {
  const decisao = ia.decisao_sugerida === "CONFIRMA" ? "CONFIRMAR" : "PULAR";
  const pick =
    ia.decisao_sugerida === "CONFIRMA" && ia.pick_escolhida ? ` - ${ia.pick_escolhida}` : "";
  const stake =
    ia.decisao_sugerida === "CONFIRMA" && ia.stake_sugerida != null
      ? ` - ${ia.stake_sugerida.toFixed(1)}u`
      : "";
  return `${decisao}${pick}${stake}`;
}

function autoCheck(p: Prognostico, edgeFinal: number | null, executableOdd: number | null) {
  const packball = getPackballValidationRequirements(p);
  if (packball) {
    if (!(executableOdd && executableOdd > 1))
      return { auto: "ALERTA" as const, reason: "Informe a odd executável antes da análise" };
    if (edgeFinal == null || edgeFinal < packball.requiredEdge)
      return {
        auto: "PULAR" as const,
        reason: `Odd executavel abaixo do edge minimo de ${packball.requiredEdge.toFixed(2)}%`,
      };
    return { auto: "DESTAQUE" as const, reason: "Odd executavel aprovada para validacao" };
  }
  if ((executableOdd ?? p.odd_ofertada) < p.odd_valor)
    return { auto: "PULAR" as const, reason: "Odd ofertada menor que odd de valor" };
  const mlbGate = evaluateMlbOperationalGate({
    ...p,
    odd_ajustada: executableOdd,
    edge_ajustado: edgeFinal,
  });
  if (mlbGate.applicable && !mlbGate.approved) {
    const blockingReasons = mlbGate.reasons.filter(
      (reason) => reason !== "MLB sem os dois starters confirmados no Preview enriquecido.",
    );
    if (blockingReasons.length)
      return { auto: "PULAR" as const, reason: blockingReasons.join(" ") };
    if (mlbGate.missingStarters)
      return {
        auto: "ALERTA" as const,
        reason: "Aplique o Preview enriquecido e confirme os dois starters antes da decisao final",
      };
  }
  if (mlbGate.applicable && mlbGate.previewContextStatus === "REVIEW_REQUIRED") {
    return {
      auto: "ALERTA" as const,
      reason: mlbGate.contextRiskFlags.map((flag) => flag.message).join(" "),
    };
  }
  const matchMatrixGate = evaluateMatchMatrixOperationalGate({
    ...p,
    odd_ajustada: executableOdd,
    edge_ajustado: edgeFinal,
  });
  if (matchMatrixGate.applicable && !matchMatrixGate.approved)
    return { auto: "PULAR" as const, reason: matchMatrixGate.reasons.join(" ") };
  if (edgeFinal != null && edgeFinal < 0)
    return { auto: "PULAR" as const, reason: "Edge negativo" };
  if (p.probabilidade_final < 55)
    return { auto: "ALERTA" as const, reason: "Probabilidade inferior a 55%" };
  if (p.probabilidade_final > 60)
    return { auto: "DESTAQUE" as const, reason: "Probabilidade superior a 60%" };
  return null;
}

function matchesMercadoOuModelo(
  prognostico: Pick<Prognostico, "mercado" | "origem_modelo">,
  filtro: string,
) {
  const alvo = normalizeFilterValue(filtro);
  return [prognostico.mercado, prognostico.origem_modelo].some(
    (value) => normalizeFilterValue(value) === alvo,
  );
}

function normalizeFilterValue(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

function Validacao() {
  const { data: prognosticos = [] } = usePrognosticos();
  const { data: cfg } = useConfiguracao();
  const createVal = useCreateValidacao();
  const updateProg = useUpdatePrognostico();
  const deleteProg = useDeletePrognostico();
  const callIA = useServerFn(analisarValidacao);
  const callIAOnline = useServerFn(analisarValidacaoOnline);
  const shortlistHistory = usePreAiOpportunityShortlistHistory();
  const [selectedShortlistRunId, setSelectedShortlistRunId] = useState("");
  const selectedShortlist =
    shortlistHistory.data?.find((entry) => entry.run.id === selectedShortlistRunId) ??
    shortlistHistory.data?.[0] ??
    null;
  const generatePreAiShortlist = useGeneratePreAiOpportunityShortlist();
  const enrichPreview = useEnrichOpportunityRankingItemPreview();
  const refreshRanking = useRefreshOpportunityRankingForPrognostico();
  const applyRankingValidation = useApplyCriticalValidationToOpportunityRanking();
  const esportes = cfg?.esportes_ativos ?? ESPORTES_DEFAULT;
  const mercados = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...(cfg?.mercados_ativos ?? MERCADOS_DEFAULT),
            ...MERCADOS_DEFAULT,
            ...prognosticos.flatMap((prognostico) => [
              prognostico.mercado,
              prognostico.origem_modelo,
            ]),
          ]
            .map((value) => value?.trim())
            .filter((value): value is string => Boolean(value)),
        ),
      ).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [cfg?.mercados_ativos, prognosticos],
  );

  // estado por opção e por grupo
  const [oddsAj, setOddsAj] = useState<Record<string, string>>({});
  const [oddSaveStatus, setOddSaveStatus] = useState<Record<string, "saving" | "saved" | "error">>(
    {},
  );
  const [stakes, setStakes] = useState<Record<string, string>>({});
  const [pareceres, setPareceres] = useState<Record<string, string>>({});
  const [contextos, setContextos] = useState<Record<string, string>>({});
  const [iaResults, setIaResults] = useState<Record<string, IAResult>>({});
  const [iaLoading, setIaLoading] = useState<Record<string, "local" | "online" | null>>({});
  const [selectedByGroup, setSelectedByGroup] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<Prognostico | null>(null);

  const [fEsporte, setFEsporte] = useState("all");
  const [fLiga, setFLiga] = useState("all");
  const [fMercado, setFMercado] = useState("all");
  const [periodo, setPeriodo] = useState<PeriodoFiltro>("tudo");
  const [customIni, setCustomIni] = useState("");
  const [customFim, setCustomFim] = useState("");

  const { ini, fim } = rangeFromPeriodo(periodo, customIni, customFim);

  const scopePrognosticos = useMemo(
    () =>
      prognosticos.filter((p) => {
        if (!dateInRange(p.data, ini, fim)) return false;
        if (fEsporte !== "all" && p.esporte !== fEsporte) return false;
        if (fLiga !== "all" && p.liga !== fLiga) return false;
        if (fMercado !== "all" && !matchesMercadoOuModelo(p, fMercado)) return false;
        return true;
      }),
    [prognosticos, ini, fim, fEsporte, fLiga, fMercado],
  );

  const pendentes = useMemo(
    () =>
      scopePrognosticos
        .filter((p) => p.resultado === "PENDENTE" && p.status_validacao === "PENDENTE")
        .slice()
        .sort((a, b) => {
          if (a.data !== b.data) return a.data < b.data ? -1 : 1;
          const ha = a.hora ?? "99:99";
          const hb = b.hora ?? "99:99";
          return ha < hb ? -1 : ha > hb ? 1 : 0;
        }),
    [scopePrognosticos],
  );

  const preliminaryCandidateById = useMemo(
    () =>
      new Map(
        pendentes.map((p) => {
          const candidate = calculatePreliminaryOpportunityScore(p);
          return [p.id, candidate] as const;
        }),
      ),
    [pendentes],
  );
  const grupos = useMemo(() => {
    const base = groupPendentes(pendentes);
    return base.sort((a, b) => {
      const bestA = getBestGroupCandidate(a, preliminaryCandidateById);
      const bestB = getBestGroupCandidate(b, preliminaryCandidateById);
      return (
        (bestB?.opportunity_score_pre ?? -1) - (bestA?.opportunity_score_pre ?? -1) ||
        (bestB?.confidence_score ?? -1) - (bestA?.confidence_score ?? -1) ||
        a.data.localeCompare(b.data) ||
        (a.hora ?? "99:99").localeCompare(b.hora ?? "99:99")
      );
    });
  }, [pendentes, preliminaryCandidateById]);
  const preAiCandidates = useMemo(
    () => buildPreAiShortlist(pendentes, DEFAULT_PRE_AI_SHORTLIST_LIMIT),
    [pendentes],
  );
  const validationSummary = useMemo(() => {
    const structuralRisk = grupos.filter((group) => {
      const candidate = getBestGroupCandidate(group, preliminaryCandidateById);
      if (!candidate) return false;
      const prognostico = group.opcoes.find((option) => option.id === candidate.prognostico.id);
      if (!prognostico) return false;
      const persistedOdd = isPackballMatrixPrognostico(prognostico)
        ? (prognostico.odd_ajustada ?? null)
        : (prognostico.odd_ajustada ?? prognostico.odd_ofertada);
      const persistedEdge = persistedOdd
        ? calcEdge(prognostico.probabilidade_final, persistedOdd)
        : prognostico.edge_ajustado;
      const check = autoCheck(prognostico, persistedEdge, persistedOdd);
      return check?.auto === "PULAR" || check?.auto === "ALERTA";
    }).length;

    return {
      pending: grupos.length,
      analyzed: Object.keys(iaResults).length,
      confirmed: scopePrognosticos.filter((p) => isStatusConfirma(p.status_validacao)).length,
      structuralRisk,
    };
  }, [grupos, preliminaryCandidateById, iaResults, scopePrognosticos]);

  const gerarShortlistPreIa = async () => {
    try {
      const saved = await generatePreAiShortlist.mutateAsync({
        prognosticos: pendentes,
        filtersPayload: {
          periodo,
          customIni,
          customFim,
          ini,
          fim,
          esporte: fEsporte,
          liga: fLiga,
          mercado: fMercado,
          total_pendentes: pendentes.length,
          total_grupos: grupos.length,
        },
      });
      setSelectedShortlistRunId(saved.run.id);
      toast.success(`Shortlist pré-IA gerada com ${saved.items.length} candidata(s).`);
    } catch (e) {
      toast.error((e as Error).message || "Erro ao gerar shortlist pré-IA.");
    }
  };

  useEffect(() => {
    const items = selectedShortlist?.items ?? [];
    const loadedPreviewItems = items.filter(
      (item) => item.matchup_preview_status === "loaded" && item.matchup_preview_context?.trim(),
    );
    if (!loadedPreviewItems.length || !grupos.length) return;

    setContextos((prev) => {
      let changed = false;
      const next = { ...prev };

      for (const item of loadedPreviewItems) {
        const eventKey = item.event_key;
        const previewContext = item.matchup_preview_context?.trim() ?? "";
        if (!previewContext) continue;

        const relatedGroups = grupos.filter((group) => group.eventKey === eventKey);
        for (const group of relatedGroups) {
          const current = next[group.key] ?? getContextoInicialGrupo(group);
          const merged = mergeMatchupPreviewContext(current, previewContext);
          if (merged !== current) {
            next[group.key] = merged;
            changed = true;
          }
        }
      }

      return changed ? next : prev;
    });
  }, [selectedShortlist?.items, grupos]);

  const aplicarMatchupPreview = async (itemId: string, rawPreviewText: string) => {
    const item = selectedShortlist?.items.find((row) => row.id === itemId);
    if (!item) {
      toast.error("Gere ou selecione uma shortlist salva antes de aplicar o preview.");
      return false;
    }
    const prognostico = prognosticos.find((p) => p.id === item.prognostico_id);
    if (!prognostico) {
      toast.error("O prognóstico desta shortlist não está mais cadastrado.");
      return false;
    }
    try {
      let previewRequiresReview = false;
      const updated = await enrichPreview.mutateAsync({
        itemId,
        prognostico,
        rawPreviewText,
      });
      const previewContext = updated.matchup_preview_context?.trim();
      if (previewContext) {
        const eventKey = item.event_key;
        const eventOptions = prognosticos.filter((option) => getEventKey(option) === eventKey);
        for (const option of eventOptions) {
          const persistedContext = mergeMatchupPreviewContext(
            getDadosTecnicos(option)?.trim() ?? "",
            previewContext,
          );
          await updateProg.mutateAsync({ id: option.id, dados_tecnicos: persistedContext });
          const postPreviewGate = evaluateMlbOperationalGate({
            ...option,
            dados_tecnicos: persistedContext,
          });
          previewRequiresReview ||=
            postPreviewGate.applicable &&
            postPreviewGate.previewContextStatus === "REVIEW_REQUIRED";
          await refreshRanking.mutateAsync({
            ...option,
            dados_tecnicos: persistedContext,
          });
        }
        setContextos((prev) => {
          const next = { ...prev };
          for (const g of grupos) {
            if (g.eventKey !== eventKey) continue;
            const base = prev[g.key] ?? getContextoInicialGrupo(g);
            next[g.key] = mergeMatchupPreviewContext(base, previewContext);
          }
          return next;
        });
      }
      if (previewRequiresReview) {
        toast.warning(
          "Preview aplicado e shortlist requalificada: o contexto MLB exige revisao antes da decisao.",
        );
      } else {
        toast.success("Matchups/Preview aplicado e shortlist requalificada.");
      }
      return true;
    } catch (e) {
      toast.error((e as Error).message || "Erro ao aplicar Matchups/Preview.");
      return false;
    }
  };

  const getContextoGrupo = (g: ValidationGroup): string =>
    contextos[g.key] ?? getContextoInicialGrupo(g);

  const setContextoGrupo = (g: ValidationGroup, value: string) => {
    setContextos((prev) => ({ ...prev, [g.key]: value }));
  };

  const getOddAjustadaNum = (p: Prognostico): number | null => {
    const raw = oddsAj[p.id];
    if (raw !== undefined && raw !== "") return Number(raw);
    if (isPackballMatrixPrognostico(p)) return p.odd_ajustada ?? null;
    return p.odd_ajustada ?? p.odd_ofertada;
  };

  const getEdgeAjustado = (p: Prognostico): number | null => {
    const odd = getOddAjustadaNum(p);
    if (odd == null || !odd) return p.edge_ajustado;
    return calcEdge(p.probabilidade_final, odd);
  };

  const persistirOddAjustada = async (p: Prognostico) => {
    const raw = oddsAj[p.id];
    if (raw === undefined) return;

    const trimmed = raw.trim();
    const odd = trimmed === "" ? null : Number(trimmed);
    if (odd != null && (!Number.isFinite(odd) || odd <= 1)) {
      setOddSaveStatus((prev) => ({ ...prev, [p.id]: "error" }));
      toast.error("Informe uma odd ajustada válida, maior que 1.00.");
      return;
    }

    const edgeAjustado = odd == null ? null : calcEdge(p.probabilidade_final, odd);
    const currentOdd = p.odd_ajustada ?? null;
    const currentEdge = p.edge_ajustado ?? null;
    const sameOdd = currentOdd === odd;
    const sameEdge =
      currentEdge === edgeAjustado ||
      (currentEdge != null &&
        edgeAjustado != null &&
        Math.abs(currentEdge - edgeAjustado) < 0.0001);
    if (sameOdd && sameEdge) {
      setOddSaveStatus((prev) => ({ ...prev, [p.id]: "saved" }));
      return;
    }

    setOddSaveStatus((prev) => ({ ...prev, [p.id]: "saving" }));
    try {
      await updateProg.mutateAsync({
        id: p.id,
        odd_ajustada: odd,
        edge_ajustado: edgeAjustado,
      });
      await refreshRanking.mutateAsync({
        ...p,
        odd_ajustada: odd,
        edge_ajustado: edgeAjustado,
      });
      setOddsAj((prev) => ({ ...prev, [p.id]: odd == null ? "" : odd.toFixed(2) }));
      setOddSaveStatus((prev) => ({ ...prev, [p.id]: "saved" }));
    } catch (error) {
      setOddSaveStatus((prev) => ({ ...prev, [p.id]: "error" }));
      toast.error((error as Error).message || "Não foi possível salvar a odd ajustada.");
    }
  };

  const getSelectedOption = (g: ValidationGroup): Prognostico | null => {
    const selectedId = selectedByGroup[g.key] ?? (g.opcoes.length === 1 ? g.opcoes[0].id : "");
    return g.opcoes.find((p) => p.id === selectedId) ?? null;
  };

  const getBestPularOption = (g: ValidationGroup): Prognostico => {
    return g.opcoes.slice().sort((a, b) => {
      const rankA = preliminaryCandidateById.get(a.id);
      const rankB = preliminaryCandidateById.get(b.id);
      return (
        (rankB?.opportunity_score_pre ?? -1) - (rankA?.opportunity_score_pre ?? -1) ||
        (rankB?.confidence_score ?? -1) - (rankA?.confidence_score ?? -1) ||
        (getEdgeAjustado(b) ?? b.edge ?? 0) - (getEdgeAjustado(a) ?? a.edge ?? 0)
      );
    })[0];
  };

  const rodarIA = async (g: ValidationGroup, modo: "local" | "online") => {
    const p = g.opcoes[0];
    const packball = getPackballValidationRequirements(p);
    const executableOdd = getOddAjustadaNum(p);
    const executableEdge = getEdgeAjustado(p);
    if (packball && (!(executableOdd && executableOdd > 1) || executableEdge == null)) {
      toast.error(`Informe a odd executável do ${packball.modelName} antes de rodar a IA.`);
      return;
    }
    if (packball && executableEdge! < packball.requiredEdge) {
      toast.error(
        `A odd executavel precisa gerar edge minimo de ${packball.requiredEdge.toFixed(2)}%.`,
      );
      return;
    }
    setIaLoading((s) => ({ ...s, [g.key]: modo }));
    try {
      const contextoAnalise = getContextoGrupo(g);
      const oddAj = getOddAjustadaNum(p);
      const edgeAj = getEdgeAjustado(p);
      const calibracao = await getAiCalibrationSummary(p);
      const opcoesMesmoMercado = g.opcoes.map((option) => ({
        prognostico_id: option.id,
        mercado: getOpportunityMarketLabel(option),
        pick: getOpportunityPickLabel(option),
        origem: getOpportunitySourceLabel(option),
        odd_original: option.odd_ofertada,
        odd_ajustada: getOddAjustadaNum(option),
        odd_mediana: option.odd_mediana ?? null,
        odd_mercado_base: getOddMercadoBase(option),
        odd_melhor: option.odd_melhor ?? null,
        bookmaker_melhor: option.bookmaker_melhor ?? null,
        odd_valor: option.odd_valor,
        probabilidade: option.probabilidade_final,
        edge_original: option.edge,
        edge_ajustado: getEdgeAjustado(option),
      }));
      const prognosticosCorrelacionados = g.opcoes
        .filter((other) => other.id !== p.id)
        .map((other) => ({
          mercado: getOpportunityMarketLabel(other),
          pick: getOpportunityPickLabel(other),
          origem: getOpportunitySourceLabel(other),
          odd_original: other.odd_ofertada,
          odd_ajustada: getOddAjustadaNum(other),
          odd_mediana: other.odd_mediana ?? null,
          odd_mercado_base: getOddMercadoBase(other),
          odd_melhor: other.odd_melhor ?? null,
          bookmaker_melhor: other.bookmaker_melhor ?? null,
          probabilidade_final: other.probabilidade_final,
          edge_original: other.edge,
          edge_ajustado: getEdgeAjustado(other),
        }));
      const payloadData = {
        prognostico: {
          data: p.data,
          hora: p.hora,
          esporte: p.esporte,
          liga: p.liga,
          jogo: p.jogo,
          mercado: getOpportunityMarketLabel(p),
          pick: getOpportunityPickLabel(p),
          origem: getOpportunitySourceLabel(p),
          odd_original: p.odd_ofertada,
          odd_ajustada: oddAj,
          odd_mediana: p.odd_mediana ?? null,
          odd_mercado_base: getOddMercadoBase(p),
          odd_melhor: p.odd_melhor ?? null,
          bookmaker_melhor: p.bookmaker_melhor ?? null,
          odd_valor: p.odd_valor,
          probabilidade_final: p.probabilidade_final,
          edge_original: p.edge,
          edge_ajustado: edgeAj,
          stake_sugerida: p.stake,
        },
        opcoes_mesmo_mercado: opcoesMesmoMercado,
        prognosticos_correlacionados: prognosticosCorrelacionados,
        dados_tecnicos: contextoAnalise,
        contexto_local: contextoAnalise,
        calibracao_interna: calibracao.texto,
      };
      const payload = {
        data: {
          ...payloadData,
          ...(modo === "online" ? { contexto_online: null } : {}),
        },
      };
      const raw = (
        modo === "online" ? await callIAOnline(payload) : await callIA(payload)
      ) as ServerAiResult;
      const arbitration =
        raw.parse_status === "FAILED" && raw.model_output == null
          ? raw.error_code === "SCHEMA_INVALID"
            ? arbitrateAiSchemaFailure(raw.parse_error)
            : arbitrateAiGenerationFailure({
                errorCode: raw.error_code,
                reason: raw.parse_error,
              })
          : arbitrateAiOutput(raw.model_output, {
              mode: modo,
              options: g.opcoes.map((option) => ({
                prediction: {
                  ...option,
                  odd_ajustada: getOddAjustadaNum(option),
                  edge_ajustado: getEdgeAjustado(option),
                  dados_tecnicos: contextoAnalise,
                },
                pick: getOpportunityPickLabel(option),
              })),
            });
      const oddsAnalisadasMap: Record<string, number> = {};
      for (const option of g.opcoes) {
        const o = getOddAjustadaNum(option);
        if (o != null) oddsAnalisadasMap[option.id] = o;
      }
      const parseFailureNote =
        raw.parse_status === "FAILED" && raw.parse_error
          ? `\n\nFalha de Structured Output:\n- ${raw.parse_error}`
          : "";
      const observability = buildAiObservabilitySnapshot({
        telemetry: raw,
        arbitration,
        sourceTraces: raw.fontes_consultadas ?? [],
        searches: raw.buscas_realizadas ?? [],
      });
      const r: IAResult = {
        parecer: `${formatArbitratedAiValidation(arbitration)}${parseFailureNote}`,
        decisao_sugerida: arbitration.output.decision,
        stake_sugerida: arbitration.output.stake,
        prognostico_id_escolhido: arbitration.output.selected_prediction_id,
        pick_escolhida: arbitration.output.selected_pick,
        prompt_versao: raw.prompt_versao,
        fontes_consultadas: raw.fontes_consultadas,
        buscas_realizadas: raw.buscas_realizadas,
        modo,
        odd_analisada: oddAj,
        odd_analisada_por_opcao: oddsAnalisadasMap,
        blocking_codes: observability.blocking_codes,
        model_output: arbitration.output,
        parse_status: raw.parse_status,
        parse_error: raw.parse_error,
        provider: raw.provider,
        model: raw.model,
        latency_ms: raw.latency_ms,
        run_id: raw.run_id,
        started_at: raw.started_at,
        finished_at: raw.finished_at,
        finish_reason: raw.finish_reason,
        usage: raw.usage,
        error_code: raw.error_code,
        repair_attempted: raw.repair_attempted,
        observability,
      };
      const chosenByIa = r.decisao_sugerida === "CONFIRMA" ? findAiChosenOption(g, r) : null;
      const rWithAviso: IAResult = {
        ...r,
        aviso_opcao:
          arbitration.blocks.length > 0
            ? raw.parse_status === "FAILED" &&
              raw.model_output == null &&
              raw.error_code !== "SCHEMA_INVALID"
              ? `Geração da IA falhou: ${raw.error_code || "PROVIDER_ERROR"}. Sem saída para arbitrar; decisão segura PULAR.`
              : `Árbitro determinístico bloqueou a sugestão: ${arbitration.blocks
                  .map((block) => block.code)
                  .join(", ")}.`
            : null,
      };
      if (chosenByIa) {
        setSelectedByGroup((prev) => ({ ...prev, [g.key]: chosenByIa.id }));
      } else if (r.decisao_sugerida === "PULAR" && g.opcoes.length > 1) {
        setSelectedByGroup((prev) => {
          const next = { ...prev };
          delete next[g.key];
          return next;
        });
      }
      setPareceres((s) => ({ ...s, [g.key]: getIaResumo(rWithAviso) }));
      if (chosenByIa && r.stake_sugerida && STAKES.includes(r.stake_sugerida.toFixed(1))) {
        setStakes((s) => ({ ...s, [chosenByIa.id]: r.stake_sugerida!.toFixed(1) }));
      }
      const snapshotOption =
        chosenByIa ?? (r.decisao_sugerida === "PULAR" ? getBestPularOption(g) : p);
      const snapshotOdd = getOddAjustadaNum(snapshotOption);
      const snapshotEdge = getEdgeAjustado(snapshotOption);
      await saveAnaliseIaSnapshot({
        prognostico_id: snapshotOption.id,
        modo_ia: modo,
        esporte: snapshotOption.esporte,
        liga: snapshotOption.liga,
        mercado: getOpportunityMarketLabel(snapshotOption),
        pick: getOpportunityPickLabel(snapshotOption),
        linha: null,
        jogo: snapshotOption.jogo,
        data_evento: snapshotOption.data,
        hora_evento: snapshotOption.hora,
        odd_usada: snapshotOdd ?? snapshotOption.odd_ofertada,
        probabilidade_final: snapshotOption.probabilidade_final,
        edge_usado: snapshotEdge ?? snapshotOption.edge,
        contexto_analisado: `[CONTEXTO ATUAL]\n${contextoAnalise || "Sem contexto adicional."}\n\n[MEMORIA OPERACIONAL]\n${calibracao.texto}`,
        parecer_ia: rWithAviso.parecer,
        decisao_sugerida: rWithAviso.decisao_sugerida,
        stake_sugerida: rWithAviso.stake_sugerida,
        riscos_identificados: rWithAviso.parecer,
        fontes_consultadas: rWithAviso.fontes_consultadas ?? null,
        buscas_realizadas: rWithAviso.buscas_realizadas ?? null,
        prompt_versao: rWithAviso.prompt_versao,
        ...rWithAviso.observability,
      });
      setIaResults((s) => ({ ...s, [g.key]: rWithAviso }));
      toast.success(modo === "online" ? "Análise online concluída" : "Análise local gerada");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setIaLoading((s) => ({ ...s, [g.key]: null }));
    }
  };

  const aplicarIA = (g: ValidationGroup) => {
    const r = iaResults[g.key];
    if (!r) return;
    const chosenByIa = r.decisao_sugerida === "CONFIRMA" ? findAiChosenOption(g, r) : null;
    const selected = chosenByIa ?? getSelectedOption(g);
    if (chosenByIa) {
      setSelectedByGroup((prev) => ({ ...prev, [g.key]: chosenByIa.id }));
    }
    setPareceres((s) => ({ ...s, [g.key]: getIaResumo(r) }));
    if (selected && r.stake_sugerida && STAKES.includes(r.stake_sugerida.toFixed(1))) {
      setStakes((s) => ({ ...s, [selected.id]: r.stake_sugerida!.toFixed(1) }));
    }
    toast.success("Parecer da IA aplicado ao prognóstico");
  };

  const registrarValidacaoGrupo = async (
    p: Prognostico,
    decisao: Status,
    parecer: string,
    contextoAnalise: string,
    ia: IAResult | undefined,
    stakeNum: number,
  ) => {
    const oddAj = getOddAjustadaNum(p);
    const edgeAj = getEdgeAjustado(p);
    const patch: Partial<Prognostico> & { id: string } = { id: p.id };

    if (decisao === "CONFIRMA") {
      if (oddAj != null && oddAj !== p.odd_ajustada) patch.odd_ajustada = oddAj;
      if (edgeAj != null && edgeAj !== p.edge_ajustado) patch.edge_ajustado = edgeAj;
    }
    if (contextoAnalise) patch.dados_tecnicos = contextoAnalise;
    if (Object.keys(patch).length > 1) await updateProg.mutateAsync(patch);

    await createVal.mutateAsync({
      prognostico_id: p.id,
      decisao,
      stake_confirmada: decisao === "CONFIRMA" ? stakeNum : 1,
      parecer_validacao: parecer,
      contexto_adicional: contextoAnalise || null,
      parecer_ia: ia?.parecer ?? null,
      decisao_ia_sugerida: ia?.decisao_sugerida ?? null,
      stake_ia_sugerida: ia?.stake_sugerida ?? null,
      data_analise_ia: ia ? new Date().toISOString() : null,
      prompt_versao: ia?.prompt_versao ?? null,
      modo_ia: ia?.modo ?? null,
      fontes_consultadas: ia?.fontes_consultadas ?? null,
      buscas_realizadas: ia?.buscas_realizadas ?? null,
    });

    try {
      await applyRankingValidation.mutateAsync({
        prognosticoId: p.id,
        decisao,
        aiDecision: ia?.decisao_sugerida ?? null,
        aiStakeSuggested: ia?.stake_sugerida ?? null,
        finalStake: decisao === "CONFIRMA" ? stakeNum : 1,
        parecer,
      });
    } catch (e) {
      console.warn("[Opportunity Ranking] Validacao salva, mas ranking nao atualizado:", e);
      toast.warning("Validação salva, mas o ranking final não foi atualizado automaticamente.");
    }
  };

  const decidirGrupo = async (g: ValidationGroup, decisao: Status) => {
    const selected = getSelectedOption(g);
    const parecer = (pareceres[g.key] ?? "").trim();
    if (decisao === "CONFIRMA" && !parecer) {
      toast.error("Resumo da decisão é obrigatório.");
      return;
    }
    if (decisao === "CONFIRMA" && !selected) {
      toast.error("Selecione uma opção para confirmar este grupo.");
      return;
    }
    if (decisao === "CONFIRMA" && selected) {
      const mlbGate = evaluateMlbOperationalGate({
        ...selected,
        odd_ajustada: getOddAjustadaNum(selected),
        edge_ajustado: getEdgeAjustado(selected),
        dados_tecnicos: getContextoGrupo(g),
      });
      if (mlbGate.applicable && !mlbGate.approved) {
        toast.error(mlbGate.reasons.join(" "));
        return;
      }
      const matchMatrixGate = evaluateMatchMatrixOperationalGate({
        ...selected,
        odd_ajustada: getOddAjustadaNum(selected),
        edge_ajustado: getEdgeAjustado(selected),
        dados_tecnicos: getContextoGrupo(g),
      });
      if (matchMatrixGate.applicable && !matchMatrixGate.approved) {
        toast.error(matchMatrixGate.reasons.join(" "));
        return;
      }
      const packball = getPackballValidationRequirements(selected);
      if (packball) {
        const explicitOdd = getOddAjustadaNum(selected);
        const adjustedEdge = getEdgeAjustado(selected);
        if (!(explicitOdd && explicitOdd > 1)) {
          toast.error(`Informe a odd executável do ${packball.modelName} antes de confirmar.`);
          return;
        }
        if (adjustedEdge == null || adjustedEdge < packball.requiredEdge) {
          toast.error(
            `Odd insuficiente: o ${packball.modelName} exige edge mínimo de ${packball.requiredEdge.toFixed(2)}% ` +
              `(odd mínima ${packball.minimumExecutableOdd.toFixed(2)}).`,
          );
          return;
        }
        const kelly = calculatePackballKelly(selected.probabilidade_final, explicitOdd, packball);
        if (kelly < 0.25) {
          toast.error("A odd executável não produz Kelly conservador mínimo de 0,25u.");
          return;
        }
      }
      const ia = iaResults[g.key];
      if (ia) {
        const oddAtual = getOddAjustadaNum(selected);
        const oddIa =
          ia.odd_analisada_por_opcao?.[selected.id] ??
          (selected.id === (ia.prognostico_id_escolhido ?? "") ? ia.odd_analisada : null) ??
          ia.odd_analisada ??
          null;
        if (oddAtual != null && oddIa != null && Math.abs(oddAtual - oddIa) > 0.001) {
          toast.error(
            `A odd ajustada (${oddAtual.toFixed(2)}) mudou desde a última análise da IA (${oddIa.toFixed(2)}). Rode a IA novamente antes de confirmar.`,
          );
          return;
        }
      }
    }

    try {
      const contextoAnalise = getContextoGrupo(g).trim();
      const ia = iaResults[g.key];
      const retained = decisao === "CONFIRMA" ? selected! : getBestPularOption(g);
      const retainedPackball = getPackballValidationRequirements(retained);
      const retainedOdd = getOddAjustadaNum(retained);
      const retainedStake =
        decisao === "CONFIRMA"
          ? retainedPackball && retainedOdd
            ? calculatePackballKelly(retained.probabilidade_final, retainedOdd, retainedPackball)
            : Number(stakes[retained.id] ?? retained.stake ?? 0)
          : 1;
      const parecerBase = parecer || "Grupo recusado na validação crítica agrupada.";
      const previewContext = extractMatchupPreviewContext(contextoAnalise);
      if (previewContext) {
        const groupIds = new Set(g.opcoes.map((option) => option.id));
        const relatedEventOptions = pendentes.filter(
          (option) => !groupIds.has(option.id) && getEventKey(option) === g.eventKey,
        );
        for (const option of relatedEventOptions) {
          await updateProg.mutateAsync({
            id: option.id,
            dados_tecnicos: mergeMatchupPreviewContext(
              getDadosTecnicos(option)?.trim() ?? "",
              previewContext,
            ),
          });
        }
      }
      await registrarValidacaoGrupo(
        retained,
        decisao === "CONFIRMA" ? "CONFIRMA" : "PULAR",
        parecerBase,
        contextoAnalise,
        ia,
        retainedStake,
      );
      for (const option of g.opcoes.filter((option) => option.id !== retained.id)) {
        await deleteProg.mutateAsync(option.id);
      }
      toast.success(
        decisao === "CONFIRMA"
          ? "Grupo validado: opção confirmada e opções concorrentes removidas"
          : "Grupo pulado: melhor registro mantido e opções concorrentes removidas",
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="page-stack relative isolate">
      <AmbientBackdrop />
      <PageIntro
        title="Validação Crítica"
        description="Segunda camada analítica: somente entradas aprovadas seguem para publicação."
        status={`${validationSummary.pending} grupo(s) aguardando decisão`}
        icon={ShieldCheck}
        iconTone="ai"
      />

      {/* Filtros */}
      <div className="filter-surface">
        <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <PeriodFilter
            periodo={periodo}
            onPeriodoChange={setPeriodo}
            customIni={customIni}
            customFim={customFim}
            onCustomIniChange={setCustomIni}
            onCustomFimChange={setCustomFim}
          />
          <div className="min-w-0">
            <Label className="block text-[10px] uppercase tracking-wider text-muted-foreground">
              Esporte
            </Label>
            <SportFilterSelect
              value={fEsporte}
              onValueChange={(v) => {
                setFEsporte(v);
                setFLiga("all");
              }}
              options={esportes}
              className="h-10 w-full"
            />
          </div>
          <div className="min-w-0">
            <Label className="block text-[10px] uppercase tracking-wider text-muted-foreground">
              Liga
            </Label>
            <LeagueFilter
              sport={fEsporte}
              value={fLiga}
              onChange={setFLiga}
              className="h-10 w-full"
            />
          </div>
          <div className="min-w-0">
            <Label className="block text-[10px] uppercase tracking-wider text-muted-foreground">
              Mercado / modelo
            </Label>
            <Select value={fMercado} onValueChange={setFMercado}>
              <SelectTrigger className="h-10 w-full">
                <SelectValue placeholder="Mercado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os mercados e modelos</SelectItem>
                {mercados.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          label="Fila pendente"
          value={String(validationSummary.pending)}
          icon={ClipboardList}
          accent="blue"
          meta="Grupos aguardando triagem"
          layout="horizontal"
        />
        <StatCard
          label="Analisadas pela IA"
          value={String(validationSummary.analyzed)}
          icon={BrainCircuit}
          accent="violet"
          meta="Nesta sessão operacional"
          layout="horizontal"
        />
        <StatCard
          label="Confirmadas"
          value={String(validationSummary.confirmed)}
          icon={CircleCheckBig}
          tone="up"
          accent="green"
          meta="No recorte selecionado"
          layout="horizontal"
        />
        <StatCard
          label="Risco estrutural"
          value={String(validationSummary.structuralRisk)}
          icon={ShieldAlert}
          tone={validationSummary.structuralRisk > 0 ? "down" : "neutral"}
          accent={validationSummary.structuralRisk > 0 ? "red" : "amber"}
          meta="Alertas ou bloqueios prévios"
          layout="horizontal"
        />
      </div>

      <PreAiShortlistPanel
        candidates={preAiCandidates}
        latest={selectedShortlist}
        history={shortlistHistory.data ?? []}
        selectedRunId={selectedShortlist?.run.id ?? ""}
        loadingLatest={shortlistHistory.isLoading}
        generating={generatePreAiShortlist.isPending}
        enrichingPreview={enrichPreview.isPending}
        onSelectRun={setSelectedShortlistRunId}
        onGenerate={gerarShortlistPreIa}
        onEnrichPreview={aplicarMatchupPreview}
      />

      <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-3">
        <div>
          <p className="panel-kicker">Fila operacional</p>
          <h2 className="section-title mt-1">Candidatas para validação crítica</h2>
        </div>
        <span className="rounded border border-primary/20 bg-primary/5 px-2.5 py-1 font-mono text-xs text-primary">
          {grupos.length}
        </span>
      </div>

      {grupos.length === 0 && (
        <div className="surface-panel relative overflow-hidden p-8 text-center text-sm text-muted-foreground">
          <div
            aria-hidden="true"
            className="absolute inset-x-[20%] top-0 h-px bg-[linear-gradient(90deg,transparent,var(--color-primary),transparent)]"
          />
          <ShieldCheck aria-hidden="true" className="mx-auto mb-3 size-7 text-success/70" />
          Não há prognósticos pendentes de validação.
        </div>
      )}

      <div className="flex flex-col gap-4">
        {grupos.map((g) => {
          const selectedOptionId =
            selectedByGroup[g.key] ?? (g.opcoes.length === 1 ? g.opcoes[0].id : "");
          const p = getSelectedOption(g) ?? g.opcoes[0];
          const oddAj = getOddAjustadaNum(p);
          const edgeAj = getEdgeAjustado(p);
          const packballRequirements = getPackballValidationRequirements({
            ...p,
            odd_ajustada: oddAj,
          });
          const packballKelly =
            packballRequirements && oddAj
              ? calculatePackballKelly(p.probabilidade_final, oddAj, packballRequirements)
              : 0;
          const check = autoCheck(p, edgeAj, oddAj);
          const marketLabel = getOpportunityMarketLabel(p);
          const pickLabel = getOpportunityPickLabel(p);
          const sourceLabel = getOpportunitySourceLabel(p);
          const contextoAnalise = getContextoGrupo(g);
          const mlbPreviewGate = evaluateMlbOperationalGate({
            ...p,
            odd_ajustada: oddAj,
            edge_ajustado: edgeAj,
            dados_tecnicos: contextoAnalise,
          });
          const parecerCurrent = pareceres[g.key] ?? "";
          const ia = iaResults[g.key];
          const rankedCandidate = preliminaryCandidateById.get(p.id);

          return (
            <div
              key={g.key}
              className={cn(
                "group relative flex flex-col gap-3 overflow-hidden rounded-xl border bg-[linear-gradient(145deg,color-mix(in_oklab,var(--color-primary)_4%,var(--color-card)),var(--color-card)_72%)] p-3 shadow-[0_18px_44px_rgb(0_0_0/0.16)] transition-[border-color,box-shadow] sm:p-4 xl:gap-2.5",
                check?.auto === "PULAR" && "border-destructive/40",
                check?.auto === "DESTAQUE" && "border-success/40",
                check?.auto === "ALERTA" && "border-warning/40",
                !check && "border-border",
              )}
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -right-16 -top-20 size-48 rounded-full bg-primary/[0.035] blur-3xl"
              />
              {/* Cabeçalho */}
              <div className="relative flex flex-wrap items-start justify-between gap-3 xl:flex-nowrap">
                <div className="flex min-w-0 items-start gap-3">
                  <SportMark sport={p.esporte} size="md" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono text-muted-foreground">{formatBR(p.data)}</span>
                      {p.hora && (
                        <span className="font-mono text-muted-foreground">
                          às {formatHora(p.hora)}
                        </span>
                      )}
                      <span className="font-semibold uppercase tracking-wider text-primary">
                        {p.esporte}
                      </span>
                      <span className="text-muted-foreground">{p.liga}</span>
                    </div>
                    <h3 className="mt-1 text-lg font-semibold tracking-[-0.02em]">{p.jogo}</h3>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Grupo: <span className="font-semibold text-foreground">{g.mercado}</span> ·{" "}
                      {formatOptionCount(g.opcoes.length)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={p.status_validacao} />
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Excluir prognóstico"
                    onClick={() => setConfirmDelete(p)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>

              <div className="relative grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border/80 bg-border/70 sm:grid-cols-3 xl:grid-cols-6">
                <Metric
                  label={packballRequirements ? "Odd referência" : "Odd ofertada"}
                  value={p.odd_ofertada.toFixed(2)}
                />
                <Metric label="Odd ajustada" value={oddAj != null ? oddAj.toFixed(2) : "-"} />
                <Metric label="Odd justa" value={p.odd_valor.toFixed(2)} tone="warn" />
                <Metric label="Probabilidade" value={`${p.probabilidade_final.toFixed(1)}%`} />
                <Metric
                  label="Edge"
                  value={edgeAj != null ? `${edgeAj.toFixed(1)}%` : "-"}
                  tone={edgeAj != null && edgeAj > 0 ? "good" : "bad"}
                />
                <Metric label="Stake pré-IA" value={`${p.stake.toFixed(1)}u`} />
              </div>

              <div className="relative grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px] xl:items-stretch">
                <ValidationGateStrip
                  hasPrice={oddAj != null}
                  hasPositiveEdge={edgeAj != null && edgeAj > 0}
                  hasContext={Boolean(contextoAnalise.trim())}
                  isOperational={check?.auto !== "PULAR"}
                  mlbPreviewStatus={
                    mlbPreviewGate.applicable ? mlbPreviewGate.previewContextStatus : undefined
                  }
                />
                {rankedCandidate ? (
                  <ValidationSignalBar
                    score={rankedCandidate.opportunity_score_pre}
                    confidence={rankedCandidate.confidence_score}
                    riskCount={rankedCandidate.risk_flags.length}
                    compact
                  />
                ) : (
                  <div className="flex items-center gap-3 rounded-lg border border-border/80 bg-card/45 p-3 text-xs text-muted-foreground">
                    <Gauge className="size-5 text-primary" />
                    Score pré-IA indisponível
                  </div>
                )}
              </div>

              <div className="relative flex flex-col gap-3 rounded-lg border border-border/80 bg-background/35 p-3 sm:p-4">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Opções disponíveis neste grupo
                </div>
                <RadioGroup
                  value={selectedOptionId}
                  onValueChange={(value) =>
                    setSelectedByGroup((prev) => ({ ...prev, [g.key]: value }))
                  }
                  className="grid gap-2"
                >
                  {g.opcoes.map((opcao) => {
                    const opcaoOdd = getOddAjustadaNum(opcao);
                    const opcaoEdge = getEdgeAjustado(opcao);
                    const opcaoCheck = autoCheck(opcao, opcaoEdge, opcaoOdd);
                    const opcaoMarketLabel = getOpportunityMarketLabel(opcao);
                    const opcaoPickLabel = getOpportunityPickLabel(opcao);
                    return (
                      <label
                        key={opcao.id}
                        className={cn(
                          "flex cursor-pointer gap-3 rounded-lg border p-3 transition-[border-color,background-color,transform] hover:-translate-y-px hover:bg-muted/40",
                          selectedOptionId === opcao.id
                            ? "border-primary bg-primary/5"
                            : "border-border bg-background/40",
                        )}
                      >
                        <RadioGroupItem value={opcao.id} className="mt-1" />
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                              {opcaoMarketLabel}
                            </span>
                            <span className="font-semibold">{opcaoPickLabel}</span>
                            {opcaoCheck && (
                              <span
                                className={cn(
                                  "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                                  opcaoCheck.auto === "PULAR" &&
                                    "bg-destructive/10 text-destructive",
                                  opcaoCheck.auto === "ALERTA" && "bg-warning/10 text-warning",
                                  opcaoCheck.auto === "DESTAQUE" && "bg-success/10 text-success",
                                )}
                              >
                                {opcaoCheck.auto}
                              </span>
                            )}
                          </div>
                          <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-6">
                            <span>
                              {isPackballMatrixPrognostico(opcao)
                                ? "Odd referencia:"
                                : "Odd ofertada:"}{" "}
                              <strong className="font-mono">{opcao.odd_ofertada.toFixed(2)}</strong>
                            </span>
                            <span>
                              Odd aj.:{" "}
                              <strong className="font-mono">
                                {opcaoOdd != null ? opcaoOdd.toFixed(2) : "-"}
                              </strong>
                            </span>
                            <span>
                              Odd mediana:{" "}
                              <strong className="font-mono">
                                {formatOptionalOdd(opcao.odd_mediana)}
                              </strong>
                            </span>
                            <span>
                              Odd valor:{" "}
                              <strong className="font-mono">{opcao.odd_valor.toFixed(2)}</strong>
                            </span>
                            <span>
                              Prob.:{" "}
                              <strong className="font-mono">
                                {opcao.probabilidade_final.toFixed(2)}%
                              </strong>
                            </span>
                            <span>
                              Edge aj.:{" "}
                              <strong className="font-mono">
                                {opcaoEdge != null ? `${opcaoEdge.toFixed(2)}%` : "-"}
                              </strong>
                            </span>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </RadioGroup>
              </div>

              <details className="group/details relative rounded-lg border border-border/80 bg-background/30">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground marker:content-none">
                  Dados detalhados e contexto local
                  <ChevronDown className="size-4 transition-transform group-open/details:rotate-180" />
                </summary>
                <div className="flex flex-col gap-3 border-t border-border/70 p-3 sm:p-4">
                  {/* Bloco de entrada */}
                  <div className="relative flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Dados do prognóstico
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {packballRequirements ? "Odd executavel:" : "Odd em uso:"}{" "}
                        <span className="font-mono font-semibold text-foreground">
                          {oddAj != null ? oddAj.toFixed(2) : "aguardando"}
                        </span>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      <KV label="Mercado" value={marketLabel} />
                      <KV label="Pick" value={pickLabel} />
                      <KV label="Origem" value={sourceLabel} />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-8">
                      <Metric
                        label={packballRequirements ? "Odd referencia PackBall" : "Odd ofertada"}
                        value={p.odd_ofertada.toFixed(2)}
                      />
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Odd ajustada
                          </Label>
                          <span
                            className={`text-[10px] ${
                              oddSaveStatus[p.id] === "error"
                                ? "text-destructive"
                                : "text-muted-foreground"
                            }`}
                          >
                            {oddSaveStatus[p.id] === "saving"
                              ? "Salvando..."
                              : oddSaveStatus[p.id] === "saved"
                                ? "Salva"
                                : oddSaveStatus[p.id] === "error"
                                  ? "Erro"
                                  : ""}
                          </span>
                        </div>
                        <Input
                          type="number"
                          step="0.01"
                          min="1.01"
                          placeholder={p.odd_ofertada.toFixed(2)}
                          value={
                            oddsAj[p.id] ??
                            (p.odd_ajustada != null
                              ? p.odd_ajustada
                              : packballRequirements
                                ? ""
                                : p.odd_ofertada)
                          }
                          onChange={(e) => {
                            const value = e.target.value;
                            setOddsAj((prev) => ({ ...prev, [p.id]: value }));
                            setOddSaveStatus((prev) => {
                              const next = { ...prev };
                              delete next[p.id];
                              return next;
                            });
                          }}
                          onBlur={() => void persistirOddAjustada(p)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              e.currentTarget.blur();
                            }
                          }}
                          className="mt-1 h-[51px] rounded-md border-border bg-background/50 font-mono text-base font-bold"
                        />
                      </div>
                      <Metric label="Odd mediana" value={formatOptionalOdd(p.odd_mediana)} />
                      <Metric
                        label="Odd mercado base"
                        value={formatOptionalOdd(getOddMercadoBase(p))}
                      />

                      <Metric label="Odd valor" value={p.odd_valor.toFixed(2)} />
                      <Metric
                        label="Probabilidade"
                        value={`${p.probabilidade_final.toFixed(2)}%`}
                        tone={
                          p.probabilidade_final > 60
                            ? "good"
                            : p.probabilidade_final < 55
                              ? "warn"
                              : undefined
                        }
                      />
                      <Metric
                        label="Edge original"
                        value={`${p.edge.toFixed(2)}%`}
                        tone={p.edge < 0 ? "bad" : "good"}
                      />
                      <Metric
                        label="Edge ajustado"
                        value={edgeAj != null ? `${edgeAj.toFixed(2)}%` : "-"}
                        tone={edgeAj == null ? undefined : edgeAj < 0 ? "bad" : "good"}
                      />
                    </div>

                    {packballRequirements && (
                      <div className="grid gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 sm:grid-cols-2 xl:grid-cols-6">
                        <Metric
                          label="Odd minima para publicar"
                          value={packballRequirements.minimumExecutableOdd.toFixed(2)}
                        />
                        <Metric
                          label="Edge minimo"
                          value={`${packballRequirements.requiredEdge.toFixed(2)}%`}
                        />
                        <Metric
                          label="Status do preco"
                          value={packballRequirements.operationalPriceStatus.replaceAll("_", " ")}
                        />
                        <Metric label="Kelly conservador" value={`${packballKelly.toFixed(2)}u`} />
                        <Metric
                          label="Teto por incerteza"
                          value={`${packballRequirements.maxStake.toFixed(2)}u`}
                        />
                        <Metric
                          label="Conflito dos componentes"
                          value={packballRequirements.componentConflictStatus.replaceAll("_", " ")}
                        />
                      </div>
                    )}

                    {check && (
                      <div
                        className={cn(
                          "flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium",
                          check.auto === "PULAR" &&
                            "border-destructive/40 bg-destructive/10 text-destructive",
                          check.auto === "ALERTA" && "border-warning/40 bg-warning/10 text-warning",
                          check.auto === "DESTAQUE" &&
                            "border-success/40 bg-success/10 text-success",
                        )}
                      >
                        {check.auto === "DESTAQUE" ? (
                          <Sparkles className="h-3.5 w-3.5" />
                        ) : check.auto === "ALERTA" ? (
                          <ShieldAlert className="h-3.5 w-3.5" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5" />
                        )}
                        <span className="uppercase tracking-wider">{check.auto}</span>
                        <span className="text-foreground/80 normal-case tracking-normal">
                          - {check.reason}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Contexto da analise */}
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      Dados Técnicos / Contexto Local
                    </Label>
                    <Textarea
                      rows={6}
                      placeholder="Cole dados internos do prognóstico: H2H, últimos jogos, projeções, odds, picks, splits, dados técnicos do modelo ou observações manuais. IA Local usará somente este contexto e os dados internos."
                      value={contextoAnalise}
                      onChange={(e) => setContextoGrupo(g, e.target.value)}
                    />
                  </div>
                </div>
              </details>

              {/* IA */}
              <AiAnalysisPanel
                result={ia}
                loadingMode={iaLoading[g.key] ?? undefined}
                onRun={(mode) => rodarIA(g, mode)}
                onApply={() => aplicarIA(g)}
                onCopy={async (text) => {
                  await navigator.clipboard.writeText(text);
                  toast.success("Copiado para a área de transferência");
                }}
                onDismiss={() =>
                  setIaResults((current) => {
                    const next = { ...current };
                    delete next[g.key];
                    return next;
                  })
                }
              />

              {/* Resumo + decisão */}
              <section
                aria-label="Decisão final determinística"
                className="grid gap-3 rounded-lg border border-success/20 bg-success/[0.035] p-3 md:grid-cols-3"
              >
                <div className="md:col-span-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      Resumo da decisão *
                    </Label>
                    {!parecerCurrent && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setPareceres((s) => ({ ...s, [g.key]: PARECER_TEMPLATE }))}
                      >
                        <RefreshCw className="h-3 w-3 mr-1" /> usar resumo
                      </Button>
                    )}
                  </div>
                  <Textarea
                    rows={3}
                    placeholder="Ex.: CONFIRMAR - Over 7.5 - 0.5u"
                    value={parecerCurrent}
                    onChange={(e) => setPareceres({ ...pareceres, [g.key]: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      Stake confirmada (u)
                    </Label>
                    {packballRequirements ? (
                      <Input
                        value={`${packballKelly.toFixed(2)}u`}
                        readOnly
                        className="font-mono font-semibold"
                      />
                    ) : (
                      <Select
                        value={stakes[p.id] ?? p.stake.toFixed(1)}
                        onValueChange={(v) => setStakes({ ...stakes, [p.id]: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STAKES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}u
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {decisoes.map((d) => (
                      <Button
                        key={d.label}
                        onClick={() => decidirGrupo(g, d.label)}
                        className={cn("font-semibold w-full", d.color)}
                        disabled={createVal.isPending}
                        size="sm"
                      >
                        {d.texto}
                      </Button>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          );
        })}
      </div>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir prognóstico?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.jogo} - {confirmDelete?.pick}. Esta ação não pode ser desfeita e
              removerá o prognóstico também da aba de Prognósticos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!confirmDelete) return;
                try {
                  await deleteProg.mutateAsync(confirmDelete.id);
                  toast.success("Prognóstico excluído com sucesso");
                } catch (e) {
                  toast.error((e as Error).message);
                }
                setConfirmDelete(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PreAiShortlistPanel({
  candidates,
  latest,
  history,
  selectedRunId,
  loadingLatest,
  generating,
  enrichingPreview,
  onSelectRun,
  onGenerate,
  onEnrichPreview,
}: {
  candidates: RankedOpportunityCandidate[];
  latest: PersistedOpportunityRankingRun | null;
  history: PersistedOpportunityRankingRun[];
  selectedRunId: string;
  loadingLatest: boolean;
  generating: boolean;
  enrichingPreview: boolean;
  onSelectRun: (runId: string) => void;
  onGenerate: () => void;
  onEnrichPreview: (itemId: string, rawPreviewText: string) => Promise<boolean>;
}) {
  const top = candidates.slice(0, 5);
  const savedItems = latest?.items ?? [];
  const [selectedPreviewItemId, setSelectedPreviewItemId] = useState("");
  const [previewText, setPreviewText] = useState("");
  const selectedPreviewItem =
    savedItems.find((item) => item.id === selectedPreviewItemId) ?? savedItems[0] ?? null;
  const selectedPreviewItemIdEffective = selectedPreviewItem?.id ?? "";
  const loadedPreviewCount = savedItems.filter(
    (item) => item.matchup_preview_status === "loaded",
  ).length;
  const previewApplicable = latest?.run.league_scope?.trim().toUpperCase() !== "WNBA";
  const decisionCounts = {
    confirmed: savedItems.filter((item) =>
      ["CONFIRMA_IA", "TOP_FINAL", "RESERVA"].includes(item.ranking_status),
    ).length,
    skipped: savedItems.filter((item) => item.ranking_status === "PULAR").length,
    pending: savedItems.filter((item) => item.ranking_status === "CANDIDATA").length,
    blocked: savedItems.filter((item) => item.ranking_status === "BLOQUEADA").length,
  };
  const finalItems = savedItems
    .filter((item) => ["TOP_FINAL", "RESERVA", "CONFIRMA_IA"].includes(item.ranking_status))
    .slice()
    .sort(
      (a, b) =>
        (a.rank_final ?? 99) - (b.rank_final ?? 99) ||
        Number(b.opportunity_score_final ?? 0) - Number(a.opportunity_score_final ?? 0),
    );
  const latestDate = latest?.run.created_at
    ? new Date(latest.run.created_at).toLocaleString("pt-BR")
    : null;

  return (
    <section className="relative flex flex-col gap-2 overflow-hidden rounded-xl border border-ai/35 bg-[linear-gradient(145deg,color-mix(in_oklab,var(--color-ai)_6%,var(--color-card)),var(--color-card)_72%)] p-3 shadow-[0_16px_40px_rgb(0_0_0/0.14)] xl:grid xl:grid-cols-[220px_minmax(0,1fr)_minmax(320px,0.85fr)] xl:items-center">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-16 -top-20 size-44 rounded-full bg-ai/[0.06] blur-3xl"
      />
      <div className="relative grid gap-3 xl:contents">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex size-10 items-center justify-center rounded-lg border border-ai/35 bg-ai/10 text-ai shadow-[0_0_22px_currentColor]">
              <Trophy className="size-5" />
            </span>
            Shortlist Pré-IA
          </div>
          <p className="mt-1 max-w-sm text-[11px] leading-relaxed text-muted-foreground">
            Triagem operacional. O ranking não confirma entrada, publicação ou bankroll.
          </p>
          <Button
            size="sm"
            onClick={onGenerate}
            disabled={generating}
            className="mt-2 w-full shadow-[0_0_22px_rgb(59_130_246/0.14)] sm:w-auto"
          >
            {generating ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            Gerar shortlist
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Metric label="Candidatas" value={String(candidates.length)} />
          <Metric label="Limite pré-IA" value={String(DEFAULT_PRE_AI_SHORTLIST_LIMIT)} />
          <Metric label="Último run" value={loadingLatest ? "..." : (latestDate ?? "-")} />
          <Metric
            label="Preview"
            value={
              loadingLatest
                ? "..."
                : previewApplicable
                  ? `${String(latest?.items.length ?? 0)} / ${loadedPreviewCount}`
                  : "Não aplicável"
            }
          />
        </div>
      </div>

      {history.length > 0 && (
        <div className="relative grid min-w-0 items-end gap-2 rounded-lg border border-border/80 bg-background/35 p-2">
          <div className="min-w-0">
            <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Histórico salvo por período e modalidade
            </Label>
            <Select value={selectedRunId} onValueChange={onSelectRun}>
              <SelectTrigger className="mt-1 h-9">
                <SelectValue placeholder="Selecione uma shortlist salva" />
              </SelectTrigger>
              <SelectContent>
                {history.map((entry) => (
                  <SelectItem key={entry.run.id} value={entry.run.id}>
                    {formatShortlistRunLabel(entry)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {latest && (
            <div className="text-[10px] text-muted-foreground">
              <div className="truncate">{formatShortlistScope(latest.run)}</div>
              <div className="mt-0.5 font-mono">
                {latest.run.top_final_count} top final de {latest.run.candidate_count} candidata(s)
              </div>
              <div className="mt-0.5 truncate font-mono">
                {decisionCounts.confirmed} confirmada(s) · {decisionCounts.skipped} pulada(s) ·{" "}
                {decisionCounts.pending} pendente(s) · {decisionCounts.blocked} bloqueada(s)
              </div>
            </div>
          )}
        </div>
      )}

      <details className="group/shortlist rounded-lg border border-border/80 bg-background/25 xl:col-span-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground marker:content-none">
          Preview, finais e ranking detalhado
          <span className="flex items-center gap-2 font-mono text-[10px] normal-case">
            {savedItems.length} salvos · {top.length} candidatas
            <ChevronDown className="size-4 transition-transform group-open/shortlist:rotate-180" />
          </span>
        </summary>
        <div className="flex flex-col gap-3 border-t border-border/70 p-3">
          {savedItems.length > 0 && previewApplicable && (
            <div className="relative flex flex-col gap-3 rounded-lg border border-border/80 bg-background/35 p-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[260px] flex-1">
                  <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Oportunidade salva para Matchups/Preview
                  </Label>
                  <Select
                    value={selectedPreviewItemIdEffective}
                    onValueChange={setSelectedPreviewItemId}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Selecione uma oportunidade" />
                    </SelectTrigger>
                    <SelectContent>
                      {savedItems.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {formatRankingItemLabel(item)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!selectedPreviewItemIdEffective || enrichingPreview}
                  onClick={async () => {
                    if (!previewText.trim()) {
                      toast.error("Cole o Matchups/Preview antes de aplicar.");
                      return;
                    }
                    const applied = await onEnrichPreview(
                      selectedPreviewItemIdEffective,
                      previewText,
                    );
                    if (applied) setPreviewText("");
                  }}
                >
                  {enrichingPreview ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                  Aplicar preview
                </Button>
              </div>
              <Textarea
                rows={5}
                placeholder="Cole aqui o Matchups/Preview do confronto selecionado. Para MLB, pode ser o texto do Baseball-Reference; para outros esportes, use preview/H2H/noticias/splits relevantes."
                value={previewText}
                onChange={(event) => setPreviewText(event.target.value)}
              />
              {selectedPreviewItem && (
                <div className="space-y-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <div>
                    Status do preview:{" "}
                    <span className="font-semibold text-foreground">
                      {formatPreviewStatus(selectedPreviewItem.matchup_preview_status)}
                    </span>
                  </div>
                  {formatSavedAlternativesSummary(selectedPreviewItem) && (
                    <div className="normal-case tracking-normal">
                      {formatSavedAlternativesSummary(selectedPreviewItem)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {savedItems.length > 0 && !previewApplicable && (
            <div className="rounded-lg border border-border/80 bg-background/35 p-3 text-xs text-muted-foreground">
              Preview não aplicável à WNBA. A shortlist e a validação usam diretamente os dados
              técnicos produzidos pelo ASP Court W, sem penalidade de score ou bloqueio operacional.
            </div>
          )}

          {finalItems.length > 0 && (
            <div className="overflow-auto rounded-md border border-border">
              <table className="w-full min-w-[760px] text-xs">
                <thead className="bg-primary/10 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Final</th>
                    <th className="px-3 py-2 text-left font-semibold">Jogo</th>
                    <th className="px-3 py-2 text-left font-semibold">Status</th>
                    <th className="px-3 py-2 text-right font-semibold">Score final</th>
                    <th className="px-3 py-2 text-right font-semibold">Stake</th>
                  </tr>
                </thead>
                <tbody>
                  {finalItems.map((item) => {
                    const metadata = asRankingItemMetadata(item);
                    return (
                      <tr key={item.id} className="border-t border-border">
                        <td className="px-3 py-2 font-mono">
                          {item.ranking_status === "TOP_FINAL" ? `#${item.rank_final}` : "-"}
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium">
                            {String(metadata.jogo ?? item.event_key)}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {[
                              metadata.mercado_operacional ?? metadata.mercado,
                              metadata.pick_operacional ?? metadata.pick,
                            ]
                              .filter(Boolean)
                              .join(" | ")}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                              item.ranking_status === "TOP_FINAL" && "bg-success/10 text-success",
                              item.ranking_status === "RESERVA" && "bg-muted text-muted-foreground",
                              item.ranking_status === "CONFIRMA_IA" && "bg-primary/10 text-primary",
                            )}
                          >
                            {item.ranking_status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatOptionalNumber(item.opportunity_score_final)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {item.final_stake != null
                            ? `${Number(item.final_stake).toFixed(1)}u`
                            : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {top.length > 0 ? (
            <div className="overflow-auto rounded-md border border-border">
              <table className="w-full min-w-[760px] text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Rank</th>
                    <th className="px-3 py-2 text-left font-semibold">Jogo</th>
                    <th className="px-3 py-2 text-left font-semibold">Mercado</th>
                    <th className="px-3 py-2 text-left font-semibold">Pick</th>
                    <th className="px-3 py-2 text-left font-semibold">Alternativas</th>
                    <th className="px-3 py-2 text-right font-semibold">Score</th>
                    <th className="px-3 py-2 text-right font-semibold">Qual. dados</th>
                    <th className="px-3 py-2 text-right font-semibold">Edge</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((candidate, index) => (
                    <tr key={candidate.prognostico.id} className="border-t border-border">
                      <td className="px-3 py-2 font-mono">{index + 1}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{candidate.prognostico.jogo}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {formatBR(candidate.prognostico.data)}
                          {candidate.prognostico.hora
                            ? ` às ${formatHora(candidate.prognostico.hora)}`
                            : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {getOpportunityMarketLabel(candidate.prognostico)}
                      </td>
                      <td className="px-3 py-2">
                        {getOpportunityPickLabel(candidate.prognostico)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatCandidateAlternativesSummary(candidate)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {candidate.opportunity_score_pre.toFixed(1)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {candidate.confidence_score.toFixed(1)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {getEdgeEfetivo(candidate.prognostico).toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              Nenhuma candidata elegível com os filtros atuais.
            </div>
          )}
        </div>
      </details>
    </section>
  );
}

function formatShortlistRunLabel(entry: PersistedOpportunityRankingRun): string {
  const { run } = entry;
  const period = formatShortlistPeriod(run);
  const sport = run.sport_scope === "all" ? "Todos os esportes" : run.sport_scope;
  const league = run.league_scope === "all" ? "Todas as ligas" : run.league_scope;
  return `${period} | ${sport} | ${league} | ${run.top_final_count} final`;
}

function formatShortlistScope(run: PersistedOpportunityRankingRun["run"]): string {
  const market = run.market_scope === "all" ? "Todos os mercados" : run.market_scope;
  return `${formatShortlistPeriod(run)} · ${run.sport_scope === "all" ? "Todos os esportes" : run.sport_scope} · ${market}`;
}

function formatShortlistPeriod(run: PersistedOpportunityRankingRun["run"]): string {
  if (!run.event_date_from && !run.event_date_to) return formatBR(run.run_date);
  const from = run.event_date_from ? formatBR(run.event_date_from) : "...";
  const to = run.event_date_to ? formatBR(run.event_date_to) : "...";
  return from === to ? from : `${from} a ${to}`;
}

function formatRankingItemLabel(item: PersistedOpportunityRankingRun["items"][number]): string {
  const metadata = asRankingItemMetadata(item);
  const rank = item.rank_prelim ? `#${item.rank_prelim}` : "#-";
  const jogo = String(metadata.jogo ?? item.event_key);
  const pick = [
    metadata.mercado_operacional ?? metadata.mercado,
    metadata.pick_operacional ?? metadata.pick,
  ]
    .filter(Boolean)
    .join(" | ");
  const alternatives = getSavedAlternatives(item).length;
  const suffix = alternatives ? `+${alternatives} alt.` : "";
  return [rank, jogo, pick, suffix].filter(Boolean).join(" - ");
}

function formatCandidateAlternativesSummary(candidate: RankedOpportunityCandidate): string {
  if (!candidate.group_alternatives.length) return "-";
  return candidate.group_alternatives.slice(0, 3).map(formatAlternativeLabel).join(" / ");
}

function formatSavedAlternativesSummary(
  item: PersistedOpportunityRankingRun["items"][number],
): string {
  const alternatives = getSavedAlternatives(item);
  if (!alternatives.length) return "";
  return `Opções alternativas agrupadas: ${alternatives.slice(0, 4).map(formatAlternativeLabel).join(" / ")}`;
}

function getSavedAlternatives(
  item: PersistedOpportunityRankingRun["items"][number],
): RankedOpportunityAlternative[] {
  const metadata = asRankingItemMetadata(item);
  return Array.isArray(metadata.alternatives)
    ? metadata.alternatives.filter(isRankedOpportunityAlternative)
    : [];
}

function isRankedOpportunityAlternative(value: unknown): value is RankedOpportunityAlternative {
  return Boolean(
    value && typeof value === "object" && "pick" in value && "opportunity_score_pre" in value,
  );
}

function formatAlternativeLabel(alternative: RankedOpportunityAlternative): string {
  return `${alternative.pick} (${alternative.opportunity_score_pre.toFixed(1)})`;
}

function formatPreviewStatus(status: string): string {
  if (status === "loaded") return "carregado";
  if (status === "queued") return "em fila";
  if (status === "missing") return "ausente";
  if (status === "error") return "erro";
  return "não solicitado";
}

function formatOptionalNumber(value: number | null | undefined): string {
  return value != null && Number.isFinite(Number(value)) ? Number(value).toFixed(1) : "-";
}

function asRankingItemMetadata(
  item: PersistedOpportunityRankingRun["items"][number],
): Record<string, unknown> {
  return item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
    ? (item.metadata as Record<string, unknown>)
    : {};
}

function ValidationSignalBar({
  score,
  confidence,
  riskCount,
  compact = false,
}: {
  score: number;
  confidence: number;
  riskCount: number;
  compact?: boolean;
}) {
  const normalizedScore = Math.max(0, Math.min(100, score));
  const level = normalizedScore >= 70 ? "Alta" : normalizedScore >= 50 ? "Média" : "Baixa";

  return (
    <div className="rounded-lg border border-border/80 bg-card/45 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="panel-kicker">Qualidade dos dados / oportunidade</p>
          {compact ? null : (
            <p className="mt-1 text-xs text-muted-foreground">
              Score pré-IA combinado com completude e estrutura dos dados
            </p>
          )}
        </div>
        <span
          className={cn(
            "rounded border px-2 py-1 font-mono text-xs font-semibold",
            level === "Alta" && "border-success/30 bg-success/10 text-success",
            level === "Média" && "border-warning/30 bg-warning/10 text-warning",
            level === "Baixa" && "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          {level} · {normalizedScore.toFixed(1)}
        </span>
      </div>
      <div className="relative mt-3 h-2 overflow-visible rounded-full bg-[linear-gradient(90deg,var(--color-destructive),var(--color-warning),var(--color-success))]">
        <span
          aria-hidden="true"
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow-[0_0_10px_rgb(255_255_255/0.45)]"
          style={{ left: `${normalizedScore}%` }}
        />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-muted-foreground sm:grid-cols-3">
        <span>
          Score: <strong className="font-mono text-foreground">{score.toFixed(1)}</strong>
        </span>
        <span>
          Qual. dados:{" "}
          <strong className="font-mono text-foreground">{confidence.toFixed(1)}</strong>
        </span>
        <span className="col-span-2 sm:col-span-1">
          Riscos: <strong className="font-mono text-foreground">{riskCount}</strong>
        </span>
      </div>
    </div>
  );
}

function ValidationGateStrip({
  hasPrice,
  hasPositiveEdge,
  hasContext,
  isOperational,
  mlbPreviewStatus,
}: {
  hasPrice: boolean;
  hasPositiveEdge: boolean;
  hasContext: boolean;
  isOperational: boolean;
  mlbPreviewStatus?: "MISSING" | "READY" | "REVIEW_REQUIRED";
}) {
  const gates = mlbPreviewStatus
    ? [
        { label: "Preço", passed: hasPrice, status: hasPrice ? "OK" : "ATENÇÃO" },
        {
          label: "Edge",
          passed: hasPositiveEdge,
          status: hasPositiveEdge ? "OK" : "ATENÇÃO",
        },
        {
          label: "Preview",
          passed: mlbPreviewStatus !== "MISSING",
          status: mlbPreviewStatus === "MISSING" ? "AUSENTE" : "COMPLETO",
        },
        {
          label: "Contexto",
          passed: mlbPreviewStatus === "READY",
          status:
            mlbPreviewStatus === "READY"
              ? "NEUTRO"
              : mlbPreviewStatus === "REVIEW_REQUIRED"
                ? "REVISÃO"
                : "PENDENTE",
        },
        {
          label: "Limites",
          passed: isOperational,
          status: isOperational ? "OK" : "ATENÇÃO",
        },
      ]
    : [
        { label: "Preço", passed: hasPrice, status: hasPrice ? "OK" : "ATENÇÃO" },
        {
          label: "Edge",
          passed: hasPositiveEdge,
          status: hasPositiveEdge ? "OK" : "ATENÇÃO",
        },
        {
          label: "Contexto",
          passed: hasContext,
          status: hasContext ? "DISPONÍVEL" : "ATENÇÃO",
        },
        {
          label: "Limites",
          passed: isOperational,
          status: isOperational ? "OK" : "ATENÇÃO",
        },
      ];

  return (
    <section
      aria-label="Sinais operacionais"
      className="rounded-lg border border-border/80 bg-background/35 p-3"
    >
      <p className="panel-kicker">Sinais operacionais</p>
      <div
        className={cn(
          "mt-2 grid grid-cols-2 gap-2",
          mlbPreviewStatus ? "sm:grid-cols-5" : "sm:grid-cols-4",
        )}
      >
        {gates.map((gate) => {
          const Icon = gate.passed ? CheckCircle2 : XCircle;
          return (
            <div
              key={gate.label}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-md border px-2.5 py-2 text-xs font-semibold",
                gate.passed
                  ? "border-success/25 bg-success/[0.07] text-success"
                  : "border-warning/25 bg-warning/[0.07] text-warning",
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span>
                {gate.label}
                <span className="block font-mono text-[9px] opacity-75">{gate.status}</span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad" | "warn";
}) {
  return (
    <div className="min-h-[64px] rounded-md border border-border bg-background/50 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-mono text-base font-bold",
          tone === "good" && "text-success",
          tone === "bad" && "text-destructive",
          tone === "warn" && "text-warning",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-h-[62px] rounded-md border border-border bg-background/50 p-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 break-words text-sm font-semibold">{value}</div>
    </div>
  );
}
