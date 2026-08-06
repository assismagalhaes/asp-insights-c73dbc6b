// Execute esta instrucao no projeto: Preciso realizar a migração completa e segura do backend deste projeto Lovable Cloud para uma conta própria do Supabase.
//
// PROJETO DE ORIGEM
// - Nome: ASP Insights
// - Project ID: 4dac6de8-943c-4948-9a8d-c134df0576c7
// - Backend atual: Lovable Cloud, baseado em Supabase/PostgreSQL
// - Banco atual: aproximadamente 3,95 GB
// - Schema public: 84 tabelas
// - Volume estimado: aproximadamente 6,8 milhões de registros
// - Auth: 1 usuário
// - Storage: 2 buckets, aproximadamente 73.694 objetos e 156 MB
//
// PROJETO DE DESTINO
// - Plataforma: Supabase Pro
// - Project ref: qjcetldbguawmfijuxrq
// - Região: sa-east-1
// - O schema estrutural já foi recriado no destino.
// - Preciso agora migrar dados, usuário e arquivos.
//
// PROBLEMA ENCONTRADO
// A exportação manual pelo botão “Export CSV” não é adequada para este banco.
//
// A tabela public.sports_odds_history possui aproximadamente 1,9 milhão de registros e sua exportação pelo painel não foi concluída. Outras tabelas também possuem centenas de milhares ou milhões de registros.
//
// Não quero exportações limitadas à página visível, amostras, relatórios resumidos ou arquivos truncados.
//
// SOLICITAÇÃO PRINCIPAL
// Forneça uma das opções abaixo, nesta ordem de preferência:
//
// 1. Um dump PostgreSQL completo feito com pg_dump, preferencialmente no formato custom:
//    pg_dump --format=custom
//
// OU
//
// 2. Uma connection string PostgreSQL temporária e somente leitura, com acesso suficiente para executar pg_dump.
//
// OU, se nenhuma das opções anteriores for possível:
//
// 3. Exportações completas e paginadas dos dados, divididas em arquivos menores, sem truncamento e preservando todas as colunas, valores nulos, UUIDs, timestamps, JSON/JSONB e relacionamentos.
//
// REQUISITOS DO DUMP/EXPORTAÇÃO
// O material precisa incluir:
//
// - Todos os dados das 84 tabelas do schema public.
// - Sequências e respectivos valores atuais, se existirem.
// - Dados necessários para preservar chaves primárias e estrangeiras.
// - Dados dos schemas necessários à migração, quando permitidos.
// - Manifesto com nome de cada tabela e quantidade exata de registros exportados.
// - Codificação UTF-8.
// - Datas e timestamps sem perda de timezone.
// - Campos JSON e JSONB sem conversão destrutiva.
// - Arquivos sem limitação silenciosa de linhas.
// - Checksums SHA-256 dos arquivos gerados, se possível.
//
// Não é necessário recriar o schema public no destino, pois as migrations já foram aplicadas. Entretanto, o dump pode conter o schema caso seja mais seguro ou seja a única modalidade disponível.
//
// AUTH
// Existe 1 usuário no Supabase Auth interno.
//
// Preciso receber:
//
// - Exportação dos dados permitidos do usuário.
// - Identificador UUID original.
// - E-mail, metadados, app_metadata, datas e demais campos exportáveis.
// - Informação explícita sobre quais campos de autenticação não podem ser exportados.
// - Procedimento recomendado para preservar o mesmo UUID ou, se isso não for possível, realizar redefinição de senha.
//
// Não exponha senha em texto puro. Não altere nem exclua o usuário atual.
//
// STORAGE
// Existem 2 buckets e aproximadamente 73.694 objetos.
//
// Preciso receber:
//
// - Lista dos buckets e suas configurações.
// - Exportação completa dos arquivos.
// - Caminho original de cada objeto.
// - MIME type, tamanho e metadados.
// - Manifesto relacionando bucket, caminho e tamanho.
// - Arquivos organizados por bucket.
// - Se necessário, dividir a exportação em vários arquivos ZIP/TAR menores.
//
// Se os downloads gerados pela Lovable tiverem limite de 20 MB, divida os arquivos em múltiplas partes menores que esse limite. Não descarte arquivos e não gere apenas uma amostra.
//
// RESTRIÇÕES DE SEGURANÇA
// Esta solicitação é estritamente de exportação e leitura.
//
// NÃO realizar:
//
// - DELETE, UPDATE, INSERT, TRUNCATE ou DROP no banco atual.
// - Mudança de migrations, schema, índices, triggers ou políticas RLS.
// - Alteração de usuários, senhas ou sessões.
// - Alteração ou exclusão dos arquivos do Storage.
// - Mudança de domínio, DNS, publicação ou deploy.
// - Alteração das variáveis e secrets atuais.
// - Modificação do código-fonte do projeto.
// - Troca automática do backend para o novo Supabase.
// - Desativação do Lovable Cloud.
// - Criação de funções temporárias persistentes no banco.
//
// O ambiente atual deve continuar funcionando normalmente durante toda a exportação.
//
// CONTROLE DE CONSISTÊNCIA
// Se possível, gere a exportação a partir de um snapshot consistente do banco.
//
// Ao concluir, informe:
//
// 1. Modalidade utilizada: dump, conexão temporária ou arquivos paginados.
// 2. Data e horário UTC do snapshot/exportação.
// 3. Quantidade exata de tabelas exportadas.
// 4. Quantidade de registros por tabela.
// 5. Tamanho total do banco exportado.
// 6. Quantidade de usuários exportados.
// 7. Quantidade de buckets e objetos exportados.
// 8. Lista de qualquer item que não pôde ser exportado.
// 9. Instruções objetivas para baixar os arquivos.
// 10. Prazo de validade da conexão ou dos links de download.
//
// IMPORTANTE
// Não responda apenas com instruções genéricas para usar o botão “Export CSV”. Esse método já foi testado e não concluiu para as tabelas grandes.
//
// Se o agente da Lovable não possuir capacidade técnica ou permissão para gerar esse material, encaminhe esta solicitação ao suporte técnico responsável pela infraestrutura Lovable Cloud e informe o protocolo do chamado.
//
// Antes de executar qualquer operação que possa modificar o ambiente atual, pare e solicite confirmação explícita.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Activity,
  BrainCircuit,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Database,
  DollarSign,
  RotateCcw,
  ShieldCheck,
  Target,
  TrendingUp,
  XCircle,
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
  Cell,
  LabelList,
  ReferenceLine,
} from "recharts";
import { ChartTooltip } from "@/components/chart-tooltip";
import {
  COLOR_GRID,
  COLOR_AXIS,
  COLOR_NEUTRAL,
  COLOR_REFERENCE,
  signColor,
  withSign,
} from "@/lib/chart-colors";
import { StatCard } from "@/components/stat-card";
import { AmbientBackdrop, PageIntro, PanelHeading } from "@/components/command-center";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { useIsMobile } from "@/hooks/use-mobile";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePrognosticos, useConfiguracao, MERCADOS_DEFAULT, ESPORTES_DEFAULT } from "@/lib/db";
import { LeagueFilter } from "@/components/league-filter";
import { SportFilterSelect } from "@/components/sport-filter-select";
import { PeriodFilter } from "@/components/period-filter";
import { formatBR } from "@/lib/date-br";
import {
  computeMetrics,
  computeValidationMetrics,
  bankrollTimeline,
  lucroUnidades,
  lucroUnidadesAnalitico,
  matchesValidationFilter,
  isStatusPular,
  rangeFromPeriodo,
  dateInRange,
  type ValidationMetricsFilter,
  type PeriodoFiltro,
} from "@/lib/metrics";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Dashboard — ASP Insights" },
      { name: "description", content: "Visão executiva de prognósticos, ROI e bankroll." },
    ],
  }),
  component: Dashboard,
});

