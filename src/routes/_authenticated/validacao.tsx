import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Sparkles, ShieldAlert, Brain, Loader2, Copy, Wand2, RefreshCw, X, Globe, ExternalLink, Trash2 } from "lucide-react";
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
import { PeriodFilter } from "@/components/period-filter";
import { rangeFromPeriodo, dateInRange, type PeriodoFiltro } from "@/lib/metrics";
import {
  usePrognosticos,
  useCreateValidacao,
  useUpdatePrognostico,
  useDeletePrognostico,
  useConfiguracao,
  calcEdge,
  getDadosTecnicos,
  saveAnaliseIaSnapshot,
  ESPORTES_DEFAULT,
  MERCADOS_DEFAULT,
  type Prognostico,
  type Status,
} from "@/lib/db";
import { analisarValidacao } from "@/lib/validacao-ia.functions";
import { analisarValidacaoOnline } from "@/lib/validacao-ia-online.functions";
import { getAiCalibrationSummary } from "@/lib/ai-learning";
import { formatBR, formatHora, shouldShowLinha } from "@/lib/date-br";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/validacao")({
  head: () => ({ meta: [{ title: "Validação Crítica — ASP Insights" }] }),
  component: Validacao,
});

const decisoes: { label: Status; texto: string; color: string }[] = [
  { label: "CONFIRMA", texto: "Confirmar", color: "bg-success text-success-foreground hover:bg-success/90" },
  { label: "PULAR", texto: "Pular", color: "bg-destructive text-destructive-foreground hover:bg-destructive/90" },
];

const STAKES = ["0.5", "1.0", "1.5"];

const PARECER_TEMPLATE = "PULAR - risco/contexto insuficiente";

interface IAResult {
  parecer: string;
  decisao_sugerida: string | null;
  stake_sugerida: number | null;
  prompt_versao: string;
  modo: "local" | "online";
  prognostico_id_escolhido?: string | null;
  pick_escolhida?: string | null;
  aviso_opcao?: string | null;
  fontes_consultadas?: { titulo: string; url: string }[];
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
    prognostico.jogo ||
    `${prognostico.mandante ?? ""} vs ${prognostico.visitante ?? ""}`;
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
  const mercado = normalizeGroupValue(prognostico.mercado);
  if (
    /moneyline|1x2|resultado final|vencedor|handicap|h[áa]ndicap|dupla chance|double chance/.test(mercado)
  ) {
    return "resultado-protecao";
  }
  return `mercado:${mercado}`;
}

function getMarketFamilyLabel(prognostico: Prognostico): string {
  return getMarketFamilyKey(prognostico) === "resultado-protecao"
    ? "Resultado / Proteção de Resultado"
    : prognostico.mercado;
}

function getValidationGroupKey(prognostico: Prognostico): string {
  return `${getEventKey(prognostico)}|${getMarketFamilyKey(prognostico)}`;
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
      const pa = `${a.pick} ${a.linha ?? ""}`;
      const pb = `${b.pick} ${b.linha ?? ""}`;
      return `${a.mercado} ${pa}`.localeCompare(`${b.mercado} ${pb}`);
    }),
  }));
}

function formatOptionCount(count: number): string {
  return count === 1 ? "1 opção pendente" : `${count} opções pendentes`;
}

