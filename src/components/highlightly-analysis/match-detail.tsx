import { lazy, Suspense, useMemo, useState } from "react";
import { ArrowLeft, CalendarClock, ExternalLink, ShieldAlert, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getMatchScore,
  isJsonRecord,
  jsonArray,
  jsonNumber,
  jsonString,
  matchStatusLabel,
  type DailyMatch,
  type JsonRecord,
  type MatchDetail,
} from "@/lib/highlightly-analysis";
import { AnalysisEmpty, AnalysisError, SectionLabel, TeamMark } from "./analysis-primitives";

const OddsPanel = lazy(() => import("./odds-panel"));
const StatisticsPanel = lazy(() => import("./statistics-panel"));

type DetailTab =
  | "summary"
  | "odds"
  | "statistics"
  | "form"
  | "lineups"
  | "events"
  | "standings"
  | "source";

function formatDateTime(value: string | null): string {
  if (!value) return "Data não informada";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date(value))
    .replace(" de ", " ");
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4" aria-label="Carregando detalhe">
      <div className="flex items-center justify-center gap-8 py-5">
        <Skeleton className="size-14" />
        <Skeleton className="h-12 w-32" />
        <Skeleton className="size-14" />
      </div>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-52 w-full" />
    </div>
  );
}

function SummaryPanel({ match, detail }: { match: DailyMatch; detail: MatchDetail }) {
  const periods = useMemo(() => {
    const rows = new Map<string, { label: string; home: number | null; away: number | null }>();
    for (const period of detail.periodScores) {
      const periodKey = jsonString(period.periodKey) ?? "período";
      const row = rows.get(periodKey) ?? {
        label: periodKey.replaceAll("_", " "),
        home: null,
        away: null,
      };
      const teamId = jsonString(period.teamId);
      const score = jsonNumber(period.score);
      if (teamId === match.home_team_id) row.home = score;
      if (teamId === match.away_team_id) row.away = score;
      rows.set(periodKey, row);
    }
    return [...rows.values()];
  }, [detail.periodScores, match.home_team_id, match.away_team_id]);

  const coverage = [
    ["Métricas", detail.teamStatistics.length],
    ["Odds", detail.odds.length],
    ["Consensos", detail.oddsConsensus.length],
    ["Eventos", detail.events.length],
    ["Box scores", detail.playerBoxScores.length],
    ["Highlights", detail.highlights.length],
  ] as const;

  return (
    <div className="flex flex-col gap-4 p-3 md:p-4">
      <section className="grid grid-cols-2 border-y border-border sm:grid-cols-3">
        {coverage.map(([label, count]) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-2.5 sm:nth-[n+4]:border-b-0"
          >
            <span className="text-xs text-muted-foreground">{label}</span>
            <strong className="font-mono text-sm">{count}</strong>
          </div>
        ))}
      </section>

      {periods.length ? (
        <section aria-labelledby="periods-title">
          <SectionLabel id="periods-title" className="mb-2">
            Placar por período
          </SectionLabel>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Período</TableHead>
                <TableHead className="text-right">{match.home_team_name}</TableHead>
                <TableHead className="text-right">{match.away_team_name}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {periods.map((period) => (
                <TableRow key={period.label}>
                  <TableCell className="capitalize text-muted-foreground">{period.label}</TableCell>
                  <TableCell className="text-right font-mono">{period.home ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{period.away ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}

      <section aria-labelledby="highlights-title">
        <SectionLabel id="highlights-title" className="mb-2">
          Highlights
        </SectionLabel>
        {detail.highlights.length ? (
          <div className="flex flex-col divide-y divide-border border-y border-border">
            {detail.highlights.map((highlight, index) => {
              const url = jsonString(highlight.contentUrl) ?? jsonString(highlight.embedUrl);
              return (
                <div
                  key={jsonString(highlight.id) ?? index}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {jsonString(highlight.title) ?? "Highlight"}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {jsonString(highlight.source) ??
                        jsonString(highlight.channel) ??
                        "Highlightly"}
                    </span>
                  </span>
                  {url ? (
                    <Button asChild variant="outline" size="sm">
                      <a href={url} target="_blank" rel="noreferrer">
                        <ExternalLink data-icon="inline-start" />
                        Abrir
                      </a>
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="border-y border-border py-4 text-xs text-muted-foreground">
            Nenhum highlight disponível.
          </p>
        )}
      </section>
    </div>
  );
}

function LineupsPanel({ detail }: { detail: MatchDetail }) {
  if (!detail.lineups.length && !detail.playerBoxScores.length) {
    return (
      <AnalysisEmpty
        title="Elencos indisponíveis"
        description="Lineups e box scores ainda não foram publicados para esta partida."
      />
    );
  }
  return (
    <div className="grid gap-4 p-3 md:grid-cols-2 md:p-4">
      {detail.lineups.map((lineup, index) => {
        const players = jsonArray(lineup.players);
        return (
          <section
            key={jsonString(lineup.id) ?? index}
            className="min-w-0 border-y border-border py-3"
          >
            <div className="mb-2 flex items-center justify-between">
              <SectionLabel>Escalação</SectionLabel>
              <Badge variant={lineup.confirmed === true ? "secondary" : "outline"}>
                {lineup.confirmed === true ? "Confirmada" : "Não confirmada"}
              </Badge>
            </div>
            <div className="flex flex-col divide-y divide-border">
              {players.map((player, playerIndex) => (
                <div
                  key={jsonString(player.playerId) ?? playerIndex}
                  className="flex items-center justify-between gap-2 py-2 text-xs"
                >
                  <span className="truncate">{jsonString(player.name) ?? "Jogador"}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {jsonString(player.position) ?? jsonString(player.role) ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        );
      })}
      {detail.playerBoxScores.length ? (
        <section className="min-w-0 border-y border-border py-3 md:col-span-2">
          <SectionLabel className="mb-2">
            Box score · {detail.playerBoxScores.length} métricas
          </SectionLabel>
          <p className="text-xs text-muted-foreground">
            Use a busca na aba Estatísticas para comparar métricas de time; o box score individual
            completo está preservado no read model.
          </p>
        </section>
      ) : null}
    </div>
  );
}

function EventsPanel({ detail }: { detail: MatchDetail }) {
  if (!detail.events.length)
    return (
      <AnalysisEmpty
        title="Eventos indisponíveis"
        description="A timeline ainda não foi publicada para esta partida."
      />
    );
  return (
    <div className="flex flex-col divide-y divide-border p-3 md:p-4">
      {detail.events.map((event, index) => (
        <div
          key={jsonString(event.sequenceKey) ?? index}
          className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 py-3 text-xs"
        >
          <span className="font-mono text-muted-foreground">
            {jsonString(event.clock) ?? jsonString(event.periodKey) ?? "—"}
          </span>
          <span className="capitalize">
            {(jsonString(event.type) ?? "evento").replaceAll("_", " ")}
          </span>
        </div>
      ))}
    </div>
  );
}

function StandingsPanel({ detail }: { detail: MatchDetail }) {
  if (!detail.standings.length) {
    return (
      <Alert className="m-4 border-warning/30 bg-warning/5">
        <ShieldAlert className="text-warning" />
        <AlertTitle>Classificação não exibida</AlertTitle>
        <AlertDescription>
          Não há snapshot validado. Dados rejeitados pelo guardrail nunca aparecem como
          classificação válida.
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="p-3 md:p-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>Time</TableHead>
            <TableHead className="text-right">J</TableHead>
            <TableHead className="text-right">V</TableHead>
            <TableHead className="text-right">D</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {detail.standings.map((row, index) => {
            const metrics = isJsonRecord(row.metrics) ? row.metrics : {};
            return (
              <TableRow key={jsonString(row.id) ?? index}>
                <TableCell className="font-mono">{jsonNumber(row.rank) ?? "—"}</TableCell>
                <TableCell>
                  {jsonString(row.team_name) ??
                    jsonString(row.teamName) ??
                    jsonString(row.team_id) ??
                    "Time"}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {jsonNumber(metrics.played) ?? "—"}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {jsonNumber(metrics.wins) ?? "—"}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {jsonNumber(metrics.losses) ?? "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function SourcePanel({ match, detail }: { match: DailyMatch; detail: MatchDetail }) {
  const facts = [
    ["ID canônico", match.match_id],
    ["Esporte", match.sport],
    ["Competição", match.competition_name],
    ["Temporada", match.season_label],
    ["Status do provider", match.provider_status],
    ["Atualizado", match.updated_at ? formatDateTime(match.updated_at) : null],
    ["Métricas preservadas", detail.teamStatistics.length],
    ["Odds atuais", detail.odds.length],
  ] as const;
  return (
    <div className="p-3 md:p-4">
      <div className="divide-y divide-border border-y border-border">
        {facts.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 py-3 text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className="break-all font-mono">{value ?? "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MatchDetailView({
  match,
  detail,
  isLoading,
  error,
  onClose,
}: {
  match: DailyMatch;
  detail?: MatchDetail;
  isLoading: boolean;
  error?: Error | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>("summary");
  const homeScore = getMatchScore(match, "home");
  const awayScore = getMatchScore(match, "away");
  const status = matchStatusLabel(match.status);
  const tabs: Array<[DetailTab, string]> = [
    ["summary", "Resumo"],
    ["odds", "Odds"],
    ["statistics", "Estatísticas"],
    ["form", "Forma"],
    ["lineups", "Elencos"],
    ["events", "Eventos"],
    ["standings", "Classificação"],
    ["source", "Fonte"],
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="relative shrink-0 border-b border-border px-4 py-4 md:px-6">
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-2 top-2 md:hidden"
          onClick={onClose}
          aria-label="Voltar à lista"
        >
          <ArrowLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-2 top-2 hidden md:inline-flex"
          onClick={onClose}
          aria-label="Fechar detalhe"
        >
          <X />
        </Button>
        <div className="mb-3 flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
          <span>{match.competition_name || "Competição"}</span>
          <span>·</span>
          <span className={status === "Finalizado" ? "text-success" : "text-primary"}>
            {status}
          </span>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_112px_minmax(0,1fr)] items-center gap-3">
          <div className="flex min-w-0 items-center justify-end gap-2 text-right">
            <span className="truncate text-xs font-medium sm:text-sm">
              {match.home_team_name || "Mandante"}
            </span>
            <TeamMark
              name={match.home_team_name || "Mandante"}
              src={match.home_team_logo_url}
              className="size-11"
            />
          </div>
          <div className="text-center">
            <div className="font-mono text-3xl font-bold tracking-tight sm:text-4xl">
              <span
                className={
                  homeScore !== null && awayScore !== null && homeScore > awayScore
                    ? "text-success"
                    : ""
                }
              >
                {homeScore ?? "—"}
              </span>
              <span className="px-2 text-muted-foreground">:</span>
              <span
                className={
                  homeScore !== null && awayScore !== null && awayScore > homeScore
                    ? "text-success"
                    : ""
                }
              >
                {awayScore ?? "—"}
              </span>
            </div>
            <span className="mt-1 flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
              <CalendarClock className="size-3" />
              {formatDateTime(match.kickoff_at)}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <TeamMark
              name={match.away_team_name || "Visitante"}
              src={match.away_team_logo_url}
              className="size-11"
            />
            <span className="truncate text-xs font-medium sm:text-sm">
              {match.away_team_name || "Visitante"}
            </span>
          </div>
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as DetailTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="shrink-0 overflow-x-auto border-b border-border px-2 md:px-4">
          <TabsList className="h-11 w-max min-w-full justify-start rounded-none bg-transparent p-0">
            {tabs.map(([value, label]) => (
              <TabsTrigger
                key={value}
                value={value}
                className="h-11 rounded-none border-b-2 border-transparent px-3 text-xs shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none"
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <DetailSkeleton />
          ) : error ? (
            <AnalysisError message={error.message} />
          ) : detail ? (
            <Suspense fallback={<DetailSkeleton />}>
              <TabsContent value="summary" className="m-0">
                <SummaryPanel match={match} detail={detail} />
              </TabsContent>
              <TabsContent value="odds" className="m-0">
                <OddsPanel detail={detail} />
              </TabsContent>
              <TabsContent value="statistics" className="m-0">
                <StatisticsPanel
                  rows={detail.teamStatistics}
                  homeTeamId={match.home_team_id}
                  awayTeamId={match.away_team_id}
                  homeName={match.home_team_name || "Mandante"}
                  awayName={match.away_team_name || "Visitante"}
                />
              </TabsContent>
              <TabsContent value="form" className="m-0">
                <StatisticsPanel
                  rows={detail.teamFormStatistics}
                  homeTeamId={match.home_team_id}
                  awayTeamId={match.away_team_id}
                  homeName={match.home_team_name || "Mandante"}
                  awayName={match.away_team_name || "Visitante"}
                  title="Forma"
                />
              </TabsContent>
              <TabsContent value="lineups" className="m-0">
                <LineupsPanel detail={detail} />
              </TabsContent>
              <TabsContent value="events" className="m-0">
                <EventsPanel detail={detail} />
              </TabsContent>
              <TabsContent value="standings" className="m-0">
                <StandingsPanel detail={detail} />
              </TabsContent>
              <TabsContent value="source" className="m-0">
                <SourcePanel match={match} detail={detail} />
              </TabsContent>
            </Suspense>
          ) : null}
        </div>
      </Tabs>
    </div>
  );
}
