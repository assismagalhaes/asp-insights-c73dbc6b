import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  Cpu,
  FileOutput,
  FolderOpen,
  Play,
  Send,
  Sparkles,
  Target,
  Upload,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { fetchCollections, type ColetaOdds } from "@/lib/coleta-dados";
import {
  executePackballPredictiveModel,
  executePredictiveModel,
  getFootballPredictiveModelStatus,
  startFootballPredictiveModel,
  uploadPackballModelFiles,
} from "@/lib/scraper-api.functions";
import { supabase } from "@/lib/supabase-public";
import { normalizeEsporteLiga } from "@/lib/db";
import { parseBrazilianDate, formatDateTimeBR } from "@/lib/date-br";
import { standardizePredictionContract } from "@/lib/market-contract";
import { AmbientBackdrop, PageIntro } from "@/components/command-center";
import { SportMark } from "@/components/sport-filter-select";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/modelos-preditivos")({
  component: ModelosPreditivosPage,
});

type ModeloDisponivel =
  | "ASP MatchMatrix"
  | "ASP Diamond"
  | "ASP Court"
  | "ASP Court W"
  | "ASP GoalMatrix"
  | "ASP CornerMatrix"
  | "ASP BackMatrix";

type PackballRunMode = "prognostico" | "backtest";

interface ModeloPrognostico {
  data: string;
  hora: string | null;
  esporte: string;
  liga: string;
  jogo: string;
  mandante?: string | null;
  visitante?: string | null;
  mercado: string;
  pick: string;
  linha?: string | null;
  odd?: number | null;
  odd_ofertada: number;
  odd_mediana?: number | null;
  odd_mercado_base?: number | null;
  odd_melhor?: number | null;
  bookmaker_melhor?: string | null;
  odd_valor: number;
  probabilidade?: number | null;
  probabilidade_final: number;
  edge: number;
  stake?: number | null;
  selection_role?: string | null;
  required_edge?: number | null;
  edge_referencial?: number | null;
  odd_minima_publicacao?: number | null;
  price_feasibility_status?: string | null;
  price_gap_pct?: number | null;
  requires_executable_odd?: boolean;
  observacoes?: string | null;
  dados_tecnicos?: string | null;
  contexto_adicional?: string | null;
  parecer_validacao?: string | null;
  contexto_modelo?: string | null;
  arquivo_contexto?: string | null;
}

interface ModeloResultado {
  ok?: boolean;
  job_id?: string;
  input_id?: string;
  modelo?: string;
  csv_coleta?: string;
  arquivo_saida?: string;
  arquivo_contexto?: string;
  contexto_modelo?: string;
  dados_tecnicos?: string;
  mensagem?: string;
  total_prognosticos?: number;
  diagnostico_funil?: Record<string, unknown>;
  prognosticos?: ModeloPrognostico[];
}

const LAST_PACKBALL_RESULT_KEY = "asp-insights:last-packball-model-result";

const MODEL_CATALOG: Array<{
  name: ModeloDisponivel;
  sport: string;
  family: string;
}> = [
  { name: "ASP MatchMatrix", sport: "Football", family: "Coletas da VM" },
  { name: "ASP Diamond", sport: "Baseball", family: "MLB" },
  { name: "ASP Court", sport: "Basketball", family: "NBA" },
  { name: "ASP Court W", sport: "Basketball", family: "WNBA" },
  { name: "ASP GoalMatrix", sport: "Football", family: "PackBall" },
  { name: "ASP CornerMatrix", sport: "Football", family: "PackBall" },
  { name: "ASP BackMatrix", sport: "Football", family: "PackBall" },
];

