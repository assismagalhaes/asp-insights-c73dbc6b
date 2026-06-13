import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { BrainCircuit, RefreshCw } from "lucide-react";
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
import {
  useCreateResumoAprendizadoIa,
  useFeedbackIaResultados,
  useResumosAprendizadoIa,
  type FeedbackIaResultado,
} from "@/lib/db";
import { calculateLearningPerformanceStats } from "@/lib/metrics";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/aprendizado-ia")({
  head: () => ({ meta: [{ title: "Aprendizado da IA - ASP Insights" }] }),
  component: AprendizadoIa,
});

function AprendizadoIa() {
  const { data: feedback = [] } = useFeedbackIaResultados();
  const { data: resumos = [] } = useResumosAprendizadoIa();
  const createResumo = useCreateResumoAprendizadoIa();

  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [esporte, setEsporte] = useState("all");
  const [liga, setLiga] = useState("all");
  const [mercado, setMercado] = useState("all");
  const [modo, setModo] = useState("all");
  const [decisaoIa, setDecisaoIa] = useState("all");
  const [decisaoHumana, setDecisaoHumana] = useState("all");
  const [resultado, setResultado] = useState("all");

  const baseLearningStats = useMemo(
    () =>
      calculateLearningPerformanceStats(feedback, {
        ini: inicio || null,
        fim: fim || null,
        esporte,
        liga,
        mercado,
        modoIa: modo as "local" | "online" | "all",
        resultado: resultado as "GREEN" | "RED" | "PENDENTE" | "all",
        decisaoHumana: decisaoHumana as "CONFIRMA" | "PULAR" | "PENDENTE" | "all",
      }),
    [feedback, inicio, fim, esporte, liga, mercado, modo, decisaoHumana, resultado],
  );
  const filtered = useMemo(
    () => baseLearningStats.filtered.filter((r) => decisaoIa === "all" || r.decisao_ia_sugerida === decisaoIa),
    [baseLearningStats, decisaoIa],
  );
  const metrics = useMemo(() => calculateLearningPerformanceStats(filtered), [filtered]);
  const localMetrics = useMemo(() => calculateLearningPerformanceStats(filtered.filter((r) => r.modo_ia === "local")), [filtered]);
  const onlineMetrics = useMemo(() => calculateLearningPerformanceStats(filtered.filter((r) => r.modo_ia === "online")), [filtered]);
  const esportes = uniq(feedback.map((r) => r.esporte));
  const ligas = uniq(feedback.filter((r) => esporte === "all" || r.esporte === esporte).map((r) => r.liga));
  const mercados = uniq(feedback.map((r) => r.mercado));
  const bySport = groupBy(filtered, "esporte");
  const byMarket = groupBy(filtered, "mercado");
  const tagsRed = topTags(filtered.filter((r) => r.resultado_real === "RED"));
  const tagsGreen = topTags(filtered.filter((r) => r.resultado_real === "GREEN"));
  const latestResumo = resumos[0];

  const recalcular = async () => {
    const geral = metrics;
    const resumo = [
      `${filtered.length} feedback(s) avaliados.`,
      `${geral.greens} GREEN e ${geral.reds} RED.`,
      `Win rate da IA: ${geral.acertoIa.toFixed(1)}%. ROI aproximado: ${geral.roi.toFixed(2)}%.`,
      filtered.length < 10 ? "Historico interno insuficiente para conclusao estatistica forte." : "Amostra suficiente para sinal auxiliar, ainda sem substituir decisao humana.",
    ].join(" ");

    await createResumo.mutateAsync({
      periodo_inicio: inicio || null,
      periodo_fim: fim || null,
      total_analises: filtered.length,
      total_green: geral.greens,
      total_red: geral.reds,
      win_rate: geral.acertoIa,
      roi: geral.roi,
      yield: geral.roi,
      resumo_geral: resumo,
      aprendizados_por_esporte: bySport,
      aprendizados_por_mercado: byMarket,
      alertas_recorrentes: { reds: tagsRed, greens: tagsGreen },
      recomendacoes_para_prompt: "Usar historico como sinal auxiliar. Exigir cautela quando amostra semelhante tiver menos de 10 entradas.",
    });
    toast.success("Resumo de aprendizado recalculado");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Aprendizado da IA</h1>
          <p className="text-sm text-muted-foreground">
            Feedback entre sugestoes da IA, decisao humana e resultados GREEN/RED.
          </p>
        </div>
        <Button onClick={recalcular} disabled={createResumo.isPending || filtered.length === 0}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Recalcular Aprendizado da IA
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card p-3">
        <div className="grid gap-3 md:grid-cols-4 lg:grid-cols-8">
          <Field label="Início"><Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} /></Field>
          <Field label="Fim"><Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} /></Field>
          <Field label="Esporte"><SelectBox value={esporte} onChange={(v) => { setEsporte(v); setLiga("all"); }} items={esportes} all="Todos" /></Field>
          <Field label="Liga"><SelectBox value={liga} onChange={setLiga} items={ligas} all="Todas" /></Field>
          <Field label="Mercado"><SelectBox value={mercado} onChange={setMercado} items={mercados} all="Todos" /></Field>
          <Field label="Modo IA"><SelectBox value={modo} onChange={setModo} items={["local", "online"]} all="Todos" /></Field>
          <Field label="Decisão IA"><SelectBox value={decisaoIa} onChange={setDecisaoIa} items={["CONFIRMA", "PULAR"]} all="Todas" /></Field>
          <Field label="Resultado"><SelectBox value={resultado} onChange={setResultado} items={["GREEN", "RED"]} all="Todos" /></Field>
        </div>
        <div className="mt-3 max-w-xs">
          <Field label="Decisão humana"><SelectBox value={decisaoHumana} onChange={setDecisaoHumana} items={["CONFIRMA", "PULAR"]} all="Todas" /></Field>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Amostras" value={String(filtered.length)} />
        <Stat label="Acerto IA" value={`${metrics.acertoIa.toFixed(1)}%`} />
        <Stat label="Lucro IA confirmou" value={`${metrics.lucroIaConfirma.toFixed(2)}u`} tone={metrics.lucroIaConfirma >= 0 ? "good" : "bad"} />
        <Stat label="Divergência IA x humano" value={`${metrics.lucroDivergente.toFixed(2)}u`} tone={metrics.lucroDivergente >= 0 ? "good" : "bad"} />
        <Stat label="Acerto IA local" value={`${localMetrics.acertoIa.toFixed(1)}%`} />
        <Stat label="Acerto IA online" value={`${onlineMetrics.acertoIa.toFixed(1)}%`} />
        <Stat label="Lucro local" value={`${localMetrics.lucroIaConfirma.toFixed(2)}u`} tone={localMetrics.lucroIaConfirma >= 0 ? "good" : "bad"} />
        <Stat label="Lucro online" value={`${onlineMetrics.lucroIaConfirma.toFixed(2)}u`} tone={onlineMetrics.lucroIaConfirma >= 0 ? "good" : "bad"} />
      </div>

      {latestResumo && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary">
            <BrainCircuit className="h-4 w-4" />
            Resumo mais recente
          </div>
          <p className="text-sm">{latestResumo.resumo_geral}</p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Acerto por esporte" data={bySport} />
        <Panel title="Acerto por mercado" data={byMarket} />
        <Tags title="Tags de risco associadas a RED" tags={tagsRed} />
        <Tags title="Padrões associados a GREEN" tags={tagsGreen} />
      </div>
    </div>
  );
}

