import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  Cell,
  LabelList,
  ReferenceLine,
} from "recharts";
import { useResultadosFinanceiros, useConfiguracao, ESPORTES_DEFAULT, MERCADOS_DEFAULT, sanitizeOptionList } from "@/lib/db";
import { calculatePerformanceStats, rangeFromPeriodo, type PeriodoFiltro } from "@/lib/metrics";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LeagueFilter } from "@/components/league-filter";
import { PeriodFilter } from "@/components/period-filter";
import { ChartTooltip } from "@/components/chart-tooltip";
import { ChartEmptyState } from "@/components/chart-empty-state";
import { formatBR } from "@/lib/date-br";
import {
  COLOR_GRID,
  COLOR_AXIS,
  COLOR_REFERENCE,
  COLOR_NEUTRAL,
  signColor,
  withSign,
} from "@/lib/chart-colors";

export const Route = createFileRoute("/_authenticated/estatisticas")({
  head: () => ({ meta: [{ title: "ROI e Estatísticas — ASP Insights" }] }),
  component: Estatisticas,
});

const chartGrid = COLOR_GRID;
const axisColor = COLOR_AXIS;

function Estatisticas() {
  const { data: resultadosFinanceiros = [] } = useResultadosFinanceiros();
  const { data: cfg } = useConfiguracao();
  const esportes = sanitizeOptionList(cfg?.esportes_ativos, ESPORTES_DEFAULT);
  const mercados = sanitizeOptionList(cfg?.mercados_ativos, MERCADOS_DEFAULT);

  const [fEsporte, setFEsporte] = useState("all");
  const [fLiga, setFLiga] = useState("all");
  const [fMercado, setFMercado] = useState("all");
  const [periodo, setPeriodo] = useState<PeriodoFiltro>("tudo");
  const [customIni, setCustomIni] = useState("");
  const [customFim, setCustomFim] = useState("");

  const { ini, fim } = rangeFromPeriodo(periodo, customIni, customFim);

  const stats = useMemo(
    () =>
      calculatePerformanceStats(resultadosFinanceiros, cfg, {
        ini,
        fim,
        esporte: fEsporte,
        liga: fLiga,
        mercado: fMercado,
      }),
    [resultadosFinanceiros, cfg, ini, fim, fEsporte, fLiga, fMercado],
  );

  const sportPerformance = useMemo(() => {
    return stats.resultadoPorEsporte.map((p) => ({
      esporte: p.nome,
      lucro: Number(p.lucroU.toFixed(2)),
      roi: Number(p.roi.toFixed(1)),
    }));
  }, [stats]);

  const marketPerformance = useMemo(() => {
    return stats.resultadoPorMercado.map((p) => ({
      mercado: p.nome,
      lucro: Number(p.lucroU.toFixed(2)),
      roi: Number(p.roi.toFixed(1)),
    }));
  }, [stats]);

  const leaguePerformance = useMemo(() => {
    return stats.resultadoPorLiga.map((p) => ({
      liga: p.nome,
      lucro: Number(p.lucroU.toFixed(2)),
      roi: Number(p.roi.toFixed(1)),
    }));
  }, [stats]);

  const monthlyResults = useMemo(() => {
    return stats.resultadoPorMes.map((p) => ({ mes: p.mes, lucro: p.lucroU }));
  }, [stats]);

  const chartBanca = stats.evolucaoBanca;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">ROI & Estatísticas</h1>
        <p className="text-sm text-muted-foreground">
          Análise detalhada de desempenho por esporte, mercado e período.
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
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">Esporte</label>
            <Select value={fEsporte} onValueChange={(v) => { setFEsporte(v); setFLiga("all"); }}>
              <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Esporte" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os esportes</SelectItem>
                {esportes.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">Liga</label>
            <LeagueFilter sport={fEsporte} value={fLiga} onChange={setFLiga} className="h-9 w-48" />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">Mercado</label>
            <Select value={fMercado} onValueChange={setFMercado}>
              <SelectTrigger className="h-9 w-52"><SelectValue placeholder="Mercado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os mercados</SelectItem>
                {mercados.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Resultado por Esporte (u)">
          {sportPerformance.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={sportPerformance} margin={{ top: 16, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis dataKey="esporte" stroke={axisColor} fontSize={10} />
              <YAxis stroke={axisColor} fontSize={10} />
              <ReferenceLine y={0} stroke={COLOR_REFERENCE} />
              <Tooltip
                cursor={{ fill: "oklch(0.28 0.02 250 / 0.3)" }}
                content={
                  <ChartTooltip formatter={(v) => ({ label: "Lucro", display: `${withSign(v)}u`, color: signColor(v) })} />
                }
              />
              <Bar dataKey="lucro" radius={[4, 4, 0, 0]}>
                {sportPerformance.map((d, i) => (
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
          ) : (
            <ChartEmptyState height={260} />
          )}
        </Card>

        <Card title="ROI por Esporte (%)">
          {sportPerformance.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={sportPerformance} margin={{ top: 16, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis dataKey="esporte" stroke={axisColor} fontSize={10} />
              <YAxis stroke={axisColor} fontSize={10} />
              <ReferenceLine y={0} stroke={COLOR_REFERENCE} />
              <Tooltip
                cursor={{ fill: "oklch(0.28 0.02 250 / 0.3)" }}
                content={
                  <ChartTooltip formatter={(v) => ({ label: "ROI", display: `${withSign(v, 1)}%`, color: signColor(v) })} />
                }
              />
              <Bar dataKey="roi" radius={[4, 4, 0, 0]}>
                {sportPerformance.map((d, i) => (
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
          ) : (
            <ChartEmptyState height={260} />
          )}
        </Card>

        <Card title="Resultado por Mercado (u)">
          {marketPerformance.length ? (
            <ResponsiveContainer width="100%" height={Math.max(260, marketPerformance.length * 32 + 40)}>
              <BarChart data={marketPerformance} layout="vertical" margin={{ top: 8, right: 48, left: 0, bottom: 8 }}>
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis type="number" stroke={axisColor} fontSize={10} />
              <YAxis type="category" dataKey="mercado" stroke={axisColor} fontSize={10} width={140} />
              <ReferenceLine x={0} stroke={COLOR_REFERENCE} />
              <Tooltip
                cursor={{ fill: "oklch(0.28 0.02 250 / 0.3)" }}
                content={
                  <ChartTooltip formatter={(v) => ({ label: "Lucro", display: `${withSign(v)}u`, color: signColor(v) })} />
                }
              />
              <Bar dataKey="lucro" radius={[0, 4, 4, 0]}>
                {marketPerformance.map((d, i) => (
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
          ) : (
            <ChartEmptyState height={260} />
          )}
        </Card>

        <Card title="ROI por Mercado (%)">
          {marketPerformance.length ? (
            <ResponsiveContainer width="100%" height={Math.max(260, marketPerformance.length * 32 + 40)}>
              <BarChart data={marketPerformance} layout="vertical" margin={{ top: 8, right: 48, left: 0, bottom: 8 }}>
                <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
                <XAxis type="number" stroke={axisColor} fontSize={10} />
                <YAxis type="category" dataKey="mercado" stroke={axisColor} fontSize={10} width={140} />
                <ReferenceLine x={0} stroke={COLOR_REFERENCE} />
                <Tooltip
                  cursor={{ fill: "oklch(0.28 0.02 250 / 0.3)" }}
                  content={
                    <ChartTooltip formatter={(v) => ({ label: "ROI", display: `${withSign(v, 1)}%`, color: signColor(v) })} />
                  }
                />
                <Bar dataKey="roi" radius={[0, 4, 4, 0]}>
                  {marketPerformance.map((d, i) => (
                    <Cell key={i} fill={signColor(d.roi)} />
                  ))}
                  <LabelList
                    dataKey="roi"
                    position="right"
                    formatter={(v: number) => `${withSign(v, 1)}%`}
                    style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", fill: COLOR_AXIS }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmptyState height={260} />
          )}
        </Card>

        <Card title="Resultado por Liga (u)">
          {leaguePerformance.length ? (
            <ResponsiveContainer width="100%" height={Math.max(260, leaguePerformance.length * 32 + 40)}>
              <BarChart data={leaguePerformance} layout="vertical" margin={{ top: 8, right: 48, left: 0, bottom: 8 }}>
                <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
                <XAxis type="number" stroke={axisColor} fontSize={10} />
                <YAxis type="category" dataKey="liga" stroke={axisColor} fontSize={10} width={140} />
                <ReferenceLine x={0} stroke={COLOR_REFERENCE} />
                <Tooltip
                  cursor={{ fill: "oklch(0.28 0.02 250 / 0.3)" }}
                  content={
                    <ChartTooltip formatter={(v) => ({ label: "Lucro", display: `${withSign(v)}u`, color: signColor(v) })} />
                  }
                />
                <Bar dataKey="lucro" radius={[0, 4, 4, 0]}>
                  {leaguePerformance.map((d, i) => (
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
          ) : (
            <ChartEmptyState height={260} />
          )}
        </Card>

        <Card title="Resultado por Mês (u)">
          {monthlyResults.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthlyResults} margin={{ top: 16, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis dataKey="mes" stroke={axisColor} fontSize={10} />
              <YAxis stroke={axisColor} fontSize={10} />
              <ReferenceLine y={0} stroke={COLOR_REFERENCE} />
              <Tooltip
                cursor={{ fill: "oklch(0.28 0.02 250 / 0.3)" }}
                content={
                  <ChartTooltip formatter={(v) => ({ label: "Lucro", display: `${withSign(v)}u`, color: signColor(v) })} />
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
          ) : (
            <ChartEmptyState height={260} />
          )}
        </Card>

        <Card title="Evolução da Banca" full>
          {chartBanca.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartBanca}>
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis dataKey="data" stroke={axisColor} fontSize={10} tickFormatter={(d) => String(d).slice(5)} />
              <YAxis stroke={axisColor} fontSize={10} />
              <ReferenceLine
                y={cfg?.banca_inicial ?? 0}
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
                        return { label: "Banca", display: `R$ ${v.toFixed(2)}`, color: signColor(v - (cfg?.banca_inicial ?? 0)) };
                      }
                      return { label: dk, display: String(v) };
                    }}
                  />
                }
              />
              <Line
                type="monotone"
                dataKey="banca"
                stroke={signColor((chartBanca.at(-1)?.banca ?? cfg?.banca_inicial ?? 0) - (cfg?.banca_inicial ?? 0))}
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
              />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmptyState height={280} />
          )}
        </Card>

        <Card title="Evolução do ROI" full>
          {chartBanca.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartBanca}>
                <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
                <XAxis dataKey="data" stroke={axisColor} fontSize={10} tickFormatter={(d) => String(d).slice(5)} />
                <YAxis stroke={axisColor} fontSize={10} />
                <ReferenceLine y={0} stroke={COLOR_REFERENCE} strokeWidth={1.5} />
                <Tooltip
                  content={
                    <ChartTooltip
                      headerFormatter={(d) => formatBR(d)}
                      formatter={(v) => ({ label: "ROI", display: `${withSign(v)}%`, color: signColor(v) })}
                    />
                  }
                />
                <Line
                  type="monotone"
                  dataKey="roi"
                  stroke={signColor(stats.roi)}
                  strokeWidth={2.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmptyState height={280} />
          )}
        </Card>
      </div>
    </div>
  );
}

function Card({ title, children, full }: { title: string; children: ReactNode; full?: boolean }) {
  return (
    <div className={`rounded-lg border border-border bg-card p-4 ${full ? "lg:col-span-2" : ""}`}>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}
