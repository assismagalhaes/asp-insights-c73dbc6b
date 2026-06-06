import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  Activity,
  CheckCircle2,
  XCircle,
  TrendingUp,
  Percent,
  Target,
  DollarSign,
  ListChecks,
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
import {
  prognosticos,
  bankrollHistory,
  sportPerformance,
  marketPerformance,
} from "@/lib/mock-data";

export const Route = createFileRoute("/")({
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

function Dashboard() {
  const today = new Date().toISOString().slice(0, 10);
  const hoje = prognosticos.filter((p) => p.data === today);
  const aprovados = prognosticos.filter(
    (p) => p.status === "CONFIRMA" || p.status === "CONFIRMA COM CAUTELA",
  );
  const rejeitados = prognosticos.filter((p) => p.status === "PASS");
  const lucro = prognosticos.reduce((s, p) => s + (p.lucro ?? 0), 0);
  const concluidos = prognosticos.filter((p) => p.resultado === "GREEN" || p.resultado === "RED");
  const greens = prognosticos.filter((p) => p.resultado === "GREEN").length;
  const winRate = concluidos.length ? (greens / concluidos.length) * 100 : 0;
  const stakeTotal = concluidos.reduce((s, p) => s + p.stake, 0);
  const roi = stakeTotal ? (lucro / stakeTotal) * 100 : 0;
  const yieldVal = roi; // simplified

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard Executivo</h1>
        <p className="text-sm text-muted-foreground">
          Visão geral do desempenho dos modelos de previsão.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Prog. do dia" value={String(hoje.length)} icon={Activity} />
        <StatCard
          label="Aprovados"
          value={String(aprovados.length)}
          icon={CheckCircle2}
          trend="up"
          delta={`+${aprovados.length} hoje`}
        />
        <StatCard
          label="Rejeitados"
          value={String(rejeitados.length)}
          icon={XCircle}
          trend="down"
        />
        <StatCard
          label="Lucro (u)"
          value={`${lucro >= 0 ? "+" : ""}${lucro.toFixed(2)}u`}
          icon={DollarSign}
          trend={lucro >= 0 ? "up" : "down"}
        />
        <StatCard
          label="ROI"
          value={`${roi.toFixed(1)}%`}
          icon={TrendingUp}
          trend={roi >= 0 ? "up" : "down"}
        />
        <StatCard label="Yield" value={`${yieldVal.toFixed(1)}%`} icon={Percent} />
        <StatCard label="Win Rate" value={`${winRate.toFixed(1)}%`} icon={Target} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Evolução da Banca
            </h3>
            <span className="font-mono text-xs text-success">
              +{(bankrollHistory[bankrollHistory.length - 1].banca - 1000).toFixed(2)}u
            </span>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={bankrollHistory}>
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis dataKey="data" stroke={axisColor} fontSize={10} tickFormatter={(d) => d.slice(5)} />
              <YAxis stroke={axisColor} fontSize={10} />
              <Tooltip
                contentStyle={{
                  background: "oklch(0.205 0.018 250)",
                  border: "1px solid oklch(0.28 0.02 250)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Line
                type="monotone"
                dataKey="banca"
                stroke="oklch(0.72 0.18 155)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Evolução do ROI
            </h3>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={bankrollHistory}>
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis dataKey="data" stroke={axisColor} fontSize={10} tickFormatter={(d) => d.slice(5)} />
              <YAxis stroke={axisColor} fontSize={10} />
              <Tooltip
                contentStyle={{
                  background: "oklch(0.205 0.018 250)",
                  border: "1px solid oklch(0.28 0.02 250)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Line type="monotone" dataKey="roi" stroke="oklch(0.7 0.15 220)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Resultado por Esporte
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={sportPerformance}>
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis dataKey="esporte" stroke={axisColor} fontSize={10} />
              <YAxis stroke={axisColor} fontSize={10} />
              <Tooltip
                contentStyle={{
                  background: "oklch(0.205 0.018 250)",
                  border: "1px solid oklch(0.28 0.02 250)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="lucro" fill="oklch(0.72 0.18 155)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Resultado por Mercado
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={marketPerformance} layout="vertical">
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis type="number" stroke={axisColor} fontSize={10} />
              <YAxis type="category" dataKey="mercado" stroke={axisColor} fontSize={10} width={120} />
              <Tooltip
                contentStyle={{
                  background: "oklch(0.205 0.018 250)",
                  border: "1px solid oklch(0.28 0.02 250)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="lucro" fill="oklch(0.7 0.15 220)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <ListChecks className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold uppercase tracking-wider">
            Últimos Prognósticos
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Data</th>
                <th className="px-4 py-2 text-left">Esporte</th>
                <th className="px-4 py-2 text-left">Jogo</th>
                <th className="px-4 py-2 text-left">Pick</th>
                <th className="px-4 py-2 text-right font-mono">Odd</th>
                <th className="px-4 py-2 text-right font-mono">Stake</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {prognosticos.slice(0, 8).map((p) => (
                <tr key={p.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-2 font-mono text-xs">{p.data}</td>
                  <td className="px-4 py-2">{p.esporte}</td>
                  <td className="px-4 py-2">{p.jogo}</td>
                  <td className="px-4 py-2">{p.pick}</td>
                  <td className="px-4 py-2 text-right font-mono">{p.oddOfertada.toFixed(2)}</td>
                  <td className="px-4 py-2 text-right font-mono">{p.stake.toFixed(1)}u</td>
                  <td className="px-4 py-2"><StatusBadge status={p.status} /></td>
                  <td className="px-4 py-2"><ResultBadge result={p.resultado} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
