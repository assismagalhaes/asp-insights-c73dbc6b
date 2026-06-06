import { createFileRoute } from "@tanstack/react-router";
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
} from "recharts";
import { sportPerformance, marketPerformance, bankrollHistory } from "@/lib/mock-data";

export const Route = createFileRoute("/estatisticas")({
  head: () => ({ meta: [{ title: "ROI e Estatísticas — ASP Insights" }] }),
  component: Estatisticas,
});

const chartGrid = "oklch(0.28 0.02 250)";
const axisColor = "oklch(0.68 0.02 250)";

const monthlyResults = [
  { mes: "Jan", lucro: 12 },
  { mes: "Fev", lucro: 8 },
  { mes: "Mar", lucro: -4 },
  { mes: "Abr", lucro: 15 },
  { mes: "Mai", lucro: 22 },
  { mes: "Jun", lucro: 9 },
];

function Estatisticas() {
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
                  <BarCell key={i} positive={entry.lucro >= 0} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Lucro Acumulado" full>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={bankrollHistory}>
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis dataKey="data" stroke={axisColor} fontSize={10} tickFormatter={(d) => d.slice(5)} />
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

const tooltipStyle = {
  background: "oklch(0.205 0.018 250)",
  border: "1px solid oklch(0.28 0.02 250)",
  borderRadius: 8,
  fontSize: 12,
};

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

// Recharts Cell helper
import { Cell } from "recharts";
function BarCell({ positive }: { positive: boolean }) {
  return <Cell fill={positive ? "oklch(0.72 0.18 155)" : "oklch(0.62 0.23 25)"} />;
}
