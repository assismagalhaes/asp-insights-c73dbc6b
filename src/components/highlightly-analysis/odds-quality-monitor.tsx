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

  return (
    <section className="border border-border bg-card" aria-labelledby="odds-quality-title">
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

      <div className="grid gap-px bg-border md:grid-cols-3">
        {report.by_sport.map((row) => {
          const ready = row.gate_status === "ready";
          return (
            <article key={row.sport} className="bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold">{SPORT_LABELS[row.sport] ?? row.sport}</p>
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

      <div className="overflow-x-auto border-t border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Esporte</TableHead>
              <TableHead>Motivo determinístico</TableHead>
              <TableHead className="text-right">Partidas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {relevantCauses.map((row) => (
              <TableRow key={`${row.sport}:${row.cause}`}>
                <TableCell>{SPORT_LABELS[row.sport] ?? row.sport}</TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <Clock3 className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    {CAUSE_LABELS[row.cause] ?? row.cause}
                  </span>
                </TableCell>
                <TableCell className="text-right font-mono">{row.matches}</TableCell>
              </TableRow>
            ))}
            {!relevantCauses.length ? (
              <TableRow>
                <TableCell colSpan={3} className="h-20 text-center text-muted-foreground">
                  Nenhuma indisponibilidade detectada na janela atual.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
