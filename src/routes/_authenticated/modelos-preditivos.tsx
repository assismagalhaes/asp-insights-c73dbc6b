import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, Play, Send, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { fetchCollections, type ColetaOdds } from "@/lib/coleta-dados";
import {
  executePackballPredictiveModel,
  executePredictiveModel,
  uploadPackballModelFiles,
} from "@/lib/scraper-api.functions";
import { supabase } from "@/lib/supabase-public";
import { normalizeEsporteLiga, normalizeMercadoPadrao } from "@/lib/db";
import { parseBrazilianDate } from "@/lib/date-br";

export const Route = createFileRoute("/_authenticated/modelos-preditivos")({
  component: ModelosPreditivosPage,
});

type ModeloDisponivel =
  | "Futebol"
  | "Baseball"
  | "Basketball NBA"
  | "Basketball WNBA"
  | "ASP GoalMatrix"
  | "ASP CornerMatrix";

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
  prognosticos?: ModeloPrognostico[];
}

function ModelosPreditivosPage() {
  const qc = useQueryClient();
  const [selectedColetaId, setSelectedColetaId] = useState("");
  const [modelo, setModelo] = useState<ModeloDisponivel>("Futebol");
  const [running, setRunning] = useState(false);
  const [sending, setSending] = useState(false);
  const [resultado, setResultado] = useState<ModeloResultado | null>(null);
  const [packballFile5, setPackballFile5] = useState<File | null>(null);
  const [packballFile20, setPackballFile20] = useState<File | null>(null);

  const { data: coletas = [] } = useQuery({
    queryKey: ["coletas-odds"],
    queryFn: fetchCollections,
  });

  const concluidas = useMemo(() => {
    if (isPackballModel(modelo)) return [];
    const coletasConcluidas = coletas.filter((coleta) => coleta.status === "CONCLUIDA" && coleta.job_id);
    if (modelo === "Baseball") return coletasConcluidas.filter(isBaseballColeta);
    if (modelo === "Basketball NBA") return coletasConcluidas.filter((coleta) => isBasketballColeta(coleta, "NBA"));
    if (modelo === "Basketball WNBA") return coletasConcluidas.filter((coleta) => isBasketballColeta(coleta, "WNBA"));
    if (modelo === "Futebol") return coletasConcluidas.filter((coleta) => !coleta.esporte || isFootballColeta(coleta));
    return coletasConcluidas;
  }, [coletas, modelo]);

  const packballMode = isPackballModel(modelo);
  const coletaSelecionada = concluidas.find((coleta) => coleta.id === selectedColetaId) ?? null;
  const prognosticos = resultado?.prognosticos ?? [];
  const canExecute = packballMode
    ?Boolean(packballFile5 && packballFile20) && !running
    : Boolean(coletaSelecionada) && !running;

  const executarModelo = async () => {
    if (packballMode) {
      if (!packballFile5 || !packballFile20) {
        toast.error("Selecione as planilhas PackBall de 5j e 20j.");
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
          data: { modelo, input_id: inputId },
        });
        const parsed = normalizeModelResponse(response);
        setResultado(parsed);
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

    if (modelo === "Baseball" && !isBaseballColeta(coletaSelecionada)) {
      toast.error("Selecione uma coleta Baseball/MLB para executar o modelo Baseball.");
      return;
    }
    if (modelo === "Basketball NBA" && !isBasketballColeta(coletaSelecionada, "NBA")) {
      toast.error("Selecione uma coleta Basketball/NBA para executar o modelo NBA.");
      return;
    }
    if (modelo === "Basketball WNBA" && !isBasketballColeta(coletaSelecionada, "WNBA")) {
      toast.error("Selecione uma coleta Basketball/WNBA para executar o modelo WNBA.");
      return;
    }

    setRunning(true);
    setResultado(null);
    try {
      const response = await executePredictiveModel({
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
      const payload = prognosticos.map((p) => stripUnsupportedPrognosticoColumns(toPrognosticoInsert(p, resultado)));
      const { error } = await supabase.from("prognosticos").insert(payload as never);
      if (error) {
        if (isMissingOddsContextColumnError(error)) {
          const fallbackPayload = payload.map(stripOddsContextColumns);
          const { error: fallbackError } = await supabase.from("prognosticos").insert(fallbackPayload as never);
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

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Modelos Preditivos</h1>
          <Badge variant="outline">VM</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Use uma coleta concluída como base para executar modelos preditivos na VM.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BrainCircuit className="h-4 w-4" /> Executar Modelo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className={packballMode ?"grid gap-3 md:grid-cols-[240px_1fr_1fr_auto] md:items-end" : "grid gap-3 md:grid-cols-[240px_1.5fr_auto] md:items-end"}>
            <div>
              <label className="text-sm font-medium">Modelo</label>
              <Select
                value={modelo}
                onValueChange={(value) => {
                  setModelo(value as ModeloDisponivel);
                  setSelectedColetaId("");
                  setResultado(null);
                  setPackballFile5(null);
                  setPackballFile20(null);
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Futebol">Futebol</SelectItem>
                  <SelectItem value="Basketball NBA">Basketball NBA</SelectItem>
                  <SelectItem value="Basketball WNBA">Basketball WNBA</SelectItem>
                  <SelectItem value="Baseball">Baseball</SelectItem>
                  <SelectItem value="Hockey" disabled>Hockey</SelectItem>
                  <SelectItem value="American Football" disabled>American Football</SelectItem>
                  <SelectItem value="ASP GoalMatrix">ASP GoalMatrix</SelectItem>
                  <SelectItem value="ASP CornerMatrix">ASP CornerMatrix</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {packballMode ?(
              <>
                <PackballFileInput label="Planilha PackBall 5j" file={packballFile5} onFile={setPackballFile5} />
                <PackballFileInput label="Planilha PackBall 20j" file={packballFile20} onFile={setPackballFile20} />
              </>
            ) : (
              <div>
                <label className="text-sm font-medium">Coleta concluida</label>
                <Select value={selectedColetaId} onValueChange={setSelectedColetaId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione uma coleta" />
                  </SelectTrigger>
                  <SelectContent>
                    {concluidas.map((coleta) => (
                      <SelectItem key={coleta.id} value={coleta.id}>
                        {coleta.created_at.slice(0, 16).replace("T", " ")} - {coleta.esporte ?? "-"} - {coleta.job_id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button onClick={executarModelo} disabled={!canExecute}>
              <Play className="mr-2 h-4 w-4" />
              {running ?"Executando..." : "Executar Modelo"}
            </Button>
          </div>

          {running && (
            <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
              Executando modelo preditivo na VM...
            </div>
          )}

          {packballMode && (
            <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              <Upload className="mr-2 inline h-4 w-4" />
              Importe as duas planilhas cruas do PackBall. O modelo organiza os dados e gera prognosticos no mesmo fluxo dos demais modelos.
            </div>
          )}

          {coletaSelecionada && <ColetaResumo coleta={coletaSelecionada} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" /> Resultado do Modelo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-5">
            <Info label="Job" value={resultado?.job_id ?? resultado?.input_id ?? coletaSelecionada?.job_id ?? "-"} />
            <Info label="Modelo" value={resultado?.modelo ?? modelo} />
            <Info label="CSV coleta" value={resultado?.csv_coleta ?? "-"} />
            <Info label="Arquivo" value={resultado?.arquivo_saida ?? "-"} />
            <Info label="Prognósticos" value={resultado?.total_prognosticos ?? prognosticos.length} />
          </div>

          {resultado && (resultado.total_prognosticos ?? prognosticos.length) === 0 && (
            <div className="rounded-md border border-muted bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              {resultado.mensagem || "Nenhuma oportunidade EV+ encontrada para esta coleta."}
            </div>
          )}

          {(resultado?.contexto_modelo || resultado?.dados_tecnicos) && (
            <Accordion type="single" collapsible className="rounded-md border px-3">
              <AccordionItem value="dados-tecnicos" className="border-0">
                <AccordionTrigger className="text-sm font-semibold">
                  Dados Técnicos do Modelo
                </AccordionTrigger>
                <AccordionContent>
                  <pre className="max-h-[42vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 font-mono text-xs">
                    {resultado.contexto_modelo?.trim() || resultado.dados_tecnicos?.trim()}
                  </pre>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}

          <div className="overflow-auto rounded-md border">
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
                  <TableHead>Linha</TableHead>
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
                    <TableCell className="whitespace-nowrap font-mono text-xs">{p.hora ?? "-"}</TableCell>
                    <TableCell>{p.esporte}</TableCell>
                    <TableCell>{p.liga}</TableCell>
                    <TableCell className="min-w-56">{p.jogo}</TableCell>
                    <TableCell>{p.mandante ?? "-"}</TableCell>
                    <TableCell>{p.visitante ?? "-"}</TableCell>
                    <TableCell>{p.mercado}</TableCell>
                    <TableCell>{p.pick}</TableCell>
                    <TableCell className="font-mono text-xs">{p.linha ?? "-"}</TableCell>
                    <TableCell className="text-right font-mono">{formatOptionalNum(p.odd)}</TableCell>
                    <TableCell className="text-right font-mono">{formatNum(p.odd_ofertada)}</TableCell>
                    <TableCell className="text-right font-mono">{formatNum(p.odd_valor)}</TableCell>
                    <TableCell className="text-right font-mono">{formatOptionalPercent(p.probabilidade)}</TableCell>
                    <TableCell className="text-right font-mono">{formatNum(p.probabilidade_final)}%</TableCell>
                    <TableCell className="text-right font-mono">{formatNum(p.edge)}%</TableCell>
                    <TableCell className="text-right font-mono">{formatOptionalNum(p.stake)}</TableCell>
                  </TableRow>
                ))}
                {!prognosticos.length && (
                  <TableRow>
                    <TableCell colSpan={17} className="py-12 text-center text-muted-foreground">
                      {resultado ?"Nenhuma oportunidade EV+ encontrada para esta coleta." : "Nenhum modelo executado ainda."}
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
                {sending ?"Enviando..." : "Enviar para Prognósticos"}
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
    <div className="grid gap-3 rounded-md border p-3 text-sm sm:grid-cols-5">
      <Info label="Job" value={coleta.job_id ?? "-"} />
      <Info label="Coleta" value={coleta.created_at.slice(0, 16).replace("T", " ")} />
      <Info label="Esporte" value={coleta.esporte ?? "-"} />
      <Info label="Ligas" value={formatColetaLigas(coleta)} />
      <Info label="Linhas" value={coleta.total_odds ?? 0} />
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
      <div className="mt-1 truncate text-xs text-muted-foreground">{file?.name ?? "Nenhum arquivo selecionado"}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}

function isPackballModel(modelo: ModeloDisponivel): modelo is "ASP GoalMatrix" | "ASP CornerMatrix" {
  return modelo === "ASP GoalMatrix" || modelo === "ASP CornerMatrix";
}

function inferPackballDate(...names: string[]) {
  for (const name of names) {
    const match = name.match(/(\d{2}-\d{2}-\d{4})/);
    if (match) return match[1];
  }
  return undefined;
}

function extractInputId(response: unknown) {
  const root = isRecord(response) ?response : {};
  const data = isRecord(root.data) ?root.data : isRecord(root.result) ?root.result : root;
  const value = data.input_id ?? data.job_id ?? data.id;
  if (!value) throw new Error("A VM nao retornou input_id para executar o modelo.");
  return String(value);
}

function normalizeModelResponse(response: unknown): ModeloResultado {
  const root = isRecord(response) ?response : {};
  const data = isRecord(root.data) ?root.data : isRecord(root.result) ?root.result : root;
  const prognosticos = Array.isArray(data.prognosticos) ?data.prognosticos.filter(isRecord).map(mapModeloPrognostico) : [];
  return {
    ok: Boolean(data.ok ?? true),
    job_id: data.job_id ?String(data.job_id) : undefined,
    input_id: data.input_id ?String(data.input_id) : undefined,
    modelo: data.modelo ?String(data.modelo) : undefined,
    csv_coleta: data.csv_coleta ?String(data.csv_coleta) : undefined,
    arquivo_saida: data.arquivo_saida ?String(data.arquivo_saida) : undefined,
    arquivo_contexto: data.arquivo_contexto ?String(data.arquivo_contexto) : undefined,
    contexto_modelo: data.contexto_modelo ?String(data.contexto_modelo) : undefined,
    dados_tecnicos: data.dados_tecnicos ?String(data.dados_tecnicos) : undefined,
    mensagem: data.mensagem ?String(data.mensagem) : undefined,
    total_prognosticos: toNumber(data.total_prognosticos) ?? prognosticos.length,
    prognosticos,
  };
}

function mapModeloPrognostico(row: Record<string, unknown>): ModeloPrognostico {
  return {
    data: String(row.data ?? ""),
    hora: row.hora ?String(row.hora) : null,
    esporte: String(row.esporte ?? ""),
    liga: String(row.liga ?? ""),
    jogo: String(row.jogo ?? ""),
    mandante: row.mandante ?String(row.mandante) : null,
    visitante: row.visitante ?String(row.visitante) : null,
    mercado: String(row.mercado ?? ""),
    pick: String(row.pick ?? ""),
    linha: row.linha == null || row.linha === "" ?null : String(row.linha),
    odd: toNumber(row.odd),
    odd_ofertada: toNumber(row.odd_ofertada) ?? toNumber(row.odd) ?? 0,
    odd_mediana: toNumber(row.odd_mediana ?? row.odd_median),
    odd_mercado_base: toNumber(row.odd_mercado_base ?? row.odd_mediana ?? row.odd_median),
    odd_melhor: toNumber(row.odd_melhor ?? row.odd_best),
    bookmaker_melhor: row.bookmaker_melhor || row.bookmaker_best ? String(row.bookmaker_melhor ?? row.bookmaker_best) : null,
    odd_valor: toNumber(row.odd_valor) ?? 0,
    probabilidade: toNumber(row.probabilidade),
    probabilidade_final: toNumber(row.probabilidade_final) ?? toNumber(row.probabilidade) ?? 0,
    edge: toNumber(row.edge) ?? 0,
    stake: toNumber(row.stake),
    observacoes: row.observacoes ?String(row.observacoes) : null,
    dados_tecnicos: row.dados_tecnicos ?String(row.dados_tecnicos) : null,
    contexto_adicional: row.contexto_adicional ?String(row.contexto_adicional) : null,
    parecer_validacao: row.parecer_validacao ?String(row.parecer_validacao) : null,
    contexto_modelo: row.contexto_modelo ?String(row.contexto_modelo) : null,
    arquivo_contexto: row.arquivo_contexto ?String(row.arquivo_contexto) : null,
  };
}

function toPrognosticoInsert(p: ModeloPrognostico, resultado: ModeloResultado | null) {
  const norm = normalizeEsporteLiga({ esporte: p.esporte, liga: p.liga });
  const { mandante, visitante } = inferTeams(p);
  const dadosTecnicosBase =
    p.dados_tecnicos?.trim() ||
    p.contexto_adicional?.trim() ||
    p.observacoes?.trim() ||
    "";
  const contextoModelo = p.contexto_modelo?.trim() || null;
  const contextoDuplicado = Boolean(
    dadosTecnicosBase &&
      contextoModelo &&
      normalizeComparableText(dadosTecnicosBase) === normalizeComparableText(contextoModelo),
  );
  const dadosTecnicos = [
    dadosTecnicosBase,
    contextoModelo && !contextoDuplicado ? `Contexto do modelo:\n${contextoModelo}` : "",
  ].filter(Boolean).join("\n\n") || null;
  return {
    data: parseModelDate(p.data) ?? p.data,
    hora: p.hora,
    esporte: norm.esporte || p.esporte,
    liga: norm.liga || p.liga,
    jogo: p.jogo,
    mandante,
    visitante,
    mercado: normalizeMercadoPadrao(p.mercado, norm.esporte || p.esporte),
    pick: p.pick,
    linha: p.linha,
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
    status_validacao: "PENDENTE",
    status_publicacao: "NAO_PUBLICADO",
    resultado: "PENDENTE",
  };
}

function stripUnsupportedPrognosticoColumns(row: Record<string, unknown>) {
  const {
    contexto_modelo: _contextoModelo,
    arquivo_contexto: _arquivoContexto,
    origem_modelo: _origemModelo,
    job_id_coleta: _jobIdColeta,
    contexto_adicional: _contextoAdicional,
    ...safeRow
  } = row;
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
  const parts = p.jogo.split(/\s+(?:vs|x|v)\s+/i).map((part) => part.trim()).filter(Boolean);
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
  return Number.isFinite(n) ?n : null;
}

function formatNum(value: number) {
  return Number(value || 0).toFixed(2);
}

function formatOptionalNum(value: number | null | undefined) {
  return value == null ?"-" : Number(value || 0).toFixed(2);
}

function formatOptionalPercent(value: number | null | undefined) {
  return value == null ?"-" : `${Number(value || 0).toFixed(2)}%`;
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
  return normalizeText(`${coleta.esporte ?? ""} ${coleta.liga ?? ""} ${JSON.stringify(coleta.parametros ?? {})}`);
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
  return leagues.map((league) => String(league).split("/").filter(Boolean).slice(-2, -1)[0] ?? String(league)).join(", ");
}
