import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  DatabaseZap,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { AmbientBackdrop, PageIntro } from "@/components/command-center";
import { SportMark } from "@/components/sport-filter-select";
import { StatCard } from "@/components/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchHighlightlyCollectionMonitor,
  type HighlightlyCollectionMonitor,
} from "@/lib/highlightly-monitor";
import { fetchHighlightlyMatchLifecycleReport } from "@/lib/highlightly-match-lifecycle";
import { fetchHighlightlyOddsQualityReport } from "@/lib/highlightly-odds-quality";
import { cn } from "@/lib/utils";
import { MatchLifecycleMonitor } from "./match-lifecycle-monitor";
import { OddsQualityMonitor } from "./odds-quality-monitor";

const SPORT_LABELS: Record<string, string> = {
  football: "Football",
  baseball: "Baseball",
  basketball: "Basketball",
  american_football: "American Football",
  hockey: "Hockey",
};

const COLLECTOR_LABELS: Record<string, string> = {
  future_window: "Partidas futuras",
  odds: "Odds",
  lifecycle: "Ciclo das partidas",
  historical: "Histórico",
  other: "Outros",
};

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function percentage(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (value / total) * 100));
}

function statusLabel(value?: string): string {
  const labels: Record<string, string> = {
    planned: "Planejada",
    running: "Em execução",
    passed: "Aprovada",
    failed: "Falhou",
    completed_with_exceptions: "Concluída com exceções",
    cancelled: "Cancelada",
    collecting: "Coletando",
    ready: "Pronta",
    blocked: "Bloqueada",
    below_sla: "Abaixo do SLA",
    historical_complete: "Histórico concluído",
    historical_complete_with_exceptions: "Histórico com exceções",
    future_slice_complete: "Fatia futura concluída",
    future_slice_complete_with_exceptions: "Fatia futura com exceções",
  };
  return labels[value ?? ""] ?? value ?? "Sem leitura";
}

function MonitorSkeleton() {
  return (
    <div className="space-y-4" aria-label="Carregando monitor da coleta">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}

function OddsQualitySkeleton() {
  return (
    <section
      className="min-h-[720px] overflow-hidden rounded-lg border border-primary/15 bg-card/90 md:min-h-[640px]"
      aria-label="Carregando qualidade e atualização das odds"
      aria-busy="true"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="space-y-2">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
        <Skeleton className="hidden h-6 w-32 sm:block" />
      </div>
      <div className="flex gap-3 border-b border-warning/20 bg-warning/[0.04] px-4 py-3">
        <Skeleton className="size-4 shrink-0 rounded-full" />
        <div className="w-full space-y-2">
          <Skeleton className="h-3 w-52" />
          <Skeleton className="h-3 w-full max-w-xl" />
        </div>
      </div>
      <div className="grid gap-px bg-border md:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="space-y-3 bg-card p-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-1.5 w-full" />
            <div className="grid grid-cols-3 gap-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          </div>
        ))}
      </div>
      <div className="hidden space-y-px border-t border-border bg-border md:block">
        {Array.from({ length: 7 }, (_, index) => (
          <div key={index} className="grid grid-cols-[0.7fr_1.5fr_0.3fr] gap-4 bg-card px-4 py-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="ml-auto h-4 w-8" />
          </div>
        ))}
      </div>
      <div className="border-t border-border px-4 py-3 md:hidden">
        <Skeleton className="h-4 w-44" />
      </div>
    </section>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "default",
  compact = false,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Activity;
  tone?: "default" | "success" | "warning";
  compact?: boolean;
}) {
  return (
    <StatCard
      label={label}
      value={value}
      meta={detail}
      icon={Icon}
      accent={tone === "success" ? "green" : tone === "warning" ? "amber" : "blue"}
      tone={tone === "success" ? "up" : tone === "warning" ? "neutral" : "off"}
      className={cn(
        "[&_div.font-mono]:text-xl sm:[&_div.font-mono]:text-2xl",
        compact && "[&_div.font-mono]:text-base sm:[&_div.font-mono]:text-lg",
      )}
    />
  );
}

