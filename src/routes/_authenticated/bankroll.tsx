import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatCard } from "@/components/stat-card";
import {
  useBankroll,
  useConfiguracao,
  useUpdateConfiguracao,
  usePrognosticos,
} from "@/lib/db";
import { TrendingDown, TrendingUp, Wallet, Percent, Target, Activity } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/bankroll")({
  head: () => ({ meta: [{ title: "Bankroll — ASP Insights" }] }),
  component: Bankroll,
});

const chartGrid = "oklch(0.28 0.02 250)";
const axisColor = "oklch(0.68 0.02 250)";

function Bankroll() {
  const { data: bankroll = [] } = useBankroll();
  const { data: cfg } = useConfiguracao();
  const { data: prognosticos = [] } = usePrognosticos();
  const updateCfg = useUpdateConfiguracao();

  const [unidade, setUnidade] = useState(10);
  const [bancaInicial, setBancaInicial] = useState(1000);

  useEffect(() => {
    if (cfg) {
      setUnidade(cfg.valor_unidade_padrao);
      setBancaInicial(cfg.banca_inicial);
    }
  }, [cfg]);

  const bancaAtual = bankroll.length ? bankroll[bankroll.length - 1].banca_atual : bancaInicial;
  const lucro = bancaAtual - bancaInicial;
  const maxBanca = bankroll.length ? Math.max(...bankroll.map((b) => b.banca_atual)) : bancaInicial;
  const drawdown = maxBanca > 0 ? ((maxBanca - bancaAtual) / maxBanca) * 100 : 0;

  // Apenas confirmados entram em win rate / ROI / lucro
  const validados = prognosticos.filter(
    (p) => p.status_validacao === "CONFIRMA" || p.status_validacao === "CONFIRMA COM CAUTELA",
  );
  const concluidos = validados.filter((p) => p.resultado === "GREEN" || p.resultado === "RED");
  const greens = validados.filter((p) => p.resultado === "GREEN").length;
  const winRate = concluidos.length ? (greens / concluidos.length) * 100 : 0;
  const stakeTotal = concluidos.reduce((s, p) => s + p.stake, 0);
  const lucroU = validados.reduce((s, p) => s + (p.lucro_prejuizo ?? 0), 0);
  const roi = stakeTotal ? (lucroU / stakeTotal) * 100 : 0;

  const stakes = [0.5, 1.0, 1.5, 2.0];
  const chartData = bankroll.map((b) => ({ data: b.data, banca: b.banca_atual }));

  const salvar = async () => {
    if (!cfg) return;
    try {
      await updateCfg.mutateAsync({
        id: cfg.id,
        valor_unidade_padrao: unidade,
        banca_inicial: bancaInicial,
      });
      toast.success("Configurações salvas");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Bankroll</h1>
        <p className="text-sm text-muted-foreground">
          Gestão de banca, unidades e controle de risco.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Configurações</h3>
          <div className="mt-4 grid gap-3">
            <div>
              <Label>Valor da unidade (R$)</Label>
              <Input type="number" value={unidade} onChange={(e) => setUnidade(+e.target.value)} />
            </div>
            <div>
              <Label>Banca inicial (R$)</Label>
              <Input type="number" value={bancaInicial} onChange={(e) => setBancaInicial(+e.target.value)} />
            </div>
            <div>
              <Label>Banca atual (R$)</Label>
              <Input value={bancaAtual.toFixed(2)} readOnly className="font-mono" />
            </div>
            <Button onClick={salvar} disabled={updateCfg.isPending}>Salvar configurações</Button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Controle por stake
          </h3>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {stakes.map((s) => (
              <div key={s} className="rounded-md border border-border bg-background/50 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Stake {s.toFixed(1)}u</div>
                <div className="mt-1 font-mono text-lg font-bold">
                  R$ {(s * unidade).toFixed(2)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {bancaAtual > 0 ? ((s * unidade / bancaAtual) * 100).toFixed(2) : "0.00"}% da banca
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard
          label="Lucro acumulado"
          value={`${lucro >= 0 ? "+" : ""}R$ ${lucro.toFixed(2)}`}
          icon={Wallet}
          trend={lucro >= 0 ? "up" : "down"}
        />
        <StatCard
          label="Drawdown"
          value={`${drawdown.toFixed(2)}%`}
          icon={TrendingDown}
          trend={drawdown > 0 ? "down" : "neutral"}
        />
        <StatCard label="ROI" value={`${roi.toFixed(1)}%`} icon={TrendingUp} trend={roi >= 0 ? "up" : "down"} />
        <StatCard label="Yield" value={`${roi.toFixed(1)}%`} icon={Percent} />
        <StatCard label="Win Rate" value={`${winRate.toFixed(1)}%`} icon={Target} />
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Evolução da banca
          </h3>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="banca" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="oklch(0.72 0.18 155)" stopOpacity={0.5} />
                <stop offset="95%" stopColor="oklch(0.72 0.18 155)" stopOpacity={0} />
              </linearGradient>
            </defs>
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
            <Area type="monotone" dataKey="banca" stroke="oklch(0.72 0.18 155)" strokeWidth={2} fill="url(#banca)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
