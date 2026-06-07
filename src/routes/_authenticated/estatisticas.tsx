import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
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
} from "recharts";
import { usePrognosticos, useBankroll } from "@/lib/db";

export const Route = createFileRoute("/estatisticas")({
  head: () => ({ meta: [{ title: "ROI e Estatísticas — ASP Insights" }] }),
  component: Estatisticas,
});

const chartGrid = "oklch(0.28 0.02 250)";
const axisColor = "oklch(0.68 0.02 250)";

const tooltipStyle = {
  background: "oklch(0.205 0.018 250)",
  border: "1px solid oklch(0.28 0.02 250)",
  borderRadius: 8,
  fontSize: 12,
};

function Estatisticas() {
  const { data: prognosticos = [] } = usePrognosticos();
  const { data: bankroll = [] } = useBankroll();

  const sportPerformance = useMemo(() => {
    const map = new Map<string, { lucro: number; stake: number }>();
    prognosticos.forEach((p) => {
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
  }, [prognosticos]);

  const marketPerformance = useMemo(() => {
    const map = new Map<string, number>();
    prognosticos.forEach((p) => {
      if (p.resultado === "PENDENTE") return;
      map.set(p.mercado, (map.get(p.mercado) ?? 0) + (p.lucro_prejuizo ?? 0));
    });
    return Array.from(map.entries()).map(([mercado, lucro]) => ({
      mercado,
      lucro: Number(lucro.toFixed(2)),
    }));
  }, [prognosticos]);

  const monthlyResults = useMemo(() => {
    const map = new Map<string, number>();
    prognosticos.forEach((p) => {
      if (p.resultado === "PENDENTE") return;
      const mes = p.data.slice(0, 7);
      map.set(mes, (map.get(mes) ?? 0) + (p.lucro_prejuizo ?? 0));
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, lucro]) => ({ mes, lucro: Number(lucro.toFixed(2)) }));
  }, [prognosticos]);

  const chartBanca = bankroll.map((b) => ({ data: b.data, banca: b.banca_atual }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">ROI & Estatísticas</h1>
        <p className="text-sm text-muted-foreground">
          Análise detalhada de desempenho por esporte, mercado e período.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Resultado por Esporte">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={sportPerformance}>
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis dataKey="esporte" stroke={axisColor} fontSize={10} />
              <YAxis stroke={axisColor} fontSize={10} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="lucro" fill="oklch(0.72 0.18 155)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="ROI por Esporte">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={sportPerformance}>
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis dataKey="esporte" stroke={axisColor} fontSize={10} />
              <YAxis stroke={axisColor} fontSize={10} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="roi" fill="oklch(0.7 0.15 220)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Resultado por Mercado">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={marketPerformance} layout="vertical">
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis type="number" stroke={axisColor} fontSize={10} />
              <YAxis type="category" dataKey="mercado" stroke={axisColor} fontSize={10} width={120} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="lucro" fill="oklch(0.82 0.17 90)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Resultado por Mês">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={monthlyResults}>
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis dataKey="mes" stroke={axisColor} fontSize={10} />
              <YAxis stroke={axisColor} fontSize={10} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="lucro" radius={[4, 4, 0, 0]}>
                {monthlyResults.map((entry, i) => (
                  <Cell key={i} fill={entry.lucro >= 0 ? "oklch(0.72 0.18 155)" : "oklch(0.62 0.23 25)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Evolução da Banca" full>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartBanca}>
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis dataKey="data" stroke={axisColor} fontSize={10} tickFormatter={(d) => String(d).slice(5)} />
              <YAxis stroke={axisColor} fontSize={10} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="banca" stroke="oklch(0.72 0.18 155)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}

function Card({ title, children, full }: { title: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={`rounded-lg border border-border bg-card p-4 ${full ? "lg:col-span-2" : ""}`}>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}
