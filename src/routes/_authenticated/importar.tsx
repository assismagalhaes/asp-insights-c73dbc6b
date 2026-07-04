import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import ExcelJS from "exceljs";
import {
  Upload,
  Download,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/lib/supabase-public";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { normalizeEsporteLiga } from "@/lib/db";
import { parseBrazilianDate, formatBR } from "@/lib/date-br";
import { ScraperApiDialog } from "@/components/scraper-api-dialog";

export const Route = createFileRoute("/_authenticated/importar")({
  component: ImportarPage,
});

const TARGET_FIELDS = [
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
  "dados_tecnicos",
  "observacoes",
] as const;
type Field = (typeof TARGET_FIELDS)[number];

const REQUIRED: Field[] = [
  "data",
  "hora",
  "esporte",
  "liga",
  "jogo",
  "mercado",
  "pick",
  "odd_ofertada",
  "odd_valor",
  "probabilidade_final",
  "edge",
];

const ALIASES: Record<Field, string[]> = {
  data: ["data", "date", "dt", "data_jogo", "data_hora", "datetime", "data_hora_jogo"],
  hora: ["hora", "time", "horario", "horário"],
  esporte: ["esporte", "sport", "modalidade"],
  liga: ["liga", "league", "campeonato", "competicao", "competição"],
  jogo: ["jogo", "match", "evento", "event", "partida"],
  mandante: ["mandante", "home", "casa", "time_casa"],
  visitante: ["visitante", "away", "fora", "time_fora"],
  mercado: ["mercado", "market", "tipo_aposta"],
  pick: ["pick", "selecao", "seleção", "selection", "aposta"],
  linha: ["linha", "line", "handicap"],
  odd_ofertada: ["odd_ofertada", "odd", "odds", "odd_oferecida", "preco"],
  odd_valor: ["odd_valor", "fair_odd", "odd_justa", "valor_odd"],
  probabilidade_final: [
    "probabilidade_final",
    "prob",
    "probabilidade",
    "probability",
    "prob_final",
  ],
  edge: ["edge", "ev", "valor_esperado"],
  dados_tecnicos: ["dados_tecnicos", "dados_técnicos", "tecnico", "técnico", "modelo", "tech"],
  observacoes: ["observacoes", "observações", "obs", "notes", "notas", "comentarios"],
};

const norm = (s: string) =>
  s
    .toString()
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "_");

function autoMap(headers: string[]): Record<Field, string | null> {
  const map = {} as Record<Field, string | null>;
  const normHeaders = headers.map((h) => ({ raw: h, n: norm(h) }));
  for (const f of TARGET_FIELDS) {
    const aliases = ALIASES[f].map(norm);
    const match = normHeaders.find((h) => aliases.includes(h.n));
    map[f] = match ? match.raw : null;
  }
  return map;
}

function parseNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v)
    .trim()
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  if (!s) return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

function parseProb(v: unknown): number | null {
  const n = parseNumber(v);
  if (n == null) return null;
  if (n > 0 && n <= 1) return Number((n * 100).toFixed(4));
  return n;
}

function parseEdge(v: unknown): number | null {
  return parseNumber(v);
}

function parseTime(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const frac = v - Math.floor(v);
    if (frac > 0) {
      const totalMin = Math.round(frac * 24 * 60);
      const hh = String(Math.floor(totalMin / 60) % 24).padStart(2, "0");
      const mm = String(totalMin % 60).padStart(2, "0");
      return `${hh}:${mm}`;
    }
    return null;
  }
  if (v instanceof Date) {
    const hh = String(v.getUTCHours()).padStart(2, "0");
    const mm = String(v.getUTCMinutes()).padStart(2, "0");
    return hh === "00" && mm === "00" ? null : `${hh}:${mm}`;
  }
  const s = String(v).trim();
  const m = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!m) return null;
  const hh = String(Math.min(23, Number(m[1]))).padStart(2, "0");
  return `${hh}:${m[2]}`;
}

