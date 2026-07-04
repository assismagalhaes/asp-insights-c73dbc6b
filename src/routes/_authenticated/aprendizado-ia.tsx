import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BrainCircuit, TrendingUp, Scale, Target, Split, Activity } from "lucide-react";
import { supabase } from "@/lib/supabase-public";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PeriodFilter } from "@/components/period-filter";
import { LeagueFilter } from "@/components/league-filter";
import { StatCard } from "@/components/stat-card";
import { rangeFromPeriodo, dateInRange, type PeriodoFiltro } from "@/lib/metrics";
import {
  ESPORTES_DEFAULT,
  MERCADOS_DEFAULT,
  getEdgeEfetivo,
  getOddEfetiva,
  normalizeAiDecision,
  useConfiguracao,
  type AnaliseIa,
  type FeedbackIaResultado,
  type Prognostico,
  type Validacao,
} from "@/lib/db";

export const Route = createFileRoute("/_authenticated/aprendizado-ia")({
  component: AprendizadoIaPage,
});

type QueryErrorLike = { message: string };
type QueryResultLike<T = unknown> = { data: T | null; error: QueryErrorLike | null };
type AiQueryLike<T = unknown> = PromiseLike<QueryResultLike<T>> & {
  select: (columns?: string) => AiQueryLike<T>;
};

const aiDb = supabase as unknown as {
  from: (table: string) => AiQueryLike;
};

type LearningRow = Pick<
  FeedbackIaResultado,
  | "prognostico_id"
  | "analise_ia_id"
  | "modo_ia"
  | "esporte"
  | "liga"
  | "mercado"
  | "pick"
  | "linha"
  | "jogo"
  | "decisao_ia_sugerida"
  | "stake_ia_sugerida"
  | "decisao_humana_final"
  | "stake_humana_final"
  | "resultado_real"
  | "resultado_teorico"
  | "resultado_financeiro"
  | "conta_bankroll"
  | "lucro_prejuizo"
  | "lucro_unidades"
  | "lucro_teorico_unidades"
  | "lucro_financeiro_unidades"
  | "odd_usada"
  | "probabilidade_final"
  | "edge_usado"
  | "tags_risco"
  | "acertou_ia"
  | "acertou_humano"
  | "divergencia_ia_humano"
  | "created_at"
>;

type HistoricalPrognostico = Prognostico & {
  resultados?: Array<{
    resultado: string;
    lucro_prejuizo: number | null;
    created_at: string;
    data_resultado: string | null;
  }>;
  validacoes?: Array<Partial<Validacao>>;
};