function QueueSummary({ monitor }: { monitor: HighlightlyCollectionMonitor }) {
  const queue = monitor.queue;
  const usage = monitor.daily_usage;
  const slice = monitor.window.current_slice;
  const healthStatus = String(monitor.health.gate_status ?? "collecting");
  const collecting = monitor.provider_enabled || queue.running > 0;
  const openIssues = monitor.quality.reduce((sum, row) => sum + number(row.open_issues), 0);
  const quotaExhausted = usage.remaining_before_reserve <= 0;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Operação"
          value={collecting ? "COLETANDO" : "EM REPOUSO"}
          detail={
            slice?.data_start
              ? `${formatDate(slice.data_start)} até ${formatDate(slice.data_end)}`
              : "Nenhuma fatia publicada"
          }
          icon={Activity}
          tone={collecting ? "success" : "default"}
        />
        <MetricCard
          label="Fila ativa"
          value={number(queue.active).toLocaleString("pt-BR")}
          detail={`${number(queue.pending)} pendentes · ${number(queue.retry)} em retry · ${number(queue.running)} rodando`}
          icon={Clock3}
          tone={queue.dead > 0 ? "warning" : "default"}
        />
        <MetricCard
          label="Concluídos"
          value={number(queue.succeeded).toLocaleString("pt-BR")}
          detail={`${number(queue.total).toLocaleString("pt-BR")} jobs registrados no escopo`}
          icon={CheckCircle2}
          tone="success"
        />
        <MetricCard
          label="Gate operacional"
          value={statusLabel(healthStatus).toUpperCase()}
          detail={`${number(queue.dead)} jobs dead · processamento do escopo`}
          icon={ShieldCheck}
          tone={healthStatus === "ready" ? "success" : "warning"}
          compact
        />
      </div>

      <section
        className={cn(
          "overflow-hidden rounded-lg border bg-[linear-gradient(135deg,color-mix(in_oklab,var(--color-primary)_7%,var(--color-card)),var(--color-card)_75%)] p-4 shadow-[0_18px_44px_rgb(0_0_0/0.16)]",
          quotaExhausted ? "border-warning/45" : "border-primary/20",
        )}
        aria-labelledby="quota-title"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="quota-title" className="text-sm font-semibold">
              Cota diária Highlightly
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Dia UTC {formatDate(usage.request_date)} · reserva protegida de{" "}
              {usage.reserve_requests.toLocaleString("pt-BR")} chamadas
            </p>
          </div>
          <div className="flex items-center gap-2">
            {quotaExhausted ? (
              <Badge variant="outline" className="border-warning/45 text-warning">
                <AlertTriangle className="size-3" aria-hidden="true" />
                Limite atingido
              </Badge>
            ) : null}
            <p className="font-mono text-sm">
              <strong>{usage.requests_used.toLocaleString("pt-BR")}</strong>
              <span className="text-muted-foreground">
                {" "}
                / {usage.usable_ceiling.toLocaleString("pt-BR")}
              </span>
            </p>
          </div>
        </div>
        <Progress
          value={percentage(usage.requests_used, usage.usable_ceiling)}
          className="mt-3 h-2"
        />
        <p
          className={cn(
            "mt-2 text-[10px]",
            quotaExhausted ? "font-medium text-warning" : "text-muted-foreground",
          )}
        >
          {usage.remaining_before_reserve.toLocaleString("pt-BR")} chamadas disponíveis antes da
          reserva.
        </p>
        {monitor.collector_usage?.length ? (
          <div className="mt-3 grid gap-2 border-t border-border/70 pt-3 sm:grid-cols-2 xl:grid-cols-4">
            {monitor.collector_usage.map((collector) => (
              <div
                key={collector.collector}
                className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-background/35 px-3 py-2"
              >
                <span className="text-xs text-muted-foreground">
                  {COLLECTOR_LABELS[collector.collector] ?? collector.collector}
                </span>
                <strong className="font-mono text-xs">
                  {number(collector.requests_used).toLocaleString("pt-BR")}
                </strong>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </>
  );
}

export function HighlightlyCollectionMonitorView() {
  const [scope, setScope] = useState<string | null>(null);
  const monitorQuery = useQuery({
    queryKey: ["highlightly-collection-monitor", scope ?? "latest"],
    queryFn: () => fetchHighlightlyCollectionMonitor(scope),
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 1,
  });
  const oddsQualityQuery = useQuery({
    queryKey: ["highlightly-odds-quality"],
    queryFn: fetchHighlightlyOddsQualityReport,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });
  const lifecycleQuery = useQuery({
    queryKey: ["highlightly-match-lifecycle"],
    queryFn: fetchHighlightlyMatchLifecycleReport,
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 1,
  });
  const monitor = monitorQuery.data;
  const selectedScope = scope ?? monitor?.scope ?? "";

  return (
    <div className="page-stack relative isolate mx-auto min-w-0 w-full max-w-[1600px] overflow-x-hidden">
      <AmbientBackdrop />
      <PageIntro
        title="Monitor da Coleta Highlightly"
        description="Fila, fatia ativa, cota, qualidade e saúde operacional em uma única visão."
        icon={DatabaseZap}
        status={
          monitorQuery.isFetching
            ? "Atualizando telemetria"
            : monitor?.provider_enabled
              ? "Coleta em execução"
              : "Monitor operacional"
        }
        actions={
          <>
            <Select
              value={selectedScope}
              onValueChange={setScope}
              disabled={!monitor?.scopes.length}
            >
              <SelectTrigger className="w-full sm:w-[280px]" aria-label="Escopo da coleta">
                <SelectValue placeholder="Último escopo" />
              </SelectTrigger>
              <SelectContent>
                {(monitor?.scopes ?? []).map((option) => (
                  <SelectItem key={option.scope} value={option.scope}>
                    {option.kind === "lifecycle" ? "Lifecycle · " : "Janela · "}
                    {option.scope}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() => monitorQuery.refetch()}
              disabled={monitorQuery.isFetching}
            >
              <RefreshCw className={cn("size-4", monitorQuery.isFetching && "animate-spin")} />
              Atualizar
            </Button>
          </>
        }
      />

      {monitorQuery.isLoading ? <MonitorSkeleton /> : null}
      {monitorQuery.error ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Não foi possível carregar o monitor</AlertTitle>
          <AlertDescription>{monitorQuery.error.message}</AlertDescription>
        </Alert>
      ) : null}

      {monitor ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            <Badge variant={monitor.provider_enabled ? "default" : "outline"}>
              Provider{" "}
              {monitor.provider_enabled ? "ativo durante a coleta" : "desligado em repouso"}
            </Badge>
            <span>Escopo: {monitor.scope ?? "—"}</span>
            <span>·</span>
            <span>
              Dados até {formatDateTime(monitor.window.updated_at ?? monitor.generated_at)}
            </span>
            <span>·</span>
            <span>Tela atualizada {formatDateTime(monitor.generated_at)}</span>
            {monitor.daily_usage.remaining_before_reserve <= 0 ? (
              <Badge variant="outline" className="border-warning/45 text-warning">
                Cota diária esgotada
              </Badge>
            ) : null}
            {monitor.quality.reduce((sum, row) => sum + number(row.open_issues), 0) > 0 ? (
              <Badge variant="outline" className="border-warning/45 text-warning">
                {monitor.quality.reduce((sum, row) => sum + number(row.open_issues), 0)} pendências
                de dados
              </Badge>
            ) : null}
          </div>

          <QueueSummary monitor={monitor} />

          {oddsQualityQuery.isLoading ? <OddsQualitySkeleton /> : null}
          {oddsQualityQuery.data ? <OddsQualityMonitor report={oddsQualityQuery.data} /> : null}
          {oddsQualityQuery.error ? (
            <Alert>
              <AlertTriangle />
              <AlertTitle>Diagnóstico de odds temporariamente indisponível</AlertTitle>
              <AlertDescription>{oddsQualityQuery.error.message}</AlertDescription>
            </Alert>
          ) : null}

          {lifecycleQuery.data ? <MatchLifecycleMonitor report={lifecycleQuery.data} /> : null}
          {lifecycleQuery.error ? (
            <Alert>
              <AlertTriangle />
              <AlertTitle>Ciclo das partidas temporariamente indisponível</AlertTitle>
              <AlertDescription>{lifecycleQuery.error.message}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.8fr)]">
            <section
              className="min-w-0 overflow-hidden rounded-lg border border-primary/15 bg-card/90"
              aria-labelledby="sports-title"
            >
              <div className="border-b border-border px-4 py-3">
                <h2 id="sports-title" className="text-sm font-semibold">
                  Fila por esporte
                </h2>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Esporte</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Ativos</TableHead>
                    <TableHead className="text-right">Retry</TableHead>
                    <TableHead className="text-right">Dead</TableHead>
                    <TableHead className="text-right">Concluídos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monitor.by_sport.map((row) => (
                    <TableRow key={row.sport}>
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-2">
                          <SportMark sport={SPORT_LABELS[row.sport] ?? row.sport} />
                          {SPORT_LABELS[row.sport] ?? row.sport}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono">{row.total}</TableCell>
                      <TableCell className="text-right font-mono">
                        {row.pending + row.running + row.retry}
                      </TableCell>
                      <TableCell className="text-right font-mono">{row.retry}</TableCell>
                      <TableCell
                        className={cn("text-right font-mono", row.dead > 0 && "text-warning")}
                      >
                        {row.dead}
                      </TableCell>
                      <TableCell className="text-right font-mono text-success">
                        {row.succeeded}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>

            <section
              className="min-w-0 overflow-hidden rounded-lg border border-primary/15 bg-card/90"
              aria-labelledby="dates-title"
            >
              <div className="border-b border-border px-4 py-3">
                <h2 id="dates-title" className="text-sm font-semibold">
                  Descoberta por data
                </h2>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead className="text-right">Listagens</TableHead>
                    <TableHead className="text-right">Ativas</TableHead>
                    <TableHead className="text-right">Concluídas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monitor.by_date.map((row) => (
                    <TableRow key={row.data_date}>
                      <TableCell>{formatDate(row.data_date)}</TableCell>
                      <TableCell className="text-right font-mono">{row.discovery_jobs}</TableCell>
                      <TableCell className="text-right font-mono">{row.active}</TableCell>
                      <TableCell className="text-right font-mono text-success">
                        {row.succeeded}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!monitor.by_date.length ? (
                    <TableRow>
                      <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                        Nenhuma listagem diária registrada.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </section>
          </div>

          <section
            className="min-w-0 overflow-hidden rounded-lg border border-primary/15 bg-card/90"
            aria-labelledby="endpoints-title"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 id="endpoints-title" className="text-sm font-semibold">
                Endpoints com maior fila ativa
              </h2>
              <span className="text-[10px] text-muted-foreground">Top 30</span>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Esporte</TableHead>
                    <TableHead>Endpoint</TableHead>
                    <TableHead className="text-right">Ativos</TableHead>
                    <TableHead className="text-right">Retry</TableHead>
                    <TableHead className="text-right">Dead</TableHead>
                    <TableHead className="text-right">Concluídos</TableHead>
                    <TableHead className="text-right">Atividade</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monitor.by_endpoint.map((row) => (
                    <TableRow key={`${row.sport}:${row.endpoint_key}`}>
                      <TableCell>{SPORT_LABELS[row.sport] ?? row.sport}</TableCell>
                      <TableCell
                        className="max-w-[520px] truncate font-mono text-[11px]"
                        title={row.endpoint_key}
                      >
                        {row.endpoint_key}
                      </TableCell>
                      <TableCell className="text-right font-mono">{row.active}</TableCell>
                      <TableCell className="text-right font-mono">{row.retry}</TableCell>
                      <TableCell
                        className={cn("text-right font-mono", row.dead > 0 && "text-warning")}
                      >
                        {row.dead}
                      </TableCell>
                      <TableCell className="text-right font-mono text-success">
                        {row.succeeded}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">
                        {formatDateTime(row.latest_activity_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            <section
              className="overflow-hidden rounded-lg border border-primary/15 bg-card/90"
              aria-labelledby="running-title"
            >
              <div className="border-b border-border px-4 py-3">
                <h2 id="running-title" className="text-sm font-semibold">
                  Jobs em execução
                </h2>
              </div>
              <div className="divide-y divide-border">
                {monitor.running_jobs.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-start justify-between gap-3 px-4 py-3 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono" title={job.endpoint_key}>
                        {job.endpoint_key}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {job.worker_id ?? "worker não informado"}
                      </p>
                    </div>
                    <Badge variant={job.lock_state === "expired" ? "destructive" : "outline"}>
                      {job.lock_state === "expired" ? "Expirado" : "Ativo"}
                    </Badge>
                  </div>
                ))}
                {!monitor.running_jobs.length ? (
                  <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                    Nenhum job possui lock neste instante.
                  </p>
                ) : null}
              </div>
            </section>

            <section
              className="overflow-hidden rounded-lg border border-primary/15 bg-card/90"
              aria-labelledby="errors-title"
            >
              <div className="border-b border-border px-4 py-3">
                <h2 id="errors-title" className="text-sm font-semibold">
                  Erros recentes
                </h2>
              </div>
              <div className="max-h-80 divide-y divide-border overflow-y-auto">
                {monitor.recent_errors.map((error) => (
                  <div key={error.id} className="px-4 py-3 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <p className="min-w-0 truncate font-mono" title={error.endpoint_key}>
                        {error.endpoint_key}
                      </p>
                      <Badge variant={error.status === "dead" ? "destructive" : "outline"}>
                        {error.status}
                      </Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">
                      {error.error}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Tentativa {error.attempts}/{error.max_attempts} ·{" "}
                      {formatDateTime(error.updated_at)}
                    </p>
                  </div>
                ))}
                {!monitor.recent_errors.length ? (
                  <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                    Nenhum erro recente no escopo.
                  </p>
                ) : null}
              </div>
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}
