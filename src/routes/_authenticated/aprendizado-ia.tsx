import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BrainCircuit,
  CheckCircle2,
  CircleDollarSign,
  Database,
  GitCompareArrows,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Split,
  Target,
  TrendingUp,
  XCircle,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/lib/supabase-public";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PeriodFilter } from "@/components/period-filter";
import { LeagueFilter } from "@/components/league-filter";
import { SportFilterSelect } from "@/components/sport-filter-select";
import { rangeFromPeriodo, dateInRange, type PeriodoFiltro } from "@/lib/metrics";
import {
  ESPORTES_DEFAULT,
  MERCADOS_DEFAULT,
  getEdgeEfetivo,
  getOddEfetiva,
  normalizeAiDecision,
  useConfiguracao,
  type AnaliseIa,
  type FeedbackIaResultado,
  type Prognostico,
  type Validacao,
} from "@/lib/db";

export const Route = createFileRoute("/_authenticated/aprendizado-ia")({
  component: AprendizadoIaPage,
});

type QueryErrorLike = { message: string };
type QueryResultLike<T = unknown> = { data: T | null; error: QueryErrorLike | null };
type AiQueryLike<T = unknown> = PromiseLike<QueryResultLike<T>> & {
  select: (columns?: string) => AiQueryLike<T>;
};

const aiDb = supabase as unknown as {
  from: (table: string) => AiQueryLike;
};

type LearningRow = Pick<
  FeedbackIaResultado,
  | "prognostico_id"
  | "analise_ia_id"
  | "modo_ia"
  | "esporte"
  | "liga"
  | "mercado"
  | "pick"
  | "linha"
  | "jogo"
  | "decisao_ia_sugerida"
  | "stake_ia_sugerida"
  | "decisao_humana_final"
  | "stake_humana_final"
  | "resultado_real"
  | "resultado_teorico"
  | "resultado_financeiro"
  | "conta_bankroll"
  | "lucro_prejuizo"
  | "lucro_unidades"
  | "lucro_teorico_unidades"
  | "lucro_financeiro_unidades"
  | "odd_usada"
  | "probabilidade_final"
  | "edge_usado"
  | "tags_risco"
  | "acertou_ia"
  | "acertou_humano"
  | "divergencia_ia_humano"
  | "created_at"
>;

type HistoricalPrognostico = Prognostico & {
  resultados?: Array<{
    resultado: string;
    lucro_prejuizo: number | null;
    created_at: string;
    data_resultado: string | null;
  }>;
  validacoes?: Array<Partial<Validacao>>;
};

