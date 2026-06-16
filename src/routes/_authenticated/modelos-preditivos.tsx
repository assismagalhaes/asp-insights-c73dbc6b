import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, Play, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchCollections, type ColetaOdds } from "@/lib/coleta-dados";
import { executePredictiveModel } from "@/lib/scraper-api.functions";
import { supabase } from "@/lib/supabase-public";
import { normalizeEsporteLiga } from "@/lib/db";
import { parseBrazilianDate } from "@/lib/date-br";

export const Route = createFileRoute("/_authenticated/modelos-preditivos")({
  component: ModelosPreditivosPage,
});

type ModeloDisponivel = "Futebol";

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
  odd_ofertada: number;
  odd_valor: number;
  probabilidade_final: number;
  edge: number;
  observacoes?: string | null;
}

interface ModeloResultado {
  ok?: boolean;
  job_id?: string;
  modelo?: string;
  arquivo_saida?: string;
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

  const { data: coletas = [] } = useQuery({
    queryKey: ["coletas-odds"],
    queryFn: fetchCollections,
  });

  const concluidas = useMemo(
    () => coletas.filter((coleta) => coleta.status === "CONCLUIDA" && coleta.job_id),
    [coletas],
  );

  const coletaSelecionada = concluidas.find((coleta) => coleta.id === selectedColetaId) ?? null;
  const prognosticos = resultado?.prognosticos ?? [];

