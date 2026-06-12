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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatCard } from "@/components/stat-card";
import {
  useConfiguracao,
  useUpdateConfiguracao,
  usePrognosticos,
  type TipoStake,
} from "@/lib/db";
import { computeMetrics, bankrollTimeline } from "@/lib/metrics";
import { TrendingDown, TrendingUp, Wallet, Percent, Target, Activity, DollarSign } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/bankroll")({
  head: () => ({ meta: [{ title: "Bankroll — ASP Insights" }] }),
  component: Bankroll,
});

const chartGrid = "oklch(0.28 0.02 250)";
const axisColor = "oklch(0.68 0.02 250)";

function Bankroll() {
  const { data: cfg } = useConfiguracao();
  const { data: prognosticos = [] } = usePrognosticos();
  const updateCfg = useUpdateConfiguracao();

  const [unidade, setUnidade] = useState(10);
  const [bancaInicial, setBancaInicial] = useState(1000);
  const [tipoStake, setTipoStake] = useState<TipoStake>("FIXO");
  const [percentual, setPercentual] = useState(1);

  useEffect(() => {
    if (cfg) {
      setUnidade(cfg.valor_unidade_padrao);
      setBancaInicial(cfg.banca_inicial);
      setTipoStake(cfg.tipo_stake ?? "FIXO");
      setPercentual(cfg.percentual_unidade ?? 1);
    }
  }, [cfg]);

  const metrics = computeMetrics(prognosticos, cfg);
  const timeline = bankrollTimeline(prognosticos, metrics.bancaInicial, cfg?.valor_unidade_padrao ?? 0);

  // valor real de 1u, conforme tipo de stake
  const valorUnidadeEfetiva =
    tipoStake === "PERCENTUAL"
      ? (metrics.bancaAtual * percentual) / 100
      : unidade;

  const stakes = [0.5, 1.0, 1.5, 2.0];

  const salvar = async () => {
    if (!cfg) return;
    try {
      await updateCfg.mutateAsync({
        id: cfg.id,
        valor_unidade_padrao: unidade,
        banca_inicial: bancaInicial,
        tipo_stake: tipoStake,
        percentual_unidade: percentual,
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
              <Label>Tipo de stake</Label>
              <Select value={tipoStake} onValueChange={(v) => setTipoStake(v as TipoStake)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="FIXO">Valor fixo</SelectItem>
                  <SelectItem value="PERCENTUAL">Percentual da banca</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {tipoStake === "FIXO" ? (
              <div>
                <Label>Valor da unidade (R$)</Label>
                <Input type="number" value={unidade} onChange={(e) => setUnidade(+e.target.value)} />
              </div>
            ) : (
              <div>
                <Label>1u equivale a (% da banca atual)</Label>
                <Input type="number" step="0.1" value={percentual} onChange={(e) => setPercentual(+e.target.value)} />
                <p className="mt-1 text-xs text-muted-foreground">
                  1u = R$ {valorUnidadeEfetiva.toFixed(2)} (sobre banca atual de R$ {metrics.bancaAtual.toFixed(2)})
                </p>
              </div>
            )}
            <div>
              <Label>Banca inicial (R$)</Label>
              <Input type="number" value={bancaInicial} onChange={(e) => setBancaInicial(+e.target.value)} />
            </div>
            <div>
              <Label>Banca atual (R$)</Label>
              <Input value={metrics.bancaAtual.toFixed(2)} readOnly className="font-mono" />
            </div>
            <Button onClick={salvar} disabled={updateCfg.isPending}>Salvar configurações</Button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Controle por stake ({tipoStake === "FIXO" ? "valor fixo" : `${percentual}% por unidade`})
          </h3>
          <p className="mt-1 text-[10px] text-muted-foreground">% calculado sobre a banca inicial (R$ {metrics.bancaInicial.toFixed(2)}).</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {stakes.map((s) => {
              const valor = s * valorUnidadeEfetiva;
              const pct = metrics.bancaInicial > 0 ? (valor / metrics.bancaInicial) * 100 : 0;
              return (
                <div key={s} className="rounded-md border border-border bg-background/50 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Stake {s.toFixed(1)}u</div>
                  <div className="mt-1 font-mono text-lg font-bold">R$ {valor.toFixed(2)}</div>
                  <div className="text-xs text-muted-foreground">{pct.toFixed(2)}% da banca inicial</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Lucro Real"
          value={`${metrics.lucroReais >= 0 ? "+" : ""}R$ ${metrics.lucroReais.toFixed(2)}`}
          icon={DollarSign}
          trend={metrics.lucroReais >= 0 ? "up" : "down"}
        />
        <StatCard
          label="Lucro (u)"
          value={`${metrics.lucroU >= 0 ? "+" : ""}${metrics.lucroU.toFixed(2)}u`}
          icon={Wallet}
          trend={metrics.lucroU >= 0 ? "up" : "down"}
        />
        <StatCard label="ROI" value={`${metrics.roi.toFixed(2)}%`} icon={TrendingUp} trend={metrics.roi >= 0 ? "up" : "down"} />
        <StatCard label="Yield" value={`${metrics.yield.toFixed(2)}%`} icon={Percent} />
        <StatCard label="Win Rate" value={`${metrics.winRate.toFixed(1)}%`} icon={Target} />
        <StatCard
          label="Drawdown"
          value={`${metrics.drawdown.toFixed(2)}%`}
          icon={TrendingDown}
          trend={metrics.drawdown > 0 ? "down" : "neutral"}
        />
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Evolução da banca
          </h3>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={timeline}>
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