function AprendizadoIaPage() {
  const { data: cfg } = useConfiguracao();
  const valorUnidade = cfg?.valor_unidade_padrao ?? 10;
  const esportesCfg = cfg?.esportes_ativos ?? ESPORTES_DEFAULT;
  const mercadosCfg = cfg?.mercados_ativos ?? MERCADOS_DEFAULT;
  const [periodo, setPeriodo] = useState<PeriodoFiltro>("tudo");
  const [customIni, setCustomIni] = useState("");
  const [customFim, setCustomFim] = useState("");
  const [esporte, setEsporte] = useState("all");
  const [liga, setLiga] = useState("all");
  const [mercado, setMercado] = useState("all");
  const [modoIa, setModoIa] = useState("all");
  const [decisaoIa, setDecisaoIa] = useState("all");
  const [decisaoHumana, setDecisaoHumana] = useState("all");
  const [resultado, setResultado] = useState("all");
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const { ini, fim } = rangeFromPeriodo(periodo, customIni, customFim);

  const { data: analises = [] } = useQuery({
    queryKey: ["ai-learning", "analises"],
    queryFn: async () => {
      const { data, error } = await aiDb.from("analises_ia").select("*");
      if (error) {
        console.warn("[Aprendizado IA] analises_ia indisponível:", error.message);
        return [] as AnaliseIa[];
      }
      return (data ?? []) as AnaliseIa[];
    },
  });

  const { data: feedback = [] } = useQuery({
    queryKey: ["ai-learning", "feedback"],
    queryFn: async () => {
      const { data, error } = await aiDb.from("feedback_ia_resultados").select("*");
      if (error) {
        console.warn("[Aprendizado IA] feedback_ia_resultados indisponível:", error.message);
        return [] as FeedbackIaResultado[];
      }
      return (data ?? []) as FeedbackIaResultado[];
    },
  });

  const { data: historico = [], isLoading: loadingHistorico } = useQuery({
    queryKey: ["ai-learning", "historico-retroativo"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prognosticos")
        .select(
          "*, resultados(resultado, lucro_prejuizo, data_resultado, created_at), validacoes(*)",
        )
        .in("resultado", ["GREEN", "RED", "WIN", "WINS", "LOSS", "LOSSES"]);
      if (error) {
        console.warn("[Aprendizado IA] histórico retroativo indisponível:", error.message);
        return [] as HistoricalPrognostico[];
      }
      return (data ?? []) as HistoricalPrognostico[];
    },
  });

  const learningRows = useMemo<LearningRow[]>(() => {
    const feedbackIds = new Set(feedback.map((row) => row.prognostico_id).filter(Boolean));
    const rows: LearningRow[] = feedback.map((row) => ({ ...row }));

    for (const p of historico) {
      if (feedbackIds.has(p.id)) continue;
      const resultado = normalizeOutcome(p.resultado);
      if (resultado !== "GREEN" && resultado !== "RED") continue;

      const validacao = latestByCreatedAt(p.validacoes ?? []);
      const resultadoRow = latestByCreatedAt(p.resultados ?? []);
      const decisaoHumana = normalizeAiDecision(validacao?.decisao ?? p.status_validacao);
      const decisaoIa = normalizeAiDecision(validacao?.decisao_ia_sugerida);
      const stakeHumana = Number(validacao?.stake_confirmada ?? p.stake ?? 0);
      const contaBankroll = decisaoHumana === "CONFIRMAR";
      const lucro = Number(resultadoRow?.lucro_prejuizo ?? p.lucro_prejuizo ?? 0);

      rows.push({
        prognostico_id: p.id,
        analise_ia_id: null,
        modo_ia: validacao?.modo_ia ?? null,
        esporte: p.esporte,
        liga: p.liga,
        mercado: p.mercado,
        pick: p.pick,
        linha: null,
        jogo: p.jogo,
        decisao_ia_sugerida: decisaoIa,
        stake_ia_sugerida: validacao?.stake_ia_sugerida ?? null,
        decisao_humana_final: decisaoHumana,
        stake_humana_final: stakeHumana,
        resultado_real: resultado,
        resultado_teorico: resultado,
        resultado_financeiro: contaBankroll ? resultado : null,
        conta_bankroll: contaBankroll,
        lucro_prejuizo: contaBankroll ? lucro : 0,
        lucro_unidades: lucro,
        lucro_teorico_unidades: lucro,
        lucro_financeiro_unidades: contaBankroll ? lucro : 0,
        odd_usada: getOddEfetiva(p),
        probabilidade_final: p.probabilidade_final,
        edge_usado: getEdgeEfetivo(p),
        tags_risco: extractTagsFromLegacyText(
          validacao?.parecer_ia ?? validacao?.parecer_validacao ?? p.observacoes,
        ),
        acertou_ia: decisaoIa ? decisionHit(decisaoIa, resultado) : null,
        acertou_humano: decisaoHumana ? decisionHit(decisaoHumana, resultado) : null,
        divergencia_ia_humano: decisaoIa && decisaoHumana ? decisaoIa !== decisaoHumana : null,
        created_at: resultadoRow?.created_at ?? p.updated_at ?? p.created_at,
      });
    }

    return dedupeLearningRows(rows);
  }, [feedback, historico]);

  const mercados = useMemo(() => {
    const mercadosImportados = [
      ...analises.map((a) => a.mercado).filter(Boolean),
      ...learningRows.map((row) => row.mercado).filter(Boolean),
    ] as string[];
    const set = new Set([...mercadosCfg, ...mercadosImportados]);
    return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [mercadosCfg, analises, learningRows]);

  const esportes = useMemo(() => {
    const esportesImportados = [
      ...analises.map((a) => a.esporte).filter(Boolean),
      ...learningRows.map((row) => row.esporte).filter(Boolean),
    ] as string[];
    return [...new Set([...esportesCfg, ...esportesImportados])].sort((a, b) =>
      a.localeCompare(b, "pt-BR"),
    );
  }, [esportesCfg, analises, learningRows]);

  const filteredAnalises = useMemo(
    () =>
      analises.filter((a) => {
        if (!dateInRange((a.created_at ?? "").slice(0, 10), ini, fim)) return false;
        if (esporte !== "all" && a.esporte !== esporte) return false;
        if (liga !== "all" && a.liga !== liga) return false;
        if (mercado !== "all" && a.mercado !== mercado) return false;
        if (modoIa !== "all" && a.modo_ia !== modoIa) return false;
        if (decisaoIa !== "all" && normalizeAiDecision(a.decisao_sugerida) !== decisaoIa)
          return false;
        return true;
      }),
    [analises, ini, fim, esporte, liga, mercado, modoIa, decisaoIa],
  );

  const filteredFeedback = useMemo(
    () =>
      learningRows.filter((f) => {
        if (!dateInRange((f.created_at ?? "").slice(0, 10), ini, fim)) return false;
        if (esporte !== "all" && f.esporte !== esporte) return false;
        if (liga !== "all" && f.liga !== liga) return false;
        if (mercado !== "all" && f.mercado !== mercado) return false;
        if (modoIa !== "all" && f.modo_ia !== modoIa) return false;
        if (decisaoIa !== "all" && normalizeAiDecision(f.decisao_ia_sugerida) !== decisaoIa)
          return false;
        if (
          decisaoHumana !== "all" &&
          normalizeAiDecision(f.decisao_humana_final) !== decisaoHumana
        )
          return false;
        if (resultado !== "all" && getOutcome(f) !== resultado) return false;
        return true;
      }),
    [learningRows, ini, fim, esporte, liga, mercado, modoIa, decisaoIa, decisaoHumana, resultado],
  );

  const iaConfirmadas = filteredAnalises.filter(
    (a) => normalizeAiDecision(a.decisao_sugerida) === "CONFIRMAR",
  );
  const rowsComDecisaoIa = filteredFeedback.filter((row) =>
    normalizeAiDecision(row.decisao_ia_sugerida),
  );
  const rowsConfirmadasIa = rowsComDecisaoIa.filter(
    (row) => normalizeAiDecision(row.decisao_ia_sugerida) === "CONFIRMAR",
  );
  const feedbackConfirmadasIa = filteredFeedback.filter(
    (f) => normalizeAiDecision(f.decisao_ia_sugerida) === "CONFIRMAR",
  );
  const feedbackPuladasIa = filteredFeedback.filter(
    (f) => normalizeAiDecision(f.decisao_ia_sugerida) === "PULAR",
  );
  const feedbackComAcertoIa = filteredFeedback.filter((f) => f.acertou_ia != null);
  const acertosIa = feedbackComAcertoIa.filter((f) => f.acertou_ia === true).length;
  const confirmadasGreen = feedbackConfirmadasIa.filter((f) => getOutcome(f) === "GREEN").length;
  const confirmadasRed = feedbackConfirmadasIa.filter((f) => getOutcome(f) === "RED").length;
  const puladasGreen = feedbackPuladasIa.filter((f) => getOutcome(f) === "GREEN").length;
  const puladasRed = feedbackPuladasIa.filter((f) => getOutcome(f) === "RED").length;
  const lucroTeoricoIa = feedbackConfirmadasIa.reduce((sum, f) => sum + getTheoreticalUnits(f), 0);
  const stakeTeoricaIa = feedbackConfirmadasIa.reduce(
    (sum, f) => sum + Number(f.stake_ia_sugerida ?? f.stake_humana_final ?? 0),
    0,
  );
  const confirmadasConcordantes = feedbackConfirmadasIa.filter(
    (f) =>
      normalizeAiDecision(f.decisao_humana_final) === "CONFIRMAR" && f.conta_bankroll !== false,
  );
  const lucroFinanceiroConcordante = confirmadasConcordantes.reduce(
    (sum, f) => sum + getFinancialUnits(f),
    0,
  );
  const stakeFinanceiraConcordante = confirmadasConcordantes.reduce(
    (sum, f) => sum + Number(f.stake_humana_final ?? 0),
    0,
  );
  const divergencias = filteredFeedback.filter((f) => f.divergencia_ia_humano).length;

  const stats = {
    total: rowsComDecisaoIa.length,
    local:
      filteredFeedback.filter((row) => row.modo_ia === "local").length ||
      filteredAnalises.filter((a) => a.modo_ia === "local").length,
    online:
      filteredFeedback.filter((row) => row.modo_ia === "online").length ||
      filteredAnalises.filter((a) => a.modo_ia === "online").length,
    taxaConfirmacao: rowsComDecisaoIa.length
      ? (rowsConfirmadasIa.length / rowsComDecisaoIa.length) * 100
      : filteredAnalises.length
        ? (iaConfirmadas.length / filteredAnalises.length) * 100
        : 0,
    taxaAcerto: feedbackComAcertoIa.length ? (acertosIa / feedbackComAcertoIa.length) * 100 : 0,
    confirmadasGreen,
    confirmadasRed,
    puladasGreen,
    puladasRed,
    confirmarCorreto: confirmadasGreen,
    confirmarIncorreto: confirmadasRed,
    pularCorreto: puladasRed,
    pularIncorreto: puladasGreen,
    roiTeoricoIa: stakeTeoricaIa > 0 ? (lucroTeoricoIa / stakeTeoricaIa) * 100 : 0,
    roiFinanceiroConcordante:
      stakeFinanceiraConcordante > 0
        ? (lucroFinanceiroConcordante / stakeFinanceiraConcordante) * 100
        : 0,
    lucroTeoricoIa,
    lucroFinanceiroConcordante,
    lucroRealConcordante: lucroFinanceiroConcordante * valorUnidade,
    divergencias,
  };

  const acertoPorEsporte = rateBy(filteredFeedback, "esporte");
  const acertoPorMercado = rateBy(filteredFeedback, "mercado");
  const lucroPorEsporte = sumFinancialBy(confirmadasConcordantes, "esporte");
  const lucroPorMercado = sumFinancialBy(confirmadasConcordantes, "mercado");
  const modoComparativo = rateBy(filteredFeedback, "modo_ia");
  const tagsRed = tagsByRed(filteredFeedback);
  const learningTrend = learningTrendByDay(filteredFeedback);
  const recentMemory = [...filteredFeedback]
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
    .slice(0, 8);
  const hasData = filteredAnalises.length > 0 || filteredFeedback.length > 0;
  const matrixTotal =
    stats.confirmarCorreto + stats.confirmarIncorreto + stats.pularCorreto + stats.pularIncorreto;

  return (
    <div className="page-stack pb-8">
      <section className="relative overflow-hidden rounded-2xl border border-primary/20 bg-[radial-gradient(circle_at_88%_18%,hsl(var(--primary)/0.24),transparent_34%),linear-gradient(135deg,hsl(var(--card)),hsl(var(--background)))] px-5 py-6 shadow-[0_18px_60px_-30px_hsl(var(--primary)/0.55)] sm:px-7">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full border border-primary/20 bg-primary/5 blur-sm" />
        <div className="pointer-events-none absolute right-20 top-8 h-2 w-2 rounded-full bg-primary shadow-[0_0_22px_6px_hsl(var(--primary)/0.5)]" />
        <div className="relative flex items-start gap-4">
          <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-primary/35 bg-primary/10 shadow-[inset_0_0_24px_hsl(var(--primary)/0.14)] sm:flex">
            <BrainCircuit className="h-8 w-8 text-primary" />
          </div>
          <div className="max-w-3xl">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                IA operacional
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/25 bg-violet-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-300">
                <Database className="h-3 w-3" />
                Memória ativa
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Aprendizado da IA
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Memória operacional que compara análise da IA, decisão humana e resultado GREEN/RED
              para aprimorar o aprendizado contínuo.
            </p>
          </div>
        </div>
      </section>

      <Card className="border-border/70 bg-card/75 shadow-sm backdrop-blur">
        <CardContent className="p-3 sm:p-4">
          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
            <PeriodFilter
              periodo={periodo}
              onPeriodoChange={setPeriodo}
              customIni={customIni}
              customFim={customFim}
              onCustomIniChange={setCustomIni}
              onCustomFimChange={setCustomFim}
              className={`${periodo === "custom" ? "sm:col-span-2 xl:col-span-4" : ""} w-full [&>div]:!w-full`}
            />
            <Filter
              label="Esporte"
              value={esporte}
              onChange={(v) => {
                setEsporte(v);
                setLiga("all");
              }}
              options={["all", ...esportes]}
              allLabel="Todos"
              sportIcons
            />
            <div className="min-w-0">
              <Label className="block text-[10px] uppercase tracking-wider text-muted-foreground">
                Liga
              </Label>
              <LeagueFilter
                sport={esporte}
                value={liga}
                onChange={setLiga}
                className="h-9 w-full"
              />
            </div>
            <button
              type="button"
              aria-expanded={moreFiltersOpen}
              onClick={() => setMoreFiltersOpen((open) => !open)}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-primary/30 bg-primary/5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 sm:hidden"
            >
              <SlidersHorizontal className="h-4 w-4" />
              {moreFiltersOpen ? "Ocultar filtros" : "Mais filtros"}
            </button>
            <div className={moreFiltersOpen ? "contents" : "hidden sm:contents"}>
              <Filter
                label="Mercado"
                value={mercado}
                onChange={setMercado}
                options={["all", ...mercados]}
                allLabel="Todos"
              />
              <Filter
                label="Modo IA"
                value={modoIa}
                onChange={setModoIa}
                options={["all", "local", "online"]}
                allLabel="Todos"
              />
              <Filter
                label="Decisão IA"
                value={decisaoIa}
                onChange={setDecisaoIa}
                options={["all", "CONFIRMAR", "PULAR"]}
                allLabel="Todas"
              />
              <Filter
                label="Decisão humana"
                value={decisaoHumana}
                onChange={setDecisaoHumana}
                options={["all", "CONFIRMAR", "PULAR"]}
                allLabel="Todas"
              />
              <Filter
                label="Resultado"
                value={resultado}
                onChange={setResultado}
                options={["all", "GREEN", "RED"]}
                allLabel="Todos"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {loadingHistorico ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Carregando histórico de aprendizado...
          </CardContent>
        </Card>
      ) : !hasData ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Nenhum dado encontrado para os filtros selecionados.
          </CardContent>
        </Card>
      ) : feedback.length === 0 && historico.length > 0 ? (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            Histórico atualizado com dados retroativos a partir de prognósticos, validações e
            resultados existentes.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <LearningKpi
          label="Decisões avaliadas"
          value={String(stats.total)}
          icon={BrainCircuit}
          tone="blue"
          detail={`${stats.local} local · ${stats.online} online`}
        />
        <LearningKpi
          label="Acerto decisório IA"
          value={`${stats.taxaAcerto.toFixed(1)}%`}
          icon={ShieldCheck}
          tone="violet"
          detail={`${feedbackComAcertoIa.length} decisões concluídas`}
        />
        <LearningKpi
          label="Taxa de confirmação"
          value={`${stats.taxaConfirmacao.toFixed(1)}%`}
          icon={Target}
          tone="green"
          detail={`${rowsConfirmadasIa.length} entradas confirmadas`}
        />
        <LearningKpi
          label="ROI teórico IA"
          value={`${stats.roiTeoricoIa.toFixed(1)}%`}
          icon={TrendingUp}
          tone={stats.roiTeoricoIa >= 0 ? "blue" : "red"}
          detail={`${stats.lucroTeoricoIa.toFixed(2)}u teóricas`}
        />
        <LearningKpi
          label="ROI concordante"
          value={`${stats.roiFinanceiroConcordante.toFixed(1)}%`}
          icon={CircleDollarSign}
          tone={stats.roiFinanceiroConcordante >= 0 ? "amber" : "red"}
          detail={`R$ ${stats.lucroRealConcordante.toFixed(2)} realizados`}
        />
        <LearningKpi
          label="Divergências IA × humano"
          value={String(stats.divergencias)}
          icon={GitCompareArrows}
          tone="red"
          detail={`${rowsComDecisaoIa.length ? ((stats.divergencias / rowsComDecisaoIa.length) * 100).toFixed(1) : "0.0"}% das decisões avaliadas`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
        <DecisionMatrix stats={stats} total={matrixTotal} />
        <LearningTrend rows={learningTrend} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard
          title="Acerto da IA por esporte"
          rows={acertoPorEsporte}
          suffix="%"
          accent="blue"
        />
        <ChartCard
          title="Acerto da IA por mercado"
          rows={acertoPorMercado}
          suffix="%"
          accent="violet"
        />
        <ChartCard title="Causas de RED" rows={tagsRed} suffix="" accent="red" />
        <ModeComparison rows={modoComparativo} totalRate={stats.taxaAcerto} />
        <ChartCard
          title="ROI financeiro por esporte"
          rows={lucroPorEsporte}
          suffix="u"
          diverging
          accent="green"
        />
        <ChartCard
          title="ROI financeiro por mercado"
          rows={lucroPorMercado}
          suffix="u"
          diverging
          accent="amber"
        />
      </div>

      <RecentMemory rows={recentMemory} />
    </div>
  );
}

type KpiTone = "blue" | "violet" | "green" | "amber" | "red";

const toneClasses: Record<KpiTone, { icon: string; glow: string; bar: string }> = {
  blue: {
    icon: "border-primary/30 bg-primary/10 text-primary",
    glow: "from-primary/14",
    bar: "bg-primary",
  },
  violet: {
    icon: "border-violet-400/30 bg-violet-500/10 text-violet-300",
    glow: "from-violet-500/14",
    bar: "bg-violet-400",
  },
  green: {
    icon: "border-success/30 bg-success/10 text-success",
    glow: "from-success/14",
    bar: "bg-success",
  },
  amber: {
    icon: "border-amber-400/30 bg-amber-500/10 text-amber-300",
    glow: "from-amber-500/14",
    bar: "bg-amber-400",
  },
  red: {
    icon: "border-destructive/30 bg-destructive/10 text-destructive",
    glow: "from-destructive/14",
    bar: "bg-destructive",
  },
};

function LearningKpi({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof BrainCircuit;
  tone: KpiTone;
}) {
  const colors = toneClasses[tone];
  return (
    <Card className="group relative min-h-32 overflow-hidden border-border/70 bg-card/85 transition-colors hover:border-primary/30">
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${colors.glow} via-transparent to-transparent opacity-70`}
      />
      <div className={`absolute inset-x-0 top-0 h-0.5 ${colors.bar}`} />
      <CardContent className="relative flex h-full items-start gap-3 p-4">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${colors.icon}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 font-mono text-2xl font-semibold tracking-tight text-foreground">
            {value}
          </p>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

type LearningStats = {
  confirmarCorreto: number;
  confirmarIncorreto: number;
  pularCorreto: number;
  pularIncorreto: number;
  taxaAcerto: number;
};

function DecisionMatrix({ stats, total }: { stats: LearningStats; total: number }) {
  const cells = [
    {
      label: "Confirmar correto",
      value: stats.confirmarCorreto,
      tone: "green" as const,
      icon: CheckCircle2,
    },
    {
      label: "Confirmar incorreto",
      value: stats.confirmarIncorreto,
      tone: "red" as const,
      icon: XCircle,
    },
    { label: "Pular correto", value: stats.pularCorreto, tone: "blue" as const, icon: ShieldCheck },
    { label: "Pular incorreto", value: stats.pularIncorreto, tone: "amber" as const, icon: Split },
  ];
  return (
    <Card className="overflow-hidden border-border/70 bg-card/85">
      <CardHeader className="border-b border-border/60 pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-[0.12em] text-primary">
            <GitCompareArrows className="h-4 w-4" />
            Matriz de decisão
          </CardTitle>
          <span className="font-mono text-xs text-muted-foreground">Total: {total}</span>
        </div>
      </CardHeader>
      <CardContent className="p-3 sm:p-4">
        <div className="mb-2 grid grid-cols-[38px_minmax(0,1fr)_minmax(0,1fr)] text-center text-[8px] font-semibold uppercase tracking-wider text-muted-foreground sm:grid-cols-[58px_1fr_1fr] sm:text-[9px]">
          <span />
          <span>Decisão correta</span>
          <span>Decisão incorreta</span>
        </div>
        <div className="grid grid-cols-[38px_minmax(0,1fr)_minmax(0,1fr)] gap-1.5 sm:grid-cols-[58px_1fr_1fr] sm:gap-2">
          <div className="flex items-center justify-center text-[8px] font-semibold uppercase tracking-wider text-muted-foreground [writing-mode:vertical-rl] sm:text-[9px]">
            IA confirma
          </div>
          {cells.slice(0, 2).map((cell) => (
            <MatrixCell key={cell.label} {...cell} total={total} />
          ))}
          <div className="flex items-center justify-center text-[8px] font-semibold uppercase tracking-wider text-muted-foreground [writing-mode:vertical-rl] sm:text-[9px]">
            IA pula
          </div>
          {cells.slice(2).map((cell) => (
            <MatrixCell key={cell.label} {...cell} total={total} />
          ))}
        </div>
        <div className="mt-4 flex items-center justify-center gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-success" />
          Acerto global da IA:
          <strong className="font-mono text-success">{stats.taxaAcerto.toFixed(1)}%</strong>
        </div>
      </CardContent>
    </Card>
  );
}

function MatrixCell({
  label,
  value,
  tone,
  icon: Icon,
  total,
}: {
  label: string;
  value: number;
  tone: KpiTone;
  icon: typeof BrainCircuit;
  total: number;
}) {
  const colors = toneClasses[tone];
  return (
    <div className={`min-w-0 rounded-xl border p-2 sm:p-3 ${colors.icon}`}>
      <div className="flex items-start gap-1 text-[9px] font-medium leading-tight sm:items-center sm:gap-1.5 sm:text-[10px]">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span>{label}</span>
      </div>
      <p className="mt-2 font-mono text-lg font-semibold text-foreground sm:text-xl">
        {total ? ((value / total) * 100).toFixed(1) : "0.0"}%
      </p>
      <p className="font-mono text-[10px] opacity-80">{value} casos</p>
    </div>
  );
}

interface TrendRow {
  date: string;
  label: string;
  local: number | null;
  online: number | null;
}

function LearningTrend({ rows }: { rows: TrendRow[] }) {
  const latest = rows.at(-1);
  return (
    <Card className="overflow-hidden border-border/70 bg-card/85">
      <CardHeader className="border-b border-border/60 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-[0.12em] text-primary">
            <Activity className="h-4 w-4" />
            Evolução do aprendizado
          </CardTitle>
          <div className="flex gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <i className="h-0.5 w-4 bg-primary" /> IA local
            </span>
            <span className="flex items-center gap-1">
              <i className="h-0.5 w-4 bg-violet-400" /> IA online
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        {rows.length ? (
          <>
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.45} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10 }}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 10 }}
                    stroke="hsl(var(--muted-foreground))"
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 10,
                      fontSize: 12,
                    }}
                    formatter={(value: number) => [`${value.toFixed(1)}%`]}
                  />
                  <Line
                    type="monotone"
                    dataKey="local"
                    connectNulls
                    stroke="hsl(var(--primary))"
                    strokeWidth={2.5}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="online"
                    connectNulls
                    stroke="#a78bfa"
                    strokeWidth={2.5}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 grid grid-cols-3 divide-x divide-border rounded-xl border border-border/60 bg-background/35 py-3 text-center">
              <TrendSummary label="Último ponto" value={latest?.label ?? "—"} />
              <TrendSummary
                label="IA local"
                value={latest?.local == null ? "—" : `${latest.local.toFixed(1)}%`}
                tone="text-primary"
              />
              <TrendSummary
                label="IA online"
                value={latest?.online == null ? "—" : `${latest.online.toFixed(1)}%`}
                tone="text-violet-300"
              />
            </div>
          </>
        ) : (
          <EmptyChart />
        )}
      </CardContent>
    </Card>
  );
}

function TrendSummary({
  label,
  value,
  tone = "text-foreground",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="px-2">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 font-mono text-sm font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

function ModeComparison({ rows, totalRate }: { rows: BarRow[]; totalRate: number }) {
  const local = rows.find((row) => row.label === "local")?.value ?? 0;
  const online = rows.find((row) => row.label === "online")?.value ?? 0;
  return (
    <Card className="overflow-hidden border-border/70 bg-card/85">
      <CardHeader className="border-b border-border/60 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-[0.12em] text-primary">
          <BrainCircuit className="h-4 w-4" /> IA local × IA online
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-64 flex-col justify-center p-5">
        <div className="relative mx-auto flex h-36 w-36 items-center justify-center rounded-full bg-[conic-gradient(hsl(var(--primary))_0_50%,#a78bfa_50%_100%)] shadow-[0_0_38px_-14px_hsl(var(--primary))]">
          <div className="flex h-28 w-28 flex-col items-center justify-center rounded-full bg-card">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Acerto IA
            </span>
            <strong className="font-mono text-2xl">{totalRate.toFixed(1)}%</strong>
            <span className="text-[10px] text-muted-foreground">global</span>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 text-center">
          <TrendSummary label="IA local" value={`${local.toFixed(1)}%`} tone="text-primary" />
          <TrendSummary label="IA online" value={`${online.toFixed(1)}%`} tone="text-violet-300" />
        </div>
      </CardContent>
    </Card>
  );
}

function RecentMemory({ rows }: { rows: LearningRow[] }) {
  return (
    <Card className="overflow-hidden border-border/70 bg-card/85">
      <CardHeader className="border-b border-border/60 pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-[0.12em] text-primary">
            <Database className="h-4 w-4" /> Memória operacional recente
          </CardTitle>
          <span className="hidden text-[10px] text-muted-foreground sm:block">
            Resultados mais recentes da seleção atual
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        {rows.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {rows.map((row) => {
              const outcome = getOutcome(row);
              const decision = normalizeAiDecision(row.decisao_ia_sugerida);
              return (
                <div
                  key={`${row.prognostico_id}-${row.created_at}`}
                  className="rounded-xl border border-border/70 bg-background/35 p-3 transition-colors hover:border-primary/35"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-foreground">
                        {row.esporte ?? "Sem esporte"}
                      </p>
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                        {row.mercado ?? row.pick ?? "Sem mercado"}
                      </p>
                    </div>
                    <span
                      className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold ${outcome === "GREEN" ? "border-success/40 bg-success/10 text-success" : "border-destructive/40 bg-destructive/10 text-destructive"}`}
                    >
                      {outcome ?? "—"}
                    </span>
                  </div>
                  <div className="mt-3 space-y-1.5 border-t border-border/60 pt-2 text-[10px]">
                    <MemoryLine label="Decisão IA" value={decision ?? "—"} ok={row.acertou_ia} />
                    <MemoryLine
                      label="Decisão humana"
                      value={normalizeAiDecision(row.decisao_humana_final) ?? "—"}
                      ok={row.acertou_humano}
                    />
                    <MemoryLine label="Modo" value={row.modo_ia ?? "—"} />
                    <MemoryLine
                      label="Odd usada"
                      value={row.odd_usada ? Number(row.odd_usada).toFixed(2) : "—"}
                    />
                  </div>
                  <p className="mt-2 border-t border-border/60 pt-2 font-mono text-[9px] text-muted-foreground">
                    {formatMemoryDate(row.created_at)}
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyChart />
        )}
      </CardContent>
    </Card>
  );
}