interface ParsedRow {
  raw: Record<string, unknown>;
  values: Record<string, unknown>;
  errors: string[];
  warnings: string[];
  duplicate: boolean;
}

type DupStrategy = "skip" | "update" | "force";

/**
 * Parser CSV simples que preserva TODOS os valores como string crua.
 * Suporta aspas duplas e separadores , ou ;
 * Nunca interpreta data — devolve exatamente o que o arquivo trouxer.
 */
function parseCsvAsText(text: string): Record<string, string>[] {
  // Remove BOM
  const clean = text.replace(/^\uFEFF/, "");
  // Detecta separador (vírgula ou ponto-e-vírgula)
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const sep =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";

  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === sep) {
        cur.push(field);
        field = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && clean[i + 1] === "\n") i++;
        cur.push(field);
        field = "";
        if (cur.some((c) => c !== "")) rows.push(cur);
        cur = [];
      } else {
        field += ch;
      }
    }
  }
  if (field !== "" || cur.length) {
    cur.push(field);
    if (cur.some((c) => c !== "")) rows.push(cur);
  }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => {
      o[h] = (r[i] ?? "").trim();
    });
    return o;
  });
}

function ImportarPage() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<Record<Field, string | null>>(
    {} as Record<Field, string | null>,
  );
  const [existingKeys, setExistingKeys] = useState<Set<string>>(new Set());
  const [dupStrategy, setDupStrategy] = useState<DupStrategy>("skip");
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [summary, setSummary] = useState<null | {
    lidas: number;
    importados: number;
    ignorados: number;
    erros: number;
    duplicados: number;
  }>(null);

  const handleFile = async (file: File) => {
    setSummary(null);
    const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv";
    let json: Record<string, unknown>[] = [];

    if (isCsv) {
      // Parse CSV manually como TEXTO puro — nunca deixar XLSX/JS interpretar datas.
      const text = await file.text();
      json = parseCsvAsText(text);
    } else {
      const buf = await file.arrayBuffer();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const ws = wb.worksheets[0];
      const headerVals = (ws.getRow(1).values as unknown[])
        .slice(1)
        .map((h) => String(h ?? "").trim());
      json = [];
      ws.eachRow({ includeEmpty: false }, (row, idx) => {
        if (idx === 1) return;
        const vals = row.values as unknown[];
        const obj: Record<string, unknown> = {};
        headerVals.forEach((h, i) => {
          if (!h) return;
          const v = vals[i + 1];
          // Normaliza valores não-primitivos vindos do ExcelJS (formula/hyperlink/richText/Date)
          if (v == null) obj[h] = "";
          else if (v instanceof Date) obj[h] = v;
          else if (typeof v === "object") {
            const o = v as {
              text?: unknown;
              result?: unknown;
              richText?: { text: string }[];
              hyperlink?: unknown;
            };
            if (Array.isArray(o.richText)) obj[h] = o.richText.map((r) => r.text).join("");
            else if (o.text != null) obj[h] = String(o.text);
            else if (o.result != null) obj[h] = o.result;
            else obj[h] = String(v);
          } else obj[h] = v;
        });
        json.push(obj);
      });
    }

    if (!json.length) {
      toast.error("Arquivo vazio");
      return;
    }
    const hdrs = Object.keys(json[0]);
    setHeaders(hdrs);
    setRawRows(json);
    setMapping(autoMap(hdrs));

    const { data } = await supabase
      .from("prognosticos")
      .select("data,esporte,jogo,mercado,pick,linha");
    const set = new Set<string>();
    (data ?? []).forEach((r: Record<string, unknown>) => {
      set.add(
        [r.data, r.esporte, r.jogo, r.mercado, r.pick, r.linha ?? ""]
          .map((x) =>
            String(x ?? "")
              .toLowerCase()
              .trim(),
          )
          .join("||"),
      );
    });
    setExistingKeys(set);
  };

  const parsedRows = useMemo<ParsedRow[]>(() => {
    if (!rawRows.length) return [];
    return rawRows.map((raw) => {
      const values = {} as Record<Field, unknown>;
      for (const f of TARGET_FIELDS) {
        const col = mapping[f];
        values[f] = col ? raw[col] : "";
      }
      const errors: string[] = [];
      const warnings: string[] = [];

      const data = parseBrazilianDate(values.data);
      if (!data) errors.push("Data inválida");

      // Hora pode vir na própria coluna de data se houver "YYYY-MM-DD HH:MM"
      const hora = parseTime(values.hora) ?? parseTime(values.data);
      if (!hora) errors.push("Hora obrigatória não informada");

      const normESL = normalizeEsporteLiga({
        esporte: String(values.esporte ?? ""),
        liga: String(values.liga ?? ""),
      });
      if (!normESL.esporte) errors.push("Esporte vazio");
      if (!normESL.liga) errors.push("Liga obrigatória não informada");

      let jogo = String(values.jogo ?? "").trim();
      const mandante = String(values.mandante ?? "").trim();
      const visitante = String(values.visitante ?? "").trim();
      if (!jogo && mandante && visitante) jogo = `${mandante} x ${visitante}`;
      if (!jogo) errors.push("Jogo vazio");

      const mercado = String(values.mercado ?? "").trim();
      if (!mercado) errors.push("Mercado vazio");
      const pick = String(values.pick ?? "").trim();
      if (!pick) errors.push("Pick vazia");

      const oddOf = parseNumber(values.odd_ofertada);
      if (oddOf == null) errors.push("Odd ofertada inválida");
      else if (oddOf <= 1) errors.push("Odd ofertada deve ser > 1");

      const oddV = parseNumber(values.odd_valor);
      if (oddV == null) errors.push("Odd valor inválida");
      else if (oddV <= 1) errors.push("Odd valor deve ser > 1");

      const prob = parseProb(values.probabilidade_final);
      if (prob == null) errors.push("Probabilidade inválida");
      else if (prob < 0 || prob > 100) errors.push("Probabilidade fora de 0-100");

      const edge = parseEdge(values.edge);
      if (edge == null) errors.push("Edge inválido");

      if (!mandante || !visitante) warnings.push("Sem mandante/visitante");

      const linha =
        values.linha == null || values.linha === "" ? null : String(values.linha).trim();
      const key = [data, normESL.esporte, jogo, mercado, pick, linha ?? ""]
        .map((x) =>
          String(x ?? "")
            .toLowerCase()
            .trim(),
        )
        .join("||");
      const duplicate = errors.length === 0 && existingKeys.has(key);

      return {
        raw,
        values: {
          data,
          hora,
          esporte: normESL.esporte,
          liga: normESL.liga,
          jogo,
          mandante: mandante || null,
          visitante: visitante || null,
          mercado,
          pick,
          linha,
          odd_ofertada: oddOf,
          odd_valor: oddV,
          probabilidade_final: prob,
          edge,
          stake: 0,
          dados_tecnicos: String(values.dados_tecnicos ?? "").trim() || null,
          observacoes: String(values.observacoes ?? "").trim() || null,
        },
        errors,
        warnings,
        duplicate,
      };
    });
  }, [rawRows, mapping, existingKeys]);

  // Pré-selecionar linhas válidas (sem erro) por padrão
  useEffect(() => {
    setSelected(
      new Set(
        parsedRows
          .map((r, i) => ({ r, i }))
          .filter(({ r }) => r.errors.length === 0)
          .map(({ i }) => i),
      ),
    );
  }, [parsedRows]);

  const stats = useMemo(() => {
    const valid = parsedRows.filter((r) => r.errors.length === 0);
    const dups = valid.filter((r) => r.duplicate).length;
    const selecionadas = parsedRows.filter((_, i) => selected.has(i)).length;
    return {
      total: parsedRows.length,
      validas: valid.length - dups,
      duplicadas: dups,
      comErro: parsedRows.filter((r) => r.errors.length > 0).length,
      comAlerta: parsedRows.filter((r) => r.errors.length === 0 && r.warnings.length > 0).length,
      selecionadas,
    };
  }, [parsedRows, selected]);

  const toggleRow = (i: number) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  };

  const selectableIndexes = useMemo(
    () => parsedRows.map((r, i) => (r.errors.length === 0 ? i : -1)).filter((i) => i >= 0),
    [parsedRows],
  );
  const allSelectableSelected =
    selectableIndexes.length > 0 && selectableIndexes.every((i) => selected.has(i));

  const toggleAll = () => {
    if (allSelectableSelected) setSelected(new Set());
    else setSelected(new Set(selectableIndexes));
  };
  const selectOnlyValid = () => {
    setSelected(
      new Set(
        parsedRows
          .map((r, i) => ({ r, i }))
          .filter(({ r }) => r.errors.length === 0 && r.warnings.length === 0 && !r.duplicate)
          .map(({ i }) => i),
      ),
    );
  };
  const clearSelection = () => setSelected(new Set());

  const handleImport = async () => {
    setImporting(true);
    try {
      const selectedRows = parsedRows.filter((r, i) => selected.has(i) && r.errors.length === 0);
      const toInsert: Record<string, unknown>[] = [];
      const toUpdate: ParsedRow[] = [];
      let ignorados = 0;
      const ligasNovas = new Map<string, string>(); // key: esporte||liga

      for (const r of selectedRows) {
        if (r.duplicate) {
          if (dupStrategy === "skip") {
            ignorados++;
            continue;
          }
          if (dupStrategy === "update") {
            toUpdate.push(r);
            continue;
          }
        }
        toInsert.push({
          ...r.values,
          status_validacao: "PENDENTE",
          status_publicacao: "NAO_PUBLICADO",
          resultado: "PENDENTE",
        });
        // coletar liga p/ upsert
        const liga = r.values.liga as string | null;
        const esp = r.values.esporte as string;
        if (liga && esp) ligasNovas.set(`${esp}||${liga}`, liga);
      }

      // Auto-cadastro de ligas novas
      const ligasArr = Array.from(ligasNovas.entries()).map(([k]) => {
        const [esporte, nome] = k.split("||");
        return { esporte, nome };
      });
      if (ligasArr.length) {
        await supabase
          .from("ligas")
          .upsert(ligasArr, { onConflict: "esporte,nome", ignoreDuplicates: true });
      }

      let importados = 0;
      if (toInsert.length) {
        const { error } = await supabase.from("prognosticos").insert(toInsert as never);
        if (error) throw error;
        importados += toInsert.length;
      }

      for (const r of toUpdate) {
        const { data: existing } = await supabase
          .from("prognosticos")
          .select("id")
          .eq("data", r.values.data as string)
          .eq("esporte", r.values.esporte as string)
          .eq("jogo", r.values.jogo as string)
          .eq("mercado", r.values.mercado as string)
          .eq("pick", r.values.pick as string)
          .limit(1);
        if (existing && existing.length) {
          const { error } = await supabase
            .from("prognosticos")
            .update(r.values as never)
            .eq("id", existing[0].id);
          if (!error) importados++;
        }
      }

      setSummary({
        lidas: parsedRows.length,
        importados,
        ignorados,
        erros: stats.comErro,
        duplicados: stats.duplicadas,
      });
      toast.success(`${importados} prognóstico(s) importado(s)`);
      qc.invalidateQueries({ queryKey: ["prognosticos"] });
      qc.invalidateQueries({ queryKey: ["ligas"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    const cols = [
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
      "stake",
    ];
    const example = [
      "11/06/2026",
      "14:10",
      "Futebol",
      "Brasileirão",
      "Flamengo x Palmeiras",
      "Flamengo",
      "Palmeiras",
      "Resultado Final",
      "Flamengo",
      "",
      "2.10",
      "1.95",
      "55",
      "5.5",
      "1",
    ];
    const csv = `${cols.join(",")}\n${example.join(",")}\n`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modelo_prognosticos.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setHeaders([]);
    setRawRows([]);
    setMapping({} as Record<Field, string | null>);
    setSelected(new Set());
    setSummary(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Importar Prognósticos</h1>
          <p className="text-sm text-muted-foreground">
            Faça upload de CSV ou XLSX. Datas no formato brasileiro <strong>DD/MM/AAAA</strong>.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <ScraperApiDialog
            onRowsReady={async (hdrs, rows) => {
              setSummary(null);
              setHeaders(hdrs);
              setRawRows(rows);
              setMapping(autoMap(hdrs));
              const { data } = await supabase
                .from("prognosticos")
                .select("data,esporte,jogo,mercado,pick,linha");
              const set = new Set<string>();
              (data ?? []).forEach((r: Record<string, unknown>) => {
                set.add(
                  [r.data, r.esporte, r.jogo, r.mercado, r.pick, r.linha ?? ""]
                    .map((x) =>
                      String(x ?? "")
                        .toLowerCase()
                        .trim(),
                    )
                    .join("||"),
                );
              });
              setExistingKeys(set);
            }}
          />
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="h-4 w-4 mr-2" /> Baixar Modelo CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" /> Upload do arquivo
          </CardTitle>
          <CardDescription>Aceita .csv, .xlsx, .xls</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          {headers.length > 0 && (
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <FileSpreadsheet className="h-3 w-3" /> {rawRows.length} linha(s) lida(s) ·{" "}
              {headers.length} coluna(s)
              <Button variant="ghost" size="sm" onClick={reset}>
                Limpar
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {headers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Mapeamento de colunas</CardTitle>
            <CardDescription>
              Ajuste se alguma coluna do arquivo veio com nome diferente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {TARGET_FIELDS.map((f) => (
                <div key={f} className="space-y-1">
                  <Label className="text-xs">
                    {f}
                    {REQUIRED.includes(f) && <span className="text-destructive ml-1">*</span>}
                  </Label>
                  <Select
                    value={mapping[f] ?? "__none__"}
                    onValueChange={(v) =>
                      setMapping((m) => ({ ...m, [f]: v === "__none__" ? null : v }))
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Nenhuma —</SelectItem>
                      {headers.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {parsedRows.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <CardTitle>Pré-visualização</CardTitle>
                <CardDescription>
                  {stats.total} linha(s) · {stats.validas} válidas · {stats.duplicadas} duplicadas ·{" "}
                  {stats.comAlerta} com alerta · {stats.comErro} com erro ·{" "}
                  <strong>{stats.selecionadas} selecionada(s)</strong>
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={selectOnlyValid}>
                  Selecionar apenas válidas
                </Button>
                <Button size="sm" variant="ghost" onClick={clearSelection}>
                  Limpar seleção
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {stats.duplicadas > 0 && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 space-y-2">
                <div className="text-sm font-medium flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  Possíveis duplicados encontrados ({stats.duplicadas})
                </div>
                <RadioGroup
                  value={dupStrategy}
                  onValueChange={(v) => setDupStrategy(v as DupStrategy)}
                  className="flex flex-wrap gap-4 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="skip" id="skip" />
                    <Label htmlFor="skip">Ignorar duplicados</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="update" id="update" />
                    <Label htmlFor="update">Atualizar existentes</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="force" id="force" />
                    <Label htmlFor="force">Importar mesmo assim</Label>
                  </div>
                </RadioGroup>
              </div>
            )}

            <div className="rounded-md border overflow-auto max-h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <Checkbox
                        checked={allSelectableSelected}
                        onCheckedChange={toggleAll}
                        aria-label="Selecionar todos"
                      />
                    </TableHead>
                    <TableHead>#</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Hora</TableHead>
                    <TableHead>Esporte</TableHead>
                    <TableHead>Liga</TableHead>
                    <TableHead>Jogo</TableHead>
                    <TableHead>Mercado</TableHead>
                    <TableHead>Pick</TableHead>
                    <TableHead>Odd</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Prob</TableHead>
                    <TableHead>Edge</TableHead>
                    <TableHead>Mensagens</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedRows.map((r, i) => {
                    const canSelect = r.errors.length === 0;
                    const rowClass =
                      r.errors.length > 0
                        ? "bg-destructive/10"
                        : r.duplicate || r.warnings.length > 0
                          ? "bg-warning/10"
                          : "bg-success/5";
                    const v = r.values;
                    return (
                      <TableRow key={i} className={rowClass}>
                        <TableCell>
                          <Checkbox
                            checked={selected.has(i)}
                            disabled={!canSelect}
                            onCheckedChange={() => toggleRow(i)}
                            aria-label={`Selecionar linha ${i + 1}`}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{i + 1}</TableCell>
                        <TableCell>
                          {r.errors.length > 0 ? (
                            <Badge variant="destructive" className="gap-1">
                              <XCircle className="h-3 w-3" /> erro
                            </Badge>
                          ) : r.duplicate ? (
                            <Badge className="bg-warning text-warning-foreground gap-1">
                              <AlertTriangle className="h-3 w-3" /> duplicado
                            </Badge>
                          ) : r.warnings.length > 0 ? (
                            <Badge className="bg-warning text-warning-foreground gap-1">
                              <AlertTriangle className="h-3 w-3" /> alerta
                            </Badge>
                          ) : (
                            <Badge className="bg-success text-success-foreground gap-1">
                              <CheckCircle2 className="h-3 w-3" /> ok
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {formatBR(v.data as string | null)}
                        </TableCell>
                        <TableCell className="text-xs font-mono">{String(v.hora ?? "—")}</TableCell>
                        <TableCell className="text-xs">{String(v.esporte ?? "")}</TableCell>
                        <TableCell className="text-xs">{String(v.liga ?? "")}</TableCell>
                        <TableCell className="text-xs">{String(v.jogo ?? "")}</TableCell>
                        <TableCell className="text-xs">{String(v.mercado ?? "")}</TableCell>
                        <TableCell className="text-xs">{String(v.pick ?? "")}</TableCell>
                        <TableCell className="text-xs">{String(v.odd_ofertada ?? "")}</TableCell>
                        <TableCell className="text-xs">{String(v.odd_valor ?? "")}</TableCell>
                        <TableCell className="text-xs">
                          {String(v.probabilidade_final ?? "")}
                        </TableCell>
                        <TableCell className="text-xs">{String(v.edge ?? "")}</TableCell>
                        <TableCell className="text-xs">
                          {[...r.errors, ...r.warnings, r.duplicate ? "duplicado" : ""]
                            .filter(Boolean)
                            .join("; ")}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={reset} disabled={importing}>
                Cancelar
              </Button>
              <Button onClick={handleImport} disabled={importing || stats.selecionadas === 0}>
                {importing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Confirmar Importação ({stats.selecionadas})
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {summary && (
        <Card>
          <CardHeader>
            <CardTitle>Resumo da importação</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold">{summary.lidas}</div>
              <div className="text-xs text-muted-foreground">Lidas</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-success">{summary.importados}</div>
              <div className="text-xs text-muted-foreground">Importadas</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-warning">{summary.ignorados}</div>
              <div className="text-xs text-muted-foreground">Ignoradas</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-destructive">{summary.erros}</div>
              <div className="text-xs text-muted-foreground">Com erro</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{summary.duplicados}</div>
              <div className="text-xs text-muted-foreground">Duplicados</div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
