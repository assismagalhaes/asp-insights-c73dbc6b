import { useState } from "react";
import { Loader2, Satellite } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase-public";
import { toast } from "sonner";

const TARGET_KEYS = [
  "data",
  "hora",
  "esporte",
  "liga",
  "jogo",
  "mandante",
  "visitante",
  "mercado",
  "pick",
  "linha",
  "odd_ofertada",
  "odd_valor",
  "probabilidade_final",
  "edge",
  "observacoes",
] as const;

type Row = Record<string, unknown>;

/** Extrai um array de jogos/odds de qualquer formato razoável que a API devolver. */
function extractRows(payload: unknown, depth = 0): Row[] {
  if (!payload || depth > 6) return [];
  if (Array.isArray(payload)) {
    // só considera array como "linhas" se os itens forem objetos
    if (payload.length === 0) return [];
    if (typeof payload[0] === "object" && payload[0] !== null) return payload as Row[];
    return [];
  }
  if (typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    // 1) chaves prioritárias
    for (const k of [
      "linhas", "odds", "rows", "data", "result", "results",
      "jogos", "items", "normalized", "normalized_json", "raw_json",
      "payload", "records", "entries",
    ]) {
      const v = obj[k];
      if (Array.isArray(v) && v.length && typeof v[0] === "object") return v as Row[];
    }
    // 2) varredura: pega o primeiro array de objetos encontrado
    for (const v of Object.values(obj)) {
      if (Array.isArray(v) && v.length && typeof v[0] === "object") return v as Row[];
    }
    // 3) recursão em objetos aninhados
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") {
        const nested = extractRows(v, depth + 1);
        if (nested.length) return nested;
      }
    }
  }
  return [];
}

function pick(row: Row, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return "";
}

function pickNested(row: Row, ...paths: string[]): unknown {
  for (const path of paths) {
    const parts = path.split(".");
    let current: unknown = row;
    for (const part of parts) {
      if (!current || typeof current !== "object" || Array.isArray(current)) {
        current = undefined;
        break;
      }
      current = (current as Row)[part];
    }
    if (current !== undefined && current !== null && current !== "") return current;
  }
  return "";
}

function compactTechnicalContext(row: Row): string {
  const source = pickNested(row, "dados_tecnicos", "technical_data", "stats", "model", "raw_ref", "metadata");
  if (!source) return "";
  return typeof source === "string" ? source : JSON.stringify(source);
}

function normalizeRow(row: Row): Row {
  const out: Row = {};
  // cópia direta quando existir
  for (const k of TARGET_KEYS) out[k] = k in row ? row[k] : "";

  // aliases comuns vindos da VM /normalized
  if (!out.data) out.data = pick(row, "data_jogo", "date", "match_date", "dt", "game_date", "start_date");
  if (!out.hora) out.hora = pick(row, "horario", "hora_jogo", "time", "kickoff", "match_time", "start_time", "hour");
  if (!out.esporte) out.esporte = pick(row, "sport", "esporte_nome");
  if (!out.liga) out.liga = pick(row, "league", "campeonato", "torneio", "competition", "competition_name");
  if (!out.mandante) out.mandante = pick(row, "home", "home_team", "time_casa", "mandante_nome", "casa", "team_home");
  if (!out.visitante) out.visitante = pick(row, "away", "away_team", "time_fora", "visitante_nome", "fora", "team_away");
  if (!out.jogo && (out.mandante || out.visitante)) {
    out.jogo = `${String(out.mandante ?? "")} x ${String(out.visitante ?? "")}`.trim();
  }
  if (!out.jogo) out.jogo = pick(row, "match", "partida", "evento", "event", "game", "fixture");
  if (!out.mercado) out.mercado = pick(row, "market", "market_name", "mercado_nome", "tipo_mercado", "market_type", "bet_type");
  if (!out.pick) out.pick = pick(row, "selection", "selecao", "aposta", "pick_nome", "outcome", "runner", "side", "option");
  if (!out.linha) out.linha = pick(row, "line", "handicap", "total", "linha_valor", "point", "points", "spread");
  if (!out.odd_ofertada) {
    out.odd_ofertada = pickNested(
      row,
      "odd",
      "odd_ofertada_valor",
      "price",
      "cotacao",
      "quota",
      "odds",
      "decimal",
      "decimal_odd",
      "bookmaker_odd",
      "offered_odd",
      "odds.decimal",
      "odds.price",
      "bookmaker.price",
    );
  }
  if (!out.odd_valor) out.odd_valor = pick(row, "fair_odd", "odd_justa", "true_odd", "valor_justo", "fair", "fair_price");
  if (!out.probabilidade_final) out.probabilidade_final = pick(row, "prob", "probability", "prob_final", "probabilidade", "probabilidade_final_pct", "prob_pct");
  if (!out.edge) out.edge = pick(row, "ev", "value", "valor_esperado", "edge_pct", "edge_percent", "ev_pct");
  if (!out.dados_tecnicos) out.dados_tecnicos = compactTechnicalContext(row);
  if (!out.observacoes) out.observacoes = pick(row, "obs", "notes", "observacao", "bookmaker", "casa", "book", "casa_aposta");
  return out;
}