function groupBy(rows: FeedbackIaResultado[], key: "esporte" | "mercado") {
  const out: Record<string, ReturnType<typeof calculateLearningPerformanceStats>> = {};
  for (const name of uniq(rows.map((r) => r[key]))) {
    out[name] = calculateLearningPerformanceStats(rows.filter((r) => r[key] === name));
  }
  return out;
}

function topTags(rows: FeedbackIaResultado[]) {
  const map = new Map<string, number>();
  rows.flatMap((r) => r.tags_risco ?? []).forEach((t) => map.set(t, (map.get(t) ?? 0) + 1));
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8));
}

function uniq(items: Array<string | null | undefined>) {
  return Array.from(new Set(items.filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>{children}</div>;
}

function SelectBox({ value, onChange, items, all }: { value: string; onChange: (v: string) => void; items: string[]; all: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{all}</SelectItem>
        {items.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-xl font-bold ${tone === "good" ? "text-success" : tone === "bad" ? "text-destructive" : ""}`}>{value}</div>
    </div>
  );
}

function Panel({ title, data }: { title: string; data: Record<string, ReturnType<typeof calculateLearningPerformanceStats>> }) {
  const rows = Object.entries(data);
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 text-sm font-semibold">{title}</div>
      <div className="space-y-1 text-xs">
        {rows.length ? rows.map(([name, m]) => (
          <div key={name} className="flex items-center justify-between gap-2 border-t border-border py-1">
            <span className="truncate">{name}</span>
            <span className="font-mono">{m.greens}G/{m.reds}R - {m.acertoIa.toFixed(1)}%</span>
          </div>
        )) : <span className="text-muted-foreground">Sem dados.</span>}
      </div>
    </div>
  );
}

function Tags({ title, tags }: { title: string; tags: Record<string, number> }) {
  const rows = Object.entries(tags);
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 text-sm font-semibold">{title}</div>
      <div className="flex flex-wrap gap-2">
        {rows.length ? rows.map(([tag, n]) => (
          <span key={tag} className="rounded border border-border bg-muted px-2 py-1 text-xs">{tag}: {n}</span>
        )) : <span className="text-xs text-muted-foreground">Sem tags suficientes.</span>}
      </div>
    </div>
  );
}
