import { Activity, CheckCircle2, Clock3, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { HighlightlyMatchLifecycleReport } from "@/lib/highlightly-match-lifecycle";
import { cn } from "@/lib/utils";

const SPORT_LABELS: Record<string, string> = {
  football: "Football",
  baseball: "Baseball",
  basketball: "Basketball",
};

const STAGE_LABELS: Record<string, string> = {
  scheduled: "Agendada",
  imminent: "Pré-jogo",
  live: "Ao vivo",
  finished_pending_detail: "Finalizada, completando",
  complete: "Completa",
  complete_with_exceptions: "Completa com exceções",
  terminal: "Encerrada sem coleta",
  quarantined: "Em quarentena",
};

const RESOURCE_LABELS: Record<string, string> = {
  match_status: "Status e placar",
  events: "Eventos",
  match_statistics: "Estatísticas",
  lineups: "Escalações",
  box_scores: "Box score",
  highlights: "Highlights",
};

const TERMINAL_STAGES = new Set(["complete", "complete_with_exceptions", "terminal"]);

function dateTime(value?: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function totalForSport(report: HighlightlyMatchLifecycleReport, sport: string): number {
  return report.by_stage
    .filter((row) => row.sport === sport)
    .reduce((total, row) => total + row.matches, 0);
}

function completedForSport(report: HighlightlyMatchLifecycleReport, sport: string): number {
  return report.by_stage
    .filter((row) => row.sport === sport && TERMINAL_STAGES.has(row.lifecycle_stage))
    .reduce((total, row) => total + row.matches, 0);
}

export function MatchLifecycleMonitor({ report }: { report: HighlightlyMatchLifecycleReport }) {
  const exceptions = report.matches.filter((match) => match.missing_resources.length > 0);

  return (
    <section className="border border-border bg-card" aria-labelledby="lifecycle-title">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 id="lifecycle-title" className="text-sm font-semibold">
            Ciclo automático das partidas
          </h2>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Pré-jogo, acompanhamento ao vivo e complementação pós-jogo em T+15m, T+2h e T+24h.
          </p>
        </div>
        <Badge variant="outline">Atualizado {dateTime(report.generated_at)}</Badge>
      </div>

      <div className="grid gap-px bg-border md:grid-cols-3">
        {report.policies.map((policy) => {
          const total = totalForSport(report, policy.sport);
          const completed = completedForSport(report, policy.sport);
          return (
            <article key={policy.sport} className="bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold">
                  {SPORT_LABELS[policy.sport] ?? policy.sport}
                </p>
                <Badge variant={policy.enabled ? "default" : "outline"}>
                  {policy.enabled ? "Ativo" : "Rollout desligado"}
                </Badge>
              </div>
              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <strong className="font-mono text-2xl">{total}</strong>
                  <span className="ml-1 text-[10px] text-muted-foreground">partidas</span>
                </div>
                <span className="text-[10px] text-muted-foreground">{completed} encerradas</span>
              </div>
              <p className="mt-3 text-[10px] text-muted-foreground">
                Live a cada {Math.round(policy.live_poll_seconds / 60)} min · pré-jogo a cada{" "}
                {Math.round(policy.prematch_poll_seconds / 60)} min
              </p>
            </article>
          );
        })}
      </div>

      <div className="grid border-t border-border xl:grid-cols-2">
        <div className="overflow-x-auto xl:border-r xl:border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Esporte</TableHead>
                <TableHead>Etapa</TableHead>
                <TableHead className="text-right">Partidas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.by_stage.map((row) => (
                <TableRow key={`${row.sport}:${row.lifecycle_stage}`}>
                  <TableCell>{SPORT_LABELS[row.sport] ?? row.sport}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      {row.lifecycle_stage === "live" ? (
                        <Activity className="size-3.5 text-success" aria-hidden="true" />
                      ) : TERMINAL_STAGES.has(row.lifecycle_stage) ? (
                        <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" />
                      ) : (
                        <Clock3 className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      )}
                      {STAGE_LABELS[row.lifecycle_stage] ?? row.lifecycle_stage}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono">{row.matches}</TableCell>
                </TableRow>
              ))}
              {!report.by_stage.length ? (
                <TableRow>
                  <TableCell colSpan={3} className="h-20 text-center text-muted-foreground">
                    Nenhuma partida acompanhada nesta janela.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>

        <div className="max-h-72 overflow-y-auto">
          <div className="border-b border-border px-4 py-3">
            <p className="text-xs font-semibold">Recursos ainda faltantes</p>
          </div>
          {exceptions.slice(0, 20).map((match) => (
            <article
              key={match.match_id}
              className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 text-xs last:border-b-0"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {match.home_team_name ?? "Mandante"} × {match.away_team_name ?? "Visitante"}
                </p>
                <p className="mt-1 truncate text-[10px] text-muted-foreground">
                  {SPORT_LABELS[match.sport] ?? match.sport} · {dateTime(match.kickoff_at)}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {match.missing_resources
                    .map((resource) => RESOURCE_LABELS[resource] ?? resource)
                    .join(" · ")}
                </p>
              </div>
              <TriangleAlert
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  match.stage === "complete_with_exceptions"
                    ? "text-warning"
                    : "text-muted-foreground",
                )}
                aria-hidden="true"
              />
            </article>
          ))}
          {!exceptions.length ? (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
              Nenhum recurso obrigatório pendente.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
