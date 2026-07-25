import { AlertCircle, CheckCircle2, Clock3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { HighlightlyOddsQualityReport } from "@/lib/highlightly-odds-quality";
import { cn } from "@/lib/utils";
import { SportMark } from "@/components/sport-filter-select";

const SPORT_LABELS: Record<string, string> = {
  football: "Football",
  baseball: "Baseball",
  basketball: "Basketball",
};

const CAUSE_LABELS: Record<string, string> = {
  available: "Disponível",
  stale: "Desatualizada",
  not_yet_due: "Ainda fora da janela",
  not_collected: "Coleta ainda não executada",
  collection_pending: "Coleta pendente",
  collection_failed: "Falha de coleta",
  provider_empty: "Provedor retornou vazio",
  provider_unavailable: "Provedor marcou indisponível",
  bookmaker_missing: "Bookmaker preferido ausente",
  market_missing: "Mercado monitorado ausente",
  quality_rejected: "Rejeitada pela qualidade",
  no_supported_quote: "Sem cotação compatível",
};

function percentage(value: number | null): number {
  return Math.max(0, Math.min(100, value ?? 0));
}

function duration(seconds: number | null): string {
  if (seconds === null) return "sem leitura";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(seconds >= 36_000 ? 0 : 1)} h`;
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function OddsQualityMonitor({ report }: { report: HighlightlyOddsQualityReport }) {
  const relevantCauses = report.by_cause.filter(
    (row) => row.cause !== "available" && row.cause !== "not_yet_due",
  );
  const totalDue = report.by_sport.reduce((sum, row) => sum + row.matches_due, 0);
  const totalAvailable = report.by_sport.reduce((sum, row) => sum + row.matches_available, 0);
  const noOddsAvailable = totalDue > 0 && totalAvailable === 0;

  return (
    <section
      className="overflow-hidden rounded-lg border border-primary/15 bg-card/90 shadow-[0_18px_44px_rgb(0_0_0/0.16)]"
      aria-labelledby="odds-quality-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 id="odds-quality-title" className="text-sm font-semibold">
            Qualidade e atualização das odds
          </h2>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Atualização incremental em T−24h, T−6h e T−60m, sem repetir estatísticas estáticas.
          </p>
        </div>
        <Badge variant="outline">Atualizado {dateTime(report.generated_at)}</Badge>
      </div>

      {noOddsAvailable ? (
        <div className="flex items-start gap-3 border-b border-warning/25 bg-warning/[0.06] px-4 py-3">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <div>
            <p className="text-xs font-semibold text-warning">Odds indisponíveis na janela atual</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Nenhuma das {totalDue.toLocaleString("pt-BR")} partidas devidas possui cotação
              disponível. Consulte abaixo as causas determinísticas por esporte.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-px bg-border md:grid-cols-3">
        {report.by_sport.map((row) => {
          const ready = row.gate_status === "ready";
          return (
            <article key={row.sport} className="bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-xs font-semibold">
                  <SportMark sport={SPORT_LABELS[row.sport] ?? row.sport} />
                  {SPORT_LABELS[row.sport] ?? row.sport}
                </p>
                {ready ? (
                  <CheckCircle2 className="size-4 text-success" aria-label="Meta atingida" />
                ) : (
                  <AlertCircle className="size-4 text-warning" aria-label="Abaixo da meta" />
                )}
              </div>
              <div className="mt-3 flex items-baseline justify-between gap-3">
                <strong
                  className={cn("font-mono text-2xl", ready ? "text-success" : "text-warning")}
                >
                  {(row.availability_pct ?? 0).toFixed(1)}%
                </strong>
                <span className="text-[10px] text-muted-foreground">
                  meta {row.target_availability_pct.toFixed(0)}%
                </span>
              </div>
              <Progress value={percentage(row.availability_pct)} className="mt-2 h-1.5" />
              <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
                <span>
                  <strong className="block font-mono text-foreground">{row.matches_due}</strong>
                  devidos
                </span>
                <span>
                  <strong className="block font-mono text-foreground">
                    {row.matches_available}
                  </strong>
                  disponíveis
                </span>
                <span>
                  <strong className="block font-mono text-foreground">
                    {duration(row.freshness_p95_seconds)}
                  </strong>
                  frescor p95
                </span>
              </div>
            </article>
          );
        })}
      </div>

      <details className="group border-t border-border md:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs font-semibold">
          Motivos determinísticos
          <Badge variant="outline" className="font-mono font-normal">
            {relevantCauses.length}
          </Badge>
        </summary>
        <div className="overflow-x-auto border-t border-border">
          <CausesTable causes={relevantCauses} />
        </div>
      </details>

      <div className="hidden overflow-x-auto border-t border-border md:block">
        <CausesTable causes={relevantCauses} />
      </div>
    </section>
  );
}

function CausesTable({ causes }: { causes: HighlightlyOddsQualityReport["by_cause"] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Esporte</TableHead>
          <TableHead>Motivo determinístico</TableHead>
          <TableHead className="text-right">Partidas</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {causes.map((row) => (
          <TableRow key={`${row.sport}:${row.cause}`}>
            <TableCell>
              <span className="flex items-center gap-2">
                <SportMark sport={SPORT_LABELS[row.sport] ?? row.sport} />
                {SPORT_LABELS[row.sport] ?? row.sport}
              </span>
            </TableCell>
            <TableCell>
              <span className="flex items-center gap-2">
                <Clock3 className="size-3.5 text-muted-foreground" aria-hidden="true" />
                {CAUSE_LABELS[row.cause] ?? row.cause}
              </span>
            </TableCell>
            <TableCell className="text-right font-mono">{row.matches}</TableCell>
          </TableRow>
        ))}
        {!causes.length ? (
          <TableRow>
            <TableCell colSpan={3} className="h-20 text-center text-muted-foreground">
              Nenhuma indisponibilidade detectada na janela atual.
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}
