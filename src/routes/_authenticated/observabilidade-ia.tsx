import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Bot,
  Braces,
  Clock3,
  DatabaseZap,
  Gauge,
  RefreshCw,
  ShieldAlert,
  Split,
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
import { StatCard } from "@/components/stat-card";
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  allLabel: string;
}) {
  return (
    <div className="flex min-w-44 flex-col">
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</label>
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
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Carregando métricas">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="h-28 animate-pulse rounded-lg border bg-muted/20" />
      ))}
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

  return (
    <div className="page-stack min-w-0 overflow-x-hidden">
      <header className="page-header border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="size-5 text-primary" aria-hidden="true" />
            <h1 className="page-title">Observabilidade da IA</h1>
          </div>
          <p className="page-description">
            Saúde estrutural, arbitragem determinística, custo, latência e feedback humano das
            validações. Este painel é analítico e não altera prognósticos.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => observabilityQuery.refetch()}
          disabled={observabilityQuery.isFetching}
        >
          <RefreshCw
            className={cn("size-4", observabilityQuery.isFetching && "animate-spin")}
            aria-hidden="true"
          />
          Atualizar
        </Button>
      </header>

      <section className="rounded-lg border bg-card p-4" aria-label="Filtros de observabilidade">
        <div className="flex flex-wrap items-end gap-3">
          <PeriodFilter
            periodo={periodo}
            onPeriodoChange={setPeriodo}
            customIni={customIni}
            customFim={customFim}
            onCustomIniChange={setCustomIni}
            onCustomFimChange={setCustomFim}
          />
          <FilterSelect
            label="Esporte"
            value={sport}
            onChange={setSport}
            options={sports}
            allLabel="Todos os esportes"
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
      </section>

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
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Cobertura da telemetria"
              value={formatPercent(summary.telemetryCoverageRate)}
              delta={`${summary.instrumentedRuns.toLocaleString("pt-BR")} de ${summary.totalRuns.toLocaleString("pt-BR")} runs`}
              trend={
                summary.telemetryCoverageRate != null && summary.telemetryCoverageRate >= 99
                  ? "up"
                  : "neutral"
              }
              icon={Gauge}
            />
            <StatCard
              label="Schema válido"
              value={formatPercent(summary.validSchemaRate)}
              delta={`${summary.failedSchemaRuns.toLocaleString("pt-BR")} falhas/rollbacks`}
              trend={
                summary.validSchemaRate == null
                  ? "neutral"
                  : summary.validSchemaRate >= 99
                    ? "up"
                    : "down"
              }
              icon={Braces}
            />
            <StatCard
              label="Bloqueios do árbitro"
              value={summary.arbiterBlockedConfirmations.toLocaleString("pt-BR")}
              delta="CONFIRMA da IA convertido em PULAR"
              trend="neutral"
              icon={ShieldAlert}
            />
            <StatCard
              label="Divergência IA × humano"
              value={formatPercent(summary.divergenceRate)}
              delta={`Amostra: ${summary.feedbackSample.toLocaleString("pt-BR")}`}
              trend="neutral"
              icon={Split}
            />
            <StatCard
              label="Latência média"
              value={formatLatency(summary.averageLatencyMs)}
              delta={`p95 ${formatLatency(summary.p95LatencyMs)}`}
              trend="neutral"
              icon={Clock3}
            />
            <StatCard
              label="Taxa de erro"
              value={formatPercent(summary.errorRate)}
              delta={`Reparo: ${formatPercent(summary.repairRate)}`}
              trend={summary.errorRate != null && summary.errorRate > 1 ? "down" : "neutral"}
              icon={AlertTriangle}
            />
            <StatCard
              label="Tokens consumidos"
              value={summary.totalTokens.toLocaleString("pt-BR")}
              delta={`Média ${formatInteger(summary.averageTokens)} por run informado`}
              trend="neutral"
              icon={Bot}
            />
            <StatCard
              label="Fontes no modo online"
              value={formatPercent(summary.onlineSourceCoverageRate)}
              delta={`${summary.onlineRunsWithSources}/${summary.onlineRuns} runs · média ${summary.averageSourcesPerOnlineRun?.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) ?? "—"} fontes`}
              trend="neutral"
              icon={DatabaseZap}
            />
          </div>

          <Alert>
            <DatabaseZap />
            <AlertTitle>Escopo das fontes online</AlertTitle>
            <AlertDescription>
              A Fase 4A mede buscas, páginas e quantidade de fontes. Atualidade temporal por fonte
              ainda não possui campo estruturado; portanto o painel não infere frescor a partir do
              texto do parecer.
            </AlertDescription>
          </Alert>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,0.6fr)]">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle className="text-sm">Execuções e saúde estrutural por dia</CardTitle>
              </CardHeader>
              <CardContent>
                {dashboard.daily.length ? (
                  <div className="h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={dashboard.daily}
                        margin={{ top: 8, right: 12, bottom: 4, left: -18 }}
                        accessibilityLayer
                      >
                        <CartesianGrid stroke={COLOR_GRID} strokeDasharray="3 3" />
                        <XAxis
                          dataKey="date"
                          tickFormatter={formatChartDate}
                          stroke={COLOR_AXIS}
                          fontSize={11}
                        />
                        <YAxis allowDecimals={false} stroke={COLOR_AXIS} fontSize={11} />
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
                          fill={COLOR_NEUTRAL}
                          radius={[3, 3, 0, 0]}
                        />
                        <Line
                          dataKey="valid"
                          name="valid"
                          stroke={COLOR_POS}
                          strokeWidth={2}
                          dot={false}
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
                  <p className="py-20 text-center text-xs text-muted-foreground">
                    Nenhuma execução instrumentada no período.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Principais motivos de bloqueio</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {dashboard.blockers.slice(0, 10).map((blocker) => (
                  <div
                    key={blocker.code}
                    className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0"
                  >
                    <code className="min-w-0 truncate text-[11px]" title={blocker.code}>
                      {blocker.code}
                    </code>
                    <Badge variant="outline">{blocker.count}</Badge>
                  </div>
                ))}
                {!dashboard.blockers.length ? (
                  <p className="py-16 text-center text-xs text-muted-foreground">
                    Nenhum código de bloqueio registrado.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle className="text-sm">
                Comparativo por modelo, prompt, modo, esporte e rollout
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
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
                    <TableRow key={row.key}>
                      <TableCell className="max-w-80">
                        <p className="truncate text-xs font-medium" title={row.modelId}>
                          {row.modelId}
                        </p>
                        <p
                          className="mt-1 truncate font-mono text-[10px] text-muted-foreground"
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
                      <TableCell className="text-right font-mono">
                        {formatPercent(row.validSchemaRate)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPercent(row.errorRate)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatLatency(row.p95LatencyMs)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatInteger(row.averageTokens)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPercent(row.divergenceRate)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        <span className="text-success">{row.greens}</span>
                        <span className="text-muted-foreground">/</span>
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

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Falhas estruturadas recentes</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
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
                    <TableRow key={failure.runId}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {formatDateTime(failure.createdAt)}
                      </TableCell>
                      <TableCell>
                        <code className="text-[10px]" title={failure.runId}>
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
                        >
                          {failure.parseStatus}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <code className="text-[10px]">{failure.errorCode}</code>
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
        </>
      ) : null}
    </div>
  );
}
