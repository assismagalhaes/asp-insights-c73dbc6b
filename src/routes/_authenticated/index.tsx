import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  CheckCircle2,
  DollarSign,
  Target,
  TrendingUp,
  XCircle,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Cell,
  LabelList,
  ReferenceLine,
} from "recharts";

import { ChartTooltip } from "@/components/chart-tooltip";
import {
  COLOR_AXIS,
  COLOR_GRID,
  COLOR_NEUTRAL,
  COLOR_REFERENCE,
  signColor,
  withSign,
} from "@/lib/chart-colors";
import { StatCard } from "@/components/stat-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  useConfiguracao,
  usePrognosticos,
  ESPORTES_DEFAULT,
  MERCADOS_DEFAULT,
  type Prognostico,
} from "@/lib/db";
import { formatBR } from "@/lib/date-br";
import {
  bankrollTimeline,
  computeMetrics,
  dateInRange,
  lucroUnidades,
  rangeFromPeriodo,
  type PeriodoFiltro,
} from "@/lib/metrics";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Dashboard - ASP Insights" },
      { name: "description", content: "Visao executiva de prognosticos, ROI e bankroll." },
    ],
  }),
  component: Dashboard,
});

type DashboardPeriodo = Extract<PeriodoFiltro, "hoje" | "ontem" | "7d" | "15d" | "30d" | "tudo" | "custom">;

const DASH_PERIODS: { value: DashboardPeriodo; label: string }[] = [
  { value: "hoje", label: "Hoje" },
  { value: "ontem", label: "Ontem" },
  { value: "7d", label: "Ultimos 7 dias" },
  { value: "15d", label: "Ultimos 15 dias" },
  { value: "30d", label: "Ultimos 30 dias" },
  { value: "tudo", label: "Todo o periodo" },
  { value: "custom", label: "Personalizado" },
];

const SPORTS = ["all", ...ESPORTES_DEFAULT];
const chartGrid = COLOR_GRID;
const axisColor = COLOR_AXIS;

