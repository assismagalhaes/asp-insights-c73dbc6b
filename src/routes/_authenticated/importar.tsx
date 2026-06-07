import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Upload, Download, FileSpreadsheet, AlertTriangle, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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
  "stake",
  "observacoes",
] as const;
type Field = (typeof TARGET_FIELDS)[number];

const REQUIRED: Field[] = [
  "data",
  "esporte",
  "jogo",
  "mercado",
  "pick",
  "odd_ofertada",
  "odd_valor",
  "probabilidade_final",
  "edge",
  "stake",
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
  probabilidade_final: ["probabilidade_final", "prob", "probabilidade", "probability", "prob_final"],
  edge: ["edge", "ev", "valor_esperado"],
  stake: ["stake", "unidades", "units", "u"],
  observacoes: ["observacoes", "observações", "obs", "notes", "notas", "comentarios"],
};

const norm = (s: string) =>
  s.toString().toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "_");

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
  const s = String(v).trim().replace(",", ".").replace(/[^\d.\-]/g, "");
  if (!s) return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

function parseStake(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).trim().toLowerCase().replace(",", ".");
  const m = s.match(/(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  return Number(m[1]);
}

function parseProb(v: unknown): number | null {
  const n = parseNumber(v);
  if (n == null) return null;
  // se 0..1 -> *100
  if (n > 0 && n <= 1) return Number((n * 100).toFixed(4));
  return n;
}

function parseEdge(v: unknown): number | null {
  const n = parseNumber(v);
  if (n == null) return null;
  // Edge é importado já em pontos percentuais (ex.: 0.3 = 0.3%, 7.08 = 7.08%).
  // Não aplicamos escala automática para evitar leituras incorretas.
  return n;
}

function parseDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    // Excel serial
    const d = XLSX.SSF.parse_date_code(v);
    if (d) {
      const mm = String(d.m).padStart(2, "0");
      const dd = String(d.d).padStart(2, "0");
      return `${d.y}-${mm}-${dd}`;
    }
  }
  if (v instanceof Date) {
    const yyyy = v.getUTCFullYear();
    const mm = String(v.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(v.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  const s = String(v).trim();
  // ISO yyyy-mm-dd (com ou sem hora)
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // dd/mm/yyyy or dd-mm-yyyy
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    const yyyy = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${yyyy}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  const d = new Date(s + "T00:00:00Z");
  if (!isNaN(d.getTime())) {
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

function parseTime(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    // Excel serial: a parte fracionária representa a hora do dia
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
  // procura HH:MM (com segundos opcionais) em qualquer parte da string
  const m = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!m) return null;
  const hh = String(Math.min(23, Number(m[1]))).padStart(2, "0");
  return `${hh}:${m[2]}`;
}

interface ParsedRow {
  raw: Record<string, unknown>;
  values: Record<Field, unknown>;
  errors: string[];
  warnings: string[];
  duplicate: boolean;
}

type DupStrategy = "skip" | "update" | "force";

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
  const [summary, setSummary] = useState<null | {
    lidas: number;
    importados: number;
    ignorados: number;
    erros: number;
    duplicados: number;
  }>(null);

  const handleFile = async (file: File) => {
    setSummary(null);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
      defval: "",
      raw: true,
    });
    if (!json.length) {
      toast.error("Arquivo vazio");
      return;
    }
    const hdrs = Object.keys(json[0]);
    setHeaders(hdrs);
    setRawRows(json);
    setMapping(autoMap(hdrs));

    // load existing keys for dup check
    const { data } = await supabase
      .from("prognosticos")
      .select("data,esporte,jogo,mercado,pick,linha");
    const set = new Set<string>();
    (data ?? []).forEach((r: Record<string, unknown>) => {
      set.add(
        [r.data, r.esporte, r.jogo, r.mercado, r.pick, r.linha ?? ""]
          .map((x) => String(x ?? "").toLowerCase().trim())
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

      const data = parseDate(values.data);
      if (!data) errors.push("data inválida");
      // hora vem na própria coluna de data (ex.: "2026-06-07 14:35") ou em coluna separada
      const hora = parseTime(values.hora) ?? parseTime(values.data);
      const esporte = String(values.esporte ?? "").trim();
      if (!esporte) errors.push("esporte vazio");
      let jogo = String(values.jogo ?? "").trim();
      const mandante = String(values.mandante ?? "").trim();
      const visitante = String(values.visitante ?? "").trim();
      if (!jogo && mandante && visitante) jogo = `${mandante} x ${visitante}`;
      if (!jogo) errors.push("jogo vazio");
      const mercado = String(values.mercado ?? "").trim();
      if (!mercado) errors.push("mercado vazio");
      const pick = String(values.pick ?? "").trim();
      if (!pick) errors.push("pick vazio");

      const oddOf = parseNumber(values.odd_ofertada);
      if (oddOf == null) errors.push("odd_ofertada inválida");
      else if (oddOf <= 1) errors.push("odd_ofertada deve ser > 1");

      const oddV = parseNumber(values.odd_valor);
      if (oddV == null) errors.push("odd_valor inválida");
      else if (oddV <= 1) errors.push("odd_valor deve ser > 1");

      const prob = parseProb(values.probabilidade_final);
      if (prob == null) errors.push("probabilidade inválida");
      else if (prob < 0 || prob > 100) errors.push("probabilidade fora de 0-100");

      const edge = parseEdge(values.edge);
      if (edge == null) errors.push("edge inválido");

      const stake = parseStake(values.stake);
      if (stake == null) errors.push("stake inválido");
      else if (stake <= 0) errors.push("stake deve ser > 0");

      if (!String(values.liga ?? "").trim()) warnings.push("liga vazia");
      if (!mandante || !visitante) warnings.push("sem mandante/visitante");

      const linha = values.linha == null || values.linha === "" ? null : String(values.linha).trim();
      const key = [data, esporte, jogo, mercado, pick, linha ?? ""]
        .map((x) => String(x ?? "").toLowerCase().trim())
        .join("||");
      const duplicate = errors.length === 0 && existingKeys.has(key);

      return {
        raw,
        values: {
          data,
          hora,
          esporte,
          liga: String(values.liga ?? "").trim() || null,
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
          stake,
          observacoes: String(values.observacoes ?? "").trim() || null,
        } as Record<Field, unknown>,
        errors,
        warnings,
        duplicate,
      };
    });
  }, [rawRows, mapping, existingKeys]);

  const stats = useMemo(() => {
    const valid = parsedRows.filter((r) => r.errors.length === 0);
    const dups = valid.filter((r) => r.duplicate).length;
    return {
      total: parsedRows.length,
      validas: valid.length - dups,
      duplicadas: dups,
      comErro: parsedRows.filter((r) => r.errors.length > 0).length,
      comAlerta: parsedRows.filter((r) => r.errors.length === 0 && r.warnings.length > 0).length,
    };
  }, [parsedRows]);

  const handleImport = async () => {
    setImporting(true);
    try {
      const validRows = parsedRows.filter((r) => r.errors.length === 0);
      const toInsert: Record<string, unknown>[] = [];
      const toUpdate: ParsedRow[] = [];
      let ignorados = 0;

      for (const r of validRows) {
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
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    const headers = TARGET_FIELDS.join(",");
    const example = [
      "2026-06-07 14:35",
      "14:35",
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
      "1u",
      "Exemplo",
    ].join(",");
    const csv = `${headers}\n${example}\n`;
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
    setSummary(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Importar Prognósticos</h1>
          <p className="text-sm text-muted-foreground">
            Faça upload de CSV ou XLSX gerado pelos seus modelos Python.
          </p>
        </div>
        <div className="flex gap-2">
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
              <FileSpreadsheet className="h-3 w-3" /> {rawRows.length} linha(s) lida(s) · {headers.length} coluna(s)
              <Button variant="ghost" size="sm" onClick={reset}>Limpar</Button>
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
                  {stats.comAlerta} com alerta · {stats.comErro} com erro
                </CardDescription>
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
                    <TableHead>#</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Esporte</TableHead>
                    <TableHead>Jogo</TableHead>
                    <TableHead>Mercado</TableHead>
                    <TableHead>Pick</TableHead>
                    <TableHead>Odd</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Prob</TableHead>
                    <TableHead>Edge</TableHead>
                    <TableHead>Stake</TableHead>
                    <TableHead>Mensagens</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedRows.map((r, i) => {
                    const rowClass =
                      r.errors.length > 0
                        ? "bg-destructive/10"
                        : r.duplicate || r.warnings.length > 0
                          ? "bg-warning/10"
                          : "bg-success/5";
                    const v = r.values;
                    return (
                      <TableRow key={i} className={rowClass}>
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
                        <TableCell className="text-xs">{String(v.data ?? "")}</TableCell>
                        <TableCell className="text-xs">{String(v.esporte ?? "")}</TableCell>
                        <TableCell className="text-xs">{String(v.jogo ?? "")}</TableCell>
                        <TableCell className="text-xs">{String(v.mercado ?? "")}</TableCell>
                        <TableCell className="text-xs">{String(v.pick ?? "")}</TableCell>
                        <TableCell className="text-xs">{String(v.odd_ofertada ?? "")}</TableCell>
                        <TableCell className="text-xs">{String(v.odd_valor ?? "")}</TableCell>
                        <TableCell className="text-xs">{String(v.probabilidade_final ?? "")}</TableCell>
                        <TableCell className="text-xs">{String(v.edge ?? "")}</TableCell>
                        <TableCell className="text-xs">{String(v.stake ?? "")}</TableCell>
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
              <Button onClick={handleImport} disabled={importing || stats.validas + (dupStrategy !== "skip" ? stats.duplicadas : 0) === 0}>
                {importing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Confirmar Importação
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