  const executarModelo = async () => {
    if (!coletaSelecionada?.job_id) {
      toast.error("Selecione uma coleta concluída.");
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
      toast.success(`${parsed.total_prognosticos ?? parsed.prognosticos?.length ?? 0} prognóstico(s) gerado(s)`);
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
      const payload = prognosticos.map(toPrognosticoInsert);
      const { error } = await supabase.from("prognosticos").insert(payload as never);
      if (error) throw error;
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
          <div className="grid gap-3 md:grid-cols-[1.5fr_240px_auto] md:items-end">
            <div>
              <label className="text-sm font-medium">Coleta concluída</label>
              <Select value={selectedColetaId} onValueChange={setSelectedColetaId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma coleta" />
                </SelectTrigger>
                <SelectContent>
                  {concluidas.map((coleta) => (
                    <SelectItem key={coleta.id} value={coleta.id}>
                      {coleta.created_at.slice(0, 16).replace("T", " ")} · {coleta.esporte ?? "-"} · {coleta.job_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Modelo</label>
              <Select value={modelo} onValueChange={(value) => setModelo(value as ModeloDisponivel)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Futebol">Futebol</SelectItem>
                  <SelectItem value="Basketball" disabled>Basketball</SelectItem>
                  <SelectItem value="Baseball" disabled>Baseball</SelectItem>
                  <SelectItem value="Hockey" disabled>Hockey</SelectItem>
                  <SelectItem value="American Football" disabled>American Football</SelectItem>
                  <SelectItem value="ASP GoalMatrix" disabled>ASP GoalMatrix</SelectItem>
                  <SelectItem value="ASP CornerMatrix" disabled>ASP CornerMatrix</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={executarModelo} disabled={!coletaSelecionada || running}>
              <Play className="mr-2 h-4 w-4" />
              {running ? "Executando..." : "Executar Modelo"}
            </Button>
          </div>

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
          <div className="grid gap-3 sm:grid-cols-4">
            <Info label="Job" value={resultado?.job_id ?? coletaSelecionada?.job_id ?? "-"} />
            <Info label="Modelo" value={resultado?.modelo ?? modelo} />
            <Info label="Arquivo" value={resultado?.arquivo_saida ?? "-"} />
            <Info label="Prognósticos" value={resultado?.total_prognosticos ?? prognosticos.length} />
          </div>

          <div className="overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Jogo</TableHead>
                  <TableHead>Mercado</TableHead>
                  <TableHead>Pick</TableHead>
                  <TableHead>Linha</TableHead>
                  <TableHead className="text-right">Odd</TableHead>
                  <TableHead className="text-right">Odd Valor</TableHead>
                  <TableHead className="text-right">Prob.</TableHead>
                  <TableHead className="text-right">Edge</TableHead>
                  <TableHead>Observações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prognosticos.slice(0, 100).map((p, index) => (
                  <TableRow key={`${p.jogo}-${p.mercado}-${p.pick}-${index}`}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{p.data} {p.hora ?? ""}</TableCell>
                    <TableCell className="min-w-56">{p.jogo}</TableCell>
                    <TableCell>{p.mercado}</TableCell>
                    <TableCell>{p.pick}</TableCell>
                    <TableCell className="font-mono text-xs">{p.linha ?? "-"}</TableCell>
                    <TableCell className="text-right font-mono">{formatNum(p.odd_ofertada)}</TableCell>
                    <TableCell className="text-right font-mono">{formatNum(p.odd_valor)}</TableCell>
                    <TableCell className="text-right font-mono">{formatNum(p.probabilidade_final)}%</TableCell>
                    <TableCell className="text-right font-mono">{formatNum(p.edge)}%</TableCell>
                    <TableCell className="max-w-80 truncate text-muted-foreground">{p.observacoes ?? "-"}</TableCell>
                  </TableRow>
                ))}
                {!prognosticos.length && (
                  <TableRow>
                    <TableCell colSpan={10} className="py-12 text-center text-muted-foreground">
                      Nenhum modelo executado ainda.
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
    <div className="grid gap-3 rounded-md border p-3 text-sm sm:grid-cols-5">
      <Info label="Job" value={coleta.job_id ?? "-"} />
      <Info label="Coleta" value={coleta.created_at.slice(0, 16).replace("T", " ")} />
      <Info label="Esporte" value={coleta.esporte ?? "-"} />
      <Info label="Ligas" value={formatColetaLigas(coleta)} />
      <Info label="Linhas" value={coleta.total_odds ?? 0} />
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

function normalizeModelResponse(response: unknown): ModeloResultado {
  const root = isRecord(response) ? response : {};
  const data = isRecord(root.data) ? root.data : isRecord(root.result) ? root.result : root;
  const prognosticos = Array.isArray(data.prognosticos) ? data.prognosticos.filter(isRecord).map(mapModeloPrognostico) : [];
  return {
    ok: Boolean(data.ok ?? true),
    job_id: data.job_id ? String(data.job_id) : undefined,
    modelo: data.modelo ? String(data.modelo) : undefined,
    arquivo_saida: data.arquivo_saida ? String(data.arquivo_saida) : undefined,
    total_prognosticos: toNumber(data.total_prognosticos) ?? prognosticos.length,
    prognosticos,
  };
}

function mapModeloPrognostico(row: Record<string, unknown>): ModeloPrognostico {
  return {
    data: String(row.data ?? ""),
    hora: row.hora ? String(row.hora) : null,
    esporte: String(row.esporte ?? "Futebol"),
    liga: String(row.liga ?? ""),
    jogo: String(row.jogo ?? ""),
    mandante: row.mandante ? String(row.mandante) : null,
    visitante: row.visitante ? String(row.visitante) : null,
    mercado: String(row.mercado ?? ""),
    pick: String(row.pick ?? ""),
    linha: row.linha == null || row.linha === "" ? null : String(row.linha),
    odd_ofertada: toNumber(row.odd_ofertada) ?? 0,
    odd_valor: toNumber(row.odd_valor) ?? 0,
    probabilidade_final: toNumber(row.probabilidade_final) ?? 0,
    edge: toNumber(row.edge) ?? 0,
    observacoes: row.observacoes ? String(row.observacoes) : null,
  };
}

function toPrognosticoInsert(p: ModeloPrognostico) {
  const norm = normalizeEsporteLiga({ esporte: p.esporte, liga: p.liga });
  const { mandante, visitante } = inferTeams(p);
  return {
    data: parseBrazilianDate(p.data) ?? p.data,
    hora: p.hora,
    esporte: norm.esporte || p.esporte,
    liga: norm.liga || p.liga,
    jogo: p.jogo,
    mandante,
    visitante,
    mercado: p.mercado,
    pick: p.pick,
    linha: p.linha,
    odd_ofertada: p.odd_ofertada,
    odd_valor: p.odd_valor,
    probabilidade_final: p.probabilidade_final,
    edge: p.edge,
    stake: 0,
    observacoes: p.observacoes ?? null,
    dados_tecnicos: null,
    status_validacao: "PENDENTE",
    status_publicacao: "NAO_PUBLICADO",
    resultado: "PENDENTE",
  };
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
  return Number.isFinite(n) ? n : null;
}

function formatNum(value: number) {
  return Number(value || 0).toFixed(2);
}

function formatColetaLigas(coleta: ColetaOdds) {
  if (coleta.liga) return coleta.liga;
  const leagues = coleta.parametros?.leagues;
  if (!Array.isArray(leagues) || leagues.length === 0) return "Todas";
  return leagues.map((league) => String(league).split("/").filter(Boolean).slice(-2, -1)[0] ?? String(league)).join(", ");
}
