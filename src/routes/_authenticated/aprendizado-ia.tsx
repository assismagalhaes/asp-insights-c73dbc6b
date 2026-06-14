import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BrainCircuit, TrendingUp, Scale, Target, Split, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PeriodFilter } from "@/components/period-filter";
import { LeagueFilter } from "@/components/league-filter";
import { StatCard } from "@/components/stat-card";
import { rangeFromPeriodo, dateInRange, type PeriodoFiltro } from "@/lib/metrics";
import {
  ESPORTES_DEFAULT,
  MERCADOS_DEFAULT,
  normalizeAiDecision,
  useConfiguracao,
  type AnaliseIa,
  type FeedbackIaResultado,
} from "@/lib/db";

export const Route = createFileRoute("/_authenticated/aprendizado-ia")({
  component: AprendizadoIaPage,
});

const aiDb = supabase as unknown as {
  from: (table: string) => {
    select: (columns?: string) => any;
  };
};

function AprendizadoIaPage() {
  const { data: cfg } = useConfiguracao();
  const valorUnidade = cfg?.valor_unidade_padrao ?? 10;
  const esportes = cfg?.esportes_ativos ?? ESPORTES_DEFAULT;
  const mercadosCfg = cfg?.mercados_ativos ?? MERCADOS_DEFAULT;
  const [periodo, setPeriodo] = useState<PeriodoFiltro>("tudo");
  const [customIni, setCustomIni] = useState("");
  const [customFim, setCustomFim] = useState("");
  const [esporte, setEsporte] = useState("all");
  const [liga, setLiga] = useState("all");
  const [mercado, setMercado] = useState("all");
  const [modoIa, setModoIa] = useState("all");
  const [decisaoIa, setDecisaoIa] = useState("all");
  const [decisaoHumana, setDecisaoHumana] = useState("all");
  const [resultado, setResultado] = useState("all");
  const { ini, fim } = rangeFromPeriodo(periodo, customIni, customFim);

  const { data: analises = [] } = useQuery({
    queryKey: ["ai-learning", "analises"],
    queryFn: async () => {
      const { data, error } = await aiDb.from("analises_ia").select("*");
      if (error) {
        console.warn("[Aprendizado IA] analises_ia indisponível:", error.message);
        return [] as AnaliseIa[];
      }
      return (data ?? []) as AnaliseIa[];
    },
  });

  const { data: feedback = [] } = useQuery({
    queryKey: ["ai-learning", "feedback"],
    queryFn: async () => {
      const { data, error } = await aiDb.from("feedback_ia_resultados").select("*");
      if (error) {
        console.warn("[Aprendizado IA] feedback_ia_resultados indisponível:", error.message);
        return [] as FeedbackIaResultado[];
      }
      return (data ?? []) as FeedbackIaResultado[];
    },
  });

  const mercados = useMemo(() => {
    const mercadosImportados = analises.map((a) => a.mercado).filter(Boolean) as string[];
    const set = new Set([...mercadosCfg, ...mercadosImportados]);
    return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [mercadosCfg, analises]);

  const filteredAnalises = useMemo(
    () =>
      analises.filter((a) => {
        if (!dateInRange((a.created_at ?? "").slice(0, 10), ini, fim)) return false;
        if (esporte !== "all" && a.esporte !== esporte) return false;
        if (liga !== "all" && a.liga !== liga) return false;
        if (mercado !== "all" && a.mercado !== mercado) return false;
        if (modoIa !== "all" && a.modo_ia !== modoIa) return false;
        if (decisaoIa !== "all" && normalizeAiDecision(a.decisao_sugerida) !== decisaoIa) return false;
        return true;
      }),
    [analises, ini, fim, esporte, liga, mercado, modoIa, decisaoIa],
  );

  const filteredFeedback = useMemo(
    () =>
      feedback.filter((f) => {
        if (!dateInRange((f.created_at ?? "").slice(0, 10), ini, fim)) return false;
        if (esporte !== "all" && f.esporte !== esporte) return false;
        if (liga !== "all" && f.liga !== liga) return false;
        if (mercado !== "all" && f.mercado !== mercado) return false;
        if (modoIa !== "all" && f.modo_ia !== modoIa) return false;
        if (decisaoIa !== "all" && normalizeAiDecision(f.decisao_ia_sugerida) !== decisaoIa) return false;
        if (decisaoHumana !== "all" && normalizeAiDecision(f.decisao_humana_final) !== decisaoHumana) return false;
        if (resultado !== "all" && f.resultado_real !== resultado) return false;
        return true;
      }),
    [feedback, ini, fim, esporte, liga, mercado, modoIa, decisaoIa, decisaoHumana, resultado],
  );

  const iaConfirmadas = filteredAnalises.filter((a) => normalizeAiDecision(a.decisao_sugerida) === "CONFIRMAR");
  const feedbackConfirmadasIa = filteredFeedback.filter((f) => normalizeAiDecision(f.decisao_ia_sugerida) === "CONFIRMAR");
  const acertosIa = feedbackConfirmadasIa.filter((f) => f.acertou_ia === true).length;
  const lucroUnidadesIa = feedbackConfirmadasIa.reduce((sum, f) => sum + Number(f.lucro_unidades ?? 0), 0);
  const divergencias = filteredFeedback.filter((f) => f.divergencia_ia_humano).length;

  const stats = {
    total: filteredAnalises.length,
    local: filteredAnalises.filter((a) => a.modo_ia === "local").length,
    online: filteredAnalises.filter((a) => a.modo_ia === "online").length,
    taxaConfirmacao: filteredAnalises.length ? (iaConfirmadas.length / filteredAnalises.length) * 100 : 0,
    taxaAcerto: feedbackConfirmadasIa.length ? (acertosIa / feedbackConfirmadasIa.length) * 100 : 0,
    lucroUnidades: lucroUnidadesIa,
    lucroReal: lucroUnidadesIa * valorUnidade,
    divergencias,
  };

  const acertoPorEsporte = rateBy(filteredFeedback, "esporte");
  const acertoPorMercado = rateBy(filteredFeedback, "mercado");
  const lucroPorEsporte = sumBy(feedbackConfirmadasIa, "esporte", "lucro_unidades");
  const lucroPorMercado = sumBy(feedbackConfirmadasIa, "mercado", "lucro_unidades");
  const modoComparativo = rateBy(filteredFeedback, "modo_ia");
  const tagsRed = tagsByRed(filteredFeedback);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Aprendizado da IA</h1>
        <p className="text-sm text-muted-foreground">
          Memória operacional entre análise da IA, decisão humana e resultados GREEN/RED.
        </p>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <PeriodFilter
              periodo={periodo}
              onPeriodoChange={setPeriodo}
              customIni={customIni}
              customFim={customFim}
              onCustomIniChange={setCustomIni}
              onCustomFimChange={setCustomFim}
            />
            <Filter label="Esporte" value={esporte} onChange={(v) => { setEsporte(v); setLiga("all"); }} options={["all", ...esportes]} allLabel="Todos" />
            <div>
              <Label className="block text-[10px] uppercase tracking-wider text-muted-foreground">Liga</Label>
              <LeagueFilter sport={esporte} value={liga} onChange={setLiga} className="h-9 w-48" />
            </div>
            <Filter label="Mercado" value={mercado} onChange={setMercado} options={["all", ...mercados]} allLabel="Todos" />
            <Filter label="Modo IA" value={modoIa} onChange={setModoIa} options={["all", "local", "online"]} allLabel="Todos" />
            <Filter label="Decisão IA" value={decisaoIa} onChange={setDecisaoIa} options={["all", "CONFIRMAR", "PULAR"]} allLabel="Todas" />
            <Filter label="Decisão humana" value={decisaoHumana} onChange={setDecisaoHumana} options={["all", "CONFIRMAR", "PULAR"]} allLabel="Todas" />
            <Filter label="Resultado" value={resultado} onChange={setResultado} options={["all", "GREEN", "RED"]} allLabel="Todos" />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total de análises IA" value={String(stats.total)} icon={BrainCircuit} />
        <StatCard label="IA local" value={String(stats.local)} icon={Activity} />
        <StatCard label="IA online" value={String(stats.online)} icon={Activity} />
        <StatCard label="Taxa de confirmação IA" value={`${stats.taxaConfirmacao.toFixed(1)}%`} icon={Target} />
        <StatCard label="Acerto IA confirmadas" value={`${stats.taxaAcerto.toFixed(1)}%`} icon={TrendingUp} />
        <StatCard label="Lucro real IA" value={`R$ ${stats.lucroReal.toFixed(2)}`} icon={Scale} trend={stats.lucroReal >= 0 ? "up" : "down"} />
        <StatCard label="Lucro (u) IA" value={`${stats.lucroUnidades.toFixed(2)}u`} icon={Scale} trend={stats.lucroUnidades >= 0 ? "up" : "down"} />
        <StatCard label="Divergências IA x humano" value={String(stats.divergencias)} icon={Split} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Acerto da IA por esporte (%)" rows={acertoPorEsporte} suffix="%" />
        <ChartCard title="Acerto da IA por mercado (%)" rows={acertoPorMercado} suffix="%" />
        <ChartCard title="Lucro por esporte das confirmadas IA (u)" rows={lucroPorEsporte} suffix="u" diverging />
        <ChartCard title="Lucro por mercado das confirmadas IA (u)" rows={lucroPorMercado} suffix="u" diverging />
        <ChartCard title="IA local vs IA online (%)" rows={modoComparativo} suffix="%" />
        <ChartCard title="Tags de risco mais associadas a RED" rows={tagsRed} suffix="" />
      </div>
    </div>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  allLabel: string;
}) {
  return (
    <div>
      <Label className="block text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option === "all" ? allLabel : option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ChartCard({ title, rows, suffix, diverging = false }: { title: string; rows: BarRow[]; suffix: string; diverging?: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <div className="space-y-2">
            {rows.slice(0, 10).map((row) => (
              <div key={row.label} className="space-y-1">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate text-muted-foreground">{row.label}</span>
                  <span className={row.value > 0 ? "text-success" : row.value < 0 ? "text-destructive" : "text-muted-foreground"}>
                    {row.value.toFixed(1)}{suffix}
                  </span>
                </div>
                <div className="h-2 rounded bg-muted">
                  <div
                    className={diverging ? (row.value >= 0 ? "h-2 rounded bg-success" : "h-2 rounded bg-destructive") : "h-2 rounded bg-primary"}
                    style={{ width: `${Math.max(4, Math.min(100, row.percent))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-12 text-center text-sm text-muted-foreground">Nenhum resultado encontrado para os filtros selecionados.</div>
        )}
      </CardContent>
    </Card>
  );
}

interface BarRow {
  label: string;
  value: number;
  percent: number;
}

function rateBy(rows: FeedbackIaResultado[], field: keyof FeedbackIaResultado): BarRow[] {
  const map = new Map<string, { ok: number; total: number }>();
  for (const row of rows) {
    const key = String(row[field] ?? "Sem dado");
    const current = map.get(key) ?? { ok: 0, total: 0 };
    if (normalizeAiDecision(row.decisao_ia_sugerida) === "CONFIRMAR") {
      current.total += 1;
      if (row.acertou_ia) current.ok += 1;
    }
    map.set(key, current);
  }
  return [...map.entries()]
    .map(([label, value]) => ({ label, value: value.total ? (value.ok / value.total) * 100 : 0, percent: value.total ? (value.ok / value.total) * 100 : 0 }))
    .filter((row) => row.percent > 0 || row.value > 0)
    .sort((a, b) => b.value - a.value);
}

function sumBy(rows: FeedbackIaResultado[], field: keyof FeedbackIaResultado, sumField: keyof FeedbackIaResultado): BarRow[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = String(row[field] ?? "Sem dado");
    map.set(key, (map.get(key) ?? 0) + Number(row[sumField] ?? 0));
  }
  const max = Math.max(1, ...[...map.values()].map((v) => Math.abs(v)));
  return [...map.entries()]
    .map(([label, value]) => ({ label, value, percent: (Math.abs(value) / max) * 100 }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

function tagsByRed(rows: FeedbackIaResultado[]): BarRow[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.resultado_real !== "RED") continue;
    for (const tag of row.tags_risco ?? []) map.set(tag, (map.get(tag) ?? 0) + 1);
  }
  const max = Math.max(1, ...map.values());
  return [...map.entries()]
    .map(([label, value]) => ({ label, value, percent: (value / max) * 100 }))
    .sort((a, b) => b.value - a.value);
}
