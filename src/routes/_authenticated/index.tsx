import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CheckCircle2, XCircle, TrendingUp, Target, DollarSign, Activity } from "lucide-react";
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
  COLOR_GRID,
  COLOR_AXIS,
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
import { usePrognosticos, useConfiguracao, MERCADOS_DEFAULT, ESPORTES_DEFAULT } from "@/lib/db";
import { LeagueFilter } from "@/components/league-filter";
import { PeriodFilter } from "@/components/period-filter";
import { formatBR } from "@/lib/date-br";
import {
  computeMetrics,
  computeValidationMetrics,
  bankrollTimeline,
  lucroUnidades,
  lucroUnidadesAnalitico,
  matchesValidationFilter,
  rangeFromPeriodo,
  dateInRange,
  type ValidationMetricsFilter,
  type PeriodoFiltro,
} from "@/lib/metrics";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Dashboard — ASP Insights" },
      { name: "description", content: "Visão executiva de prognósticos, ROI e bankroll." },
    ],
  }),
  component: Dashboard,
});

const chartGrid = COLOR_GRID;
const axisColor = COLOR_AXIS;

const ESPORTES = ["Todos", ...ESPORTES_DEFAULT];
const MERCADOS = ["Todos", ...MERCADOS_DEFAULT];

function Dashboard() {
  const { data: prognosticos = [] } = usePrognosticos();
  const { data: cfg } = useConfiguracao();

  const [periodo, setPeriodo] = useState<PeriodoFiltro>("tudo");
  const [customIni, setCustomIni] = useState("");
  const [customFim, setCustomFim] = useState("");
  const [esporte, setEsporte] = useState("Todos");
  const [liga, setLiga] = useState("all");
  const [mercado, setMercado] = useState("Todos");
  const [validacao, setValidacao] = useState<ValidationMetricsFilter>("confirmadas");

  const { ini, fim } = rangeFromPeriodo(periodo, customIni, customFim);

  const filtrados = useMemo(
    () =>
      prognosticos.filter((p) => {
        if (!dateInRange(p.data, ini, fim)) return false;
        if (esporte !== "Todos" && p.esporte !== esporte) return false;
        if (liga !== "all" && p.liga !== liga) return false;
        if (mercado !== "Todos" && p.mercado !== mercado) return false;
        return true;
      }),
    [prognosticos, ini, fim, esporte, liga, mercado],
  );

  const officialMetrics = useMemo(() => computeMetrics(filtrados, cfg), [filtrados, cfg]);
  const metrics = useMemo(
    () => computeValidationMetrics(filtrados, cfg, validacao),
    [filtrados, cfg, validacao],
  );
  const timeline = useMemo(
    () => bankrollTimeline(filtrados, cfg?.banca_inicial ?? 0, cfg?.valor_unidade_padrao ?? 0),
    [filtrados, cfg],
  );

  const sportPerf = useMemo(() => {
    const map = new Map<string, { lucro: number; stake: number }>();
    filtrados
      .filter((p) => matchesValidationFilter(p, validacao))
      .forEach((p) => {
        const cur = map.get(p.esporte) ?? { lucro: 0, stake: 0 };
        cur.lucro += validacao === "confirmadas" ? lucroUnidades(p) : lucroUnidadesAnalitico(p);
        cur.stake +=
          validacao === "confirmadas"
            ? p.stake
            : p.status_validacao === "PULAR" && p.stake <= 0
              ? 1
              : p.stake;
        map.set(p.esporte, cur);
      });
    return Array.from(map.entries()).map(([esporte, v]) => ({
      esporte,
      lucro: Number(v.lucro.toFixed(2)),
    }));
  }, [filtrados, validacao]);

  const sportPerfRoi = useMemo(() => {
    const map = new Map<string, { lucro: number; stake: number }>();
    filtrados
      .filter((p) => matchesValidationFilter(p, validacao))
      .forEach((p) => {
        const cur = map.get(p.esporte) ?? { lucro: 0, stake: 0 };
        cur.lucro += validacao === "confirmadas" ? lucroUnidades(p) : lucroUnidadesAnalitico(p);
        cur.stake +=
          validacao === "confirmadas"
            ? p.stake
            : p.status_validacao === "PULAR" && p.stake <= 0
              ? 1
              : p.stake;
        map.set(p.esporte, cur);
      });
    return Array.from(map.entries()).map(([esporte, v]) => ({
      esporte,
      roi: v.stake ? Number(((v.lucro / v.stake) * 100).toFixed(1)) : 0,
    }));
  }, [filtrados, validacao]);

  const monthlyResults = useMemo(() => {
    const map = new Map<string, number>();
    filtrados
      .filter((p) => matchesValidationFilter(p, validacao))
      .forEach((p) => {
        const mes = p.data.slice(0, 7);
        map.set(
          mes,
          (map.get(mes) ?? 0) +
            (validacao === "confirmadas" ? lucroUnidades(p) : lucroUnidadesAnalitico(p)),
        );
      });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, lucro]) => ({ mes, lucro: Number(lucro.toFixed(2)) }));
  }, [filtrados, validacao]);

  const marketPerf = useMemo(() => {
    const map = new Map<string, number>();
    filtrados
      .filter((p) => matchesValidationFilter(p, validacao))
      .forEach((p) =>
        map.set(
          p.mercado,
          (map.get(p.mercado) ?? 0) +
            (validacao === "confirmadas" ? lucroUnidades(p) : lucroUnidadesAnalitico(p)),
        ),
      );
    return Array.from(map.entries()).map(([mercado, lucro]) => ({
      mercado,
      lucro: Number(lucro.toFixed(2)),
    }));
  }, [filtrados, validacao]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard Executivo</h1>
        <p className="text-sm text-muted-foreground">
          Visão geral do desempenho dos modelos de previsão.
        </p>
      </div>

      {/* Filtros */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-end gap-3">
          <PeriodFilter
            periodo={periodo}
            onPeriodoChange={setPeriodo}
            customIni={customIni}
            customFim={customFim}
            onCustomIniChange={setCustomIni}
            onCustomFimChange={setCustomFim}
          />
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">
              Esporte
            </label>
            <Select value={esporte} onValueChange={setEsporte}>
              <SelectTrigger className="h-9 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ESPORTES.map((e) => (
                  <SelectItem key={e} value={e}>
                    {e}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">
              Liga
            </label>
            <LeagueFilter
              sport={esporte === "Todos" ? "all" : esporte}
              value={liga}
              onChange={setLiga}
              className="h-9 w-48"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">
              Mercado
            </label>
            <Select value={mercado} onValueChange={setMercado}>
              <SelectTrigger className="h-9 w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MERCADOS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">
              Validação
            </label>
            <Select
              value={validacao}
              onValueChange={(v) => setValidacao(v as ValidationMetricsFilter)}
            >
              <SelectTrigger className="h-9 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="confirmadas">Confirmadas</SelectItem>
                <SelectItem value="puladas">Puladas</SelectItem>
                <SelectItem value="todas">Todas</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
        <StatCard label="Greens" value={String(metrics.greens)} icon={CheckCircle2} tone="up" />
        <StatCard label="Reds" value={String(metrics.reds)} icon={XCircle} tone="down" />
        <StatCard
          label="ODD MÉDIA"
          value={metrics.oddMediaGreens ? metrics.oddMediaGreens.toFixed(2) : "-"}
          icon={Target}
          tone="neutral"
        />
        <StatCard
          label="Lucro (u)"
          value={`${withSign(metrics.lucroU)}u`}
          icon={Activity}
          tone={metrics.lucroU > 0 ? "up" : metrics.lucroU < 0 ? "down" : "neutral"}
        />
        <StatCard
          label="Lucro Real"
          value={`${metrics.lucroReais >= 0 ? "+" : "-"}R$ ${Math.abs(metrics.lucroReais).toFixed(2)}`}
          icon={DollarSign}
          tone={metrics.lucroReais > 0 ? "up" : metrics.lucroReais < 0 ? "down" : "neutral"}
        />
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
      </div>

      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Evolução da Banca
            </h3>
            <span
              className="font-mono text-xs"
              style={{
                color: signColor(officialMetrics.bancaAtual - officialMetrics.bancaInicial),
              }}
            >
              R$ {officialMetrics.bancaAtual.toFixed(2)}
            </span>
          </div>
          <ResponsiveContainer width="100%" height={340}>
            <LineChart data={timeline}>
              <defs>
                <linearGradient id="bancaPos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={signColor(1)} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={signColor(1)} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="bancaNeg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={signColor(-1)} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={signColor(-1)} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis
                dataKey="data"
                stroke={axisColor}
                fontSize={10}
                tickFormatter={(d) => String(d).slice(5)}
              />
              <YAxis stroke={axisColor} fontSize={10} domain={["auto", "auto"]} />
              <ReferenceLine
                y={officialMetrics.bancaInicial}
                stroke={COLOR_REFERENCE}
                strokeDasharray="4 4"
                label={{
                  value: "Banca inicial",
                  position: "insideTopRight",
                  fill: COLOR_NEUTRAL,
                  fontSize: 10,
                }}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    headerFormatter={(d) => formatBR(d)}
                    formatter={(v, _n, dk) => {
                      if (dk === "banca") {
                        return {
                          label: "Banca",
                          display: `R$ ${v.toFixed(2)}`,
                          color: signColor(v - officialMetrics.bancaInicial),
                        };
                      }
                      if (dk === "lucroAcum") {
                        return {
                          label: "Lucro acum.",
                          display: `${v >= 0 ? "+" : "-"}R$ ${Math.abs(v).toFixed(2)}`,
                        };
                      }
                      return { label: dk, display: String(v) };
                    }}
                  />
                }
              />
              <Line
                type="monotone"
                dataKey="banca"
                stroke={signColor(officialMetrics.bancaAtual - officialMetrics.bancaInicial)}
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
              />
              <Line type="monotone" dataKey="lucroAcum" hide />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Evolução do ROI
            </h3>
            <span className="font-mono text-xs" style={{ color: signColor(metrics.roi) }}>
              {withSign(metrics.roi)}%
            </span>
          </div>
          <ResponsiveContainer width="100%" height={340}>
            <LineChart data={timeline}>
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis
                dataKey="data"
                stroke={axisColor}
                fontSize={10}
                tickFormatter={(d) => String(d).slice(5)}
              />
              <YAxis stroke={axisColor} fontSize={10} />
              <ReferenceLine y={0} stroke={COLOR_REFERENCE} strokeWidth={1.5} />
              <Tooltip
                content={
                  <ChartTooltip
                    headerFormatter={(d) => formatBR(d)}
                    formatter={(v) => ({
                      label: "ROI",
                      display: `${withSign(v)}%`,
                      color: signColor(v),
                    })}
                  />
                }
              />
              <Line
                type="monotone"
                dataKey="roi"
                stroke={signColor(metrics.roi)}
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Resultado por Esporte (u)
          </h3>
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={sportPerf} margin={{ top: 16, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis dataKey="esporte" stroke={axisColor} fontSize={10} />
              <YAxis stroke={axisColor} fontSize={10} />
              <ReferenceLine y={0} stroke={COLOR_REFERENCE} />
              <Tooltip
                cursor={{ fill: "oklch(0.28 0.02 250 / 0.3)" }}
                content={
                  <ChartTooltip
                    formatter={(v) => ({
                      label: "Lucro",
                      display: `${withSign(v)}u`,
                      color: signColor(v),
                    })}
                  />
                }
              />
              <Bar dataKey="lucro" radius={[4, 4, 0, 0]}>
                {sportPerf.map((d, i) => (
                  <Cell key={i} fill={signColor(d.lucro)} />
                ))}
                <LabelList
                  dataKey="lucro"
                  position="top"
                  formatter={(v: number) => `${withSign(v)}u`}
                  style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", fill: COLOR_AXIS }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Resultado por Mercado (u)
          </h3>
          <ResponsiveContainer width="100%" height={Math.max(340, marketPerf.length * 44 + 60)}>
            <BarChart
              data={marketPerf}
              layout="vertical"
              margin={{ top: 8, right: 48, left: 0, bottom: 8 }}
            >
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis type="number" stroke={axisColor} fontSize={10} />
              <YAxis
                type="category"
                dataKey="mercado"
                stroke={axisColor}
                fontSize={10}
                width={140}
              />
              <ReferenceLine x={0} stroke={COLOR_REFERENCE} />
              <Tooltip
                cursor={{ fill: "oklch(0.28 0.02 250 / 0.3)" }}
                content={
                  <ChartTooltip
                    formatter={(v) => ({
                      label: "Lucro",
                      display: `${withSign(v)}u`,
                      color: signColor(v),
                    })}
                  />
                }
              />
              <Bar dataKey="lucro" radius={[0, 4, 4, 0]}>
                {marketPerf.map((d, i) => (
                  <Cell key={i} fill={signColor(d.lucro)} />
                ))}
                <LabelList
                  dataKey="lucro"
                  position="right"
                  formatter={(v: number) => `${withSign(v)}u`}
                  style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", fill: COLOR_AXIS }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            ROI por Esporte (%)
          </h3>
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={sportPerfRoi} margin={{ top: 16, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis dataKey="esporte" stroke={axisColor} fontSize={10} />
              <YAxis stroke={axisColor} fontSize={10} />
              <ReferenceLine y={0} stroke={COLOR_REFERENCE} />
              <Tooltip
                cursor={{ fill: "oklch(0.28 0.02 250 / 0.3)" }}
                content={
                  <ChartTooltip
                    formatter={(v) => ({
                      label: "ROI",
                      display: `${withSign(v, 1)}%`,
                      color: signColor(v),
                    })}
                  />
                }
              />
              <Bar dataKey="roi" radius={[4, 4, 0, 0]}>
                {sportPerfRoi.map((d, i) => (
                  <Cell key={i} fill={signColor(d.roi)} />
                ))}
                <LabelList
                  dataKey="roi"
                  position="top"
                  formatter={(v: number) => `${withSign(v, 1)}%`}
                  style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", fill: COLOR_AXIS }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Resultado por Mês (u)
          </h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={monthlyResults} margin={{ top: 16, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis dataKey="mes" stroke={axisColor} fontSize={10} />
              <YAxis stroke={axisColor} fontSize={10} />
              <ReferenceLine y={0} stroke={COLOR_REFERENCE} />
              <Tooltip
                cursor={{ fill: "oklch(0.28 0.02 250 / 0.3)" }}
                content={
                  <ChartTooltip
                    formatter={(v) => ({
                      label: "Lucro",
                      display: `${withSign(v)}u`,
                      color: signColor(v),
                    })}
                  />
                }
              />
              <Bar dataKey="lucro" radius={[4, 4, 0, 0]}>
                {monthlyResults.map((entry, i) => (
                  <Cell key={i} fill={signColor(entry.lucro)} />
                ))}
                <LabelList
                  dataKey="lucro"
                  position="top"
                  formatter={(v: number) => `${withSign(v)}u`}
                  style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", fill: COLOR_AXIS }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