function ModelosPreditivosPage() {
  const qc = useQueryClient();
  const catalogRef = useRef<HTMLDivElement>(null);
  const [selectedColetaId, setSelectedColetaId] = useState("");
  const [modelo, setModelo] = useState<ModeloDisponivel>("ASP MatchMatrix");
  const [running, setRunning] = useState(false);
  const [sending, setSending] = useState(false);
  const [resultado, setResultado] = useState<ModeloResultado | null>(null);
  const [packballFile5, setPackballFile5] = useState<File | null>(null);
  const [packballFile20, setPackballFile20] = useState<File | null>(null);
  const [packballRunMode, setPackballRunMode] = useState<PackballRunMode>("prognostico");

  useEffect(() => {
    try {
      const saved = globalThis.localStorage?.getItem(LAST_PACKBALL_RESULT_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as ModeloResultado;
      if (!parsed.modelo || !isPackballModel(parsed.modelo as ModeloDisponivel)) return;
      setModelo(parsed.modelo as ModeloDisponivel);
      setResultado(parsed);
    } catch {
      globalThis.localStorage?.removeItem(LAST_PACKBALL_RESULT_KEY);
    }
  }, []);

  const { data: coletas = [] } = useQuery({
    queryKey: ["coletas-odds"],
    queryFn: fetchCollections,
  });

  const concluidas = useMemo(() => {
    if (isPackballModel(modelo)) return [];
    const coletasConcluidas = coletas.filter(
      (coleta) => coleta.status === "CONCLUIDA" && coleta.job_id,
    );
    if (modelo === "ASP Diamond") return coletasConcluidas.filter(isBaseballColeta);
    if (modelo === "ASP Court")
      return coletasConcluidas.filter((coleta) => isBasketballColeta(coleta, "NBA"));
    if (modelo === "ASP Court W")
      return coletasConcluidas.filter((coleta) => isBasketballColeta(coleta, "WNBA"));
    if (modelo === "ASP MatchMatrix")
      return coletasConcluidas.filter((coleta) => !coleta.esporte || isFootballColeta(coleta));
    return coletasConcluidas;
  }, [coletas, modelo]);

  const packballMode = isPackballModel(modelo);
  const coletaSelecionada = concluidas.find((coleta) => coleta.id === selectedColetaId) ?? null;
  const prognosticos = resultado?.prognosticos ?? [];
  const canExecute = packballMode
    ? Boolean(packballFile5 && packballFile20) && !running
    : Boolean(coletaSelecionada) && !running;

  const selecionarModelo = (value: ModeloDisponivel) => {
    setModelo(value);
    setSelectedColetaId("");
    setResultado(null);
    setPackballFile5(null);
    setPackballFile20(null);
    setPackballRunMode("prognostico");
  };

  const executarModelo = async () => {
    if (packballMode) {
      if (!packballFile5 || !packballFile20) {
        toast.error(
          isPackballModel(modelo)
            ? "Selecione as planilhas PackBall de 10j gerais e 20j por mando."
            : "Selecione as planilhas PackBall de 5j e 20j.",
        );
        return;
      }

      setRunning(true);
      setResultado(null);
      try {
        const uploadResponse = await uploadPackballModelFiles({
          data: {
            modelo,
            date_str: inferPackballDate(packballFile5.name, packballFile20.name),
            arquivo_5: { name: packballFile5.name, content: await packballFile5.text() },
            arquivo_20: { name: packballFile20.name, content: await packballFile20.text() },
          },
        });
        const inputId = extractInputId(uploadResponse);
        const response = await executePackballPredictiveModel({
          data: { modelo, input_id: inputId, run_mode: packballRunMode },
        });
        const parsed = normalizeModelResponse(response);
        setResultado(parsed);
        globalThis.localStorage?.setItem(LAST_PACKBALL_RESULT_KEY, JSON.stringify(parsed));
        const total = parsed.total_prognosticos ?? parsed.prognosticos?.length ?? 0;
        if (total === 0) {
          toast.info("Nenhuma oportunidade EV+ encontrada para estas planilhas.");
        } else {
          toast.success(`${total} prognóstico(s) gerado(s)`);
        }
      } catch (e) {
        toast.error((e as Error).message || "Erro ao executar modelo PackBall.");
      } finally {
        setRunning(false);
      }
      return;
    }

    if (!coletaSelecionada?.job_id) {
      toast.error("Selecione uma coleta concluída.");
      return;
    }

    if (modelo === "ASP Diamond" && !isBaseballColeta(coletaSelecionada)) {
      toast.error("Selecione uma coleta Baseball/MLB para executar o ASP Diamond.");
      return;
    }
    if (modelo === "ASP Court" && !isBasketballColeta(coletaSelecionada, "NBA")) {
      toast.error("Selecione uma coleta Basketball/NBA para executar o ASP Court.");
      return;
    }
    if (modelo === "ASP Court W" && !isBasketballColeta(coletaSelecionada, "WNBA")) {
      toast.error("Selecione uma coleta Basketball/WNBA para executar o ASP Court W.");
      return;
    }

    setRunning(true);
    setResultado(null);
    try {
      const response =
        modelo === "ASP MatchMatrix"
          ? await executeFootballModelAsync(coletaSelecionada.job_id)
          : await executePredictiveModel({
              data: { job_id: coletaSelecionada.job_id, modelo },
            });
      const parsed = normalizeModelResponse(response);
      setResultado(parsed);
      const total = parsed.total_prognosticos ?? parsed.prognosticos?.length ?? 0;
      if (total === 0) {
        toast.info("Nenhuma oportunidade EV+ encontrada para esta coleta.");
      } else {
        toast.success(`${total} prognóstico(s) gerado(s)`);
      }
    } catch (e) {
      toast.error((e as Error).message || "Erro ao executar modelo preditivo.");
    } finally {
      setRunning(false);
    }
  };

  const enviarParaPrognosticos = async () => {
    if (!prognosticos.length) {
      toast.error("Execute um modelo antes de enviar.");
      return;
    }

    setSending(true);
    try {
      const payload = prognosticos.map((p) =>
        stripUnsupportedPrognosticoColumns(toPrognosticoInsert(p, resultado)),
      );
      const { error } = await supabase.from("prognosticos").insert(payload as never);
      if (error) {
        if (isMissingOddsContextColumnError(error)) {
          const fallbackPayload = payload.map(stripOddsContextColumns);
          const { error: fallbackError } = await supabase
            .from("prognosticos")
            .insert(fallbackPayload as never);
          if (fallbackError) throw fallbackError;
        } else {
          throw error;
        }
      }
      await qc.invalidateQueries({ queryKey: ["prognosticos"] });
      toast.success(`${payload.length} prognóstico(s) enviados para Prognósticos`);
    } catch (e) {
      toast.error((e as Error).message || "Erro ao enviar prognósticos.");
    } finally {
      setSending(false);
    }
  };

  const scrollCatalog = (direction: -1 | 1) => {
    catalogRef.current?.scrollBy({
      left: direction * Math.min(catalogRef.current.clientWidth * 0.8, 560),
      behavior: "smooth",
    });
  };

  return (
    <div className="page-stack relative isolate mx-auto min-w-0 w-full max-w-[1600px] overflow-x-hidden">
      <AmbientBackdrop />
      <PageIntro
        title="Modelos Preditivos"
        description="Execute modelos preditivos sobre coletas concluídas e acompanhe o resultado antes do envio."
        icon={BrainCircuit}
        iconTone="ai"
        status="VM operacional"
        actions={
          <Badge variant="outline" className="border-ai/30 bg-ai/5 text-ai">
            <Cpu className="size-3.5" aria-hidden="true" />
            Execução protegida
          </Badge>
        }
      />

      <section
        className="order-1 overflow-hidden rounded-lg border border-primary/15 bg-card/85 shadow-[0_18px_44px_rgb(0_0_0/0.16)] lg:order-2"
        aria-labelledby="catalog-title"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2
            id="catalog-title"
            className="text-xs font-semibold uppercase tracking-[0.14em] text-primary"
          >
            Catálogo de modelos
          </h2>
          <div className="flex items-center gap-2">
            <span className="hidden text-[10px] text-muted-foreground sm:inline">
              Selecione uma família
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 border border-border bg-background/45"
                aria-label="Ver modelos anteriores"
                onClick={() => scrollCatalog(-1)}
              >
                <ChevronLeft className="size-3.5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 border border-border bg-background/45"
                aria-label="Ver próximos modelos"
                onClick={() => scrollCatalog(1)}
              >
                <ChevronRight className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>
        <div
          ref={catalogRef}
          className="flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-smooth p-3"
        >
          {MODEL_CATALOG.map((item) => {
            const selected = item.name === modelo;
            return (
              <button
                key={item.name}
                type="button"
                onClick={() => selecionarModelo(item.name)}
                aria-pressed={selected}
                className={cn(
                  "flex min-w-[156px] snap-start items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors sm:min-w-[164px]",
                  selected
                    ? "border-primary/55 bg-primary/10 shadow-[0_0_22px_rgb(37_99_235/0.12)]"
                    : "border-border bg-background/35 hover:border-primary/30 hover:bg-primary/5",
                )}
              >
                <SportMark sport={item.sport} size="md" />
                <span className="min-w-0">
                  <strong className={cn("block truncate text-xs", selected && "text-primary")}>
                    {item.name.replace("ASP ", "")}
                  </strong>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    {item.family}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <Card className="order-2 overflow-hidden border-primary/20 bg-[linear-gradient(135deg,color-mix(in_oklab,var(--color-primary)_5%,var(--color-card)),var(--color-card)_72%)] shadow-[0_18px_44px_rgb(0_0_0/0.16)] lg:order-1">
        <CardHeader className="border-b border-border">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-primary" /> Console de execução
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className={
              packballMode
                ? "grid gap-3 md:grid-cols-[220px_1fr_1fr_180px_auto] md:items-end"
                : "grid gap-3 md:grid-cols-[240px_1.5fr_auto] md:items-end"
            }
          >
            <div>
              <label className="text-sm font-medium">Modelo</label>
              <Select
                value={modelo}
                onValueChange={(value) => selecionarModelo(value as ModeloDisponivel)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ASP MatchMatrix">ASP MatchMatrix</SelectItem>
                  <SelectItem value="ASP GoalMatrix">ASP GoalMatrix</SelectItem>
                  <SelectItem value="ASP CornerMatrix">ASP CornerMatrix</SelectItem>
                  <SelectItem value="ASP BackMatrix">ASP BackMatrix</SelectItem>
                  <SelectItem value="ASP Diamond">ASP Diamond</SelectItem>
                  <SelectItem value="ASP Court">ASP Court</SelectItem>
                  <SelectItem value="ASP Court W">ASP Court W</SelectItem>
                  <SelectItem value="Hockey" disabled>
                    Hockey
                  </SelectItem>
                  <SelectItem value="American Football" disabled>
                    American Football
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {packballMode ? (
              <>
                <PackballFileInput
                  label={isPackballModel(modelo) ? "PackBall 10j gerais" : "Planilha PackBall 5j"}
                  file={packballFile5}
                  onFile={setPackballFile5}
                />
                <PackballFileInput
                  label={
                    modelo === "ASP GoalMatrix" || modelo === "ASP BackMatrix"
                      ? "PackBall 20j casa/fora"
                      : "Planilha PackBall 20j"
                  }
                  file={packballFile20}
                  onFile={setPackballFile20}
                />
                {packballMode ? (
                  <div>
                    <label className="text-sm font-medium">Execução</label>
                    <Select
                      value={packballRunMode}
                      onValueChange={(value) => setPackballRunMode(value as PackballRunMode)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="prognostico">Prognóstico (NS)</SelectItem>
                        <SelectItem value="backtest">Backtest (FT)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </>
            ) : (
              <div>
                <label className="text-sm font-medium">Coleta concluída</label>
                <Select value={selectedColetaId} onValueChange={setSelectedColetaId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione uma coleta" />
                  </SelectTrigger>
                  <SelectContent>
                    {concluidas.map((coleta) => (
                      <SelectItem key={coleta.id} value={coleta.id}>
                        {formatDateTimeBR(coleta.created_at)} - {coleta.esporte ?? "-"} -{" "}
                        {coleta.job_id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button
              onClick={executarModelo}
              disabled={!canExecute}
              className="shadow-[0_0_24px_rgb(37_99_235/0.18)]"
            >
              <Play className="mr-2 h-4 w-4" />
              {running ? "Executando..." : "Executar Modelo"}
            </Button>
          </div>

          {running && (
            <div
              role="status"
              className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary"
            >
              Executando modelo preditivo na VM...
            </div>
          )}

          <div
            role="status"
            aria-live="polite"
            className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3"
          >
            <Info
              icon={Activity}
              label="Status da execução"
              value={
                running
                  ? "Executando na VM"
                  : resultado
                    ? "Execução concluída"
                    : "Aguardando entrada"
              }
            />
            <Info icon={BrainCircuit} label="Modelo ativo" value={modelo.replace("ASP ", "")} />
            <Info
              icon={Cpu}
              label="Proteção operacional"
              value={canExecute ? "Entrada pronta" : "Execução bloqueada"}
            />
          </div>

          {packballMode && (
            <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              <Upload className="mr-2 inline h-4 w-4" />
              Importe as duas planilhas cruas do PackBall. O modelo organiza os dados e gera
              prognosticos no mesmo fluxo dos demais modelos.
            </div>
          )}

          {coletaSelecionada && <ColetaResumo coleta={coletaSelecionada} />}
        </CardContent>
      </Card>

      <Card className="order-3 overflow-hidden border-primary/15 bg-card/90 shadow-[0_18px_44px_rgb(0_0_0/0.16)]">
        <CardHeader className="border-b border-border">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-ai" /> Resultado do modelo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 md:grid-cols-5">
            <Info
              icon={Target}
              label="Job"
              value={resultado?.job_id ?? resultado?.input_id ?? coletaSelecionada?.job_id ?? "-"}
            />
            <Info icon={BrainCircuit} label="Modelo" value={resultado?.modelo ?? modelo} />
            <Info icon={FolderOpen} label="CSV coleta" value={resultado?.csv_coleta ?? "-"} />
            <Info icon={FileOutput} label="Arquivo" value={resultado?.arquivo_saida ?? "-"} />
            <Info
              icon={Sparkles}
              label="Prognósticos"
              value={resultado?.total_prognosticos ?? prognosticos.length}
            />
          </div>

          {resultado && (resultado.total_prognosticos ?? prognosticos.length) === 0 && (
            <div className="rounded-md border border-muted bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              {resultado.mensagem ||
                "Nenhuma oportunidade EV+ persistida. Consulte o funil abaixo para os motivos de rejeicao."}
            </div>
          )}

          <Accordion type="single" collapsible className="rounded-md border px-3">
            <AccordionItem value="diagnostico-funil" className="border-0">
              <AccordionTrigger className="text-sm font-semibold">
                Diagnóstico do Funil
              </AccordionTrigger>
              <AccordionContent>
                {resultado?.diagnostico_funil ? (
                  <pre className="max-h-[42vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 font-mono text-xs">
                    {JSON.stringify(resultado.diagnostico_funil, null, 2)}
                  </pre>
                ) : (
                  <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
                    O funil será disponibilizado após a primeira execução concluída.
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <Accordion type="single" collapsible className="rounded-md border px-3">
            <AccordionItem value="dados-tecnicos" className="border-0">
              <AccordionTrigger className="text-sm font-semibold">
                Dados Técnicos do Modelo
              </AccordionTrigger>
              <AccordionContent>
                {resultado?.contexto_modelo || resultado?.dados_tecnicos ? (
                  <pre className="max-h-[42vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 font-mono text-xs">
                    {resultado.contexto_modelo?.trim() || resultado.dados_tecnicos?.trim()}
                  </pre>
                ) : (
                  <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
                    Contexto, parâmetros e observações aparecerão após a execução.
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {!prognosticos.length && (
            <div className="flex flex-col items-center rounded-lg border border-dashed border-primary/20 bg-primary/[0.025] px-5 py-12 text-center md:hidden">
              <span className="mb-4 flex size-12 items-center justify-center rounded-lg border border-primary/20 bg-primary/5 text-primary">
                <FolderOpen className="size-5" aria-hidden="true" />
              </span>
              <strong className="text-sm text-foreground">
                {resultado
                  ? "Nenhuma oportunidade EV+ encontrada"
                  : "Nenhum modelo executado ainda"}
              </strong>
              <span className="mt-2 max-w-xs text-xs text-muted-foreground">
                {resultado
                  ? "Consulte o diagnóstico do funil para entender as rejeições."
                  : "Selecione um modelo e uma entrada compatível para iniciar a execução."}
              </span>
            </div>
          )}

          <div
            className={cn(
              "overflow-auto rounded-lg border border-primary/15",
              !prognosticos.length && "hidden md:block",
            )}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Hora</TableHead>
                  <TableHead>Esporte</TableHead>
                  <TableHead>Liga</TableHead>
                  <TableHead>Jogo</TableHead>
                  <TableHead>Mandante</TableHead>
                  <TableHead>Visitante</TableHead>
                  <TableHead>Mercado</TableHead>
                  <TableHead>Pick</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Odd</TableHead>
                  <TableHead className="text-right">Odd ofertada</TableHead>
                  <TableHead className="text-right">Odd valor</TableHead>
                  <TableHead className="text-right">Prob.</TableHead>
                  <TableHead className="text-right">Probabilidade</TableHead>
                  <TableHead className="text-right">Edge</TableHead>
                  <TableHead className="text-right">Stake</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prognosticos.slice(0, 100).map((p, index) => (
                  <TableRow key={`${p.jogo}-${p.mercado}-${p.pick}-${index}`}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{p.data}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {p.hora ?? "-"}
                    </TableCell>
                    <TableCell>{p.esporte}</TableCell>
                    <TableCell>{p.liga}</TableCell>
                    <TableCell className="min-w-56">{p.jogo}</TableCell>
                    <TableCell>{p.mandante ?? "-"}</TableCell>
                    <TableCell>{p.visitante ?? "-"}</TableCell>
                    <TableCell>{p.mercado}</TableCell>
                    <TableCell>{p.pick}</TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        {p.selection_role?.startsWith("CANDIDATO_") ? (
                          <Badge variant="outline">{p.selection_role.replaceAll("_", " ")}</Badge>
                        ) : (
                          (p.selection_role ?? "-")
                        )}
                        {p.price_feasibility_status && (
                          <Badge variant="secondary">
                            {p.price_feasibility_status.replaceAll("_", " ")}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatOptionalNum(p.odd)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatNum(p.odd_ofertada)}
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatNum(p.odd_valor)}</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatOptionalPercent(p.probabilidade)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatNum(p.probabilidade_final)}%
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatNum(p.edge)}%</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatOptionalNum(p.stake)}
                    </TableCell>
                  </TableRow>
                ))}
                {!prognosticos.length && (
                  <TableRow>
                    <TableCell colSpan={17} className="py-16 text-center text-muted-foreground">
                      <div className="mx-auto flex max-w-md flex-col items-center">
                        <span className="mb-4 flex size-12 items-center justify-center rounded-lg border border-primary/20 bg-primary/5 text-primary">
                          <FolderOpen className="size-5" aria-hidden="true" />
                        </span>
                        <strong className="text-sm text-foreground">
                          {resultado
                            ? "Nenhuma oportunidade EV+ encontrada"
                            : "Nenhum modelo executado ainda"}
                        </strong>
                        <span className="mt-2 text-xs">
                          {resultado
                            ? "Consulte o diagnóstico do funil para entender as rejeições."
                            : "Selecione um modelo e uma coleta compatível para iniciar a execução."}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {prognosticos.length > 0 && (
            <div className="flex justify-end">
              <Button onClick={enviarParaPrognosticos} disabled={sending}>
                <Send className="mr-2 h-4 w-4" />
                {sending ? "Enviando..." : "Enviar para Prognósticos"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ColetaResumo({ coleta }: { coleta: ColetaOdds }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border text-sm sm:grid-cols-5">
      <Info icon={Target} label="Job" value={coleta.job_id ?? "-"} />
      <Info label="Coleta" value={formatDateTimeBR(coleta.created_at)} />
      <Info label="Esporte" value={coleta.esporte ?? "-"} />
      <Info label="Ligas" value={formatColetaLigas(coleta)} />
      <Info label="Cotações" value={coleta.total_odds ?? 0} />
    </div>
  );
}

function PackballFileInput({
  label,
  file,
  onFile,
}: {
  label: string;
  file: File | null;
  onFile: (file: File | null) => void;
}) {
  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      <input
        type="file"
        accept=".csv,text/csv"
        className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1 file:text-primary-foreground"
        onChange={(event) => onFile(event.currentTarget.files?.[0] ?? null)}
      />
      <div className="mt-1 truncate text-xs text-muted-foreground">
        {file?.name ?? "Nenhum arquivo selecionado"}
      </div>
    </div>
  );
}

function Info({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon?: LucideIcon;
}) {
  return (
    <div className="min-w-0 bg-card px-3 py-3">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        {Icon ? <Icon className="size-3.5 text-primary" aria-hidden="true" /> : null}
        {label}
      </div>
      <div className="mt-1.5 truncate font-mono text-sm font-semibold" title={String(value)}>
        {value}
      </div>
    </div>
  );
}

function isPackballModel(
  modelo: ModeloDisponivel,
): modelo is "ASP GoalMatrix" | "ASP CornerMatrix" | "ASP BackMatrix" {
  return (
    modelo === "ASP GoalMatrix" || modelo === "ASP CornerMatrix" || modelo === "ASP BackMatrix"
  );
}

function inferPackballDate(...names: string[]) {
  for (const name of names) {
    const match = name.match(/(\d{2}-\d{2}-\d{4})/);
    if (match) return match[1];
  }
  return undefined;
}

function extractInputId(response: unknown) {
  const root = isRecord(response) ? response : {};
  const data = isRecord(root.data) ? root.data : isRecord(root.result) ? root.result : root;
  const value = data.input_id ?? data.job_id ?? data.id;
  if (!value) throw new Error("A VM nao retornou input_id para executar o modelo.");
  return String(value);
}

async function executeFootballModelAsync(jobId: string): Promise<unknown> {
  const started = await startFootballPredictiveModel({
    data: { job_id: jobId, modelo: "ASP MatchMatrix" },
  });
  if (!isRecord(started) || typeof started.run_id !== "string") {
    throw new Error("A VM não retornou o identificador da execução do MatchMatrix.");
  }

  for (let attempt = 1; attempt <= 300; attempt++) {
    await waitForModelPoll(2000);
    const state = await getFootballPredictiveModelStatus({
      data: { run_id: started.run_id },
    });
    if (!isRecord(state)) continue;
    const status = String(state.status ?? "").toUpperCase();
    if (status === "CONCLUIDO") {
      if (!("resultado" in state)) throw new Error("A execução terminou sem resultado.");
      return state.resultado;
    }
    if (status === "ERRO") {
      const detail = state.erro;
      throw new Error(
        typeof detail === "string" ? detail : `Erro no MatchMatrix: ${JSON.stringify(detail)}`,
      );
    }
  }
  throw new Error(
    "O MatchMatrix continua processando após 10 minutos. Tente consultar novamente mais tarde.",
  );
}

function waitForModelPoll(milliseconds: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function normalizeModelResponse(response: unknown): ModeloResultado {
  const root = isRecord(response) ? response : {};
  const data = isRecord(root.data) ? root.data : isRecord(root.result) ? root.result : root;
  const modelName = data.modelo ? String(data.modelo) : undefined;
  const prognosticos = Array.isArray(data.prognosticos)
    ? data.prognosticos.filter(isRecord).map((row) => mapModeloPrognostico(row, modelName))
    : [];
  return {
    ok: Boolean(data.ok ?? true),
    job_id: data.job_id ? String(data.job_id) : undefined,
    input_id: data.input_id ? String(data.input_id) : undefined,
    modelo: data.modelo ? String(data.modelo) : undefined,
    csv_coleta: data.csv_coleta ? String(data.csv_coleta) : undefined,
    arquivo_saida: data.arquivo_saida ? String(data.arquivo_saida) : undefined,
    arquivo_contexto: data.arquivo_contexto ? String(data.arquivo_contexto) : undefined,
    contexto_modelo: data.contexto_modelo ? String(data.contexto_modelo) : undefined,
    dados_tecnicos: data.dados_tecnicos ? String(data.dados_tecnicos) : undefined,
    mensagem: data.mensagem ? String(data.mensagem) : undefined,
    total_prognosticos: toNumber(data.total_prognosticos) ?? prognosticos.length,
    diagnostico_funil: isRecord(data.diagnostico_funil) ? data.diagnostico_funil : undefined,
    prognosticos,
  };
}

function mapModeloPrognostico(row: Record<string, unknown>, modelName?: string): ModeloPrognostico {
  const standard = standardizePredictionContract(
    {
      mercado: String(row.mercado ?? ""),
      pick: String(row.pick ?? ""),
      linha: row.linha == null ? null : String(row.linha),
      esporte: String(row.esporte ?? ""),
      mandante: row.mandante ? String(row.mandante) : null,
      visitante: row.visitante ? String(row.visitante) : null,
      selection_side: row.selection_side ? String(row.selection_side) : null,
      opcao_1x2: row.opcao_1x2 ? String(row.opcao_1x2) : null,
    },
    modelName,
  );
  return {
    data: String(row.data ?? ""),
    hora: row.hora ? String(row.hora) : null,
    esporte: String(row.esporte ?? ""),
    liga: String(row.liga ?? ""),
    jogo: String(row.jogo ?? ""),
    mandante: row.mandante ? String(row.mandante) : null,
    visitante: row.visitante ? String(row.visitante) : null,
    mercado: standard.mercado,
    pick: standard.pick,
    linha: null,
    odd: toNumber(row.odd),
    odd_ofertada: toNumber(row.odd_ofertada) ?? toNumber(row.odd) ?? 0,
    odd_mediana: toNumber(row.odd_mediana ?? row.odd_median),
    odd_mercado_base: toNumber(row.odd_mercado_base ?? row.odd_mediana ?? row.odd_median),
    odd_melhor: toNumber(row.odd_melhor ?? row.odd_best),
    bookmaker_melhor:
      row.bookmaker_melhor || row.bookmaker_best
        ? String(row.bookmaker_melhor ?? row.bookmaker_best)
        : null,
    odd_valor: toNumber(row.odd_valor) ?? 0,
    probabilidade: toNumber(row.probabilidade),
    probabilidade_final: toNumber(row.probabilidade_final) ?? toNumber(row.probabilidade) ?? 0,
    edge: toNumber(row.edge) ?? 0,
    stake: toNumber(row.stake),
    selection_role: row.selection_role ? String(row.selection_role) : null,
    required_edge: toNumber(row.required_edge),
    edge_referencial: toNumber(row.edge_referencial ?? row.edge),
    odd_minima_publicacao: toNumber(row.odd_minima_publicacao),
    price_feasibility_status: row.price_feasibility_status
      ? String(row.price_feasibility_status)
      : null,
    price_gap_pct: toNumber(row.price_gap_pct),
    requires_executable_odd: Boolean(row.requires_executable_odd),
    observacoes: row.observacoes ? String(row.observacoes) : null,
    dados_tecnicos: row.dados_tecnicos ? String(row.dados_tecnicos) : null,
    contexto_adicional: row.contexto_adicional ? String(row.contexto_adicional) : null,
    parecer_validacao: row.parecer_validacao ? String(row.parecer_validacao) : null,
    contexto_modelo: row.contexto_modelo ? String(row.contexto_modelo) : null,
    arquivo_contexto: row.arquivo_contexto ? String(row.arquivo_contexto) : null,
  };
}

function toPrognosticoInsert(p: ModeloPrognostico, resultado: ModeloResultado | null) {
  const norm = normalizeEsporteLiga({ esporte: p.esporte, liga: p.liga });
  const { mandante, visitante } = inferTeams(p);
  const dadosTecnicosBase =
    p.dados_tecnicos?.trim() || p.contexto_adicional?.trim() || p.observacoes?.trim() || "";
  const contextoModelo = p.contexto_modelo?.trim() || null;
  const contextoDuplicado = Boolean(
    dadosTecnicosBase &&
    contextoModelo &&
    normalizeComparableText(dadosTecnicosBase) === normalizeComparableText(contextoModelo),
  );
  const dadosTecnicos =
    [
      dadosTecnicosBase,
      contextoModelo && !contextoDuplicado ? `Contexto do modelo:\n${contextoModelo}` : "",
    ]
      .filter(Boolean)
      .join("\n\n") || null;
  const standard = standardizePredictionContract(
    {
      ...p,
      mandante,
      visitante,
      esporte: norm.esporte || p.esporte,
    },
    resultado?.modelo,
  );
  return {
    data: parseModelDate(p.data) ?? p.data,
    hora: p.hora,
    esporte: norm.esporte || p.esporte,
    liga: norm.liga || p.liga,
    jogo: p.jogo,
    mandante,
    visitante,
    mercado: standard.mercado,
    pick: standard.pick,
    linha: null,
    odd_ofertada: p.odd_ofertada,
    odd_mediana: p.odd_mediana ?? p.odd_mercado_base ?? null,
    odd_mercado_base: p.odd_mercado_base ?? p.odd_mediana ?? null,
    odd_melhor: p.odd_melhor ?? p.odd_ofertada ?? null,
    bookmaker_melhor: p.bookmaker_melhor ?? null,
    odd_valor: p.odd_valor,
    probabilidade_final: p.probabilidade_final,
    edge: p.edge,
    stake: 0,
    observacoes: p.observacoes ?? null,
    dados_tecnicos: dadosTecnicos,
    contexto_modelo: contextoModelo,
    arquivo_contexto: p.arquivo_contexto ?? resultado?.arquivo_contexto ?? null,
    origem_modelo: resultado?.modelo ?? p.mercado,
    job_id_coleta: resultado?.job_id ?? resultado?.input_id ?? null,
    status_validacao: "PENDENTE",
    status_publicacao: "NAO_PUBLICADO",
    resultado: "PENDENTE",
  };
}

function stripUnsupportedPrognosticoColumns(row: Record<string, unknown>) {
  const { contexto_adicional: _contextoAdicional, ...safeRow } = row;
  return safeRow;
}

function stripOddsContextColumns(row: Record<string, unknown>) {
  const {
    odd_mediana: _oddMediana,
    odd_mercado_base: _oddMercadoBase,
    odd_melhor: _oddMelhor,
    bookmaker_melhor: _bookmakerMelhor,
    ...safeRow
  } = row;
  return safeRow;
}

function isMissingOddsContextColumnError(error: unknown) {
  const message = String((error as { message?: unknown })?.message ?? error ?? "");
  return /odd_mediana|odd_mercado_base|odd_melhor|bookmaker_melhor/i.test(message);
}

function inferTeams(p: ModeloPrognostico) {
  const mandante = p.mandante?.trim();
  const visitante = p.visitante?.trim();
  if (mandante && visitante) return { mandante, visitante };
  const parts = p.jogo
    .split(/\s+(?:vs|x|v)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    mandante: mandante || parts[0] || p.jogo,
    visitante: visitante || parts[1] || "Visitante",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function toNumber(value: unknown) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function formatNum(value: number) {
  return Number(value || 0).toFixed(2);
}

function formatOptionalNum(value: number | null | undefined) {
  return value == null ? "-" : Number(value || 0).toFixed(2);
}

function formatOptionalPercent(value: number | null | undefined) {
  return value == null ? "-" : `${Number(value || 0).toFixed(2)}%`;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeComparableText(value: string) {
  return normalizeText(value).replace(/\s+/g, " ").trim();
}

function coletaSearchText(coleta: ColetaOdds) {
  return normalizeText(
    `${coleta.esporte ?? ""} ${coleta.liga ?? ""} ${JSON.stringify(coleta.parametros ?? {})}`,
  );
}

function isBaseballColeta(coleta: ColetaOdds) {
  const text = coletaSearchText(coleta);
  return text.includes("baseball") || text.includes("mlb");
}

function isBasketballColeta(coleta: ColetaOdds, liga?: "NBA" | "WNBA") {
  const text = coletaSearchText(coleta);
  if (!text.includes("basketball")) return false;
  if (!liga) return true;
  return text.includes(liga.toLowerCase());
}

function isFootballColeta(coleta: ColetaOdds) {
  const text = coletaSearchText(coleta);
  return text.includes("futebol") || text.includes("football") || text.includes("soccer");
}

function parseModelDate(value: unknown) {
  if (typeof value === "string") {
    return parseBrazilianDate(value.replace(/\./g, "/"));
  }
  return parseBrazilianDate(value);
}

function formatColetaLigas(coleta: ColetaOdds) {
  if (coleta.liga) return coleta.liga;
  const leagues = coleta.parametros?.leagues;
  if (!Array.isArray(leagues) || leagues.length === 0) return "Todas";
  return leagues
    .map((league) => String(league).split("/").filter(Boolean).slice(-2, -1)[0] ?? String(league))
    .join(", ");
}
