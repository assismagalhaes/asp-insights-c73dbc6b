import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  Activity,
  CheckCircle2,
  XCircle,
  TrendingUp,
  Percent,
  Target,
  DollarSign,
  ListChecks,
  Megaphone,
  Clock,
  Trophy,
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
import { usePrognosticos, useBankroll, useConfiguracao, todayBR } from "@/lib/db";

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

function Dashboard() {
  const { data: prognosticos = [] } = usePrognosticos();
  const { data: bankroll = [] } = useBankroll();
  const { data: cfg } = useConfiguracao();
  const bancaInicial = cfg?.banca_inicial ?? 1000;

  const today = todayBR();
  const hoje = prognosticos.filter((p) => p.data === today);
  const aprovados = prognosticos.filter(
    (p) => p.status_validacao === "CONFIRMA",
  );
  const rejeitados = prognosticos.filter((p) => p.status_validacao === "PULAR");
  // Só prognósticos confirmados entram em banca, lucro, ROI, yield, win rate
  const validados = aprovados;
  const lucro = validados.reduce((s, p) => s + (p.lucro_prejuizo ?? 0), 0);
  const concluidos = validados.filter((p) => p.resultado !== "PENDENTE");
  const greens = validados.filter((p) => p.resultado === "GREEN" || p.resultado === "HALF GREEN").length;
  const winRate = concluidos.length ? (greens / concluidos.length) * 100 : 0;
  const stakeTotal = concluidos.reduce((s, p) => s + p.stake, 0);
  const roi = stakeTotal ? (lucro / stakeTotal) * 100 : 0;
  const yieldVal = roi;

  const publicadasHoje = prognosticos.filter(
    (p) => p.status_publicacao !== "NAO_PUBLICADO" && p.data_publicacao?.slice(0, 10) === today,
  ).length;
  const pendentesPub = prognosticos.filter(
    (p) =>
      p.status_publicacao === "NAO_PUBLICADO" &&
      p.status_validacao === "CONFIRMA",
  ).length;
  const finalizadas = prognosticos.filter((p) => p.status_publicacao === "FINALIZADO").length;
  const lucroPublicadas = validados
    .filter((p) => p.status_publicacao === "PUBLICADO" || p.status_publicacao === "FINALIZADO")
    .reduce((s, p) => s + (p.lucro_prejuizo ?? 0), 0);

  const bankrollChart = bankroll.map((b) => ({
    data: b.data,
    banca: b.banca_atual,
    roi: bancaInicial ? ((b.banca_atual - bancaInicial) / bancaInicial) * 100 : 0,
  }));
  const ultimoBanca = bankroll.length ? bankroll[bankroll.length - 1].banca_atual : bancaInicial;

  const sportPerformance = useMemo(() => {
    const map = new Map<string, { lucro: number; stake: number }>();
    validados.forEach((p) => {
      if (p.resultado === "PENDENTE") return;
      const cur = map.get(p.esporte) ?? { lucro: 0, stake: 0 };
      cur.lucro += p.lucro_prejuizo ?? 0;
      cur.stake += p.stake;
      map.set(p.esporte, cur);
    });
    return Array.from(map.entries()).map(([esporte, v]) => ({
      esporte,
      lucro: Number(v.lucro.toFixed(2)),
      roi: v.stake ? Number(((v.lucro / v.stake) * 100).toFixed(1)) : 0,
    }));
  }, [validados]);

  const marketPerformance = useMemo(() => {
    const map = new Map<string, number>();
    validados.forEach((p) => {
      if (p.resultado === "PENDENTE") return;
      map.set(p.mercado, (map.get(p.mercado) ?? 0) + (p.lucro_prejuizo ?? 0));
    });
    return Array.from(map.entries()).map(([mercado, lucro]) => ({
      mercado,
      lucro: Number(lucro.toFixed(2)),
    }));
  }, [validados]);


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
        <StatCard label="Aprovados" value={String(aprovados.length)} icon={CheckCircle2} trend="up" />
        <StatCard label="Rejeitados" value={String(rejeitados.length)} icon={XCircle} trend="down" />
        <StatCard
          label="Lucro (u)"
          value={`${lucro >= 0 ? "+" : ""}${lucro.toFixed(2)}u`}
          icon={Activity}
          trend={lucro >= 0 ? "up" : "down"}
        />
        <StatCard label="ROI" value={`${roi.toFixed(1)}%`} icon={TrendingUp} trend={roi >= 0 ? "up" : "down"} />
        <StatCard label="Yield" value={`${yieldVal.toFixed(1)}%`} icon={Percent} />
        <StatCard label="Win Rate" value={`${winRate.toFixed(1)}%`} icon={Target} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Publicadas hoje" value={String(publicadasHoje)} icon={Megaphone} />
        <StatCard label="Pendentes pub." value={String(pendentesPub)} icon={Clock} />
        <StatCard label="Finalizadas" value={String(finalizadas)} icon={Trophy} />
        <StatCard
          label="Lucro publicadas (R$)"
          value={`${lucroPublicadas >= 0 ? "+" : ""}R$ ${(lucroPublicadas * (cfg?.valor_unidade_padrao ?? 10)).toFixed(2)}`}
          icon={DollarSign}
          trend={lucroPublicadas >= 0 ? "up" : "down"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Evolução da Banca
            </h3>
            <span className="font-mono text-xs text-success">
              {ultimoBanca >= bancaInicial ? "+" : ""}
              R$ {(ultimoBanca - bancaInicial).toFixed(2)}
            </span>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={bankrollChart}>
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis dataKey="data" stroke={axisColor} fontSize={10} tickFormatter={(d) => String(d).slice(5)} />
              <YAxis stroke={axisColor} fontSize={10} />
              <Tooltip
                contentStyle={{
                  background: "oklch(0.205 0.018 250)",
                  border: "1px solid oklch(0.28 0.02 250)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Line type="monotone" dataKey="banca" stroke="oklch(0.72 0.18 155)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Evolução do ROI
          </h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={bankrollChart}>
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis dataKey="data" stroke={axisColor} fontSize={10} tickFormatter={(d) => String(d).slice(5)} />
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
          <h3 className="text-sm font-semibold uppercase tracking-wider">Últimos Prognósticos</h3>
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
                  <td className="px-4 py-2 text-right font-mono">{p.odd_ofertada.toFixed(2)}</td>
                  <td className="px-4 py-2 text-right font-mono">{p.stake.toFixed(1)}u</td>
                  <td className="px-4 py-2"><StatusBadge status={p.status_validacao} /></td>
                  <td className="px-4 py-2"><ResultBadge result={p.resultado} /></td>
                </tr>
              ))}
              {prognosticos.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Nenhum prognóstico cadastrado ainda.
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