function MemoryLine({ label, value, ok }: { label: string; value: string; ok?: boolean | null }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1 font-medium text-foreground">
        {value}
        {ok === true ? (
          <CheckCircle2 className="h-3 w-3 text-success" />
        ) : ok === false ? (
          <XCircle className="h-3 w-3 text-destructive" />
        ) : null}
      </span>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex min-h-40 items-center justify-center text-center text-sm text-muted-foreground">
      Nenhum resultado encontrado para os filtros selecionados.
    </div>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
  allLabel,
  sportIcons = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  allLabel: string;
  sportIcons?: boolean;
}) {
  return (
    <div className="min-w-0">
      <Label className="block text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {sportIcons ? (
        <SportFilterSelect
          value={value}
          onValueChange={onChange}
          options={options.filter((option) => option !== "all")}
          allLabel={allLabel}
          className="h-9 w-full"
        />
      ) : (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="h-9 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {option === "all" ? allLabel : option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function ChartCard({
  title,
  rows,
  suffix,
  diverging = false,
  accent = "blue",
}: {
  title: string;
  rows: BarRow[];
  suffix: string;
  diverging?: boolean;
  accent?: KpiTone;
}) {
  const colors = toneClasses[accent];
  return (
    <Card className="overflow-hidden border-border/70 bg-card/85">
      <CardHeader className="border-b border-border/60 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-[0.12em] text-primary">
          <span className={`h-2 w-2 rounded-full ${colors.bar}`} />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="min-h-64 p-4">
        {rows.length ? (
          <div className="space-y-3">
            {rows.slice(0, 10).map((row) => (
              <div key={row.label} className="space-y-1">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate text-foreground/85">{row.label}</span>
                  <span
                    className={
                      row.value > 0
                        ? "text-success"
                        : row.value < 0
                          ? "text-destructive"
                          : "text-muted-foreground"
                    }
                  >
                    {row.value.toFixed(1)}
                    {suffix}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted/80">
                  <div
                    className={
                      diverging
                        ? row.value >= 0
                          ? "h-1.5 rounded-full bg-success shadow-[0_0_10px_hsl(var(--success)/0.35)]"
                          : "h-1.5 rounded-full bg-destructive shadow-[0_0_10px_hsl(var(--destructive)/0.35)]"
                        : `h-1.5 rounded-full ${colors.bar}`
                    }
                    style={{ width: `${Math.max(4, Math.min(100, row.percent))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyChart />
        )}
      </CardContent>
    </Card>
  );
}

interface BarRow {
  label: string;
  value: number;
  percent: number;
}

function learningTrendByDay(rows: LearningRow[]): TrendRow[] {
  const map = new Map<
    string,
    { local: { ok: number; total: number }; online: { ok: number; total: number } }
  >();
  for (const row of rows) {
    if (row.acertou_ia == null || !row.created_at) continue;
    const date = row.created_at.slice(0, 10);
    const mode = row.modo_ia === "online" ? "online" : row.modo_ia === "local" ? "local" : null;
    if (!mode) continue;
    const current = map.get(date) ?? {
      local: { ok: 0, total: 0 },
      online: { ok: 0, total: 0 },
    };
    current[mode].total += 1;
    if (row.acertou_ia) current[mode].ok += 1;
    map.set(date, current);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([date, value]) => ({
      date,
      label: new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(
        new Date(`${date}T12:00:00`),
      ),
      local: value.local.total ? (value.local.ok / value.local.total) * 100 : null,
      online: value.online.total ? (value.online.ok / value.online.total) * 100 : null,
    }));
}

function formatMemoryDate(value: string | null | undefined): string {
  if (!value) return "Data não informada";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function rateBy(rows: LearningRow[], field: keyof LearningRow): BarRow[] {
  const map = new Map<string, { ok: number; total: number }>();
  for (const row of rows) {
    const key = String(row[field] ?? "Sem dado");
    const current = map.get(key) ?? { ok: 0, total: 0 };
    if (row.acertou_ia != null) {
      current.total += 1;
      if (row.acertou_ia) current.ok += 1;
    }
    map.set(key, current);
  }
  return [...map.entries()]
    .filter(([, value]) => value.total > 0)
    .map(([label, value]) => ({
      label,
      value: value.total ? (value.ok / value.total) * 100 : 0,
      percent: value.total ? (value.ok / value.total) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);
}

function sumBy(
  rows: LearningRow[],
  field: keyof LearningRow,
  sumField: keyof LearningRow,
): BarRow[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = String(row[field] ?? "Sem dado");
    map.set(key, (map.get(key) ?? 0) + Number(row[sumField] ?? 0));
  }
  const max = Math.max(1, ...[...map.values()].map((v) => Math.abs(v)));
  return [...map.entries()]
    .map(([label, value]) => ({ label, value, percent: (Math.abs(value) / max) * 100 }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

function sumFinancialBy(rows: LearningRow[], field: keyof LearningRow): BarRow[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = String(row[field] ?? "Sem dado");
    map.set(key, (map.get(key) ?? 0) + getFinancialUnits(row));
  }
  const max = Math.max(1, ...[...map.values()].map((v) => Math.abs(v)));
  return [...map.entries()]
    .map(([label, value]) => ({ label, value, percent: (Math.abs(value) / max) * 100 }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

function tagsByRed(rows: LearningRow[]): BarRow[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (getOutcome(row) !== "RED") continue;
    for (const tag of row.tags_risco ?? []) map.set(tag, (map.get(tag) ?? 0) + 1);
  }
  const max = Math.max(1, ...map.values());
  return [...map.entries()]
    .map(([label, value]) => ({ label, value, percent: (value / max) * 100 }))
    .sort((a, b) => b.value - a.value);
}

function getOutcome(row: LearningRow): string | null {
  return normalizeOutcome(row.resultado_teorico ?? row.resultado_real);
}

function getFinancialUnits(row: LearningRow): number {
  return Number(
    row.lucro_financeiro_unidades ?? (row.conta_bankroll === false ? 0 : (row.lucro_unidades ?? 0)),
  );
}

function getTheoreticalUnits(row: LearningRow): number {
  return Number(row.lucro_teorico_unidades ?? row.lucro_unidades ?? 0);
}

function normalizeOutcome(resultado: string | null | undefined): "GREEN" | "RED" | null {
  const value = String(resultado ?? "")
    .toUpperCase()
    .trim();
  if (["GREEN", "WIN", "WINS"].includes(value)) return "GREEN";
  if (["RED", "LOSS", "LOSSES"].includes(value)) return "RED";
  return null;
}

function latestByCreatedAt<T extends { created_at?: string | null }>(rows: T[]): T | null {
  if (!rows.length) return null;
  return (
    [...rows].sort((a, b) =>
      String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
    )[0] ?? null
  );
}

function dedupeLearningRows(rows: LearningRow[]): LearningRow[] {
  const sorted = [...rows].sort((a, b) =>
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
  );
  const seen = new Set<string>();
  return sorted.filter((row) => {
    const key = row.prognostico_id ?? row.analise_ia_id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function decisionHit(
  decision: "CONFIRMAR" | "PULAR" | null,
  resultado: "GREEN" | "RED",
): boolean | null {
  if (decision === "CONFIRMAR") return resultado === "GREEN";
  if (decision === "PULAR") return resultado === "RED";
  return null;
}

function extractTagsFromLegacyText(text: string | null | undefined): string[] {
  const value = String(text ?? "").toLowerCase();
  const tags: string[] = [];
  const checks: Array<[string, RegExp]> = [
    ["info_ausente", /não encontrado|nao encontrado|ausente|incert|não confirmad|nao confirmad/],
    [
      "risco_estrutural",
      /risco estrutural|lineup|escalação|escalacao|rotação|rotacao|desfalque|lesão|lesao|questionável|questionavel/,
    ],
    [
      "fonte_fraca",
      /fonte insuficiente|fonte fraca|sem fonte|desatualizad|notícia antiga|noticia antiga/,
    ],
    ["duplicidade", /duplicidade|correlaç|correlac|redundan/],
    ["volatilidade", /volátil|volatil|variância|variancia|mercado volátil|mercado volatil/],
    ["clima", /clima|vento|chuva|temperatura|weather/],
  ];
  for (const [tag, pattern] of checks) {
    if (pattern.test(value)) tags.push(tag);
  }
  return tags;
}
