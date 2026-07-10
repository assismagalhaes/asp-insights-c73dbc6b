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
  ReferenceLine,
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
import { ChartTooltip } from "@/components/chart-tooltip";
import { useConfiguracao, useUpdateConfiguracao, usePrognosticos, type TipoStake } from "@/lib/db";
import { computeMetrics, bankrollTimeline } from "@/lib/metrics";
import { formatBR } from "@/lib/date-br";
import {
  COLOR_GRID,
  COLOR_AXIS,
  COLOR_REFERENCE,
  COLOR_NEUTRAL,
  signColor,
  withSign,
} from "@/lib/chart-colors";
import {
  TrendingDown,
  TrendingUp,
  Wallet,
  Percent,
  Target,
  Activity,
  DollarSign,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/bankroll")({
  head: () => ({ meta: [{ title: "Bankroll — ASP Insights" }] }),
  component: Bankroll,
});

const chartGrid = COLOR_GRID;
const axisColor = COLOR_AXIS;

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

  const officialRows = prognosticos;
  const metrics = computeMetrics(officialRows, cfg);
  const timeline = bankrollTimeline(
    officialRows,
    metrics.bancaInicial,
    cfg?.valor_unidade_padrao ?? 0,
  );

  // valor real de 1u, conforme tipo de stake
  const valorUnidadeEfetiva =
    tipoStake === "PERCENTUAL" ? (metrics.bancaAtual * percentual) / 100 : unidade;

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
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Configurações
          </h3>
          <div className="mt-4 grid gap-3">
            <div>
              <Label>Tipo de stake</Label>
              <Select value={tipoStake} onValueChange={(v) => setTipoStake(v as TipoStake)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FIXO">Valor fixo</SelectItem>
                  <SelectItem value="PERCENTUAL">Percentual da banca</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {tipoStake === "FIXO" ? (
              <div>
                <Label>Valor da unidade (R$)</Label>
                <Input
                  type="number"
                  value={unidade}
                  onChange={(e) => setUnidade(+e.target.value)}
                />
              </div>
            ) : (
              <div>
                <Label>1u equivale a (% da banca atual)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={percentual}
                  onChange={(e) => setPercentual(+e.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  1u = R$ {valorUnidadeEfetiva.toFixed(2)} (sobre banca atual de R${" "}
                  {metrics.bancaAtual.toFixed(2)})
                </p>
              </div>
            )}
            <div>
              <Label>Banca inicial (R$)</Label>
              <Input
                type="number"
                value={bancaInicial}
                onChange={(e) => setBancaInicial(+e.target.value)}
              />
            </div>
            <div>
              <Label>Banca atual (R$)</Label>
              <Input value={metrics.bancaAtual.toFixed(2)} readOnly className="font-mono" />
            </div>
            <Button onClick={salvar} disabled={updateCfg.isPending}>
              Salvar configurações
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Controle por stake ({tipoStake === "FIXO" ? "valor fixo" : `${percentual}% por unidade`}
            )
          </h3>
          <p className="mt-1 text-[10px] text-muted-foreground">
            % calculado sobre a banca inicial (R$ {metrics.bancaInicial.toFixed(2)}).
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {stakes.map((s) => {
              const valor = s * valorUnidadeEfetiva;
              const pct = metrics.bancaInicial > 0 ? (valor / metrics.bancaInicial) * 100 : 0;
              return (
                <div key={s} className="rounded-md border border-border bg-background/50 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Stake {s.toFixed(1)}u
                  </div>
                  <div className="mt-1 font-mono text-lg font-bold">R$ {valor.toFixed(2)}</div>
                  <div className="text-xs text-muted-foreground">
                    {pct.toFixed(2)}% da banca inicial
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Lucro Real"
          value={`${metrics.lucroReais >= 0 ? "+" : "-"}R$ ${Math.abs(metrics.lucroReais).toFixed(2)}`}
          icon={DollarSign}
          tone={metrics.lucroReais > 0 ? "up" : metrics.lucroReais < 0 ? "down" : "neutral"}
        />
        <StatCard
          label="Lucro (u)"
          value={`${withSign(metrics.lucroU)}u`}
          icon={Wallet}
          tone={metrics.lucroU > 0 ? "up" : metrics.lucroU < 0 ? "down" : "neutral"}
        />
        <StatCard
          label="ROI"
          value={`${withSign(metrics.roi)}%`}
          icon={TrendingUp}
          tone={metrics.roi > 0 ? "up" : metrics.roi < 0 ? "down" : "neutral"}
        />
        <StatCard
          label="Yield"
          value={`${withSign(metrics.yield)}%`}
          icon={Percent}
          tone={metrics.yield > 0 ? "up" : metrics.yield < 0 ? "down" : "neutral"}
        />
        <StatCard
          label="Win Rate"
          value={`${metrics.winRate.toFixed(1)}%`}
          icon={Target}
          tone={metrics.winRate >= 50 ? "up" : metrics.winRate > 0 ? "down" : "neutral"}
        />
        <StatCard
          label="Drawdown"
          value={`${metrics.drawdown.toFixed(2)}%`}
          icon={TrendingDown}
          tone={metrics.drawdown > 0 ? "down" : "neutral"}
        />
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Evolução da banca
            </h3>
          </div>
          <span
            className="font-mono text-xs"
            style={{ color: signColor(metrics.bancaAtual - metrics.bancaInicial) }}
          >
            R$ {metrics.bancaAtual.toFixed(2)} (
            {withSign(metrics.bancaAtual - metrics.bancaInicial)})
          </span>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={timeline}>
            <defs>
              <linearGradient id="bancaFill" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor={signColor(metrics.bancaAtual - metrics.bancaInicial)}
                  stopOpacity={0.45}
                />
                <stop
                  offset="100%"
                  stopColor={signColor(metrics.bancaAtual - metrics.bancaInicial)}
                  stopOpacity={0}
                />
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
              y={metrics.bancaInicial}
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
                        color: signColor(v - metrics.bancaInicial),
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
            <Area
              type="monotone"
              dataKey="banca"
              stroke={signColor(metrics.bancaAtual - metrics.bancaInicial)}
              strokeWidth={2.5}
              fill="url(#bancaFill)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
