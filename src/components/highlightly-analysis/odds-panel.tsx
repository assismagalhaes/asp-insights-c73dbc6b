import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  isJsonRecord,
  jsonNumber,
  jsonString,
  type JsonRecord,
  type MatchDetail,
} from "@/lib/highlightly-analysis";
import { cn } from "@/lib/utils";
import { AnalysisEmpty, SectionLabel } from "./analysis-primitives";

type QuoteGroup = {
  bookmaker: string;
  preferred: boolean;
  prices: Map<string, number>;
  updatedAt: string | null;
};

type MovementPoint = {
  timestamp: number;
  label: string;
  [selection: string]: string | number;
};

function key(record: JsonRecord, camel: string, snake = camel): string | null {
  return jsonString(record[camel]) ?? jsonString(record[snake]);
}

function number(record: JsonRecord, camel: string, snake = camel): number | null {
  return jsonNumber(record[camel]) ?? jsonNumber(record[snake]);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const ordered = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function selectionTone(selection: string, index: number): "primary" | "destructive" {
  const value = selection.toLowerCase();
  return value.includes("under") || value.includes("away") || index === 1
    ? "destructive"
    : "primary";
}

function formatOdd(value: number | null): string {
  if (value === null) return "—";
  return value
    .toFixed(value < 2 ? 3 : 2)
    .replace(/0$/, "")
    .replace(/\.$/, "");
}

function formatTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function lineIdentity(record: JsonRecord): string {
  return (
    key(record, "lineKey", "line_key") ?? String(number(record, "lineValue", "line_value") ?? "")
  );
}

function marketFamily(record: JsonRecord): string {
  return key(record, "marketFamily", "market_family") ?? "mercado";
}

function marketLabel(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes("total")) return "Total";
  if (
    normalized.includes("spread") ||
    normalized.includes("handicap") ||
    normalized.includes("run_line")
  )
    return "Spread";
  if (normalized.includes("money") || normalized.includes("1x2") || normalized.includes("result"))
    return "Moneyline";
  return value.replaceAll("_", " ");
}