const chartGrid = COLOR_GRID;
const axisColor = COLOR_AXIS;

const MERCADOS = ["Todos", ...MERCADOS_DEFAULT];

function Dashboard() {
  const isMobile = useIsMobile();
  const { data: prognosticos = [] } = usePrognosticos();
  const { data: cfg } = useConfiguracao();

  const [periodo, setPeriodo] = useState<PeriodoFiltro>("tudo");
  const [customIni, setCustomIni] = useState("");
  const [customFim, setCustomFim] = useState("");
  const [esporte, setEsporte] = useState("Todos");
  const [liga, setLiga] = useState("all");
  const [mercado, setMercado] = useState("Todos");
  const [validacao, setValidacao] = useState<ValidationMetricsFilter>("confirmadas");

  const { ini, fim } = rangeFromPeriodo(periodo, customIni, customFim);

  const filtrados = useMemo(
    () =>
      prognosticos.filter((p) => {
        if (!dateInRange(p.data, ini, fim)) return false;
        if (esporte !== "Todos" && p.esporte !== esporte) return false;
        if (liga !== "all" && p.liga !== liga) return false;
        if (mercado !== "Todos" && p.mercado !== mercado) return false;
        return true;
      }),
    [prognosticos, ini, fim, esporte, liga, mercado],
  );

  const officialMetrics = useMemo(() => computeMetrics(filtrados, cfg), [filtrados, cfg]);
  const metrics = useMemo(
    () => computeValidationMetrics(filtrados, cfg, validacao),
    [filtrados, cfg, validacao],
  );
  const timeline = useMemo(
    () => bankrollTimeline(filtrados, cfg?.banca_inicial ?? 0, cfg?.valor_unidade_padrao ?? 0),
    [filtrados, cfg],
  );

  const sportPerf = useMemo(() => {
    const map = new Map<string, { lucro: number; stake: number }>();
    filtrados
      .filter((p) => matchesValidationFilter(p, validacao))
      .forEach((p) => {
        const cur = map.get(p.esporte) ?? { lucro: 0, stake: 0 };
        cur.lucro += validacao === "confirmadas" ? lucroUnidades(p) : lucroUnidadesAnalitico(p);
        cur.stake +=
          validacao === "confirmadas"
            ? p.stake
            : isStatusPular(p.status_validacao) && p.stake <= 0
              ? 1
              : p.stake;
        map.set(p.esporte, cur);
      });
    return Array.from(map.entries()).map(([esporte, v]) => ({
      esporte,
      lucro: Number(v.lucro.toFixed(2)),
    }));
  }, [filtrados, validacao]);

  const sportPerfRoi = useMemo(() => {
    const map = new Map<string, { lucro: number; stake: number }>();
    filtrados
      .filter((p) => matchesValidationFilter(p, validacao))
      .forEach((p) => {
        const cur = map.get(p.esporte) ?? { lucro: 0, stake: 0 };
        cur.lucro += validacao === "confirmadas" ? lucroUnidades(p) : lucroUnidadesAnalitico(p);
        cur.stake +=
          validacao === "confirmadas"
            ? p.stake
            : isStatusPular(p.status_validacao) && p.stake <= 0
              ? 1
              : p.stake;
        map.set(p.esporte, cur);
      });
    return Array.from(map.entries()).map(([esporte, v]) => ({
      esporte,
      roi: v.stake ? Number(((v.lucro / v.stake) * 100).toFixed(1)) : 0,
    }));
  }, [filtrados, validacao]);

  const monthlyResults = useMemo(() => {
    const map = new Map<string, number>();
    filtrados
      .filter((p) => matchesValidationFilter(p, validacao))
      .forEach((p) => {
        const mes = p.data.slice(0, 7);
        map.set(
          mes,
          (map.get(mes) ?? 0) +
            (validacao === "confirmadas" ? lucroUnidades(p) : lucroUnidadesAnalitico(p)),
        );
      });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, lucro]) => ({ mes, lucro: Number(lucro.toFixed(2)) }));
  }, [filtrados, validacao]);

  const marketPerf = useMemo(() => {
    const map = new Map<string, number>();
    filtrados
      .filter((p) => matchesValidationFilter(p, validacao))
      .forEach((p) =>
        map.set(
          p.mercado,
          (map.get(p.mercado) ?? 0) +
            (validacao === "confirmadas" ? lucroUnidades(p) : lucroUnidadesAnalitico(p)),
        ),
      );
    return Array.from(map.entries()).map(([mercado, lucro]) => ({
      mercado,
      lucro: Number(lucro.toFixed(2)),
    }));
  }, [filtrados, validacao]);

  const validationSummary = useMemo(() => {
    let approved = 0;
    let skipped = 0;
    let pending = 0;

    for (const prognostico of filtrados) {
      const status = String(prognostico.status_validacao ?? "PENDENTE").toUpperCase();
      if (status === "PENDENTE") pending += 1;
      else if (isStatusPular(prognostico.status_validacao)) skipped += 1;
      else approved += 1;
    }

    const total = approved + skipped + pending;
    return {
      approved,
      skipped,
      pending,
      total,
      approvedPct: total ? (approved / total) * 100 : 0,
      skippedPct: total ? (skipped / total) * 100 : 0,
      pendingPct: total ? (pending / total) * 100 : 0,
    };
  }, [filtrados]);

  const recentActivity = useMemo(
    () =>
      [...filtrados]
        .sort((a, b) => b.data.localeCompare(a.data))
        .slice(0, 6)
        .map((prognostico) => ({
          id: prognostico.id,
          data: prognostico.data,
          evento: prognostico.jogo,
          esporte: prognostico.esporte,
          liga: prognostico.liga,
          mercado: prognostico.mercado,
          status: String(prognostico.status_validacao ?? "PENDENTE"),
        })),
    [filtrados],
  );

  const bankrollSparkline = timeline.slice(-12).map((point) => Number(point.banca));
  const roiSparkline = timeline.slice(-12).map((point) => Number(point.roi));
  const resultSparkline = monthlyResults.slice(-12).map((point) => point.lucro);

  const operationalHealth = [
    {
      label: "Modelo preditivo",
      detail: `${filtrados.length} prognósticos no recorte`,
      icon: BrainCircuit,
      state: filtrados.length ? "Saudável" : "Sem amostra",
      tone: filtrados.length ? "success" : "neutral",
    },
    {
      label: "Calibração de probabilidades",
      detail: `${metrics.greens + metrics.reds} resultados avaliados`,
      icon: Target,
      state: metrics.greens + metrics.reds >= 20 ? "Saudável" : "Atenção",
      tone: metrics.greens + metrics.reds >= 20 ? "success" : "warning",
    },
    {
      label: "Detecção de risco",
      detail: `ROI atual ${withSign(metrics.roi)}%`,
      icon: CircleAlert,
      state: metrics.roi >= 0 ? "Saudável" : "Atenção",
      tone: metrics.roi >= 0 ? "success" : "warning",
    },
    {
      label: "Pipeline de dados",
      detail: `${timeline.length} pontos na série`,
      icon: Database,
      state: timeline.length ? "Saudável" : "Sem dados",
      tone: timeline.length ? "success" : "neutral",
    },
  ] as const;
  const chartHeight = isMobile ? 260 : 340;

  function clearFilters() {
    setPeriodo("tudo");
    setCustomIni("");
    setCustomFim("");
    setEsporte("Todos");
    setLiga("all");
    setMercado("Todos");
    setValidacao("confirmadas");
  }

  return (
    <div className="command-surface page-stack">
      <AmbientBackdrop />
      <PageIntro
        title="Dashboard Executivo"
        description="Visão estratégica do desempenho e da operação do sistema de previsões."
        status="Dados operacionais atualizados"
      />

      {/* Filtros */}
      <div className="filter-surface">
        <div className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-end">
          <PeriodFilter
            periodo={periodo}
            onPeriodoChange={setPeriodo}
            customIni={customIni}
            customFim={customFim}
            onCustomIniChange={setCustomIni}
            onCustomFimChange={setCustomFim}
          />
          <div className="min-w-0 sm:w-44">
            <label
              htmlFor="dashboard-esporte"
              className="block text-[10px] uppercase tracking-wider text-muted-foreground"
            >
              Esporte
            </label>
            <SportFilterSelect
              value={esporte}
              onValueChange={setEsporte}
              options={ESPORTES_DEFAULT}
              allValue="Todos"
              allLabel="Todos os esportes"
              id="dashboard-esporte"
              className="h-9 w-full"
            />
          </div>
          <div className="min-w-0 sm:w-48">
            <label
              htmlFor="dashboard-liga"
              className="block text-[10px] uppercase tracking-wider text-muted-foreground"
            >
              Liga
            </label>
            <LeagueFilter
              sport={esporte === "Todos" ? "all" : esporte}
              value={liga}
              onChange={setLiga}
              id="dashboard-liga"
              className="h-9 w-full"
            />
          </div>
          <div className="min-w-0 sm:w-52">
            <label
              htmlFor="dashboard-mercado"
              className="block text-[10px] uppercase tracking-wider text-muted-foreground"
            >
              Mercado
            </label>
            <Select value={mercado} onValueChange={setMercado}>
              <SelectTrigger id="dashboard-mercado" className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MERCADOS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 sm:w-44">
            <label
              htmlFor="dashboard-validacao"
              className="block text-[10px] uppercase tracking-wider text-muted-foreground"
            >
              Validação
            </label>
            <Select
              value={validacao}
              onValueChange={(v) => setValidacao(v as ValidationMetricsFilter)}
            >
              <SelectTrigger id="dashboard-validacao" className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="confirmadas">Confirmadas</SelectItem>
                <SelectItem value="puladas">Puladas</SelectItem>
                <SelectItem value="todas">Todas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={clearFilters}
            className="h-9 w-full border-primary/20 bg-primary/5 text-xs text-muted-foreground hover:bg-primary/10 hover:text-primary sm:ml-auto sm:w-auto"
          >
            <RotateCcw data-icon="inline-start" />
            Limpar filtros
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label="Prognósticos"
          value={String(filtrados.length)}
          icon={Activity}
          tone="off"
          accent="blue"
          sparkline={resultSparkline}
          meta="No recorte selecionado"
        />
        <StatCard
          label="Aprovados"
          value={String(validationSummary.approved)}
          icon={ShieldCheck}
          tone="up"
          accent="green"
          sparkline={bankrollSparkline}
          meta={`${validationSummary.approvedPct.toFixed(1)}% do total`}
        />
        <StatCard
          label="Pendentes"
          value={String(validationSummary.pending)}
          icon={Clock3}
          tone="neutral"
          accent="amber"
          sparkline={resultSparkline.map((value) => Math.abs(value))}
          meta={`${validationSummary.pendingPct.toFixed(1)}% aguardando análise`}
        />
        <StatCard
          label="Win Rate"
          value={`${metrics.winRate.toFixed(1)}%`}
          icon={Target}
          tone={metrics.winRate >= 50 ? "up" : metrics.winRate > 0 ? "down" : "neutral"}
          accent="violet"
          sparkline={resultSparkline}
          meta={`${metrics.greens} GREEN / ${metrics.reds} RED`}
        />
        <StatCard
          className="col-span-2 lg:col-span-1"
          label="ROI"
          value={`${withSign(metrics.roi)}%`}
          icon={TrendingUp}
          tone={metrics.roi > 0 ? "up" : metrics.roi < 0 ? "down" : "neutral"}
          accent="cyan"
          sparkline={roiSparkline}
          meta={`${withSign(metrics.lucroU)}u no período`}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <div className="surface-panel">
          <PanelHeading
            eyebrow="Performance financeira"
            title="Evolução da Banca"
            icon={DollarSign}
            value={
              <span
                className="numeric-value text-xs"
                style={{
                  color: signColor(officialMetrics.bancaAtual - officialMetrics.bancaInicial),
                }}
              >
                R$ {officialMetrics.bancaAtual.toFixed(2)}
              </span>
            }
          />
          <ResponsiveContainer width="100%" height={chartHeight}>
            <LineChart data={timeline}>
              <defs>
                <linearGradient id="bancaPos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={signColor(1)} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={signColor(1)} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="bancaNeg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={signColor(-1)} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={signColor(-1)} stopOpacity={0} />
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
                y={officialMetrics.bancaInicial}
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
                          color: signColor(v - officialMetrics.bancaInicial),
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
              <Line
                type="monotone"
                dataKey="banca"
                stroke={signColor(officialMetrics.bancaAtual - officialMetrics.bancaInicial)}
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
              />
              <Line type="monotone" dataKey="lucroAcum" hide />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="surface-panel">
          <PanelHeading
            eyebrow="Eficiência operacional"
            title="Evolução do ROI"
            icon={TrendingUp}
            value={
              <span className="numeric-value text-xs" style={{ color: signColor(metrics.roi) }}>
                {withSign(metrics.roi)}%
              </span>
            }
          />
          <ResponsiveContainer width="100%" height={chartHeight}>
            <LineChart data={timeline}>
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis
                dataKey="data"
                stroke={axisColor}
                fontSize={10}
                tickFormatter={(d) => String(d).slice(5)}
              />
              <YAxis stroke={axisColor} fontSize={10} />
              <ReferenceLine y={0} stroke={COLOR_REFERENCE} strokeWidth={1.5} />
              <Tooltip
                content={
                  <ChartTooltip
                    headerFormatter={(d) => formatBR(d)}
                    formatter={(v) => ({
                      label: "ROI",
                      display: `${withSign(v)}%`,
                      color: signColor(v),
                    })}
                  />
                }
              />
              <Line
                type="monotone"
                dataKey="roi"
                stroke={signColor(metrics.roi)}
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="surface-panel">
          <PanelHeading
            eyebrow="Distribuição esportiva"
            title="Resultado por Esporte (u)"
            icon={Activity}
          />
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart data={sportPerf} margin={{ top: 16, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis dataKey="esporte" stroke={axisColor} fontSize={10} />
              <YAxis stroke={axisColor} fontSize={10} />
              <ReferenceLine y={0} stroke={COLOR_REFERENCE} />
              <Tooltip
                cursor={{ fill: "oklch(0.28 0.02 250 / 0.3)" }}
                content={
                  <ChartTooltip
                    formatter={(v) => ({
                      label: "Lucro",
                      display: `${withSign(v)}u`,
                      color: signColor(v),
                    })}
                  />
                }
              />
              <Bar dataKey="lucro" radius={[4, 4, 0, 0]}>
                {sportPerf.map((d, i) => (
                  <Cell key={i} fill={signColor(d.lucro)} />
                ))}
                <LabelList
                  dataKey="lucro"
                  position="top"
                  formatter={(v: number) => `${withSign(v)}u`}
                  style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", fill: COLOR_AXIS }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="surface-panel">
          <PanelHeading
            eyebrow="Inteligência de mercado"
            title="Resultado por Mercado (u)"
            icon={Target}
          />
          <ResponsiveContainer
            width="100%"
            height={Math.min(
              isMobile ? 420 : 500,
              Math.max(isMobile ? 300 : 340, marketPerf.length * 38 + 56),
            )}
          >
            <BarChart
              data={marketPerf}
              layout="vertical"
              margin={{ top: 8, right: 48, left: 0, bottom: 8 }}
            >
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis type="number" stroke={axisColor} fontSize={10} />
              <YAxis
                type="category"
                dataKey="mercado"
                stroke={axisColor}
                fontSize={10}
                width={140}
              />
              <ReferenceLine x={0} stroke={COLOR_REFERENCE} />
              <Tooltip
                cursor={{ fill: "oklch(0.28 0.02 250 / 0.3)" }}
                content={
                  <ChartTooltip
                    formatter={(v) => ({
                      label: "Lucro",
                      display: `${withSign(v)}u`,
                      color: signColor(v),
                    })}
                  />
                }
              />
              <Bar dataKey="lucro" radius={[0, 4, 4, 0]}>
                {marketPerf.map((d, i) => (
                  <Cell key={i} fill={signColor(d.lucro)} />
                ))}
                <LabelList
                  dataKey="lucro"
                  position="right"
                  formatter={(v: number) => `${withSign(v)}u`}
                  style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", fill: COLOR_AXIS }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="surface-panel">
          <PanelHeading
            eyebrow="Retorno comparativo"
            title="ROI por Esporte (%)"
            icon={TrendingUp}
          />
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart data={sportPerfRoi} margin={{ top: 16, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis dataKey="esporte" stroke={axisColor} fontSize={10} />
              <YAxis stroke={axisColor} fontSize={10} />
              <ReferenceLine y={0} stroke={COLOR_REFERENCE} />
              <Tooltip
                cursor={{ fill: "oklch(0.28 0.02 250 / 0.3)" }}
                content={
                  <ChartTooltip
                    formatter={(v) => ({
                      label: "ROI",
                      display: `${withSign(v, 1)}%`,
                      color: signColor(v),
                    })}
                  />
                }
              />
              <Bar dataKey="roi" radius={[4, 4, 0, 0]}>
                {sportPerfRoi.map((d, i) => (
                  <Cell key={i} fill={signColor(d.roi)} />
                ))}
                <LabelList
                  dataKey="roi"
                  position="top"
                  formatter={(v: number) => `${withSign(v, 1)}%`}
                  style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", fill: COLOR_AXIS }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="surface-panel">
          <PanelHeading
            eyebrow="Tendência temporal"
            title="Resultado por Mês (u)"
            icon={Activity}
          />
          <ResponsiveContainer width="100%" height={isMobile ? 220 : 260}>
            <BarChart data={monthlyResults} margin={{ top: 16, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
              <XAxis dataKey="mes" stroke={axisColor} fontSize={10} />
              <YAxis stroke={axisColor} fontSize={10} />
              <ReferenceLine y={0} stroke={COLOR_REFERENCE} />
              <Tooltip
                cursor={{ fill: "oklch(0.28 0.02 250 / 0.3)" }}
                content={
                  <ChartTooltip
                    formatter={(v) => ({
                      label: "Lucro",
                      display: `${withSign(v)}u`,
                      color: signColor(v),
                    })}
                  />
                }
              />
              <Bar dataKey="lucro" radius={[4, 4, 0, 0]}>
                {monthlyResults.map((entry, i) => (
                  <Cell key={i} fill={signColor(entry.lucro)} />
                ))}
                <LabelList
                  dataKey="lucro"
                  position="top"
                  formatter={(v: number) => `${withSign(v)}u`}
                  style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", fill: COLOR_AXIS }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <section className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.55fr)]">
        <div className="data-surface">
          <div className="flex items-center justify-between gap-3 border-b border-border/80 px-4 py-3">
            <div>
              <p className="panel-kicker">Fluxo do sistema</p>
              <h2 className="section-title mt-1">Atividade operacional recente</h2>
            </div>
            <Button asChild variant="ghost" size="sm" className="text-xs text-muted-foreground">
              <Link to="/historico">Ver histórico</Link>
            </Button>
          </div>
          <div
            className="overflow-x-auto"
            role="region"
            aria-label="Atividade operacional recente"
            tabIndex={0}
          >
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="border-b border-border/70 bg-background/35 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Data</th>
                  <th className="px-4 py-2.5 font-medium">Evento</th>
                  <th className="px-4 py-2.5 font-medium">Esporte</th>
                  <th className="px-4 py-2.5 font-medium">Liga</th>
                  <th className="px-4 py-2.5 font-medium">Mercado</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {recentActivity.length ? (
                  recentActivity.map((item) => (
                    <tr key={item.id} className="transition-colors hover:bg-primary/[0.035]">
                      <td className="numeric-value whitespace-nowrap px-4 py-3 text-muted-foreground">
                        {formatBR(item.data)}
                      </td>
                      <td className="max-w-64 truncate px-4 py-3 font-medium">{item.evento}</td>
                      <td className="px-4 py-3 text-muted-foreground">{item.esporte}</td>
                      <td className="max-w-40 truncate px-4 py-3 text-muted-foreground">
                        {item.liga}
                      </td>
                      <td className="max-w-40 truncate px-4 py-3 text-muted-foreground">
                        {item.mercado}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={item.status} />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                      Nenhuma atividade encontrada para os filtros atuais.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="surface-panel">
            <PanelHeading
              eyebrow="Governança"
              title="Status de validação"
              icon={ShieldCheck}
              value={
                <span className="numeric-value text-xs text-success">
                  {validationSummary.approvedPct.toFixed(1)}%
                </span>
              }
            />
            <div className="grid grid-cols-[8rem_1fr] items-center gap-4">
              <div
                role="img"
                aria-label={`${validationSummary.approvedPct.toFixed(1)}% aprovados, ${validationSummary.skippedPct.toFixed(1)}% pulados e ${validationSummary.pendingPct.toFixed(1)}% pendentes`}
                className="relative mx-auto aspect-square w-28 rounded-full"
                style={{
                  background: `conic-gradient(var(--color-success) 0 ${validationSummary.approvedPct}%, var(--color-destructive) ${validationSummary.approvedPct}% ${validationSummary.approvedPct + validationSummary.skippedPct}%, var(--color-warning) ${validationSummary.approvedPct + validationSummary.skippedPct}% 100%)`,
                }}
              >
                <div className="absolute inset-4 flex flex-col items-center justify-center rounded-full border border-border/70 bg-card">
                  <strong className="numeric-value text-lg">
                    {validationSummary.approvedPct.toFixed(1)}%
                  </strong>
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                    aprovados
                  </span>
                </div>
              </div>
              <dl className="space-y-2 text-xs">
                <ValidationLegend
                  label="Aprovados"
                  value={validationSummary.approved}
                  color="bg-success"
                />
                <ValidationLegend
                  label="Pulados"
                  value={validationSummary.skipped}
                  color="bg-destructive"
                />
                <ValidationLegend
                  label="Pendentes"
                  value={validationSummary.pending}
                  color="bg-warning"
                />
                <div className="flex items-center justify-between border-t border-border/70 pt-2 font-medium">
                  <dt>Total</dt>
                  <dd className="numeric-value">{validationSummary.total}</dd>
                </div>
              </dl>
            </div>
            <Button asChild variant="outline" size="sm" className="mt-4 w-full">
              <Link to="/validacao">Ver validação crítica</Link>
            </Button>
          </div>

          <div className="surface-panel">
            <PanelHeading eyebrow="Confiabilidade" title="Saúde operacional" icon={BrainCircuit} />
            <div className="divide-y divide-border/60">
              {operationalHealth.map((item) => (
                <div key={item.label} className="flex items-center gap-3 py-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded border border-primary/20 bg-primary/5 text-primary">
                    <item.icon aria-hidden="true" className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{item.label}</p>
                    <p className="truncate text-[10px] text-muted-foreground">{item.detail}</p>
                  </div>
                  <span
                    className={
                      item.tone === "success"
                        ? "text-[10px] font-semibold uppercase text-success"
                        : item.tone === "warning"
                          ? "text-[10px] font-semibold uppercase text-warning"
                          : "text-[10px] font-semibold uppercase text-muted-foreground"
                    }
                  >
                    {item.state}
                  </span>
                </div>
              ))}
            </div>
            <Button asChild variant="outline" size="sm" className="mt-3 w-full">
              <Link to="/observabilidade-ia">Ver observabilidade da IA</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function ValidationLegend({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2 text-muted-foreground">
        <span className={`size-2 rounded-sm ${color}`} aria-hidden="true" />
        {label}
      </dt>
      <dd className="numeric-value font-medium">{value}</dd>
    </div>
  );
}
