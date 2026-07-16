import { useDeferredValue, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  isJsonRecord,
  jsonNumber,
  jsonString,
  translateAnalyticsLabel,
  type JsonRecord,
} from "@/lib/highlightly-analysis";
import { AnalysisEmpty, SectionLabel } from "./analysis-primitives";

type MetricPair = {
  key: string;
  name: string;
  group: string;
  unit: string | null;
  home: JsonRecord | null;
  away: JsonRecord | null;
};

const EMPTY_TERMS: string[] = [];

function value(record: JsonRecord | null): string {
  if (!record) return "—";
  const numeric = jsonNumber(record.numericValue);
  if (numeric !== null) {
    const unit = jsonString(record.unit) ?? "";
    const formatted = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(numeric);
    return unit === "%" ? `${formatted}%` : `${formatted}${unit ? ` ${unit}` : ""}`;
  }
  return (
    jsonString(record.textValue) ??
    (record.booleanValue === true ? "Sim" : record.booleanValue === false ? "Não" : "—")
  );
}

function numeric(record: JsonRecord | null): number | null {
  return record ? jsonNumber(record.numericValue) : null;
}

export default function StatisticsPanel({
  rows,
  homeTeamId,
  awayTeamId,
  homeName,
  awayName,
  title = "Estatísticas",
  filterTerms = EMPTY_TERMS,
}: {
  rows: JsonRecord[];
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeName: string;
  awayName: string;
  title?: string;
  filterTerms?: string[];
}) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase("pt-BR"));
  const groups = useMemo(() => {
    const metrics = new Map<string, MetricPair>();
    for (const row of rows) {
      if (!isJsonRecord(row)) continue;
      const metricKey =
        jsonString(row.metricKey) ??
        jsonString(row.providerMetricKey) ??
        jsonString(row.displayName);
      if (!metricKey) continue;
      const group = jsonString(row.group) ?? "Geral";
      const scope = jsonString(row.scopeKey) ?? "";
      const split = jsonString(row.splitKey) ?? "";
      const player = jsonString(row.player) ?? "";
      const translatedGroup = [
        ...new Set([group, scope, split].filter(Boolean).map(translateAnalyticsLabel)),
      ]
        .filter(Boolean)
        .join(" · ");
      const pairKey = `${group}|${scope}|${split}|${player}|${metricKey}`;
      const pair = metrics.get(pairKey) ?? {
        key: pairKey,
        name: translateAnalyticsLabel(jsonString(row.displayName) ?? metricKey),
        group: [player, translatedGroup].filter(Boolean).join(" · ") || "Geral",
        unit: jsonString(row.unit),
        home: null,
        away: null,
      };
      const teamId = jsonString(row.teamId);
      if (teamId && teamId === homeTeamId) pair.home = row;
      if (teamId && teamId === awayTeamId) pair.away = row;
      metrics.set(pairKey, pair);
    }

    const normalizedTerms = filterTerms.map((term) => term.toLocaleLowerCase("pt-BR"));
    const filtered = [...metrics.values()].filter((metric) => {
      const searchable = `${metric.name} ${metric.group}`.toLocaleLowerCase("pt-BR");
      if (normalizedTerms.length && !normalizedTerms.some((term) => searchable.includes(term))) {
        return false;
      }
      return !deferredSearch || searchable.includes(deferredSearch);
    });
    const grouped = new Map<string, MetricPair[]>();
    for (const metric of filtered) {
      grouped.set(metric.group, [...(grouped.get(metric.group) ?? []), metric]);
    }
    return grouped;
  }, [rows, homeTeamId, awayTeamId, deferredSearch, filterTerms]);

  if (!rows.length) {
    return (
      <AnalysisEmpty
        title={`${title} indisponíveis`}
        description="Este conjunto ainda não foi coletado ou validado para a partida."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 p-3 md:p-4">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar métrica em português..."
          className="pl-9"
        />
      </div>
      <div className="grid grid-cols-[minmax(76px,1fr)_minmax(120px,1.35fr)_minmax(76px,1fr)] items-center border-y border-border py-2 text-xs">
        <span className="truncate pr-2 text-left font-semibold text-primary">{homeName}</span>
        <span className="text-center text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          {title}
        </span>
        <span className="truncate pl-2 text-right font-semibold text-destructive">{awayName}</span>
      </div>

      {[...groups.entries()].map(([group, metrics]) => (
        <section key={group} className="flex flex-col gap-1" aria-labelledby={`metric-${group}`}>
          <SectionLabel id={`metric-${group}`} className="mb-1">
            {group}
          </SectionLabel>
          {metrics.map((metric) => {
            const homeValue = numeric(metric.home);
            const awayValue = numeric(metric.away);
            const total = Math.abs(homeValue ?? 0) + Math.abs(awayValue ?? 0);
            const homeShare = total ? (Math.abs(homeValue ?? 0) / total) * 100 : 50;
            const awayShare = 100 - homeShare;
            return (
              <div
                key={metric.key}
                className="grid min-h-12 grid-cols-[minmax(76px,1fr)_minmax(120px,1.35fr)_minmax(76px,1fr)] items-center border-b border-border/70 py-2 text-xs"
              >
                <span className="pr-2 text-left font-mono font-semibold">{value(metric.home)}</span>
                <span className="flex min-w-0 flex-col items-center gap-1.5 px-2">
                  <span className="max-w-full truncate text-[11px] text-muted-foreground">
                    {metric.name}
                  </span>
                  {homeValue !== null || awayValue !== null ? (
                    <span className="flex w-full items-center gap-1" aria-hidden="true">
                      <Progress value={homeShare} className="h-1 flex-1 [&>div]:bg-primary" />
                      <Progress value={awayShare} className="h-1 flex-1 [&>div]:bg-destructive" />
                    </span>
                  ) : null}
                </span>
                <span className="pl-2 text-right font-mono font-semibold">
                  {value(metric.away)}
                </span>
              </div>
            );
          })}
        </section>
      ))}
      {!groups.size ? (
        <AnalysisEmpty
          title="Sem métricas para este recorte"
          description="O filtro selecionado não encontrou dados coletados. Escolha outra visão analítica."
        />
      ) : null}
    </div>
  );
}