interface Props {
  onRowsReady: (headers: string[], rows: Row[]) => void;
}

type JobResp = { ok: boolean; status: number; data: unknown };

async function callApi(action: string, method: "GET" | "POST", body?: unknown): Promise<JobResp> {
  const { data, error } = await supabase.functions.invoke("scraper-api", {
    body: { action, method, body },
  });
  if (error) throw error;
  return data as JobResp;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function ScraperApiDialog({ onRowsReady }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [esporte, setEsporte] = useState("Futebol");
  const [liga, setLiga] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [mercados, setMercados] = useState("");
  const [bookmaker, setBookmaker] = useState("");

  const handleSearch = async () => {
    const mercadosArr = mercados
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (!esporte.trim() || !liga.trim() || !dataInicio || !dataFim || mercadosArr.length === 0) {
      toast.error("Preencha esporte, liga, datas e ao menos 1 mercado.");
      return;
    }

    setLoading(true);
    setStatusMsg("Criando job na VM...");
    try {
      // 1) Criar job
      const created = await callApi("/scraping/jobs", "POST", {
        esporte: esporte.trim(),
        liga: liga.trim(),
        data_inicio: dataInicio,
        data_fim: dataFim,
        mercados: mercadosArr,
        bookmaker: bookmaker.trim() || null,
      });
      if (!created.ok) {
        const detail = (created.data as { detail?: string } | undefined)?.detail;
        throw new Error(detail || `Falha ao criar job (HTTP ${created.status})`);
      }
      const jobId = (created.data as { job_id?: string })?.job_id;
      if (!jobId) throw new Error("API não retornou job_id.");

      // 2) Polling
      setStatusMsg("Coleta em andamento na VM...");
      const maxTries = 60; // ~3 min com intervalo de 3s
      let finalStatus = "";
      for (let i = 0; i < maxTries; i++) {
        await sleep(3000);
        const st = await callApi(`/scraping/jobs/${jobId}`, "GET");
        if (!st.ok) throw new Error(`Falha ao consultar status (HTTP ${st.status})`);
        const rec = st.data as { status?: string; erro?: string | null };
        finalStatus = rec.status ?? "";
        setStatusMsg(`Status: ${finalStatus}`);
        if (finalStatus === "CONCLUIDA") break;
        if (finalStatus === "ERRO") throw new Error(rec.erro || "Job retornou ERRO.");
      }
      if (finalStatus !== "CONCLUIDA") {
        throw new Error("Timeout aguardando o job concluir.");
      }

      // 3) Buscar normalizado
      setStatusMsg("Lendo resultado normalizado...");
      const norm = await callApi(`/scraping/jobs/${jobId}/normalized`, "GET");
      if (!norm.ok) throw new Error(`Falha ao buscar normalizado (HTTP ${norm.status})`);

      const rawRows = extractRows(norm.data);
      const rows = rawRows.map(normalizeRow);
      // diagnóstico: sempre logar shape para depurar respostas /normalized
      // eslint-disable-next-line no-console
      console.log("[scraper /normalized] payload:", norm.data);
      // eslint-disable-next-line no-console
      console.log("[scraper /normalized] rawRows:", rawRows.length, "sample:", rawRows[0]);
      if (!rows.length) {
        const topKeys =
          norm.data && typeof norm.data === "object" && !Array.isArray(norm.data)
            ? Object.keys(norm.data as Record<string, unknown>).join(", ")
            : Array.isArray(norm.data)
              ? "array"
              : typeof norm.data;
        toast.error(
          `O job concluiu mas /normalized não trouxe linhas. Chaves recebidas: ${topKeys}. Veja o console para o payload completo.`,
        );
        return;
      }
      onRowsReady([...TARGET_KEYS, "dados_tecnicos"], rows);
      toast.success(`${rows.length} odds recebidas da VM e enviadas para a pré-visualização.`);
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message || "Falha ao consultar a API");
    } finally {
      setLoading(false);
      setStatusMsg("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Satellite className="h-4 w-4 mr-2" /> Buscar jogos pela API
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Buscar jogos pela API</DialogTitle>
          <DialogDescription>
            A VM roda a coleta em background. O resultado vai para a pré-visualização antes da importação.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Esporte *</Label>
            <Input value={esporte} onChange={(e) => setEsporte(e.target.value)} placeholder="Futebol" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Liga *</Label>
            <Input value={liga} onChange={(e) => setLiga(e.target.value)} placeholder="Brasileirão" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Data início *</Label>
              <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Data fim *</Label>
              <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Mercados * (separados por vírgula)</Label>
            <Input
              value={mercados}
              onChange={(e) => setMercados(e.target.value)}
              placeholder="Resultado Final, Over 2.5"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Bookmaker</Label>
            <Input value={bookmaker} onChange={(e) => setBookmaker(e.target.value)} placeholder="Bet365" />
          </div>
          {statusMsg && (
            <p className="text-xs text-muted-foreground">{statusMsg}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSearch} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Buscar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
