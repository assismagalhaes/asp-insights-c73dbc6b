import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Star,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  analysisSportLabels,
  fetchDailyMatches,
  fetchMatchDetail,
  formatAnalysisDate,
  type AnalysisSportFilter,
  type DailyMatch,
} from "@/lib/highlightly-analysis";
import { cn } from "@/lib/utils";
import { AnalysisEmpty, AnalysisError } from "./analysis-primitives";
import { MatchDetailView } from "./match-detail";
import { MatchExplorer } from "./match-explorer";

export interface CentralEsportivaSearch {
  sport: AnalysisSportFilter;
  date: string;
  match?: string;
}

const presetOptions: Record<AnalysisSportFilter, string[]> = {
  all: ["Visão geral", "Odds e movimento"],
  football: ["Geral / forma", "Gols e xG", "1X2 / BTTS", "Cantos", "Handicap", "Odds e movimento"],
  baseball: [
    "Geral / forma",
    "Ataque",
    "Starting pitchers",
    "Bullpen",
    "Totais",
    "Odds e movimento",
  ],
  basketball: [
    "Geral / forma",
    "Eficiência e pace",
    "Arremessos",
    "Rebotes / turnovers",
    "Totais",
    "Odds e movimento",
  ],
};

function shiftDate(value: string, amount: number): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return date.toISOString().slice(0, 10);
}

function latestUpdate(matches: DailyMatch[]): string | null {
  let latest = 0;
  for (const match of matches) {
    const value = match.updated_at ? new Date(match.updated_at).getTime() : 0;
    if (value > latest) latest = value;
  }
  return latest ? new Date(latest).toISOString() : null;
}

function useFavoriteMatches() {
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const value = JSON.parse(localStorage.getItem("asp:central-esportiva:favorites:v1") ?? "[]");
      return new Set(
        Array.isArray(value)
          ? value.filter((item): item is string => typeof item === "string")
          : [],
      );
    } catch {
      return new Set();
    }
  });
  const toggle = (matchId: string) => {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(matchId)) next.delete(matchId);
      else next.add(matchId);
      localStorage.setItem("asp:central-esportiva:favorites:v1", JSON.stringify([...next]));
      return next;
    });
  };
  return { favorites, toggle };
}

