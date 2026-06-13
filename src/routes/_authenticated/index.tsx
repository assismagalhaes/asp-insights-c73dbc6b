import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  CheckCircle2,
  XCircle,
  TrendingUp,
  Target,
  DollarSign,
  ListChecks,
  Activity,
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
} from "recharts";
import { StatCard } from "@/components/stat-card";
import { StatusBadge, ResultBadge } from "@/components/status-badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  usePrognosticos,
  useConfiguracao,
  MERCADOS_DEFAULT,
  ESPORTES_DEFAULT,
} from "@/lib/db";
import { LeagueFilter } from "@/components/league-filter";
import { PeriodFilter } from "@/components/period-filter";
import { formatBR, formatHora } from "@/lib/date-br";
import {
  computeMetrics,
  bankrollTimeline,
  lucroUnidades,
  rangeFromPeriodo,
  dateInRange,
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

const chartGrid = "oklch(0.28 0.02 250)";
const axisColor = "oklch(0.68 0.02 250)";

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

  const metrics = useMemo(() => computeMetrics(filtrados, cfg), [filtrados, cfg]);
  const timeline = useMemo(
    () => bankrollTimeline(filtrados, cfg?.banca_inicial ?? 0, cfg?.valor_unidade_padrao ?? 0),
    [filtrados, cfg],
  );

  const sportPerf = useMemo(() => {
    const map = new Map<string, { lucro: number; stake: number }>();
    filtrados
      .filter((p) => p.status_validacao === "CONFIRMA")
      .forEach((p) => {
        const cur = map.get(p.esporte) ?? { lucro: 0, stake: 0 };
        cur.lucro += lucroUnidades(p);
        cur.stake += p.stake;
        map.set(p.esporte, cur);
      });
    return Array.from(map.entries()).map(([esporte, v]) => ({
      esporte,
      lucro: Number(v.lucro.toFixed(2)),
    }));
  }, [filtrados]);

  const marketPerf = useMemo(() => {
    const map = new Map<string, number>();
    filtrados
      .filter((p) => p.status_validacao === "CONFIRMA")
      .forEach((p) => map.set(p.mercado, (map.get(p.mercado) ?? 0) + lucroUnidades(p)));
    return Array.from(map.entries()).map(([mercado, lucro]) => ({
      mercado,
      lucro: Number(lucro.toFixed(2)),
    }));
  }, [filtrados]);

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
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">Período</label>
            <Select value={periodo} onValueChange={(v) => setPeriodo(v as PeriodoFiltro)}>
              <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIODOS.map((p) => <SelectItem key={p.v} value={p.v}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {periodo === "custom" && (
            <>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">De</label>
                <Input type="date" value={customIni} onChange={(e) => setCustomIni(e.target.value)} className="h-9 w-40" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">Até</label>
                <Input type="date" value={customFim} onChange={(e) => setCustomFim(e.target.value)} className="h-9 w-40" />
              </div>
            </>
          )}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">Esporte</label>
            <Select value={esporte} onValueChange={setEsporte}>
              <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ESPORTES.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">Liga</label>
            <LeagueFilter sport={esporte === "Todos" ? "all" : esporte} value={liga} onChange={setLiga} className="h-9 w-48" />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">Mercado</label>
            <Select value={mercado} onValueChange={setMercado}>
              <SelectTrigger className="h-9 w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MERCADOS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Greens" value={String(metrics.greens)} icon={CheckCircle2} trend="up" />
        <StatCard label="Reds" value={String(metrics.reds)} icon={XCircle} trend="down" />
        <StatCard
          label="Lucro (u)"
          value={`${metrics.lucroU >= 0 ? "+" : ""}${metrics.lucroU.toFixed(2)}u`}
          icon={Activity}
          trend={metrics.lucroU >= 0 ? "up" : "down"}
        />
        <StatCard
          label="Lucro Real"
          value={`${metrics.lucroReais >= 0 ? "+" : ""}R$ ${metrics.lucroReais.toFixed(2)}`}
          icon={DollarSign}
          trend={metrics.lucroReais >= 0 ? "up" : "down"}
        />
        <StatCard label="ROI" value={`${metrics.roi.toFixed(2)}%`} icon={TrendingUp} trend={metrics.roi >= 0 ? "up" : "down"} />
        <StatCard label="Win Rate" value={`${metrics.winRate.toFixed(1)}%`} icon={Target} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Evolução da Banca
            </h3>
            <span className="font-mono text-xs text-success">
              R$ {metrics.bancaAtual.toFixed(2)}
            </span>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={timeline}>
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis dataKey="data" stroke={axisColor} fontSize={10} tickFormatter={(d) => String(d).slice(5)} />
              <YAxis stroke={axisColor} fontSize={10} />
              <Tooltip contentStyle={{ background: "oklch(0.205 0.018 250)", border: "1px solid oklch(0.28 0.02 250)", borderRadius: 8, fontSize: 12 }} />
              <Line type="monotone" dataKey="banca" stroke="oklch(0.72 0.18 155)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Evolução do ROI
          </h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={timeline}>
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis dataKey="data" stroke={axisColor} fontSize={10} tickFormatter={(d) => String(d).slice(5)} />
              <YAxis stroke={axisColor} fontSize={10} />
              <Tooltip contentStyle={{ background: "oklch(0.205 0.018 250)", border: "1px solid oklch(0.28 0.02 250)", borderRadius: 8, fontSize: 12 }} />
              <Line type="monotone" dataKey="roi" stroke="oklch(0.7 0.15 220)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Resultado por Esporte (u)
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={sportPerf}>
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis dataKey="esporte" stroke={axisColor} fontSize={10} />
              <YAxis stroke={axisColor} fontSize={10} />
              <Tooltip contentStyle={{ background: "oklch(0.205 0.018 250)", border: "1px solid oklch(0.28 0.02 250)", borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="lucro" fill="oklch(0.72 0.18 155)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Resultado por Mercado (u)
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={marketPerf} layout="vertical">
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis type="number" stroke={axisColor} fontSize={10} />
              <YAxis type="category" dataKey="mercado" stroke={axisColor} fontSize={10} width={120} />
              <Tooltip contentStyle={{ background: "oklch(0.205 0.018 250)", border: "1px solid oklch(0.28 0.02 250)", borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="lucro" fill="oklch(0.7 0.15 220)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <ListChecks className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold uppercase tracking-wider">Últimos Prognósticos</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Data</th>
                <th className="px-4 py-2 text-left">Hora</th>
                <th className="px-4 py-2 text-left">Esporte</th>
                <th className="px-4 py-2 text-left">Liga</th>
                <th className="px-4 py-2 text-left">Jogo</th>
                <th className="px-4 py-2 text-left">Pick</th>
                <th className="px-4 py-2 text-right font-mono">Odd</th>
                <th className="px-4 py-2 text-right font-mono">Stake</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.slice(0, 8).map((p) => (
                <tr key={p.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">{formatBR(p.data)}</td>
                  <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">{p.hora ? formatHora(p.hora) : "—"}</td>
                  <td className="px-4 py-2">{p.esporte}</td>
                  <td className="px-4 py-2 text-muted-foreground">{p.liga}</td>
                  <td className="px-4 py-2">{p.jogo}</td>
                  <td className="px-4 py-2">{p.pick}</td>
                  <td className="px-4 py-2 text-right font-mono">{p.odd_ofertada.toFixed(2)}</td>
                  <td className="px-4 py-2 text-right font-mono">{p.stake.toFixed(1)}u</td>
                  <td className="px-4 py-2"><StatusBadge status={p.status_validacao} /></td>
                  <td className="px-4 py-2"><ResultBadge result={p.resultado} /></td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Nenhum prognóstico para os filtros selecionados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