function normalizeAiChoice(value: unknown): string {
  return normalizeGroupValue(value)
    .replace(/\s+/g, " ")
    .trim();
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
      const optionLabel = normalizeAiChoice(`${p.pick} ${p.linha ?? ""}`);
      const optionPick = normalizeAiChoice(p.pick);
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

function formatIaParecerForDisplay(parecer: string): string {
  return parecer
    .split(/\r?\n/)
    .filter((line) => !/^\s*"?decis[aã]o_grupo"?\s*:/i.test(line))
    .filter((line) => !/^\s*"?prognostico_id_escolhido"?\s*:/i.test(line))
    .filter((line) => !/^\s*"?stake_confirmada"?\s*:/i.test(line))
    .map((line) =>
      line
        .replace(/^\s*"?pick_escolhida"?\s*:/i, "Pick escolhida:")
        .replace(/^\s*"?justificativa_linha"?\s*:/i, "Justificativa da linha escolhida:")
        .replace(/^\s*"?riscos"?\s*:/i, "Principais riscos:")
        .replace(/^\s*"?condicao_invalidacao"?\s*:/i, "Condição de invalidação:")
        .replace(/\bCONFIRMA\b/g, "CONFIRMAR")
        .replace(/\bPASS\b/g, "PULAR"),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getIaResumo(ia: IAResult): string {
  const decisao = ia.decisao_sugerida === "CONFIRMA" ? "CONFIRMAR" : "PULAR";
  const pick = ia.decisao_sugerida === "CONFIRMA" && ia.pick_escolhida ? ` - ${ia.pick_escolhida}` : "";
  const stake =
    ia.decisao_sugerida === "CONFIRMA" && ia.stake_sugerida != null
      ? ` - ${ia.stake_sugerida.toFixed(1)}u`
      : "";
  return `${decisao}${pick}${stake}`;
}

function getOnlineAlertas(parecer: string): string[] {
  const text = parecer.toLowerCase();
  const alertas: string[] = [];
  if (/aguardar confirma|não confirmad|nao confirmad|incert|não encontrado|nao encontrado/.test(text)) {
    alertas.push("Informação crítica não confirmada");
  }
  if (/risco alto|impacto na aposta:\s*alto/.test(text)) {
    alertas.push("Risco alto");
  }
  if (/fonte insuficiente|sem fonte confiável|sem fonte confiavel|fonte não confiável|fonte nao confiavel/.test(text)) {
    alertas.push("Fonte insuficiente");
  }
  if (/desatualizad|notícia antiga|noticia antiga|sem data/.test(text)) {
    alertas.push("Possível dado desatualizado");
  }
  return Array.from(new Set(alertas));
}

function autoCheck(p: Prognostico, edgeFinal: number) {
  if (p.odd_ofertada < p.odd_valor) return { auto: "PULAR" as const, reason: "Odd ofertada menor que odd de valor" };
  if (edgeFinal < 0) return { auto: "PULAR" as const, reason: "Edge negativo" };
  if (p.probabilidade_final < 55) return { auto: "ALERTA" as const, reason: "Probabilidade inferior a 55%" };
  if (p.probabilidade_final > 60) return { auto: "DESTAQUE" as const, reason: "Probabilidade superior a 60%" };
  return null;
}

function Validacao() {
  const { data: prognosticos = [] } = usePrognosticos();
  const { data: cfg } = useConfiguracao();
  const createVal = useCreateValidacao();
  const updateProg = useUpdatePrognostico();
  const deleteProg = useDeletePrognostico();
  const callIA = useServerFn(analisarValidacao);
  const callIAOnline = useServerFn(analisarValidacaoOnline);
  const esportes = cfg?.esportes_ativos ?? ESPORTES_DEFAULT;
  const mercados = cfg?.mercados_ativos ?? MERCADOS_DEFAULT;

  // estado por linha e por grupo
  const [oddsAj, setOddsAj] = useState<Record<string, string>>({});
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

  const pendentes = useMemo(
    () =>
      prognosticos
        .filter((p) => p.resultado === "PENDENTE" && p.status_validacao === "PENDENTE")
        .filter((p) => {
          if (!dateInRange(p.data, ini, fim)) return false;
          if (fEsporte !== "all" && p.esporte !== fEsporte) return false;
          if (fLiga !== "all" && p.liga !== fLiga) return false;
          if (fMercado !== "all" && p.mercado !== fMercado) return false;
          return true;
        })
        .slice()
        .sort((a, b) => {
          if (a.data !== b.data) return a.data < b.data ? -1 : 1;
          const ha = a.hora ?? "99:99";
          const hb = b.hora ?? "99:99";
          return ha < hb ? -1 : ha > hb ? 1 : 0;
        }),
    [prognosticos, ini, fim, fEsporte, fLiga, fMercado],
  );

  const grupos = useMemo(() => groupPendentes(pendentes), [pendentes]);

  const getContextoGrupo = (g: ValidationGroup): string =>
    contextos[g.key] ?? contextos[g.eventKey] ?? getContextoInicialGrupo(g);

  const setContextoGrupo = (g: ValidationGroup, value: string) => {
    setContextos((prev) => {
      const next = { ...prev, [g.eventKey]: value };
      for (const group of grupos) {
        if (group.eventKey === g.eventKey) next[group.key] = value;
      }
      return next;
    });
  };

  const getOddAjustadaNum = (p: Prognostico): number | null => {
    const raw = oddsAj[p.id];
    if (raw !== undefined && raw !== "") return Number(raw);
    return p.odd_ajustada ?? p.odd_ofertada;
  };

  const getEdgeAjustado = (p: Prognostico): number | null => {
    const odd = getOddAjustadaNum(p);
    if (odd == null || !odd) return p.edge_ajustado;
    return calcEdge(p.probabilidade_final, odd);
  };

  const getSelectedOption = (g: ValidationGroup): Prognostico | null => {
    const selectedId = selectedByGroup[g.key] ?? (g.opcoes.length === 1 ? g.opcoes[0].id : "");
    return g.opcoes.find((p) => p.id === selectedId) ?? null;
  };

  const rodarIA = async (g: ValidationGroup, modo: "local" | "online") => {
    const p = g.opcoes[0];
    setIaLoading((s) => ({ ...s, [g.key]: modo }));
    try {
      const contextoAnalise = getContextoGrupo(g);
      const oddAj = getOddAjustadaNum(p);
      const edgeAj = getEdgeAjustado(p);
      const calibracao = await getAiCalibrationSummary(p);
      const opcoesMesmoMercado = g.opcoes.map((option) => ({
        prognostico_id: option.id,
        mercado: option.mercado,
        pick: option.pick,
        linha: option.linha,
        odd_original: option.odd_ofertada,
        odd_ajustada: getOddAjustadaNum(option),
        odd_valor: option.odd_valor,
        probabilidade: option.probabilidade_final,
        edge_original: option.edge,
        edge_ajustado: getEdgeAjustado(option),
      }));
      const prognosticosCorrelacionados = g.opcoes
        .filter((other) => other.id !== p.id)
        .map((other) => ({
          mercado: other.mercado,
          pick: other.pick,
          linha: other.linha,
          odd_original: other.odd_ofertada,
          odd_ajustada: getOddAjustadaNum(other),
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
          mercado: p.mercado,
          pick: p.pick,
          linha: p.linha,
          odd_original: p.odd_ofertada,
          odd_ajustada: oddAj,
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
      const raw = modo === "online" ? await callIAOnline(payload) : await callIA(payload);
      const r: IAResult = { ...(raw as Omit<IAResult, "modo">), modo };
      const chosenByIa = r.decisao_sugerida === "CONFIRMA" ? findAiChosenOption(g, r) : null;
      const rWithAviso: IAResult = {
        ...r,
        aviso_opcao:
          r.decisao_sugerida === "CONFIRMA" && !chosenByIa
            ? "A IA sugeriu confirmar, mas não foi possível identificar uma opção válida do grupo. Selecione manualmente antes de confirmar."
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
      const snapshotOption = chosenByIa ?? p;
      const snapshotOdd = getOddAjustadaNum(snapshotOption);
      const snapshotEdge = getEdgeAjustado(snapshotOption);
      await saveAnaliseIaSnapshot({
        prognostico_id: snapshotOption.id,
        modo_ia: modo,
        esporte: snapshotOption.esporte,
        liga: snapshotOption.liga,
        mercado: snapshotOption.mercado,
        pick: snapshotOption.pick,
        linha: snapshotOption.linha,
        jogo: snapshotOption.jogo,
        data_evento: snapshotOption.data,
        hora_evento: snapshotOption.hora,
        odd_usada: snapshotOdd ?? snapshotOption.odd_ofertada,
        probabilidade_final: snapshotOption.probabilidade_final,
        edge_usado: snapshotEdge ?? snapshotOption.edge,
        contexto_analisado: contextoAnalise,
        parecer_ia: rWithAviso.parecer,
        decisao_sugerida: rWithAviso.decisao_sugerida,
        stake_sugerida: rWithAviso.stake_sugerida,
        riscos_identificados: rWithAviso.parecer,
        fontes_consultadas: rWithAviso.fontes_consultadas ?? null,
        buscas_realizadas: rWithAviso.buscas_realizadas ?? null,
        prompt_versao: rWithAviso.prompt_versao,
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
    toast.success("Parecer da IA aplicado");
  };

  const decidir = async (p: Prognostico, decisao: Status) => {
    if (p.id || decisao) {
      toast.error("Use a validação agrupada para confirmar ou pular este mercado.");
      return;
    }
    const parecer = (pareceres[p.id] ?? "").trim();
    if (!parecer) {
      toast.error("Parecer da Validação é obrigatório.");
      return;
    }
    try {
      const oddAj = getOddAjustadaNum(p);
      const edgeAj = getEdgeAjustado(p);
      const stakeNum = stakes[p.id] ? Number(stakes[p.id]) : p.stake;
      const contextoAnalise = "";
      const contextoFoiEditado = false;

      // atualiza odd/edge ajustados e contexto no prognostico
      const patch: Partial<Prognostico> & { id: string } = { id: p.id };
      if (oddAj != null && oddAj !== p.odd_ajustada) patch.odd_ajustada = oddAj;
      if (edgeAj != null && edgeAj !== p.edge_ajustado) patch.edge_ajustado = edgeAj;
      if (contextoFoiEditado) patch.dados_tecnicos = contextoAnalise || null;
      if (Object.keys(patch).length > 1) await updateProg.mutateAsync(patch);

      const ia = iaResults[p.id];
      await createVal.mutateAsync({
        prognostico_id: p.id,
        decisao,
        stake_confirmada: decisao === "CONFIRMA" ? stakeNum : 0,
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
      toast.success(`Decisão registrada: ${decisao}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
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
      stake_confirmada: decisao === "CONFIRMA" ? stakeNum : 0,
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

    try {
      const contextoAnalise = getContextoGrupo(g).trim();
      const ia = iaResults[g.key];
      const selectedLabel = selected ? `${selected.pick}${selected.linha ? ` ${selected.linha}` : ""}` : "";
      const parecerBase = parecer || "Grupo recusado na validação crítica agrupada.";
      if (contextoAnalise) {
        const groupIds = new Set(g.opcoes.map((option) => option.id));
        const relatedEventOptions = pendentes.filter(
          (option) => !groupIds.has(option.id) && getEventKey(option) === g.eventKey,
        );
        for (const option of relatedEventOptions) {
          await updateProg.mutateAsync({ id: option.id, dados_tecnicos: contextoAnalise });
        }
      }
      for (const option of g.opcoes) {
        const isConfirmada = decisao === "CONFIRMA" && selected?.id === option.id;
        const stakeNum = isConfirmada ? Number(stakes[option.id] ?? option.stake ?? 0) : 0;
        const parecerOption =
          isConfirmada || decisao === "PULAR"
            ? parecerBase
            : `Linha não escolhida na validação agrupada. Opção confirmada no grupo: ${selectedLabel}.`;
        await registrarValidacaoGrupo(
          option,
          isConfirmada ? "CONFIRMA" : "PULAR",
          parecerOption,
          contextoAnalise,
          isConfirmada ? ia : undefined,
          stakeNum,
        );
      }
      toast.success(decisao === "CONFIRMA" ? "Grupo validado: 1 opção confirmada e demais puladas" : "Grupo inteiro marcado como PULAR");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Validação Crítica</h1>
        <p className="text-sm text-muted-foreground">
          Segunda camada analítica dos prognósticos gerados pelos modelos.
        </p>
      </div>

      {/* Filtros */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-end gap-3">
          <PeriodFilter
            periodo={periodo}
            onPeriodoChange={setPeriodo}
            customIni={customIni}
            customFim={customFim}
            onCustomIniChange={setCustomIni}
            onCustomFimChange={setCustomFim}
          />
          <div>
            <Label className="block text-[10px] uppercase tracking-wider text-muted-foreground">Esporte</Label>
            <Select value={fEsporte} onValueChange={(v) => { setFEsporte(v); setFLiga("all"); }}>
              <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Esporte" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os esportes</SelectItem>
                {esportes.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="block text-[10px] uppercase tracking-wider text-muted-foreground">Liga</Label>
            <LeagueFilter sport={fEsporte} value={fLiga} onChange={setFLiga} className="h-9 w-48" />
          </div>
          <div>
            <Label className="block text-[10px] uppercase tracking-wider text-muted-foreground">Mercado</Label>
            <Select value={fMercado} onValueChange={setFMercado}>
              <SelectTrigger className="h-9 w-52"><SelectValue placeholder="Mercado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os mercados</SelectItem>
                {mercados.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {grupos.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Não há prognósticos pendentes de validação.
        </div>
      )}

      <div className="space-y-4">
        {grupos.map((g) => {
          const selectedOptionId = selectedByGroup[g.key] ?? (g.opcoes.length === 1 ? g.opcoes[0].id : "");
          const p = getSelectedOption(g) ?? g.opcoes[0];
          const oddAj = getOddAjustadaNum(p);
          const edgeAj = getEdgeAjustado(p);
          const check = autoCheck(p, edgeAj ?? p.edge);
          const mostrarLinha = shouldShowLinha(p.pick, p.linha);
          const contextoAnalise = getContextoGrupo(g);
          const parecerCurrent = pareceres[g.key] ?? "";
          const ia = iaResults[g.key];
          const iaParecerDisplay = ia ? formatIaParecerForDisplay(ia.parecer) : "";

          return (
            <div
              key={g.key}
              className={cn(
                "rounded-lg border bg-card p-5 space-y-4",
                check?.auto === "PULAR" && "border-destructive/40",
                check?.auto === "DESTAQUE" && "border-success/40",
                check?.auto === "ALERTA" && "border-warning/40",
                !check && "border-border",
              )}
            >
              {/* Cabeçalho */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-muted-foreground">{formatBR(p.data)}</span>
                    {p.hora && <span className="font-mono text-muted-foreground">às {formatHora(p.hora)}</span>}
                    <span className="text-muted-foreground">•</span>
                    <span className="font-semibold uppercase tracking-wider text-primary">{p.esporte}</span>
                    <span className="text-muted-foreground">• {p.liga}</span>
                  </div>
                  <h3 className="mt-1 text-lg font-semibold">{p.jogo}</h3>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Grupo: <span className="font-semibold text-foreground">{g.mercado}</span> · {formatOptionCount(g.opcoes.length)}
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

              <div className="rounded-md border border-border bg-background/50 p-4 space-y-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Opções disponíveis neste grupo
                </div>
                <RadioGroup
                  value={selectedOptionId}
                  onValueChange={(value) => setSelectedByGroup((prev) => ({ ...prev, [g.key]: value }))}
                  className="grid gap-2"
                >
                  {g.opcoes.map((opcao) => {
                    const opcaoOdd = getOddAjustadaNum(opcao);
                    const opcaoEdge = getEdgeAjustado(opcao);
                    const opcaoCheck = autoCheck(opcao, opcaoEdge ?? opcao.edge);
                    return (
                      <label
                        key={opcao.id}
                        className={cn(
                          "flex cursor-pointer gap-3 rounded-md border p-3 transition-colors hover:bg-muted/40",
                          selectedOptionId === opcao.id ? "border-primary bg-primary/5" : "border-border bg-background/40",
                        )}
                      >
                        <RadioGroupItem value={opcao.id} className="mt-1" />
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                              {opcao.mercado}
                            </span>
                            <span className="font-semibold">{opcao.pick}</span>
                            {shouldShowLinha(opcao.pick, opcao.linha) && (
                              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{opcao.linha}</span>
                            )}
                            {opcaoCheck && (
                              <span className={cn(
                                "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                                opcaoCheck.auto === "PULAR" && "bg-destructive/10 text-destructive",
                                opcaoCheck.auto === "ALERTA" && "bg-warning/10 text-warning",
                                opcaoCheck.auto === "DESTAQUE" && "bg-success/10 text-success",
                              )}>
                                {opcaoCheck.auto}
                              </span>
                            )}
                          </div>
                          <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-5">
                            <span>Odd: <strong className="font-mono">{opcao.odd_ofertada.toFixed(2)}</strong></span>
                            <span>Odd aj.: <strong className="font-mono">{(opcaoOdd ?? opcao.odd_ofertada).toFixed(2)}</strong></span>
                            <span>Odd valor: <strong className="font-mono">{opcao.odd_valor.toFixed(2)}</strong></span>
                            <span>Prob.: <strong className="font-mono">{opcao.probabilidade_final.toFixed(2)}%</strong></span>
                            <span>Edge aj.: <strong className="font-mono">{opcaoEdge != null ? `${opcaoEdge.toFixed(2)}%` : "-"}</strong></span>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </RadioGroup>
              </div>

              {/* Bloco de entrada */}
              <div className="rounded-md border border-border bg-background/50 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Dados do prognóstico</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Odd em uso: <span className="font-mono font-semibold text-foreground">{(oddAj ?? p.odd_ofertada).toFixed(2)}</span>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  <KV label="Mercado" value={p.mercado} />
                  <KV label="Pick" value={p.pick} />
                  {mostrarLinha && <KV label="Linha" value={p.linha ?? "—"} />}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
                  <Metric label="Odd original" value={p.odd_ofertada.toFixed(2)} />
                  <div>
                    <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Odd ajustada</Label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder={p.odd_ofertada.toFixed(2)}
                      value={oddsAj[p.id] ?? (p.odd_ajustada != null ? p.odd_ajustada : p.odd_ofertada)}
                      onChange={(e) => setOddsAj({ ...oddsAj, [p.id]: e.target.value })}
                      className="mt-1 h-[51px] rounded-md border-border bg-background/50 font-mono text-base font-bold"
                    />
                  </div>
                  <Metric label="Odd valor" value={p.odd_valor.toFixed(2)} />
                  <Metric label="Probabilidade" value={`${p.probabilidade_final.toFixed(2)}%`} tone={p.probabilidade_final > 60 ? "good" : p.probabilidade_final < 55 ? "warn" : undefined} />
                  <Metric label="Edge original" value={`${p.edge.toFixed(2)}%`} tone={p.edge < 0 ? "bad" : "good"} />
                  <Metric
                    label="Edge ajustado"
                    value={edgeAj != null ? `${edgeAj.toFixed(2)}%` : "—"}
                    tone={edgeAj == null ? undefined : edgeAj < 0 ? "bad" : "good"}
                  />
                </div>

                {check && (
                  <div
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium",
                      check.auto === "PULAR" && "border-destructive/40 bg-destructive/10 text-destructive",
                      check.auto === "ALERTA" && "border-warning/40 bg-warning/10 text-warning",
                      check.auto === "DESTAQUE" && "border-success/40 bg-success/10 text-success",
                    )}
                  >
                    {check.auto === "DESTAQUE" ? <Sparkles className="h-3.5 w-3.5" /> : check.auto === "ALERTA" ? <ShieldAlert className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                    <span className="uppercase tracking-wider">{check.auto}</span>
                    <span className="text-foreground/80 normal-case tracking-normal">— {check.reason}</span>
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
                  placeholder="Cole dados internos do prognóstico: H2H, últimos jogos, projeções, odds, linhas, splits, dados técnicos do modelo ou observações manuais. IA Local usará somente este contexto e os dados internos."
                  value={contextoAnalise}
                  onChange={(e) => setContextoGrupo(g, e.target.value)}
                />
              </div>

              {/* IA */}
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                    <Wand2 className="h-4 w-4" />
                    Análise sugerida pela IA
                    {ia?.modo === "online" && (
                      <span className="flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                        <Globe className="h-3 w-3" /> online
                      </span>
                    )}
                    {ia?.modo === "local" && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        local
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => rodarIA(g, "local")}
                      disabled={!!iaLoading[g.key]}
                    >
                      {iaLoading[g.key] === "local" ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <Brain className="h-3 w-3 mr-1" />
                      )}
                      IA Local
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => rodarIA(g, "online")}
                      disabled={!!iaLoading[g.key]}
                      title="Usa Gemini com pesquisa online (Firecrawl) — consome créditos extras"
                    >
                      {iaLoading[g.key] === "online" ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <Globe className="h-3 w-3 mr-1" />
                      )}
                      IA Local + Pesquisa
                    </Button>
                    {ia && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => aplicarIA(g)}>
                          Aplicar
                        </Button>
                        <Button size="sm" variant="outline" onClick={async () => { await navigator.clipboard.writeText(iaParecerDisplay); toast.success("Copiado"); }}>
                          <Copy className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setIaResults((s) => { const n = { ...s }; delete n[g.key]; return n; })}>
                          <X className="h-3 w-3" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {iaLoading[g.key] === "online" && (
                  <p className="text-xs text-primary/80">
                    Pesquisando notícias, lineups e contexto na web… pode levar 15-40s.
                  </p>
                )}
                {ia ? (
                  <>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {ia.decisao_sugerida && (
                        <span className="rounded border border-border bg-background px-2 py-0.5">
                          Decisão: <strong>{ia.decisao_sugerida === "CONFIRMA" ? "CONFIRMAR" : "PULAR"}</strong>
                        </span>
                      )}
                      {ia.stake_sugerida != null && (
                        <span className="rounded border border-border bg-background px-2 py-0.5">
                          Stake sugerida: <strong>{ia.stake_sugerida}u</strong>
                        </span>
                      )}
                      {ia.pick_escolhida && (
                        <span className="rounded border border-border bg-background px-2 py-0.5">
                          Pick escolhida: <strong>{ia.pick_escolhida}</strong>
                        </span>
                      )}
                    </div>
                    {ia.aviso_opcao && (
                      <div className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                        {ia.aviso_opcao}
                      </div>
                    )}
                    {ia.modo === "online" && getOnlineAlertas(ia.parecer).length > 0 && (
                      <div className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                        <div className="mb-1 flex items-center gap-1 font-semibold">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Alertas da pesquisa online
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {getOnlineAlertas(ia.parecer).map((alerta) => (
                            <span key={alerta} className="rounded border border-warning/30 bg-background/50 px-2 py-0.5">
                              {alerta}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-border bg-background/60 p-2 font-mono text-xs">
                      {iaParecerDisplay}
                    </pre>
                    {ia.modo === "online" && (ia.fontes_consultadas?.length || ia.buscas_realizadas?.length) ? (
                      <div className="rounded border border-border bg-background/60 p-2 space-y-1.5">
                        {ia.buscas_realizadas && ia.buscas_realizadas.length > 0 && (
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Buscas realizadas</div>
                            <ul className="mt-0.5 space-y-0.5 text-xs">
                              {ia.buscas_realizadas.map((q, i) => (
                                <li key={i} className="text-muted-foreground">• {q}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {ia.fontes_consultadas && ia.fontes_consultadas.length > 0 && (
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Fontes consultadas</div>
                            <ul className="mt-0.5 space-y-0.5 text-xs">
                              {ia.fontes_consultadas.map((f, i) => (
                                <li key={i}>
                                  <a
                                    href={f.url}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="inline-flex items-center gap-1 text-primary hover:underline"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                    {f.titulo}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    <strong>IA Local</strong>: analisa apenas dados internos e contexto local/manual. <strong>IA Local + Pesquisa</strong>: usa os dados internos e adiciona notícias, lineups, lesões e contexto online pesquisado.
                  </p>
                )}
              </div>


              {/* Resumo + decisão */}
              <div className="grid gap-3 md:grid-cols-3">
                <div className="md:col-span-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Resumo da decisão *</Label>
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
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Stake confirmada (u)</Label>
                    <Select
                      value={stakes[p.id] ?? p.stake.toFixed(1)}
                      onValueChange={(v) => setStakes({ ...stakes, [p.id]: v })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STAKES.map((s) => <SelectItem key={s} value={s}>{s}u</SelectItem>)}
                      </SelectContent>
                    </Select>
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
              </div>
            </div>
          );
        })}
      </div>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir prognóstico?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.jogo} — {confirmDelete?.pick}. Esta ação não pode ser desfeita e removerá o prognóstico também da aba de Prognósticos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!confirmDelete) return;
                try {
                  await deleteProg.mutateAsync(confirmDelete.id);
                  toast.success("Prognóstico excluído");
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

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className="min-h-[72px] rounded-md border border-border bg-background/50 p-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
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
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold">{value}</div>
    </div>
  );
}