export function CentralEsportiva({
  search,
  onSearchChange,
}: {
  search: CentralEsportivaSearch;
  onSearchChange: (next: CentralEsportivaSearch, replace?: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [preset, setPreset] = useState(presetOptions[search.sport][0]);
  const deferredText = useDeferredValue(text.trim().toLocaleLowerCase("pt-BR"));
  const { favorites, toggle } = useFavoriteMatches();

  useEffect(() => setPreset(presetOptions[search.sport][0]), [search.sport]);

  const matchesQuery = useQuery({
    queryKey: ["highlightly-analysis", "daily", search.sport, search.date],
    queryFn: () => fetchDailyMatches(search.sport, search.date),
    staleTime: 60_000,
    retry: 1,
  });
  const matches = useMemo(() => matchesQuery.data ?? [], [matchesQuery.data]);
  const filteredMatches = useMemo(() => {
    return matches.filter((match) => {
      if (favoritesOnly && !favorites.has(String(match.match_id))) return false;
      if (!deferredText) return true;
      return [match.home_team_name, match.away_team_name, match.competition_name]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("pt-BR")
        .includes(deferredText);
    });
  }, [matches, favoritesOnly, favorites, deferredText]);
  const selectedMatch = matches.find((match) => String(match.match_id) === search.match);
  const detailQuery = useQuery({
    queryKey: ["highlightly-analysis", "detail", selectedMatch?.sport, selectedMatch?.match_id],
    queryFn: () => fetchMatchDetail(selectedMatch!.sport, String(selectedMatch!.match_id)),
    enabled: Boolean(selectedMatch?.match_id),
    staleTime: 60_000,
    retry: 1,
  });
  const updatedAt = latestUpdate(matches);

  function selectMatch(match: DailyMatch) {
    onSearchChange({ sport: match.sport, date: search.date, match: String(match.match_id) });
  }

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-[560px] flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border bg-analysis-toolbar px-3 py-3 md:px-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Central de Análises</h1>
              <p className="text-[10px] text-muted-foreground">
                Highlightly · read models canônicos
              </p>
            </div>
            <Badge variant="outline" className="xl:hidden">
              {filteredMatches.length} jogos
            </Badge>
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 xl:justify-end">
            <div className="relative min-w-48 flex-1 xl:max-w-72">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Buscar jogo, time ou liga"
                className="pl-9"
              />
            </div>
            <div className="flex items-center">
              <Button
                variant="outline"
                size="icon"
                className="rounded-r-none"
                onClick={() =>
                  onSearchChange({ ...search, date: shiftDate(search.date, -1), match: undefined })
                }
                aria-label="Dia anterior"
              >
                <ChevronLeft />
              </Button>
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="date"
                  value={search.date}
                  onChange={(event) =>
                    onSearchChange({ ...search, date: event.target.value, match: undefined })
                  }
                  className="w-36 rounded-none pl-7 font-mono text-xs"
                  aria-label="Data"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                className="rounded-l-none"
                onClick={() =>
                  onSearchChange({ ...search, date: shiftDate(search.date, 1), match: undefined })
                }
                aria-label="Próximo dia"
              >
                <ChevronRight />
              </Button>
            </div>
            <Button
              variant={favoritesOnly ? "secondary" : "outline"}
              size="icon"
              onClick={() => setFavoritesOnly((value) => !value)}
              aria-pressed={favoritesOnly}
              aria-label="Somente favoritos"
            >
              <Star className={favoritesOnly ? "fill-current" : ""} />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["highlightly-analysis"] })}
              aria-label="Atualizar dados"
            >
              <RefreshCw className={matchesQuery.isFetching ? "animate-spin" : ""} />
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
          <ToggleGroup
            type="single"
            value={search.sport}
            onValueChange={(value) =>
              value && onSearchChange({ sport: value as AnalysisSportFilter, date: search.date })
            }
            variant="outline"
            size="sm"
            className="justify-start overflow-x-auto"
            aria-label="Esporte"
          >
            {(Object.keys(analysisSportLabels) as AnalysisSportFilter[]).map((sport) => (
              <ToggleGroupItem key={sport} value={sport} className="min-w-20">
                {analysisSportLabels[sport]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-3.5 text-muted-foreground" aria-hidden="true" />
            <Select value={preset} onValueChange={setPreset}>
              <SelectTrigger className="h-8 w-48" aria-label="Preset analítico">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {presetOptions[search.sport].map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <span className="hidden text-[10px] text-muted-foreground lg:inline">
              Atualizado{" "}
              {updatedAt
                ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(
                    new Date(updatedAt),
                  )
                : "—"}
            </span>
          </div>
        </div>
      </header>

      {matchesQuery.error ? (
        <AnalysisError message={matchesQuery.error.message} />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(340px,42%)_minmax(0,1fr)]">
          <aside
            className={cn(
              "min-h-0 border-r border-border bg-analysis-rail",
              selectedMatch ? "hidden lg:flex" : "flex",
              "flex-col",
            )}
            aria-label="Explorador de partidas"
          >
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3 text-[10px] text-muted-foreground">
              <span>Hoje, {formatAnalysisDate(search.date)}</span>
              <span>{filteredMatches.length} resultados</span>
            </div>
            <MatchExplorer
              matches={filteredMatches}
              isLoading={matchesQuery.isLoading}
              selectedMatchId={search.match}
              onSelect={selectMatch}
            />
          </aside>
          <section
            className={cn("min-h-0", selectedMatch ? "block" : "hidden lg:block")}
            aria-label="Detalhe da partida"
          >
            {selectedMatch ? (
              <div className="relative h-full">
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-12 top-2 z-10"
                  onClick={() => toggle(String(selectedMatch.match_id))}
                  aria-label={
                    favorites.has(String(selectedMatch.match_id))
                      ? "Remover dos favoritos"
                      : "Adicionar aos favoritos"
                  }
                >
                  <Star
                    className={
                      favorites.has(String(selectedMatch.match_id))
                        ? "fill-current text-warning"
                        : ""
                    }
                  />
                </Button>
                <MatchDetailView
                  key={String(selectedMatch.match_id)}
                  match={selectedMatch}
                  detail={detailQuery.data}
                  isLoading={detailQuery.isLoading}
                  error={detailQuery.error}
                  onClose={() => onSearchChange({ sport: search.sport, date: search.date }, true)}
                />
              </div>
            ) : (
              <AnalysisEmpty
                title="Selecione uma partida"
                description="Escolha um jogo para abrir estatísticas, forma, escalações, eventos, standings e evidências de odds."
                className="h-full"
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
