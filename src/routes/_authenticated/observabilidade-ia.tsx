import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Bot,
  Braces,
  Clock3,
  Cpu,
  DatabaseZap,
  Eye,
  Gauge,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  SlidersHorizontal,
  Split,
  Zap,
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PeriodFilter } from "@/components/period-filter";
import { SportFilterSelect } from "@/components/sport-filter-select";
import { ChartTooltip } from "@/components/chart-tooltip";
import {
  buildAiObservabilityDashboard,
  type AiObservabilityFeedback,
  type AiObservabilityRun,
} from "@/lib/ai-validation/observability-dashboard";
import { COLOR_AXIS, COLOR_GRID, COLOR_NEG, COLOR_NEUTRAL, COLOR_POS } from "@/lib/chart-colors";
import { rangeFromPeriodo, type PeriodoFiltro } from "@/lib/metrics";
import { supabase } from "@/lib/supabase-public";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/observabilidade-ia")({
  component: AiObservabilityPage,
});

const QUERY_LIMIT = 5_000;
const RUN_COLUMNS =
  "id, run_id, created_at, modo_ia, esporte, liga, prompt_versao, schema_version, arbiter_version, provider, model_id, latency_ms, finish_reason, total_tokens, parse_status, error_code, model_decision, final_decision, blocking_codes, repair_attempted, rollout_stage, rollout_variant, rollout_reason, search_count, scrape_count, source_count";
const FEEDBACK_COLUMNS =
  "analise_ia_id, modo_ia, esporte, decisao_ia_sugerida, decisao_humana_final, divergencia_ia_humano, resultado_teorico, stake_ia_sugerida, lucro_teorico_unidades, acertou_ia, created_at";
const EMPTY_RUNS: AiObservabilityRun[] = [];
const EMPTY_FEEDBACK: AiObservabilityFeedback[] = [];

function formatPercent(value: number | null, digits = 1) {
  return value == null
    ? "—"
    : `${value.toLocaleString("pt-BR", { maximumFractionDigits: digits })}%`;
}

function formatInteger(value: number | null) {
  return value == null ? "—" : Math.round(value).toLocaleString("pt-BR");
}

function formatLatency(value: number | null) {
  if (value == null) return "—";
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

function formatChartDate(value: string) {
  const [, month, day] = value.split("-");
  return `${day}/${month}`;
}

function uniqueOptions(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))].sort(
    (left, right) => left.localeCompare(right, "pt-BR"),
  );
}