function Dashboard() {
  const { data: prognosticos = [] } = usePrognosticos();
  const { data: cfg } = useConfiguracao();

  const [periodo, setPeriodo] = useState<DashboardPeriodo>("tudo");
  const [customIni, setCustomIni] = useState("");
  const [customFim, setCustomFim] = useState("");
  const [esporte, setEsporte] = useState("all");
  const [liga, setLiga] = useState("all");
  const [mercado, setMercado] = useState("all");

  const { ini, fim } = rangeFromPeriodo(periodo, customIni, customFim);

  const ligas = useMemo(() => {
    return uniq(
      prognosticos
        .filter((p) => esporte === "all" || p.esporte === esporte)
        .map((p) => p.liga),
    );
  }, [prognosticos, esporte]);

  const mercados = useMemo(() => {
    const observed = uniq(
      prognosticos
        .filter((p) => esporte === "all" || p.esporte === esporte)
        .filter((p) => liga === "all" || p.liga === liga)
        .map((p) => p.mercado),
    );
    return observed.length || esporte !== "all" ? observed : MERCADOS_DEFAULT;
  }, [prognosticos, esporte, liga]);

  const filtrados = useMemo(
    () =>
      prognosticos.filter((p) => {
        if (!dateInRange(p.data, ini, fim)) return false;
        if (esporte !== "all" && p.esporte !== esporte) return false;
        if (liga !== "all" && p.liga !== liga) return false;
        if (mercado !== "all" && p.mercado !== mercado) return false;
        return true;
      }),
    [prognosticos, ini, fim, esporte, liga, mercado],
  );

  const metrics = useMemo(() => computeMetrics(filtrados, cfg), [filtrados, cfg]);
  const timeline = useMemo(
    () => bankrollTimeline(filtrados, cfg?.banca_inicial ?? 0, cfg?.valor_unidade_padrao ?? 0),
    [filtrados, cfg],
  );

  const confirmed = useMemo(
    () => filtrados.filter((p) => p.status_validacao === "CONFIRMA"),
    [filtrados],
  );

  const sportPerformance = useMemo(
    () => groupPerformance(confirmed, (p) => p.esporte, "esporte"),
    [confirmed],
  );
  const leaguePerformance = useMemo(
    () => groupPerformance(confirmed, (p) => p.liga || "Sem liga", "liga"),
    [confirmed],
  );
  const marketPerformance = useMemo(
    () => groupPerformance(confirmed, (p) => p.mercado, "mercado"),
    [confirmed],
  );
  const monthlyResults = useMemo(() => {
    const map = new Map<string, number>();
    confirmed.forEach((p) => {
      const mes = p.data.slice(0, 7);
      map.set(mes, (map.get(mes) ?? 0) + lucroUnidades(p));
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, lucro]) => ({ mes, lucro: Number(lucro.toFixed(2)) }));
  }, [confirmed]);

  const resetSport = (value: string) => {
    setEsporte(value);
    setLiga("all");
    setMercado("all");
  };

  const resetLiga = (value: string) => {
    setLiga(value);
    setMercado("all");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard Executivo</h1>
        <p className="text-sm text-muted-foreground">
          Performance consolidada por periodo, esporte, liga e mercado.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-end gap-3">
          <FilterField label="Periodo">
            <Select value={periodo} onValueChange={(v) => setPeriodo(v as DashboardPeriodo)}>
              <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DASH_PERIODS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          {periodo === "custom" && (
            <>
              <FilterField label="De">
                <Input type="date" value={customIni} onChange={(e) => setCustomIni(e.target.value)} className="h-9 w-40" />
              </FilterField>
              <FilterField label="Ate">
                <Input type="date" value={customFim} onChange={(e) => setCustomFim(e.target.value)} className="h-9 w-40" />
              </FilterField>
            </>
          )}

          <FilterField label="Esporte">
            <Select value={esporte} onValueChange={resetSport}>
              <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SPORTS.map((s) => (
                  <SelectItem key={s} value={s}>{s === "all" ? "Todos os esportes" : s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Liga">
            <Select value={liga} onValueChange={resetLiga}>
              <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as ligas</SelectItem>
                {ligas.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Mercado">
            <Select value={mercado} onValueChange={setMercado}>
              <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os mercados</SelectItem>
                {mercados.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterField>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Greens" value={String(metrics.greens)} icon={CheckCircle2} tone="up" />
        <StatCard label="Reds" value={String(metrics.reds)} icon={XCircle} tone="down" />
        <StatCard
          label="ROI"
          value={`${withSign(metrics.roi)}%`}
          icon={TrendingUp}
          tone={metrics.roi > 0 ? "up" : metrics.roi < 0 ? "down" : "neutral"}
        />
        <StatCard
          label="Win Rate"
          value={`${metrics.winRate.toFixed(1)}%`}
          icon={Target}
          tone={metrics.winRate >= 50 ? "up" : metrics.winRate > 0 ? "down" : "neutral"}
        />
        <StatCard
          label="Lucro (u)"
          value={`${withSign(metrics.lucroU)}u`}
          icon={Activity}
          tone={metrics.lucroU > 0 ? "up" : metrics.lucroU < 0 ? "down" : "neutral"}
        />
        <StatCard
          label="Lucro R$"
          value={`${metrics.lucroReais >= 0 ? "+" : "-"}R$ ${Math.abs(metrics.lucroReais).toFixed(2)}`}
          icon={DollarSign}
          tone={metrics.lucroReais > 0 ? "up" : metrics.lucroReais < 0 ? "down" : "neutral"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Evolucao da Banca" meta={`R$ ${metrics.bancaAtual.toFixed(2)}`} tone={metrics.bancaAtual - metrics.bancaInicial}>
          {timeline.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={timeline}>
                <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
                <XAxis dataKey="data" stroke={axisColor} fontSize={10} tickFormatter={(d) => String(d).slice(5)} />
                <YAxis stroke={axisColor} fontSize={10} domain={["auto", "auto"]} />
                <ReferenceLine
                  y={metrics.bancaInicial}
                  stroke={COLOR_REFERENCE}
                  strokeDasharray="4 4"
                  label={{ value: "Banca inicial", position: "insideTopRight", fill: COLOR_NEUTRAL, fontSize: 10 }}
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      headerFormatter={(d) => formatBR(d)}
                      formatter={(v, _n, dk) => {
                        if (dk === "banca") {
                          return { label: "Banca", display: `R$ ${v.toFixed(2)}`, color: signColor(v - metrics.bancaInicial) };
                        }
                        if (dk === "lucroAcum") {
                          return { label: "Lucro acum.", display: `${v >= 0 ? "+" : "-"}R$ ${Math.abs(v).toFixed(2)}` };
                        }
                        return { label: String(dk), display: String(v) };
                      }}
                    />
                  }
                />
                <Line type="monotone" dataKey="banca" stroke={signColor(metrics.bancaAtual - metrics.bancaInicial)} strokeWidth={2.5} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="lucroAcum" hide />
              </LineChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </ChartCard>

        <ChartCard title="Evolucao do ROI" meta={`${withSign(metrics.roi)}%`} tone={metrics.roi}>
          {timeline.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={timeline}>
                <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
                <XAxis dataKey="data" stroke={axisColor} fontSize={10} tickFormatter={(d) => String(d).slice(5)} />
                <YAxis stroke={axisColor} fontSize={10} />
                <ReferenceLine y={0} stroke={COLOR_REFERENCE} strokeWidth={1.5} />
                <Tooltip content={<ChartTooltip headerFormatter={(d) => formatBR(d)} formatter={(v) => ({ label: "ROI", display: `${withSign(v)}%`, color: signColor(v) })} />} />
                <Line type="monotone" dataKey="roi" stroke={signColor(metrics.roi)} strokeWidth={2.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </ChartCard>

        <VerticalBarCard title="Resultado por Esporte (u)" data={sportPerformance} labelKey="esporte" valueKey="lucro" suffix="u" />
        <VerticalBarCard title="ROI por Esporte (%)" data={sportPerformance} labelKey="esporte" valueKey="roi" suffix="%" decimals={1} />
        <HorizontalBarCard title="Resultado por Mercado (u)" data={marketPerformance} labelKey="mercado" valueKey="lucro" suffix="u" />
        <HorizontalBarCard title="ROI por Mercado (%)" data={marketPerformance} labelKey="mercado" valueKey="roi" suffix="%" decimals={1} />
        <HorizontalBarCard title="Resultado por Liga (u)" data={leaguePerformance} labelKey="liga" valueKey="lucro" suffix="u" />
        <VerticalBarCard title="Resultado por Mes (u)" data={monthlyResults} labelKey="mes" valueKey="lucro" suffix="u" />
      </div>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function ChartCard({ title, meta, tone, children }: { title: string; meta?: string; tone?: number; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        {meta && <span className="font-mono text-xs" style={{ color: signColor(tone ?? 0) }}>{meta}</span>}
      </div>
      {children}
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-[260px] items-center justify-center rounded-md border border-dashed border-border text-center text-sm text-muted-foreground">
      Nenhum resultado encontrado para os filtros selecionados.
    </div>
  );
}

function VerticalBarCard({
  title,
  data,
  labelKey,
  valueKey,
  suffix,
  decimals = 2,
}: {
  title: string;
  data: Array<Record<string, string | number>>;
  labelKey: string;
  valueKey: string;
  suffix: string;
  decimals?: number;
}) {
  return (
    <ChartCard title={title}>
      {data.length ? (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 16, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
            <XAxis dataKey={labelKey} stroke={axisColor} fontSize={10} />
            <YAxis stroke={axisColor} fontSize={10} />
            <ReferenceLine y={0} stroke={COLOR_REFERENCE} />
            <Tooltip
              cursor={{ fill: "oklch(0.28 0.02 250 / 0.3)" }}
              content={<ChartTooltip formatter={(v) => ({ label: title, display: `${withSign(v, decimals)}${suffix}`, color: signColor(v) })} />}
            />
            <Bar dataKey={valueKey} radius={[4, 4, 0, 0]}>
              {data.map((d, i) => <Cell key={i} fill={signColor(Number(d[valueKey]))} />)}
              <LabelList
                dataKey={valueKey}
                position="top"
                formatter={(v: number) => `${withSign(v, decimals)}${suffix}`}
                style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", fill: COLOR_AXIS }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : <EmptyChart />}
    </ChartCard>
  );
}

function HorizontalBarCard({
  title,
  data,
  labelKey,
  valueKey,
  suffix,
  decimals = 2,
}: {
  title: string;
  data: Array<Record<string, string | number>>;
  labelKey: string;
  valueKey: string;
  suffix: string;
  decimals?: number;
}) {
  return (
    <ChartCard title={title}>
      {data.length ? (
        <ResponsiveContainer width="100%" height={Math.max(260, data.length * 34 + 44)}>
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 56, left: 0, bottom: 8 }}>
            <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
            <XAxis type="number" stroke={axisColor} fontSize={10} />
            <YAxis type="category" dataKey={labelKey} stroke={axisColor} fontSize={10} width={150} />
            <ReferenceLine x={0} stroke={COLOR_REFERENCE} />
            <Tooltip
              cursor={{ fill: "oklch(0.28 0.02 250 / 0.3)" }}
              content={<ChartTooltip formatter={(v) => ({ label: title, display: `${withSign(v, decimals)}${suffix}`, color: signColor(v) })} />}
            />
            <Bar dataKey={valueKey} radius={[0, 4, 4, 0]}>
              {data.map((d, i) => <Cell key={i} fill={signColor(Number(d[valueKey]))} />)}
              <LabelList
                dataKey={valueKey}
                position="right"
                formatter={(v: number) => `${withSign(v, decimals)}${suffix}`}
                style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", fill: COLOR_AXIS }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : <EmptyChart />}
    </ChartCard>
  );
}

function groupPerformance<T extends string>(
  rows: Prognostico[],
  getName: (p: Prognostico) => string,
  key: T,
): Array<Record<T | "lucro" | "roi", string | number>> {
  const map = new Map<string, { lucro: number; stake: number }>();
  rows.forEach((p) => {
    const name = getName(p).trim() || "Sem informacao";
    const current = map.get(name) ?? { lucro: 0, stake: 0 };
    current.lucro += lucroUnidades(p);
    current.stake += p.stake;
    map.set(name, current);
  });
  return Array.from(map.entries())
    .map(([name, value]) => ({
      [key]: name,
      lucro: Number(value.lucro.toFixed(2)),
      roi: value.stake ? Number(((value.lucro / value.stake) * 100).toFixed(1)) : 0,
    }) as Record<T | "lucro" | "roi", string | number>)
    .sort((a, b) => Math.abs(Number(b.lucro)) - Math.abs(Number(a.lucro)))
    .slice(0, 12);
}

function uniq(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
}
