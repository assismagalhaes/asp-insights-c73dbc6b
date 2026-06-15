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

/** Extrai um array de jogos de qualquer formato razoável que a API devolver. */
function extractRows(payload: unknown): Row[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload as Row[];
  if (typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const k of ["data", "result", "results", "jogos", "items", "rows", "normalized_json", "raw_json"]) {
      const v = obj[k];
      if (Array.isArray(v)) return v as Row[];
      if (v && typeof v === "object") {
        const nested = extractRows(v);
        if (nested.length) return nested;
      }
    }
  }
  return [];
}

/** Normaliza uma linha para o modelo do importador. Preserva chaves desconhecidas em observações. */
function normalizeRow(row: Row): Row {
  const out: Row = {};
  for (const k of TARGET_KEYS) {
    if (k in row) out[k] = row[k];
    else out[k] = "";
  }
  // Casos comuns de nomes alternativos
  if (!out.mandante && row.home) out.mandante = row.home;
  if (!out.visitante && row.away) out.visitante = row.away;
  if (!out.jogo && (out.mandante || out.visitante)) {
    out.jogo = `${String(out.mandante ?? "")} x ${String(out.visitante ?? "")}`.trim();
  }
  if (!out.odd_ofertada && row.odd) out.odd_ofertada = row.odd;
  if (!out.odd_valor && row.fair_odd) out.odd_valor = row.fair_odd;
  return out;
}

interface Props {
  onRowsReady: (headers: string[], rows: Row[]) => void;
}

export function ScraperApiDialog({ onRowsReady }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [esporte, setEsporte] = useState("Futebol");
  const [liga, setLiga] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [mercados, setMercados] = useState("");
  const [bookmaker, setBookmaker] = useState("");

  const handleSearch = async () => {
    if (!esporte.trim()) {
      toast.error("Informe o esporte");
      return;
    }
    setLoading(true);
    try {
      const body = {
        action: "/scrape",
        method: "POST",
        body: {
          esporte: esporte.trim(),
          liga: liga.trim() || null,
          data_inicio: dataInicio || null,
          data_fim: dataFim || null,
          mercados: mercados
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          bookmaker: bookmaker.trim() || null,
        },
      };
      const { data, error } = await supabase.functions.invoke("scraper-api", { body });
      if (error) throw error;
      const payload = (data as { data?: unknown } | undefined)?.data ?? data;
      const rows = extractRows(payload).map(normalizeRow);
      if (!rows.length) {
        toast.error("A API não retornou jogos para esses filtros.");
        return;
      }
      onRowsReady([...TARGET_KEYS], rows);
      toast.success(`${rows.length} jogo(s) trazido(s) da API`);
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message || "Falha ao consultar a API");
    } finally {
      setLoading(false);
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
            Os jogos retornados vão para a pré-visualização antes de qualquer importação.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Esporte *</Label>
            <Input value={esporte} onChange={(e) => setEsporte(e.target.value)} placeholder="Futebol" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Liga</Label>
            <Input value={liga} onChange={(e) => setLiga(e.target.value)} placeholder="Brasileirão" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Data início</Label>
              <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Data fim</Label>
              <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Mercados (separados por vírgula)</Label>
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