async function fetchObservabilityRows(ini: string | null, fim: string | null) {
  let runsQuery = supabase
    .from("analises_ia")
    .select(RUN_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(QUERY_LIMIT);
  const feedbackQuery = supabase
    .from("feedback_ia_resultados")
    .select(FEEDBACK_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(QUERY_LIMIT);

  if (ini) {
    const start = `${ini}T00:00:00.000-03:00`;
    runsQuery = runsQuery.gte("created_at", start);
  }
  if (fim) {
    const end = `${fim}T23:59:59.999-03:00`;
    runsQuery = runsQuery.lte("created_at", end);
  }

  const [runsResult, feedbackResult] = await Promise.all([runsQuery, feedbackQuery]);
  if (runsResult.error) throw runsResult.error;
  if (feedbackResult.error) throw feedbackResult.error;

  return {
    runs: (runsResult.data ?? []) as AiObservabilityRun[],
    feedback: (feedbackResult.data ?? []) as AiObservabilityFeedback[],
    reachedLimit:
      (runsResult.data?.length ?? 0) === QUERY_LIMIT ||
      (feedbackResult.data?.length ?? 0) === QUERY_LIMIT,
  };
}

function FilterSelect({
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
    <div className="flex min-w-44 flex-col">
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</label>
      {sportIcons ? (
        <SportFilterSelect
          value={value}
          onValueChange={onChange}
          options={options}
          allLabel={allLabel}
          className="h-9"
          ariaLabel={label}
        />
      ) : (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="h-9" aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{allLabel}</SelectItem>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8"
      aria-label="Carregando métricas"
    >
      {Array.from({ length: 8 }, (_, index) => (
        <div
          key={index}
          className="h-36 animate-pulse rounded-xl border border-border/70 bg-muted/20"
        />
      ))}
    </div>
  );
}

type TelemetryTone = "blue" | "green" | "violet" | "amber" | "red" | "cyan";

const telemetryTone: Record<
  TelemetryTone,
  { icon: string; glow: string; line: string; value: string }
> = {
  blue: {
    icon: "border-primary/35 bg-primary/12 text-primary",
    glow: "from-primary/16",
    line: "bg-primary",
    value: "text-foreground",
  },
  green: {
    icon: "border-success/35 bg-success/12 text-success",
    glow: "from-success/16",
    line: "bg-success",
    value: "text-success",
  },
  violet: {
    icon: "border-violet-400/35 bg-violet-500/12 text-violet-300",
    glow: "from-violet-500/16",
    line: "bg-violet-400",
    value: "text-violet-200",
  },
  amber: {
    icon: "border-amber-400/35 bg-amber-500/12 text-amber-300",
    glow: "from-amber-500/16",
    line: "bg-amber-400",
    value: "text-amber-200",
  },
  red: {
    icon: "border-destructive/35 bg-destructive/12 text-destructive",
    glow: "from-destructive/16",
    line: "bg-destructive",
    value: "text-destructive",
  },
  cyan: {
    icon: "border-cyan-400/35 bg-cyan-500/12 text-cyan-300",
    glow: "from-cyan-500/16",
    line: "bg-cyan-400",
    value: "text-cyan-200",
  },
};

function TelemetryCard({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Activity;
  tone: TelemetryTone;
}) {
  const colors = telemetryTone[tone];
  return (
    <article className="group relative min-w-0 overflow-hidden rounded-xl border border-border/75 bg-card/85 p-4 shadow-[0_16px_42px_-34px_hsl(var(--primary)/0.7)] transition-colors hover:border-primary/35">
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent opacity-70",
          colors.glow,
        )}
      />
      <div className={cn("absolute inset-x-0 top-0 h-0.5 opacity-80", colors.line)} />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <p className="min-h-8 text-[10px] font-semibold uppercase leading-4 tracking-[0.12em] text-muted-foreground">
            {label}
          </p>
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border shadow-[inset_0_0_18px_currentColor]",
              colors.icon,
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        </div>
        <p
          className={cn(
            "mt-3 truncate font-mono text-2xl font-semibold tracking-tight",
            colors.value,
          )}
          title={value}
        >
          {value}
        </p>
        <p className="mt-2 line-clamp-2 min-h-8 text-[10px] leading-4 text-muted-foreground">
          {detail}
        </p>
      </div>
    </article>
  );
}

function PanelTitle({
  icon: Icon,
  title,
  detail,
}: {
  icon: typeof Activity;
  title: string;
  detail?: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <CardTitle className="text-sm font-semibold tracking-tight">{title}</CardTitle>
        {detail ? <p className="mt-1 text-[10px] text-muted-foreground">{detail}</p> : null}
      </div>
    </div>
  );
}

function AiObservabilityPage() {
  const [periodo, setPeriodo] = useState<PeriodoFiltro>("30d");
  const [customIni, setCustomIni] = useState("");
  const [customFim, setCustomFim] = useState("");
  const [sport, setSport] = useState("all");
  const [mode, setMode] = useState("all");
  const [model, setModel] = useState("all");
  const [rollout, setRollout] = useState("all");
  const { ini, fim } = rangeFromPeriodo(periodo, customIni, customFim);

  const observabilityQuery = useQuery({
    queryKey: ["ai-validation-observability", ini, fim],
    queryFn: () => fetchObservabilityRows(ini, fim),
    staleTime: 30_000,
    retry: 1,
  });

  const periodRuns = observabilityQuery.data?.runs ?? EMPTY_RUNS;
  const periodFeedback = observabilityQuery.data?.feedback ?? EMPTY_FEEDBACK;
  const sports = useMemo(() => uniqueOptions(periodRuns.map((run) => run.esporte)), [periodRuns]);
  const modes = useMemo(() => uniqueOptions(periodRuns.map((run) => run.modo_ia)), [periodRuns]);
  const models = useMemo(() => uniqueOptions(periodRuns.map((run) => run.model_id)), [periodRuns]);
  const rollouts = useMemo(
    () => uniqueOptions(periodRuns.map((run) => run.rollout_stage)),
    [periodRuns],
  );

  const filteredRuns = useMemo(
    () =>
      periodRuns.filter((run) => {
        if (sport !== "all" && run.esporte !== sport) return false;
        if (mode !== "all" && run.modo_ia !== mode) return false;
        if (model !== "all" && run.model_id !== model) return false;
        if (rollout !== "all" && run.rollout_stage !== rollout) return false;
        return true;
      }),
    [periodRuns, sport, mode, model, rollout],
  );
  const filteredFeedback = useMemo(() => {
    const analysisIds = new Set(filteredRuns.map((run) => run.id));
    return periodFeedback.filter(
      (row) => row.analise_ia_id != null && analysisIds.has(row.analise_ia_id),
    );
  }, [periodFeedback, filteredRuns]);
  const dashboard = useMemo(
    () => buildAiObservabilityDashboard(filteredRuns, filteredFeedback),
    [filteredRuns, filteredFeedback],
  );
  const summary = dashboard.summary;
  const totalBlockers = dashboard.blockers.reduce((sum, blocker) => sum + blocker.count, 0);
  const resetFilters = () => {
    setPeriodo("30d");
    setCustomIni("");
    setCustomFim("");
    setSport("all");
    setMode("all");
    setModel("all");
    setRollout("all");
  };

  return (
    <div className="page-stack min-w-0 overflow-x-hidden pb-8">
      <section className="relative overflow-hidden rounded-2xl border border-primary/20 bg-[radial-gradient(circle_at_88%_18%,hsl(var(--primary)/0.25),transparent_32%),radial-gradient(circle_at_12%_100%,hsl(var(--success)/0.08),transparent_28%),linear-gradient(135deg,hsl(var(--card)),hsl(var(--background)))] px-5 py-6 shadow-[0_18px_60px_-30px_hsl(var(--primary)/0.58)] sm:px-7">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full border border-primary/20 bg-primary/5 blur-sm" />
        <div className="pointer-events-none absolute right-20 top-8 h-2 w-2 rounded-full bg-primary shadow-[0_0_22px_6px_hsl(var(--primary)/0.5)]" />
        <div className="pointer-events-none absolute bottom-5 right-48 hidden h-px w-32 bg-gradient-to-r from-transparent via-success/70 to-transparent md:block" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-primary/35 bg-primary/10 shadow-[inset_0_0_24px_hsl(var(--primary)/0.14)] sm:flex">
              <Eye className="h-8 w-8 text-primary" aria-hidden="true" />
            </div>
            <div className="max-w-3xl">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-success">
                  <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_10px_hsl(var(--success))]" />
                  Telemetria ativa
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-300">
                  <ShieldAlert className="h-3 w-3" />
                  Árbitro monitorado
                </span>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                Observabilidade da IA
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Saúde estrutural, arbitragem determinística, custo, latência e feedback humano das
                validações. Este painel é analítico e não altera prognósticos.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            className="border-primary/25 bg-background/45 backdrop-blur hover:bg-primary/10"
            onClick={() => observabilityQuery.refetch()}
            disabled={observabilityQuery.isFetching}
          >
            <RefreshCw
              className={cn("size-4", observabilityQuery.isFetching && "animate-spin")}
              aria-hidden="true"
            />
            Atualizar
          </Button>
        </div>
      </section>

      <Card className="border-border/70 bg-card/75 shadow-sm backdrop-blur">
        <CardContent className="p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
              Recorte operacional
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 text-[10px] text-muted-foreground hover:text-primary"
              onClick={resetFilters}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Limpar filtros
            </Button>
          </div>
          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <PeriodFilter
              periodo={periodo}
              onPeriodoChange={setPeriodo}
              customIni={customIni}
              customFim={customFim}
              onCustomIniChange={setCustomIni}
              onCustomFimChange={setCustomFim}
              className={`${periodo === "custom" ? "sm:col-span-2 xl:col-span-2" : ""} w-full [&>div]:!w-full`}
            />
            <FilterSelect
              label="Esporte"
              value={sport}
              onChange={setSport}
              options={sports}
              allLabel="Todos os esportes"
              sportIcons
            />
            <FilterSelect
              label="Modo"
              value={mode}
              onChange={setMode}
              options={modes}
              allLabel="Todos os modos"
            />
            <FilterSelect
              label="Modelo"
              value={model}
              onChange={setModel}
              options={models}
              allLabel="Todos os modelos"
            />
            <FilterSelect
              label="Rollout"
              value={rollout}
              onChange={setRollout}
              options={rollouts}
              allLabel="Todos os estágios"
            />
          </div>
        </CardContent>
      </Card>

      {observabilityQuery.error ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Não foi possível carregar a observabilidade</AlertTitle>
          <AlertDescription>{observabilityQuery.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {observabilityQuery.data?.reachedLimit ? (
        <Alert>
          <DatabaseZap />
          <AlertTitle>Limite analítico atingido</AlertTitle>
          <AlertDescription>
            A consulta alcançou {QUERY_LIMIT.toLocaleString("pt-BR")} registros. Reduza o período
            para manter as métricas completas.
          </AlertDescription>
        </Alert>
      ) : null}

      {observabilityQuery.isLoading ? <DashboardSkeleton /> : null}
      {!observabilityQuery.isLoading && !observabilityQuery.error ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
            <TelemetryCard
              label="Cobertura da telemetria"
              value={formatPercent(summary.telemetryCoverageRate)}
              detail={`${summary.instrumentedRuns.toLocaleString("pt-BR")} de ${summary.totalRuns.toLocaleString("pt-BR")} runs`}
              icon={Gauge}
              tone="blue"
            />
            <TelemetryCard
              label="Schema válido"
              value={formatPercent(summary.validSchemaRate)}
              detail={`${summary.failedSchemaRuns.toLocaleString("pt-BR")} falhas ou rollbacks`}
              icon={Braces}
              tone={
                summary.validSchemaRate != null && summary.validSchemaRate >= 99 ? "green" : "amber"
              }
            />
            <TelemetryCard
              label="Bloqueios do árbitro"
              value={summary.arbiterBlockedConfirmations.toLocaleString("pt-BR")}
              detail="CONFIRMA da IA convertido em PULAR"
              icon={ShieldAlert}
              tone="violet"
            />
            <TelemetryCard
              label="Divergência IA × humano"
              value={formatPercent(summary.divergenceRate)}
              detail={`Amostra de ${summary.feedbackSample.toLocaleString("pt-BR")} decisões`}
              icon={Split}
              tone="amber"
            />
            <TelemetryCard
              label="Latência média / p95"
              value={`${formatLatency(summary.averageLatencyMs)} / ${formatLatency(summary.p95LatencyMs)}`}
              detail="Tempo observado por validação"
              icon={Clock3}
              tone="blue"
            />
            <TelemetryCard
              label="Erro / reparo"
              value={`${formatPercent(summary.errorRate)} / ${formatPercent(summary.repairRate)}`}
              detail="Falhas estruturadas e tentativas de reparo"
              icon={AlertTriangle}
              tone={summary.errorRate != null && summary.errorRate > 1 ? "red" : "green"}
            />
            <TelemetryCard
              label="Tokens consumidos"
              value={summary.totalTokens.toLocaleString("pt-BR")}
              detail={`Média ${formatInteger(summary.averageTokens)} por run informado`}
              icon={Bot}
              tone="cyan"
            />
            <TelemetryCard
              label="Fontes no modo online"
              value={formatPercent(summary.onlineSourceCoverageRate)}
              detail={`${summary.onlineRunsWithSources}/${summary.onlineRuns} runs · média ${summary.averageSourcesPerOnlineRun?.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) ?? "—"} fontes`}
              icon={DatabaseZap}
              tone="green"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(330px,0.55fr)]">
            <Card className="relative min-w-0 overflow-hidden border-border/75 bg-card/85">
              <div className="pointer-events-none absolute right-10 top-8 h-2 w-2 rounded-full bg-success shadow-[0_0_16px_4px_hsl(var(--success)/0.35)]" />
              <CardHeader className="border-b border-border/60 pb-3">
                <PanelTitle
                  icon={Activity}
                  title="Execuções e saúde estrutural por dia"
                  detail="Volume, conformidade, falhas e interferências do árbitro"
                />
              </CardHeader>
              <CardContent className="p-3 sm:p-5">
                {dashboard.daily.length ? (
                  <div className="h-80 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={dashboard.daily}
                        margin={{ top: 12, right: 12, bottom: 4, left: -18 }}
                        accessibilityLayer
                      >
                        <defs>
                          <linearGradient id="observabilityRuns" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={COLOR_NEUTRAL} stopOpacity={0.9} />
                            <stop offset="100%" stopColor={COLOR_NEUTRAL} stopOpacity={0.18} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke={COLOR_GRID} strokeDasharray="3 5" vertical={false} />
                        <XAxis
                          dataKey="date"
                          tickFormatter={formatChartDate}
                          stroke={COLOR_AXIS}
                          fontSize={10}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          allowDecimals={false}
                          stroke={COLOR_AXIS}
                          fontSize={10}
                          tickLine={false}
                          axisLine={false}
                        />
                        <Tooltip
                          content={
                            <ChartTooltip
                              headerFormatter={formatChartDate}
                              formatter={(value, name) => ({
                                label:
                                  name === "runs"
                                    ? "Runs"
                                    : name === "valid"
                                      ? "Schema válido"
                                      : name === "errors"
                                        ? "Erros"
                                        : "Bloqueios",
                                display: value.toLocaleString("pt-BR"),
                                color:
                                  name === "valid"
                                    ? COLOR_POS
                                    : name === "errors"
                                      ? COLOR_NEG
                                      : COLOR_NEUTRAL,
                              })}
                            />
                          }
                        />
                        <Bar
                          dataKey="runs"
                          name="runs"
                          fill="url(#observabilityRuns)"
                          radius={[4, 4, 0, 0]}
                        />
                        <Line
                          dataKey="valid"
                          name="valid"
                          stroke={COLOR_POS}
                          strokeWidth={2.5}
                          dot={{ r: 2, fill: COLOR_POS }}
                          activeDot={{ r: 4 }}
                        />
                        <Line
                          dataKey="errors"
                          name="errors"
                          stroke={COLOR_NEG}
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          dataKey="blocked"
                          name="blocked"
                          stroke={COLOR_AXIS}
                          strokeWidth={2}
                          strokeDasharray="4 3"
                          dot={false}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="py-24 text-center text-xs text-muted-foreground">
                    Nenhuma execução instrumentada no período.
                  </p>
                )}
                <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border/60 bg-border/60 sm:grid-cols-4">
                  {[
                    ["Runs", summary.instrumentedRuns.toLocaleString("pt-BR")],
                    ["Schema válido", formatPercent(summary.validSchemaRate)],
                    ["Falhas", summary.failedSchemaRuns.toLocaleString("pt-BR")],
                    ["Bloqueios", summary.arbiterBlockedConfirmations.toLocaleString("pt-BR")],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-background/70 px-3 py-2.5 text-center">
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
                        {label}
                      </p>
                      <p className="mt-1 font-mono text-sm font-semibold text-foreground">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden border-border/75 bg-card/85">
              <CardHeader className="border-b border-border/60 pb-3">
                <PanelTitle
                  icon={Zap}
                  title="Principais motivos de bloqueio"
                  detail={`${totalBlockers.toLocaleString("pt-BR")} ocorrências classificadas`}
                />
              </CardHeader>
              <CardContent className="p-4">
                {dashboard.blockers.length ? (
                  <div className="space-y-3">
                    {dashboard.blockers.slice(0, 10).map((blocker, index) => {
                      const share = totalBlockers ? (blocker.count / totalBlockers) * 100 : 0;
                      return (
                        <div key={blocker.code} className="group">
                          <div className="mb-1.5 flex items-center gap-2">
                            <span className="w-4 font-mono text-[9px] text-muted-foreground">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <code
                              className="min-w-0 flex-1 truncate text-[10px] text-foreground/85"
                              title={blocker.code}
                            >
                              {blocker.code}
                            </code>
                            <span className="font-mono text-[10px] text-amber-300">
                              {blocker.count}
                            </span>
                          </div>
                          <div className="ml-6 h-1.5 overflow-hidden rounded-full bg-muted/70">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-primary to-cyan-400 shadow-[0_0_9px_hsl(var(--primary)/0.35)]"
                              style={{ width: `${Math.max(3, share)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="py-24 text-center text-xs text-muted-foreground">
                    Nenhum código de bloqueio registrado.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="min-w-0 overflow-hidden border-border/75 bg-card/85">
            <CardHeader className="border-b border-border/60 pb-3">
              <PanelTitle
                icon={Cpu}
                title="Comparativo por modelo, prompt, modo, esporte e rollout"
                detail={`${dashboard.dimensions.length.toLocaleString("pt-BR")} combinações instrumentadas`}
              />
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table className="min-w-[1050px]">
                <TableHeader className="bg-muted/25">
                  <TableRow>
                    <TableHead>Modelo / prompt</TableHead>
                    <TableHead>Modo / esporte</TableHead>
                    <TableHead className="text-right">Runs</TableHead>
                    <TableHead className="text-right">Schema</TableHead>
                    <TableHead className="text-right">Erro</TableHead>
                    <TableHead className="text-right">p95</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">Divergência</TableHead>
                    <TableHead className="text-right">GREEN/RED</TableHead>
                    <TableHead className="text-right">ROI teórico</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.dimensions.map((row) => (
                    <TableRow key={row.key} className="hover:bg-primary/[0.035]">
                      <TableCell className="max-w-80 border-l-2 border-l-primary/35">
                        <p className="truncate text-xs font-medium" title={row.modelId}>
                          {row.modelId}
                        </p>
                        <p
                          className="mt-1 truncate font-mono text-[10px] text-primary/75"
                          title={row.promptVersion}
                        >
                          {row.promptVersion}
                        </p>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs">{row.mode}</p>
                        <p className="text-[10px] text-muted-foreground">{row.sport}</p>
                        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                          {row.rolloutStage} / {row.rolloutVariant}
                        </p>
                      </TableCell>
                      <TableCell className="text-right font-mono">{row.runs}</TableCell>
                      <TableCell className="text-right font-mono text-success">
                        {formatPercent(row.validSchemaRate)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono",
                          row.errorRate != null && row.errorRate > 1
                            ? "text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        {formatPercent(row.errorRate)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatLatency(row.p95LatencyMs)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatInteger(row.averageTokens)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-amber-300">
                        {formatPercent(row.divergenceRate)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        <span className="text-success">{row.greens}</span>
                        <span className="px-0.5 text-muted-foreground">/</span>
                        <span className="text-destructive">{row.reds}</span>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono",
                          row.theoreticalRoi != null &&
                            (row.theoreticalRoi > 0
                              ? "text-success"
                              : row.theoreticalRoi < 0
                                ? "text-destructive"
                                : "text-muted-foreground"),
                        )}
                      >
                        {formatPercent(row.theoreticalRoi)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!dashboard.dimensions.length ? (
                    <TableRow>
                      <TableCell colSpan={10} className="h-24 text-center text-muted-foreground">
                        Nenhuma dimensão instrumentada para os filtros atuais.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border-border/75 bg-card/85">
            <CardHeader className="border-b border-border/60 pb-3">
              <PanelTitle
                icon={AlertTriangle}
                title="Falhas estruturadas recentes"
                detail="Ocorrências seguras para diagnóstico, sem exposição do conteúdo sensível"
              />
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table className="min-w-[780px]">
                <TableHeader className="bg-muted/25">
                  <TableRow>
                    <TableHead>Horário</TableHead>
                    <TableHead>Run ID</TableHead>
                    <TableHead>Modelo</TableHead>
                    <TableHead>Modo / esporte</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Código seguro</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.recentFailures.map((failure) => (
                    <TableRow key={failure.runId} className="hover:bg-destructive/[0.025]">
                      <TableCell className="whitespace-nowrap text-xs">
                        {formatDateTime(failure.createdAt)}
                      </TableCell>
                      <TableCell>
                        <code className="text-[10px] text-primary" title={failure.runId}>
                          {failure.runId.slice(0, 8)}
                        </code>
                      </TableCell>
                      <TableCell className="max-w-64 truncate text-xs" title={failure.modelId}>
                        {failure.modelId}
                      </TableCell>
                      <TableCell className="text-xs">
                        {failure.mode} · {failure.sport}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={failure.parseStatus === "VALID" ? "outline" : "destructive"}
                          className="font-mono text-[9px]"
                        >
                          {failure.parseStatus}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <code className="text-[10px] text-destructive">{failure.errorCode}</code>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!dashboard.recentFailures.length ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                        Nenhuma falha estruturada no período.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Alert className="border-primary/20 bg-[linear-gradient(90deg,hsl(var(--primary)/0.09),transparent)]">
            <DatabaseZap className="text-primary" />
            <AlertTitle>Escopo das fontes online</AlertTitle>
            <AlertDescription>
              A Fase 4A mede buscas, páginas e quantidade de fontes. Atualidade temporal por fonte
              ainda não possui campo estruturado; portanto o painel não infere frescor a partir do
              texto do parecer.
            </AlertDescription>
          </Alert>
        </>
      ) : null}
    </div>
  );
}
