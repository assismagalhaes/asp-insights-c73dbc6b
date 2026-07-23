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
import { fetchHighlightlyOddsQualityReport } from "@/lib/highlightly-odds-quality";
import { cn } from "@/lib/utils";
import { OddsQualityMonitor } from "./odds-quality-monitor";

const SPORT_LABELS: Record<string, string> = {
  football: "Football",
  baseball: "Baseball",
  basketball: "Basketball",
  american_football: "American Football",
  hockey: "Hockey",
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

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Activity;
  tone?: "default" | "success" | "warning";
}) {
  return (
    <article className="border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {label}
          </p>
          <p
            className={cn(
              "mt-2 font-mono text-2xl font-semibold",
              tone === "success" && "text-success",
              tone === "warning" && "text-warning",
            )}
          >
            {value}
          </p>
        </div>
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
    </article>
  );
}

function QueueSummary({ monitor }: { monitor: HighlightlyCollectionMonitor }) {
  const queue = monitor.queue;
  const usage = monitor.daily_usage;
  const slice = monitor.window.current_slice;
  const healthStatus = String(monitor.health.gate_status ?? "collecting");
  const collecting = monitor.provider_enabled || queue.running > 0;

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
          label="Gate de qualidade"
          value={statusLabel(healthStatus).toUpperCase()}
          detail={`${number(queue.dead)} jobs dead · ${monitor.quality.reduce((sum, row) => sum + number(row.open_issues), 0)} issues abertas`}
          icon={ShieldCheck}
          tone={healthStatus === "ready" ? "success" : "warning"}
        />
      </div>

      <section className="border border-border bg-card p-4" aria-labelledby="quota-title">
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
          <p className="font-mono text-sm">
            <strong>{usage.requests_used.toLocaleString("pt-BR")}</strong>
            <span className="text-muted-foreground">
              {" "}
              / {usage.usable_ceiling.toLocaleString("pt-BR")}
            </span>
          </p>
        </div>
        <Progress
          value={percentage(usage.requests_used, usage.usable_ceiling)}
          className="mt-3 h-2"
        />
        <p className="mt-2 text-[10px] text-muted-foreground">
          {usage.remaining_before_reserve.toLocaleString("pt-BR")} chamadas disponíveis antes da
          reserva.
        </p>
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
  const monitor = monitorQuery.data;
  const selectedScope = scope ?? monitor?.scope ?? "";

  return (
    <div className="mx-auto flex min-w-0 w-full max-w-[1600px] flex-col gap-4 overflow-x-hidden">
      <header className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <DatabaseZap className="size-5 text-primary" aria-hidden="true" />
            <h1 className="text-xl font-semibold tracking-tight">Monitor da Coleta Highlightly</h1>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Fila, fatia ativa, cota, qualidade e saúde operacional em uma única visão.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={selectedScope} onValueChange={setScope} disabled={!monitor?.scopes.length}>
            <SelectTrigger className="w-full sm:w-[330px]" aria-label="Escopo da coleta">
              <SelectValue placeholder="Último escopo" />
            </SelectTrigger>
            <SelectContent>
              {(monitor?.scopes ?? []).map((option) => (
                <SelectItem key={option.scope} value={option.scope}>
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
        </div>
      </header>

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
            <span>Atualizado {formatDateTime(monitor.generated_at)}</span>
          </div>

          <QueueSummary monitor={monitor} />

          {oddsQualityQuery.data ? <OddsQualityMonitor report={oddsQualityQuery.data} /> : null}
          {oddsQualityQuery.error ? (
            <Alert>
              <AlertTriangle />
              <AlertTitle>Diagnóstico de odds temporariamente indisponível</AlertTitle>
              <AlertDescription>{oddsQualityQuery.error.message}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.8fr)]">
            <section
              className="min-w-0 border border-border bg-card"
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
                        {SPORT_LABELS[row.sport] ?? row.sport}
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

            <section className="min-w-0 border border-border bg-card" aria-labelledby="dates-title">
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
            className="min-w-0 border border-border bg-card"
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
            <section className="border border-border bg-card" aria-labelledby="running-title">
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

            <section className="border border-border bg-card" aria-labelledby="errors-title">
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