function AprendizadoIaPage() {
  const { data: cfg } = useConfiguracao();
  const valorUnidade = cfg?.valor_unidade_padrao ?? 10;
  const esportesCfg = cfg?.esportes_ativos ?? ESPORTES_DEFAULT;
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

  const { data: historico = [], isLoading: loadingHistorico } = useQuery({
    queryKey: ["ai-learning", "historico-retroativo"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prognosticos")
        .select(
          "*, resultados(resultado, lucro_prejuizo, data_resultado, created_at), validacoes(*)",
        )
        .in("resultado", ["GREEN", "RED", "WIN", "WINS", "LOSS", "LOSSES"]);
      if (error) {
        console.warn("[Aprendizado IA] histórico retroativo indisponível:", error.message);
        return [] as HistoricalPrognostico[];
      }
      return (data ?? []) as HistoricalPrognostico[];
    },
  });

  const learningRows = useMemo<LearningRow[]>(() => {
    const feedbackIds = new Set(feedback.map((row) => row.prognostico_id).filter(Boolean));
    const rows: LearningRow[] = feedback.map((row) => ({ ...row }));

    for (const p of historico) {
      if (feedbackIds.has(p.id)) continue;
      const resultado = normalizeOutcome(p.resultado);
      if (resultado !== "GREEN" && resultado !== "RED") continue;

      const validacao = latestByCreatedAt(p.validacoes ?? []);
      const resultadoRow = latestByCreatedAt(p.resultados ?? []);
      const decisaoHumana = normalizeAiDecision(validacao?.decisao ?? p.status_validacao);
      const decisaoIa = normalizeAiDecision(validacao?.decisao_ia_sugerida);
      const stakeHumana = Number(validacao?.stake_confirmada ?? p.stake ?? 0);
      const contaBankroll = decisaoHumana === "CONFIRMAR";
      const lucro = Number(resultadoRow?.lucro_prejuizo ?? p.lucro_prejuizo ?? 0);

      rows.push({
        prognostico_id: p.id,
        analise_ia_id: null,
        modo_ia: validacao?.modo_ia ?? null,
        esporte: p.esporte,
        liga: p.liga,
        mercado: p.mercado,
        pick: p.pick,
        linha: p.linha,
        jogo: p.jogo,
        decisao_ia_sugerida: decisaoIa,
        stake_ia_sugerida: validacao?.stake_ia_sugerida ?? null,
        decisao_humana_final: decisaoHumana,
        stake_humana_final: stakeHumana,
        resultado_real: resultado,
        resultado_teorico: resultado,
        resultado_financeiro: contaBankroll ? resultado : null,
        conta_bankroll: contaBankroll,
        lucro_prejuizo: contaBankroll ? lucro : 0,
        lucro_unidades: lucro,
        lucro_teorico_unidades: lucro,
        lucro_financeiro_unidades: contaBankroll ? lucro : 0,
        odd_usada: getOddEfetiva(p),
        probabilidade_final: p.probabilidade_final,
        edge_usado: getEdgeEfetivo(p),
        tags_risco: extractTagsFromLegacyText(
          validacao?.parecer_ia ?? validacao?.parecer_validacao ?? p.observacoes,
        ),
        acertou_ia: decisaoIa ? decisionHit(decisaoIa, resultado) : null,
        acertou_humano: decisaoHumana ? decisionHit(decisaoHumana, resultado) : null,
        divergencia_ia_humano: decisaoIa && decisaoHumana ? decisaoIa !== decisaoHumana : null,
        created_at: resultadoRow?.created_at ?? p.updated_at ?? p.created_at,
      });
    }

    return rows;
  }, [feedback, historico]);

  const mercados = useMemo(() => {
    const mercadosImportados = [
      ...analises.map((a) => a.mercado).filter(Boolean),
      ...learningRows.map((row) => row.mercado).filter(Boolean),
    ] as string[];
    const set = new Set([...mercadosCfg, ...mercadosImportados]);
    return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [mercadosCfg, analises, learningRows]);

  const esportes = useMemo(() => {
    const esportesImportados = [
      ...analises.map((a) => a.esporte).filter(Boolean),
      ...learningRows.map((row) => row.esporte).filter(Boolean),
    ] as string[];
    return [...new Set([...esportesCfg, ...esportesImportados])].sort((a, b) =>
      a.localeCompare(b, "pt-BR"),
    );
  }, [esportesCfg, analises, learningRows]);

  const filteredAnalises = useMemo(
    () =>
      analises.filter((a) => {
        if (!dateInRange((a.created_at ?? "").slice(0, 10), ini, fim)) return false;
        if (esporte !== "all" && a.esporte !== esporte) return false;
        if (liga !== "all" && a.liga !== liga) return false;
        if (mercado !== "all" && a.mercado !== mercado) return false;
        if (modoIa !== "all" && a.modo_ia !== modoIa) return false;
        if (decisaoIa !== "all" && normalizeAiDecision(a.decisao_sugerida) !== decisaoIa)
          return false;
        return true;
      }),
    [analises, ini, fim, esporte, liga, mercado, modoIa, decisaoIa],
  );

  const filteredFeedback = useMemo(
    () =>
      learningRows.filter((f) => {
        if (!dateInRange((f.created_at ?? "").slice(0, 10), ini, fim)) return false;
        if (esporte !== "all" && f.esporte !== esporte) return false;
        if (liga !== "all" && f.liga !== liga) return false;
        if (mercado !== "all" && f.mercado !== mercado) return false;
        if (modoIa !== "all" && f.modo_ia !== modoIa) return false;
        if (decisaoIa !== "all" && normalizeAiDecision(f.decisao_ia_sugerida) !== decisaoIa)
          return false;
        if (
          decisaoHumana !== "all" &&
          normalizeAiDecision(f.decisao_humana_final) !== decisaoHumana
        )
          return false;
        if (resultado !== "all" && getOutcome(f) !== resultado) return false;
        return true;
      }),
    [learningRows, ini, fim, esporte, liga, mercado, modoIa, decisaoIa, decisaoHumana, resultado],
  );

  const iaConfirmadas = filteredAnalises.filter(
    (a) => normalizeAiDecision(a.decisao_sugerida) === "CONFIRMAR",
  );
  const rowsComDecisaoIa = filteredFeedback.filter((row) =>
    normalizeAiDecision(row.decisao_ia_sugerida),
  );
  const rowsConfirmadasIa = rowsComDecisaoIa.filter(
    (row) => normalizeAiDecision(row.decisao_ia_sugerida) === "CONFIRMAR",
  );
  const feedbackConfirmadasIa = filteredFeedback.filter(
    (f) => normalizeAiDecision(f.decisao_ia_sugerida) === "CONFIRMAR",
  );
  const feedbackPuladasIa = filteredFeedback.filter(
    (f) => normalizeAiDecision(f.decisao_ia_sugerida) === "PULAR",
  );
  const feedbackComAcertoIa = filteredFeedback.filter((f) => f.acertou_ia != null);
  const acertosIa = feedbackComAcertoIa.filter((f) => f.acertou_ia === true).length;
  const confirmadasGreen = feedbackConfirmadasIa.filter((f) => getOutcome(f) === "GREEN").length;
  const confirmadasRed = feedbackConfirmadasIa.filter((f) => getOutcome(f) === "RED").length;
  const puladasGreen = feedbackPuladasIa.filter((f) => getOutcome(f) === "GREEN").length;
  const puladasRed = feedbackPuladasIa.filter((f) => getOutcome(f) === "RED").length;
  const lucroUnidadesIa = feedbackConfirmadasIa.reduce((sum, f) => sum + getFinancialUnits(f), 0);
  const stakeConfirmadaIa = feedbackConfirmadasIa.reduce(
    (sum, f) => sum + Number(f.stake_humana_final ?? f.stake_ia_sugerida ?? 0),
    0,
  );
  const divergencias = filteredFeedback.filter((f) => f.divergencia_ia_humano).length;

  const stats = {
    total: filteredFeedback.length,
    local:
      filteredFeedback.filter((row) => row.modo_ia === "local").length ||
      filteredAnalises.filter((a) => a.modo_ia === "local").length,
    online:
      filteredFeedback.filter((row) => row.modo_ia === "online").length ||
      filteredAnalises.filter((a) => a.modo_ia === "online").length,
    taxaConfirmacao: rowsComDecisaoIa.length
      ? (rowsConfirmadasIa.length / rowsComDecisaoIa.length) * 100
      : filteredAnalises.length
        ? (iaConfirmadas.length / filteredAnalises.length) * 100
        : 0,
    taxaAcerto: feedbackComAcertoIa.length ? (acertosIa / feedbackComAcertoIa.length) * 100 : 0,
    confirmadasGreen,
    confirmadasRed,
    puladasGreen,
    puladasRed,
    confirmarCorreto: confirmadasGreen,
    confirmarIncorreto: confirmadasRed,
    pularCorreto: puladasRed,
    pularIncorreto: puladasGreen,
    roiConfirmadasIa: stakeConfirmadaIa > 0 ? (lucroUnidadesIa / stakeConfirmadaIa) * 100 : 0,
    lucroUnidades: lucroUnidadesIa,
    lucroReal: lucroUnidadesIa * valorUnidade,
    divergencias,
  };

  const acertoPorEsporte = rateBy(filteredFeedback, "esporte");
  const acertoPorMercado = rateBy(filteredFeedback, "mercado");
  const lucroPorEsporte = sumFinancialBy(feedbackConfirmadasIa, "esporte");
  const lucroPorMercado = sumFinancialBy(feedbackConfirmadasIa, "mercado");
  const modoComparativo = rateBy(filteredFeedback, "modo_ia");
  const tagsRed = tagsByRed(filteredFeedback);
  const hasData = filteredAnalises.length > 0 || filteredFeedback.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Aprendizado da IA</h1>
        <p className="text-sm text-muted-foreground">
          Memória operacional entre análise da IA, decisão humana e resultados GREEN/RED.
          Confirmadas medem banca; puladas medem qualidade da decisão de recusa.
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
            <Filter
              label="Esporte"
              value={esporte}
              onChange={(v) => {
                setEsporte(v);
                setLiga("all");
              }}
              options={["all", ...esportes]}
              allLabel="Todos"
            />
            <div>
              <Label className="block text-[10px] uppercase tracking-wider text-muted-foreground">
                Liga
              </Label>
              <LeagueFilter sport={esporte} value={liga} onChange={setLiga} className="h-9 w-48" />
            </div>
            <Filter
              label="Mercado"
              value={mercado}
              onChange={setMercado}
              options={["all", ...mercados]}
              allLabel="Todos"
            />
            <Filter
              label="Modo IA"
              value={modoIa}
              onChange={setModoIa}
              options={["all", "local", "online"]}
              allLabel="Todos"
            />
            <Filter
              label="Decisão IA"
              value={decisaoIa}
              onChange={setDecisaoIa}
              options={["all", "CONFIRMAR", "PULAR"]}
              allLabel="Todas"
            />
            <Filter
              label="Decisão humana"
              value={decisaoHumana}
              onChange={setDecisaoHumana}
              options={["all", "CONFIRMAR", "PULAR"]}
              allLabel="Todas"
            />
            <Filter
              label="Resultado"
              value={resultado}
              onChange={setResultado}
              options={["all", "GREEN", "RED"]}
              allLabel="Todos"
            />
          </div>
        </CardContent>
      </Card>

      {loadingHistorico ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Carregando histórico de aprendizado...
          </CardContent>
        </Card>
      ) : !hasData ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Nenhum dado encontrado para os filtros selecionados.
          </CardContent>
        </Card>
      ) : feedback.length === 0 && historico.length > 0 ? (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            Histórico atualizado com dados retroativos a partir de prognósticos, validações e
            resultados existentes.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Prognósticos analisados" value={String(stats.total)} icon={BrainCircuit} />
        <StatCard label="IA local" value={String(stats.local)} icon={Activity} />
        <StatCard label="IA online" value={String(stats.online)} icon={Activity} />
        <StatCard
          label="Taxa de confirmação IA"
          value={`${stats.taxaConfirmacao.toFixed(1)}%`}
          icon={Target}
        />
        <StatCard
          label="Acerto geral IA"
          value={`${stats.taxaAcerto.toFixed(1)}%`}
          icon={TrendingUp}
        />
        <StatCard
          label="Confirmadas IA GREEN/RED"
          value={`${stats.confirmadasGreen}/${stats.confirmadasRed}`}
          icon={Target}
        />
        <StatCard
          label="ROI confirmadas IA"
          value={`${stats.roiConfirmadasIa.toFixed(1)}%`}
          icon={TrendingUp}
          trend={stats.roiConfirmadasIa >= 0 ? "up" : "down"}
        />
        <StatCard
          label="Puladas IA GREEN/RED"
          value={`${stats.puladasGreen}/${stats.puladasRed}`}
          icon={Split}
        />
        <StatCard
          label="Pular correto"
          value={String(stats.pularCorreto)}
          icon={Split}
          trend="up"
        />
        <StatCard
          label="Pular incorreto"
          value={String(stats.pularIncorreto)}
          icon={Split}
          trend={stats.pularIncorreto > 0 ? "down" : "neutral"}
        />
        <StatCard
          label="Confirmar correto"
          value={String(stats.confirmarCorreto)}
          icon={Target}
          trend="up"
        />
        <StatCard
          label="Confirmar incorreto"
          value={String(stats.confirmarIncorreto)}
          icon={Target}
          trend={stats.confirmarIncorreto > 0 ? "down" : "neutral"}
        />
        <StatCard
          label="Lucro real IA"
          value={`R$ ${stats.lucroReal.toFixed(2)}`}
          icon={Scale}
          trend={stats.lucroReal >= 0 ? "up" : "down"}
        />
        <StatCard
          label="Lucro (u) IA"
          value={`${stats.lucroUnidades.toFixed(2)}u`}
          icon={Scale}
          trend={stats.lucroUnidades >= 0 ? "up" : "down"}
        />
        <StatCard
          label="Divergências IA x humano"
          value={String(stats.divergencias)}
          icon={Split}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Acerto da IA por esporte (%)" rows={acertoPorEsporte} suffix="%" />
        <ChartCard title="Acerto da IA por mercado (%)" rows={acertoPorMercado} suffix="%" />
        <ChartCard
          title="Resultado oficial por esporte das confirmadas IA (u)"
          rows={lucroPorEsporte}
          suffix="u"
          diverging
        />
        <ChartCard
          title="Resultado oficial por mercado das confirmadas IA (u)"
          rows={lucroPorMercado}
          suffix="u"
          diverging
        />
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
      <Label className="block text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-44">
          <SelectValue />
        </SelectTrigger>
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

function ChartCard({
  title,
  rows,
  suffix,
  diverging = false,
}: {
  title: string;
  rows: BarRow[];
  suffix: string;
  diverging?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <div className="space-y-2">
            {rows.slice(0, 10).map((row) => (
              <div key={row.label} className="space-y-1">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate text-muted-foreground">{row.label}</span>
                  <span
                    className={
                      row.value > 0
                        ? "text-success"
                        : row.value < 0
                          ? "text-destructive"
                          : "text-muted-foreground"
                    }
                  >
                    {row.value.toFixed(1)}
                    {suffix}
                  </span>
                </div>
                <div className="h-2 rounded bg-muted">
                  <div
                    className={
                      diverging
                        ? row.value >= 0
                          ? "h-2 rounded bg-success"
                          : "h-2 rounded bg-destructive"
                        : "h-2 rounded bg-primary"
                    }
                    style={{ width: `${Math.max(4, Math.min(100, row.percent))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Nenhum resultado encontrado para os filtros selecionados.
          </div>
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

function rateBy(rows: LearningRow[], field: keyof LearningRow): BarRow[] {
  const map = new Map<string, { ok: number; total: number }>();
  for (const row of rows) {
    const key = String(row[field] ?? "Sem dado");
    const current = map.get(key) ?? { ok: 0, total: 0 };
    if (row.acertou_ia != null) {
      current.total += 1;
      if (row.acertou_ia) current.ok += 1;
    }
    map.set(key, current);
  }
  return [...map.entries()]
    .filter(([, value]) => value.total > 0)
    .map(([label, value]) => ({
      label,
      value: value.total ? (value.ok / value.total) * 100 : 0,
      percent: value.total ? (value.ok / value.total) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);
}

function sumBy(
  rows: LearningRow[],
  field: keyof LearningRow,
  sumField: keyof LearningRow,
): BarRow[] {
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

function sumFinancialBy(rows: LearningRow[], field: keyof LearningRow): BarRow[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = String(row[field] ?? "Sem dado");
    map.set(key, (map.get(key) ?? 0) + getFinancialUnits(row));
  }
  const max = Math.max(1, ...[...map.values()].map((v) => Math.abs(v)));
  return [...map.entries()]
    .map(([label, value]) => ({ label, value, percent: (Math.abs(value) / max) * 100 }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

function tagsByRed(rows: LearningRow[]): BarRow[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (getOutcome(row) !== "RED") continue;
    for (const tag of row.tags_risco ?? []) map.set(tag, (map.get(tag) ?? 0) + 1);
  }
  const max = Math.max(1, ...map.values());
  return [...map.entries()]
    .map(([label, value]) => ({ label, value, percent: (value / max) * 100 }))
    .sort((a, b) => b.value - a.value);
}

function getOutcome(row: LearningRow): string | null {
  return normalizeOutcome(row.resultado_teorico ?? row.resultado_real);
}

function getFinancialUnits(row: LearningRow): number {
  return Number(
    row.lucro_financeiro_unidades ?? (row.conta_bankroll === false ? 0 : (row.lucro_unidades ?? 0)),
  );
}

function normalizeOutcome(resultado: string | null | undefined): "GREEN" | "RED" | null {
  const value = String(resultado ?? "")
    .toUpperCase()
    .trim();
  if (["GREEN", "WIN", "WINS"].includes(value)) return "GREEN";
  if (["RED", "LOSS", "LOSSES"].includes(value)) return "RED";
  return null;
}

function latestByCreatedAt<T extends { created_at?: string | null }>(rows: T[]): T | null {
  if (!rows.length) return null;
  return (
    [...rows].sort((a, b) =>
      String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
    )[0] ?? null
  );
}

function decisionHit(
  decision: "CONFIRMAR" | "PULAR" | null,
  resultado: "GREEN" | "RED",
): boolean | null {
  if (decision === "CONFIRMAR") return resultado === "GREEN";
  if (decision === "PULAR") return resultado === "RED";
  return null;
}

function extractTagsFromLegacyText(text: string | null | undefined): string[] {
  const value = String(text ?? "").toLowerCase();
  const tags: string[] = [];
  const checks: Array<[string, RegExp]> = [
    ["info_ausente", /não encontrado|nao encontrado|ausente|incert|não confirmad|nao confirmad/],
    [
      "risco_estrutural",
      /risco estrutural|lineup|escalação|escalacao|rotação|rotacao|desfalque|lesão|lesao|questionável|questionavel/,
    ],
    [
      "fonte_fraca",
      /fonte insuficiente|fonte fraca|sem fonte|desatualizad|notícia antiga|noticia antiga/,
    ],
    ["duplicidade", /duplicidade|correlaç|correlac|redundan/],
    ["volatilidade", /volátil|volatil|variância|variancia|mercado volátil|mercado volatil/],
    ["clima", /clima|vento|chuva|temperatura|weather/],
  ];
  for (const [tag, pattern] of checks) {
    if (pattern.test(value)) tags.push(tag);
  }
  return tags;
}
