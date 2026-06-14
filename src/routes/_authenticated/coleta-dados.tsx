import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Download, FileJson, FileSpreadsheet, Save, Upload } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PeriodFilter } from "@/components/period-filter";
import { dateInRange, rangeFromPeriodo, type PeriodoFiltro } from "@/lib/metrics";
import {
  downloadText,
  fetchCollections,
  fetchOddsRows,
  normalizeOddsJson,
  saveCollection,
  toCsv,
  type NormalizedCollection,
  type NormalizedOdd,
} from "@/lib/coleta-dados";

export const Route = createFileRoute("/_authenticated/coleta-dados")({
  component: ColetaDadosPage,
});

function ColetaDadosPage() {
  const qc = useQueryClient();
  const [fileName, setFileName] = useState("");
  const [rawText, setRawText] = useState("");
  const [rawJson, setRawJson] = useState<unknown>(null);
  const [normalized, setNormalized] = useState<NormalizedCollection | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [periodo, setPeriodo] = useState<PeriodoFiltro>("tudo");
  const [customIni, setCustomIni] = useState("");
  const [customFim, setCustomFim] = useState("");
  const [fEsporte, setFEsporte] = useState("all");
  const [fLiga, setFLiga] = useState("all");
  const [fMercado, setFMercado] = useState("all");
  const [fBookmaker, setFBookmaker] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const { ini, fim } = rangeFromPeriodo(periodo, customIni, customFim);

  const { data: coletas = [] } = useQuery({
    queryKey: ["coletas-odds"],
    queryFn: fetchCollections,
  });
  const { data: oddsRows = [] } = useQuery({
    queryKey: ["odds-jogos"],
    queryFn: fetchOddsRows,
  });

  const filteredOdds = useMemo(
    () =>
      oddsRows.filter((row) => {
        if (row.data && !dateInRange(row.data, ini, fim)) return false;
        if (fEsporte !== "all" && row.esporte !== fEsporte) return false;
        if (fLiga !== "all" && row.liga !== fLiga) return false;
        if (fMercado !== "all" && row.mercado !== fMercado) return false;
        if (fBookmaker !== "all" && row.bookmaker !== fBookmaker) return false;
        return true;
      }),
    [oddsRows, ini, fim, fEsporte, fLiga, fMercado, fBookmaker],
  );

  const filteredCollections = useMemo(
    () =>
      coletas.filter((coleta) => {
        const dataBase = coleta.data_inicio ?? coleta.created_at.slice(0, 10);
        if (!dateInRange(dataBase, ini, fim)) return false;
        if (fEsporte !== "all" && coleta.esporte !== fEsporte) return false;
        if (fLiga !== "all" && coleta.liga !== fLiga) return false;
        if (fStatus !== "all" && coleta.status !== fStatus) return false;
        return true;
      }),
    [coletas, ini, fim, fEsporte, fLiga, fStatus],
  );

  const filterOptions = useMemo(() => {
    const rows = normalized?.rows ?? oddsRows;
    return {
      esportes: unique(rows.map((row) => row.esporte)),
      ligas: unique(rows.map((row) => row.liga)),
      mercados: unique(rows.map((row) => row.mercado)),
      bookmakers: unique(rows.map((row) => row.bookmaker)),
      status: unique(coletas.map((row) => row.status)),
    };
  }, [normalized, oddsRows, coletas]);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setFileName(file.name);
    setErro(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const normalizedData = normalizeOddsJson(json, { esporte: inferSportFromFilename(file.name) });
      setRawText(text);
      setRawJson(json);
      setNormalized(normalizedData);
      toast.success(`${normalizedData.total_odds} odds normalizadas`);
    } catch (e) {
      setRawText("");
      setRawJson(null);
      setNormalized(null);
      setErro((e as Error).message);
      toast.error("Arquivo JSON inválido ou não normalizável");
    }
  };

  const salvar = async () => {
    if (!rawJson || !normalized) {
      toast.error("Importe um JSON antes de salvar.");
      return;
    }
    setSaving(true);
    try {
      await saveCollection(rawJson, normalized, { file_name: fileName, origem: "upload_manual" });
      await qc.invalidateQueries({ queryKey: ["coletas-odds"] });
      await qc.invalidateQueries({ queryKey: ["odds-jogos"] });
      toast.success("Coleta salva no banco");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const exportRows: NormalizedOdd[] = normalized?.rows.length ? normalized.rows : filteredOdds;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Coleta de Dados</h1>
          <Badge variant="outline">Manual</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Upload manual de JSON dos scrapers Python para normalização, exportação e persistência de odds.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Upload className="h-4 w-4" /> Upload JSON</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="space-y-3">
            <Label>Arquivo JSON</Label>
            <Input type="file" accept="application/json,.json" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
            {fileName && <Badge variant="outline">{fileName}</Badge>}
            {erro && <p className="text-sm text-destructive">{erro}</p>}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Info label="Jogos" value={normalized?.total_jogos ?? 0} />
              <Info label="Odds" value={normalized?.total_odds ?? 0} />
              <Info label="Esporte" value={normalized?.esporte ?? "-"} />
              <Info label="Liga" value={normalized?.liga ?? "múltiplas"} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={salvar} disabled={!normalized || saving}>
                <Save className="mr-2 h-4 w-4" /> Salvar coleta
              </Button>
              <Button variant="outline" disabled={!exportRows.length} onClick={() => downloadText(csvName(fileName), toCsv(exportRows))}>
                <Download className="mr-2 h-4 w-4" /> Exportar CSV
              </Button>
              <Button variant="outline" disabled={!exportRows.length} onClick={() => exportXlsx(exportRows, fileName)}>
                <FileSpreadsheet className="mr-2 h-4 w-4" /> Exportar XLSX
              </Button>
            </div>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Preview title="Conteúdo bruto" icon={FileJson} value={rawText || "Nenhum arquivo carregado."} />
            <Preview title="Dados normalizados" icon={Database} value={normalized ? JSON.stringify(normalized.rows.slice(0, 80), null, 2) : "Nenhuma normalização gerada."} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <PeriodFilter
              periodo={periodo}
              onPeriodoChange={setPeriodo}
              customIni={customIni}
              customFim={customFim}
              onCustomIniChange={setCustomIni}
              onCustomFimChange={setCustomFim}
            />
            <Filter label="Esporte" value={fEsporte} onChange={setFEsporte} options={filterOptions.esportes} />
            <Filter label="Liga" value={fLiga} onChange={setFLiga} options={filterOptions.ligas} />
            <Filter label="Mercado" value={fMercado} onChange={setFMercado} options={filterOptions.mercados} />
            <Filter label="Bookmaker" value={fBookmaker} onChange={setFBookmaker} options={filterOptions.bookmakers} />
            <Filter label="Status" value={fStatus} onChange={setFStatus} options={filterOptions.status} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.3fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Histórico de coletas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[460px] overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Data</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Esporte/Liga</th>
                    <th className="px-3 py-2 text-right">Jogos</th>
                    <th className="px-3 py-2 text-right">Odds</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCollections.map((coleta) => (
                    <tr key={coleta.id} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs">{coleta.created_at.slice(0, 10)}</td>
                      <td className="px-3 py-2"><Badge variant={coleta.erro ? "destructive" : "outline"}>{coleta.status}</Badge></td>
                      <td className="px-3 py-2">{coleta.esporte ?? "-"} / <span className="text-muted-foreground">{coleta.liga ?? "múltiplas"}</span></td>
                      <td className="px-3 py-2 text-right font-mono">{coleta.total_jogos}</td>
                      <td className="px-3 py-2 text-right font-mono">{coleta.total_odds}</td>
                    </tr>
                  ))}
                  {!filteredCollections.length && <EmptyRow cols={5} />}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Odds normalizadas salvas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[460px] overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Data</th>
                    <th className="px-3 py-2 text-left">Jogo</th>
                    <th className="px-3 py-2 text-left">Mercado</th>
                    <th className="px-3 py-2 text-left">Pick</th>
                    <th className="px-3 py-2 text-left">Linha</th>
                    <th className="px-3 py-2 text-right">Odd</th>
                    <th className="px-3 py-2 text-left">Book</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOdds.slice(0, 300).map((row) => (
                    <tr key={row.id} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{row.data ?? "-"} {row.hora?.slice(0, 5) ?? ""}</td>
                      <td className="px-3 py-2 min-w-52">{row.jogo}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{row.mercado}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{row.pick}</td>
                      <td className="px-3 py-2 font-mono text-xs">{row.linha ?? "-"}</td>
                      <td className="px-3 py-2 text-right font-mono">{Number(row.odd).toFixed(2)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.bookmaker ?? "-"}</td>
                    </tr>
                  ))}
                  {!filteredOdds.length && <EmptyRow cols={7} />}
                </tbody>
              </table>
            </div>
            {filteredOdds.length > 300 && <p className="mt-2 text-xs text-muted-foreground">Exibindo 300 de {filteredOdds.length} odds filtradas.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-mono font-semibold">{value}</div>
    </div>
  );
}

function Preview({ title, icon: Icon, value }: { title: string; icon: LucideIcon; value: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium"><Icon className="h-4 w-4" /> {title}</div>
      <Textarea value={value} readOnly className="h-72 resize-none font-mono text-xs" />
    </div>
  );
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <Label className="block text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos</SelectItem>
          {options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className="px-3 py-12 text-center text-sm text-muted-foreground">
        Nenhum registro encontrado.
      </td>
    </tr>
  );
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function inferSportFromFilename(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("basket")) return "Basketball";
  if (lower.includes("baseball")) return "Baseball";
  if (lower.includes("hockey")) return "Hockey";
  if (lower.includes("american")) return "American Football";
  if (lower.includes("football")) return "Futebol";
  return null;
}

function csvName(name: string) {
  return `${name.replace(/\.json$/i, "") || "coleta_odds"}_normalizado.csv`;
}

async function exportXlsx(rows: NormalizedOdd[], fileName: string) {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.json_to_sheet(rows.map(({ raw_ref: _raw, ...row }) => row));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "odds");
  XLSX.writeFile(wb, `${fileName.replace(/\.json$/i, "") || "coleta_odds"}_normalizado.xlsx`);
}
