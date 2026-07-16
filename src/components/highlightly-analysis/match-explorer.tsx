import { useMemo, useState } from "react";
import { Clock3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  analysisSportLabels,
  getMatchScore,
  matchStatusLabel,
  type DailyMatch,
} from "@/lib/highlightly-analysis";
import { AnalysisEmpty, MatchListSkeleton } from "./analysis-primitives";

const ROW_HEIGHT = 70;
const OVERSCAN = 6;

function formatKickoff(value: string | null): string {
  if (!value) return "--:--";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function scoreText(match: DailyMatch): string | null {
  const home = getMatchScore(match, "home");
  const away = getMatchScore(match, "away");
  return home === null || away === null ? null : `${home}–${away}`;
}

export function MatchExplorer({
  matches,
  isLoading,
  selectedMatchId,
  onSelect,
}: {
  matches: DailyMatch[];
  isLoading: boolean;
  selectedMatchId?: string;
  onSelect: (match: DailyMatch) => void;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(620);
  const virtual = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(
      matches.length,
      Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
    );
    return { start, end, items: matches.slice(start, end) };
  }, [matches, scrollTop, viewportHeight]);

  if (isLoading) return <MatchListSkeleton />;
  if (!matches.length) {
    return (
      <AnalysisEmpty
        title="Nenhuma partida encontrada"
        description="Ajuste a data, o esporte ou a busca. A lista mostra somente dados normalizados e validados."
        className="h-full"
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid h-9 shrink-0 grid-cols-[54px_88px_minmax(0,1fr)_72px] items-center border-y border-border px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        <span>Hora</span>
        <span>Liga</span>
        <span>Jogo</span>
        <span className="text-right">Status</span>
      </div>
      <div
        role="listbox"
        aria-label="Partidas"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop);
          setViewportHeight(event.currentTarget.clientHeight);
        }}
      >
        <div className="relative" style={{ height: matches.length * ROW_HEIGHT }}>
          {virtual.items.map((match, index) => {
            const matchId = String(match.match_id);
            const selected = matchId === selectedMatchId;
            const status = matchStatusLabel(match.status);
            const score = scoreText(match);
            return (
              <button
                key={matchId}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => onSelect(match)}
                className={cn(
                  "absolute left-0 grid w-full grid-cols-[54px_88px_minmax(0,1fr)_72px] items-center border-b border-border px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  selected
                    ? "bg-primary/10 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary"
                    : "hover:bg-muted/50",
                )}
                style={{
                  height: ROW_HEIGHT,
                  transform: `translateY(${(virtual.start + index) * ROW_HEIGHT}px)`,
                }}
              >
                <span className="font-mono text-xs text-foreground">
                  {status === "Finalizado" ? "Final" : formatKickoff(match.kickoff_at)}
                </span>
                <span className="line-clamp-2 pr-2 text-[10px] leading-4 text-muted-foreground">
                  {match.competition_short_name ||
                    match.competition_name ||
                    analysisSportLabels[match.sport]}
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-xs font-medium">
                    {match.home_team_name || "Mandante"}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {score ? `${score}  ` : "vs  "}
                    {match.away_team_name || "Visitante"}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <Badge
                    variant={status === "Finalizado" ? "secondary" : "outline"}
                    className={cn(
                      "h-5 max-w-full truncate px-1.5 text-[9px]",
                      status === "Ao vivo" && "border-success/40 text-success",
                    )}
                  >
                    {status}
                  </Badge>
                  <span className="flex items-center gap-1 text-[9px] text-muted-foreground">
                    <Clock3 className="size-2.5" />
                    {analysisSportLabels[match.sport]}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex h-9 shrink-0 items-center justify-between border-t border-border px-3 text-[10px] text-muted-foreground">
        <span>{matches.length} partidas</span>
        <span>Lista virtualizada</span>
      </div>
    </div>
  );
}