function movementSeries(
  rows: JsonRecord[],
  marketId: string | null,
  lineKey: string,
  selections: string[],
): MovementPoint[] {
  const buckets = new Map<string, Map<string, number[]>>();
  for (const row of rows) {
    if (marketId && key(row, "marketId", "market_id") !== marketId) continue;
    if (lineIdentity(row) !== lineKey) continue;
    const selection = key(row, "selectionKey", "selection_key");
    const capturedAt = key(row, "capturedAt", "captured_at");
    const price = number(row, "decimalOdds", "decimal_odds");
    if (!selection || !capturedAt || price === null || !selections.includes(selection)) continue;
    const timestamp = new Date(capturedAt).getTime();
    if (!Number.isFinite(timestamp)) continue;
    const minute = Math.floor(timestamp / 60_000) * 60_000;
    const bucketKey = String(minute);
    const bucket = buckets.get(bucketKey) ?? new Map<string, number[]>();
    bucket.set(selection, [...(bucket.get(selection) ?? []), price]);
    buckets.set(bucketKey, bucket);
  }
  return [...buckets.entries()]
    .map(([timestamp, bucket]) => {
      const point: MovementPoint = {
        timestamp: Number(timestamp),
        label: formatTime(new Date(Number(timestamp)).toISOString()),
      };
      for (const selection of selections) {
        const value = median(bucket.get(selection) ?? []);
        if (value !== null) point[selection] = value;
      }
      return point;
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

export default function OddsPanel({ detail }: { detail: MatchDetail }) {
  const families = useMemo(() => [...new Set(detail.odds.map(marketFamily))], [detail.odds]);
  const initialFamily =
    families.find((value) => value.toLowerCase().includes("total")) ?? families[0] ?? "";
  const [family, setFamily] = useState(initialFamily);

  useEffect(() => {
    if (!families.includes(family)) setFamily(initialFamily);
  }, [families, family, initialFamily]);

  const familyOdds = useMemo(
    () => detail.odds.filter((quote) => marketFamily(quote) === family),
    [detail.odds, family],
  );
  const lines = useMemo(() => {
    const values = new Map<string, number | null>();
    for (const quote of familyOdds)
      values.set(lineIdentity(quote), number(quote, "lineValue", "line_value"));
    return [...values.entries()].sort((a, b) => (a[1] ?? -Infinity) - (b[1] ?? -Infinity));
  }, [familyOdds]);
  const preferredLine = lines.find(([, value]) => value === 172.5)?.[0] ?? lines[0]?.[0] ?? "";
  const [selectedLine, setSelectedLine] = useState(preferredLine);

  useEffect(() => {
    if (!lines.some(([line]) => line === selectedLine)) setSelectedLine(preferredLine);
  }, [lines, preferredLine, selectedLine]);

  const quotes = useMemo(
    () =>
      familyOdds.filter(
        (quote) => lineIdentity(quote) === selectedLine && key(quote, "status") !== "closed",
      ),
    [familyOdds, selectedLine],
  );
  const marketId = quotes.length ? key(quotes[0], "marketId", "market_id") : null;
  const selections = useMemo(
    () =>
      [
        ...new Set(
          quotes
            .map((quote) => key(quote, "selectionKey", "selection_key"))
            .filter((value): value is string => Boolean(value)),
        ),
      ].slice(0, 3),
    [quotes],
  );
  const selectionLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const quote of quotes) {
      const selectionKey = key(quote, "selectionKey", "selection_key");
      if (selectionKey)
        labels.set(selectionKey, key(quote, "selection", "selection_name") ?? selectionKey);
    }
    return labels;
  }, [quotes]);

  const quoteGroups = useMemo(() => {
    const groups = new Map<string, QuoteGroup>();
    for (const quote of quotes) {
      const bookmaker = key(quote, "bookmaker") ?? "Bookmaker";
      const selection = key(quote, "selectionKey", "selection_key");
      const price = number(quote, "decimalOdds", "decimal_odds");
      if (!selection || price === null) continue;
      const group = groups.get(bookmaker) ?? {
        bookmaker,
        preferred: quote.preferred === true,
        prices: new Map<string, number>(),
        updatedAt: key(quote, "lastSeenAt", "last_seen_at"),
      };
      group.prices.set(selection, price);
      groups.set(bookmaker, group);
    }
    return [...groups.values()].sort(
      (a, b) => Number(b.preferred) - Number(a.preferred) || a.bookmaker.localeCompare(b.bookmaker),
    );
  }, [quotes]);

  const consensus = useMemo(() => {
    const values = new Map<string, JsonRecord>();
    for (const row of detail.oddsConsensus) {
      if (marketId && key(row, "marketDefinitionId", "market_definition_id") !== marketId) continue;
      if (lineIdentity(row) !== selectedLine) continue;
      const selection = key(row, "selectionKey", "selection_key");
      if (selection) values.set(selection, row);
    }
    return values;
  }, [detail.oddsConsensus, marketId, selectedLine]);
  const movement = useMemo(
    () => movementSeries(detail.oddsMovement, marketId, selectedLine, selections),
    [detail.oddsMovement, marketId, selectedLine, selections],
  );

  if (!detail.odds.length) {
    return (
      <AnalysisEmpty
        title="Odds indisponíveis"
        description="A Highlightly ainda não retornou cotações válidas para esta partida."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3 md:p-4">
      <div className="flex flex-col gap-2 border-b border-border pb-3">
        <ToggleGroup
          type="single"
          value={family}
          onValueChange={(value) => value && setFamily(value)}
          variant="outline"
          size="sm"
          className="justify-start overflow-x-auto"
          aria-label="Mercado"
        >
          {families.slice(0, 7).map((value) => (
            <ToggleGroupItem key={value} value={value} className="min-w-24">
              {marketLabel(value)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {lines.length > 1 ? (
          <Select value={selectedLine} onValueChange={setSelectedLine}>
            <SelectTrigger className="w-full sm:w-48" aria-label="Linha">
              <SelectValue placeholder="Escolha a linha" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {lines.map(([line, value]) => (
                  <SelectItem key={line} value={line}>
                    {value ?? "Sem linha"}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}
      </div>

      <section className="grid grid-cols-2 divide-x divide-border border-y border-border sm:grid-cols-4">
        {selections.map((selection, index) => {
          const row = consensus.get(selection);
          const sources = row
            ? number(row, "bookmakerCount", "bookmaker_count")
            : quoteGroups.length;
          return (
            <div key={selection} className="flex min-w-0 flex-col gap-1 px-3 py-2.5">
              <span
                className={cn(
                  "truncate text-[10px] font-semibold uppercase tracking-wide",
                  selectionTone(selection, index) === "primary"
                    ? "text-primary"
                    : "text-destructive",
                )}
              >
                {selectionLabels.get(selection) ?? selection}
              </span>
              <span className="flex items-baseline gap-2 font-mono text-sm">
                <strong>
                  {formatOdd(
                    row
                      ? number(row, "medianOdds", "median_odds")
                      : median(quoteGroups.flatMap((group) => group.prices.get(selection) ?? [])),
                  )}
                </strong>
                <span className="text-[10px] text-muted-foreground">mediana</span>
              </span>
              <span className="font-mono text-xs text-success">
                {formatOdd(
                  row
                    ? number(row, "bestOdds", "best_odds")
                    : Math.max(
                        ...quoteGroups.flatMap((group) => group.prices.get(selection) ?? []),
                      ),
                )}{" "}
                melhor
              </span>
              <span className="text-[10px] text-muted-foreground">
                {sources ?? quoteGroups.length} casas
              </span>
            </div>
          );
        })}
      </section>

      <section className="border-y border-border py-3" aria-labelledby="movement-title">
        <div className="mb-2 flex items-center justify-between px-1">
          <SectionLabel id="movement-title">Movimento da linha · mediana</SectionLabel>
          <span className="text-[10px] text-muted-foreground">histórico observado</span>
        </div>
        {movement.length >= 2 ? (
          <div
            className="h-48 w-full"
            role="img"
            aria-label="Evolução da mediana das odds por seleção"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={movement} margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.75} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={36}
                />
                <YAxis
                  domain={["auto", "auto"]}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                />
                <RechartsTooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "var(--muted-foreground)" }}
                />
                {selections.map((selection, index) => (
                  <Line
                    key={selection}
                    type="monotone"
                    dataKey={selection}
                    name={selectionLabels.get(selection) ?? selection}
                    stroke={
                      selectionTone(selection, index) === "primary"
                        ? "var(--primary)"
                        : "var(--destructive)"
                    }
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <AnalysisEmpty
            title="Movimento ainda insuficiente"
            description="O histórico aparecerá quando houver pelo menos duas observações da mesma linha."
            className="min-h-36"
          />
        )}
      </section>

      <section className="min-w-0" aria-labelledby="bookmaker-title">
        <div className="mb-2 flex items-center justify-between">
          <SectionLabel id="bookmaker-title">Cotação por casa de apostas</SectionLabel>
          <Badge variant="outline">{quoteGroups.length} fontes</Badge>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Casa</TableHead>
              {selections.map((selection) => (
                <TableHead key={selection} className="text-right">
                  {selectionLabels.get(selection) ?? selection}
                </TableHead>
              ))}
              <TableHead className="hidden text-right md:table-cell">Atualizado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quoteGroups.map((group) => (
              <TableRow key={group.bookmaker}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    {group.preferred ? (
                      <CheckCircle2
                        className="size-3.5 text-success"
                        aria-label="Bookmaker preferido"
                      />
                    ) : null}
                    {group.bookmaker}
                  </span>
                </TableCell>
                {selections.map((selection) => {
                  const value = group.prices.get(selection) ?? null;
                  const best = consensus.get(selection)
                    ? number(consensus.get(selection)!, "bestOdds", "best_odds")
                    : null;
                  return (
                    <TableCell
                      key={selection}
                      className={cn(
                        "text-right font-mono",
                        best !== null && value === best && "font-semibold text-success",
                      )}
                    >
                      {formatOdd(value)}
                    </TableCell>
                  );
                })}
                <TableCell className="hidden text-right text-xs text-muted-foreground md:table-cell">
                  {formatTime(group.updatedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      {quoteGroups.length >= 2 ? (
        <Alert className="border-success/25 bg-success/5">
          <CheckCircle2 className="text-success" />
          <AlertTitle>Consenso publicável</AlertTitle>
          <AlertDescription>
            Mediana calculada com {quoteGroups.length} fontes para a mesma seleção e linha.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="border-warning/30 bg-warning/5">
          <AlertTriangle className="text-warning" />
          <AlertTitle>Consenso indisponível</AlertTitle>
          <AlertDescription>
            São necessárias ao menos duas fontes para publicar a mediana.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
