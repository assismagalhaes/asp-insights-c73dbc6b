import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudDownload, Database, Download, FileJson, FileSpreadsheet, RefreshCw, Save, Upload } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PeriodFilter } from "@/components/period-filter";
import { dateInRange, rangeFromPeriodo, type PeriodoFiltro } from "@/lib/metrics";
import {
  downloadText,
  completeRemoteCollection,
  createRemoteCollection,
  fetchCollections,
  fetchOddsRows,
  normalizeVmNormalizedPayload,
  normalizeOddsJson,
  saveCollection,
  toCsv,
  updateCollectionStatus,
  type NormalizedCollection,
  type NormalizedOdd,
  type ColetaOdds,
} from "@/lib/coleta-dados";
import {
  createScrapingJob,
  getScrapingJobNormalized,
  getScrapingJobStatus,
} from "@/lib/scraper-api.functions";

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
  const [remoteBusy, setRemoteBusy] = useState<string | null>(null);
  const [remoteStatus, setRemoteStatus] = useState<string | null>(null);
  const [remoteParams, setRemoteParams] = useState({
    esporte: "Baseball",
    leagues: ["Todos"],
    data_inicio: "",
    data_fim: "",
  });
  const [periodo, setPeriodo] = useState<PeriodoFiltro>("tudo");
  const [customIni, setCustomIni] = useState("");
  const [customFim, setCustomFim] = useState("");
  const [fEsporte, setFEsporte] = useState("all");
  const [fLiga, setFLiga] = useState("all");
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
        return true;
      }),
    [oddsRows, ini, fim, fEsporte, fLiga],
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

  const importarNormalizedDaVm = async (coleta: ColetaOdds) => {
    if (!coleta.job_id) throw new Error("Coleta sem job_id para consultar na VM.");
    setRemoteStatus("Buscando dados normalizados...");
    const result = await getScrapingJobNormalized({ data: { job_id: coleta.job_id } });
    const raw = result.normalized_json;
    const normalizedData = normalizeVmNormalizedPayload(raw, { esporte: coleta.esporte });
    if (!normalizedData.total_odds) {
      throw new Error("Retorno /normalized da VM nao trouxe odds para importar.");
    }

    setRemoteStatus("Salvando odds no banco...");
    const imported = await completeRemoteCollection(coleta.id, raw, normalizedData);
    await qc.invalidateQueries({ queryKey: ["coletas-odds"] });
    await qc.invalidateQueries({ queryKey: ["odds-jogos"] });
    setRawJson(raw);
    setRawText(JSON.stringify(raw, null, 2));
    setNormalized(normalizedData);
    toast.success(`${imported.inserted} odds importadas da VM${imported.duplicated ? ` (${imported.duplicated} duplicadas ignoradas)` : ""}`);
  };

  const executarColeta = async () => {
    setRemoteBusy("pipeline");
    setRemoteStatus("Criando job na VM...");
    setErro(null);
    let coletaCriada: ColetaOdds | null = null;
    try {
      const scraperPayload = {
        esporte: scraperSportName(remoteParams.esporte),
        leagues: selectedLeagueValues(remoteParams.esporte, remoteParams.leagues),
        data_inicio: remoteParams.data_inicio,
        data_fim: remoteParams.data_fim,
      };
      if (!scraperPayload.data_inicio || !scraperPayload.data_fim) {
        toast.error("Informe data inicio e data fim.");
        return;
      }
      console.info("[Coleta VM] Payload POST /scraping/jobs", scraperPayload);
      const result = await createScrapingJob({ data: scraperPayload });
      const coleta = await createRemoteCollection({
        esporte: remoteParams.esporte,
        liga: selectedLeagueLabels(remoteParams.esporte, remoteParams.leagues).join(", ") || "Todos",
        data_inicio: scraperPayload.data_inicio,
        data_fim: scraperPayload.data_fim,
        mercados: [],
        job_id: result.job_id,
      });
      coletaCriada = coleta;
      await qc.invalidateQueries({ queryKey: ["coletas-odds"] });
      toast.success(`Coleta enviada para VM: ${result.job_id}`);
      const finalStatus = await pollVmJob(coleta.id, result.job_id, setRemoteStatus);
      if (finalStatus === "CONCLUIDA") {
        await importarNormalizedDaVm(coleta);
      } else {
        await qc.invalidateQueries({ queryKey: ["coletas-odds"] });
        toast.info("Coleta em andamento na VM. Você pode sair da tela e voltar depois.");
      }
    } catch (e) {
      const message = formatVmError(e);
      setErro(message);
      if (coletaCriada) {
        await updateCollectionStatus(coletaCriada.id, "ERRO", message).catch(() => null);
        await qc.invalidateQueries({ queryKey: ["coletas-odds"] });
      }
      toast.error(message);
    } finally {
      setRemoteBusy(null);
      setRemoteStatus(null);
    }
  };

  const atualizarStatus = async (coleta: ColetaOdds) => {
    if (!coleta.job_id) return;
    setRemoteBusy(`status:${coleta.id}`);
    setErro(null);
    try {
      const result = await getScrapingJobStatus({ data: { job_id: coleta.job_id } });
      const { status, erro } = extractVmStatus(result.payload);
      await updateCollectionStatus(coleta.id, status, erro);
      await qc.invalidateQueries({ queryKey: ["coletas-odds"] });
      toast.success(`Status atualizado: ${status}`);
      if (status === "CONCLUIDA") {
        await importarNormalizedDaVm(coleta);
      }
      if (status === "ERRO" && erro) {
        setErro(erro);
        toast.error(erro);
      }
    } catch (e) {
      await updateCollectionStatus(coleta.id, "ERRO", formatVmError(e)).catch(() => null);
      await qc.invalidateQueries({ queryKey: ["coletas-odds"] });
      toast.error(formatVmError(e));
    } finally {
      setRemoteBusy(null);
      setRemoteStatus(null);
    }
  };

  const importarResultadoVm = async (coleta: ColetaOdds) => {
    if (!coleta.job_id) return;
    setRemoteBusy(`normalized:${coleta.id}`);
    try {
      const result = await getScrapingJobNormalized({ data: { job_id: coleta.job_id } });
      const raw = result.normalized_json;
      const normalizedData = normalizeVmNormalizedPayload(raw, { esporte: coleta.esporte });
      if (!normalizedData.total_odds) {
        throw new Error("JSON retornado pela VM não gerou odds normalizadas.");
      }
      const imported = await completeRemoteCollection(coleta.id, raw, normalizedData);
      await qc.invalidateQueries({ queryKey: ["coletas-odds"] });
      await qc.invalidateQueries({ queryKey: ["odds-jogos"] });
      setRawJson(raw);
      setRawText(JSON.stringify(raw, null, 2));
      setNormalized(normalizedData);
      toast.success(`${imported.inserted} odds importadas da VM${imported.duplicated ? ` (${imported.duplicated} duplicadas ignoradas)` : ""}`);
    } catch (e) {
      await updateCollectionStatus(coleta.id, "ERRO", formatVmError(e)).catch(() => null);
      await qc.invalidateQueries({ queryKey: ["coletas-odds"] });
      toast.error(formatVmError(e));
    } finally {
      setRemoteBusy(null);
      setRemoteStatus(null);
    }
  };

  const retomarColeta = async (coleta: ColetaOdds) => {
    if (!coleta.job_id) return;
    setRemoteBusy(`resume:${coleta.id}`);
    setRemoteStatus("Coleta em andamento na VM. Você pode sair da tela e voltar depois.");
    setErro(null);
    try {
      const finalStatus = await pollVmJob(coleta.id, coleta.job_id, setRemoteStatus);
      if (finalStatus === "CONCLUIDA") {
        await importarNormalizedDaVm(coleta);
      } else {
        await qc.invalidateQueries({ queryKey: ["coletas-odds"] });
        toast.info("Coleta em andamento na VM. Você pode sair da tela e voltar depois.");
      }
    } catch (e) {
      const message = formatVmError(e);
      setErro(message);
      await updateCollectionStatus(coleta.id, "ERRO", message).catch(() => null);
      await qc.invalidateQueries({ queryKey: ["coletas-odds"] });
      toast.error(message);
    } finally {
      setRemoteBusy(null);
      setRemoteStatus(null);
    }
  };

  const exportRows: NormalizedOdd[] = normalized?.rows.length ? normalized.rows : filteredOdds;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Coleta de Dados</h1>
          <Badge variant="outline">Manual</Badge>
          <Badge variant="outline">VM</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Upload manual de JSON dos scrapers Python para normalização, exportação e persistência de odds.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CloudDownload className="h-4 w-4" /> Executar Coleta na VM
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <Label>Esporte</Label>
              <Select value={remoteParams.esporte} onValueChange={(v) => setRemoteParams((p) => ({ ...p, esporte: v, leagues: ["Todos"] }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Futebol">Futebol</SelectItem>
                  <SelectItem value="Basketball">Basketball</SelectItem>
                  <SelectItem value="Baseball">Baseball</SelectItem>
                  <SelectItem value="American Football">American Football</SelectItem>
                  <SelectItem value="Hockey">Hockey</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <LeagueSelector
              esporte={remoteParams.esporte}
              selected={remoteParams.leagues}
              onChange={(leagues) => setRemoteParams((p) => ({ ...p, leagues }))}
            />
            <Field label="Data início" type="date" value={remoteParams.data_inicio} onChange={(data_inicio) => setRemoteParams((p) => ({ ...p, data_inicio }))} />
            <Field label="Data fim" type="date" value={remoteParams.data_fim} onChange={(data_fim) => setRemoteParams((p) => ({ ...p, data_fim }))} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={executarColeta} disabled={remoteBusy === "pipeline" || !remoteParams.esporte}>
              <CloudDownload className="mr-2 h-4 w-4" />
              {remoteBusy === "pipeline" ? "Coletando..." : "Executar Coleta"}
            </Button>
            <p className="text-xs text-muted-foreground">
              A chave da VM fica protegida no servidor via SCRAPER_API_URL e SCRAPER_API_KEY.
            </p>
          </div>
          {remoteStatus && (
            <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
              {remoteStatus}
            </div>
          )}
          {erro && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {erro}
            </div>
          )}
        </CardContent>
      </Card>

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
                    <th className="px-3 py-2 text-left">Job</th>
                    <th className="px-3 py-2 text-right">Jogos</th>
                    <th className="px-3 py-2 text-right">Odds</th>
                    <th className="px-3 py-2 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCollections.map((coleta) => (
                    <tr key={coleta.id} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs">{coleta.created_at.slice(0, 10)}</td>
                      <td className="px-3 py-2"><Badge variant={coleta.erro ? "destructive" : "outline"}>{coleta.status}</Badge></td>
                      <td className="px-3 py-2">{coleta.esporte ?? "-"} / <span className="text-muted-foreground">{coleta.liga ?? "múltiplas"}</span></td>
                      <td className="px-3 py-2 font-mono text-xs">{coleta.job_id ?? "-"}</td>
                      <td className="px-3 py-2 text-right font-mono">{coleta.total_jogos}</td>
                      <td className="px-3 py-2 text-right font-mono">{coleta.total_odds}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" disabled={!coleta.job_id || remoteBusy === `status:${coleta.id}`} onClick={() => atualizarStatus(coleta)}>
                            <RefreshCw className="mr-1 h-3 w-3" /> Status
                          </Button>
                          <Button size="sm" variant="outline" disabled={!coleta.job_id || !isRunningStatus(coleta.status) || remoteBusy === `resume:${coleta.id}`} onClick={() => retomarColeta(coleta)}>
                            <RefreshCw className="mr-1 h-3 w-3" /> Retomar
                          </Button>
                          <Button size="sm" variant="outline" disabled={!coleta.job_id || coleta.status !== "CONCLUIDA" || remoteBusy === `normalized:${coleta.id}`} onClick={() => importarResultadoVm(coleta)}>
                            <CloudDownload className="mr-1 h-3 w-3" /> Importar
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!filteredCollections.length && <EmptyRow cols={8} />}
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

function LeagueSelector({
  esporte,
  selected,
  onChange,
}: {
  esporte: string;
  selected: string[];
  onChange: (value: string[]) => void;
}) {
  const options = leagueOptionsForSport(esporte);
  const selectedSet = new Set(selected.length ? selected : ["Todos"]);

  if (esporte === "Futebol") {
    return (
      <div className="md:col-span-2">
        <Label>Liga</Label>
        <div className="mt-2 max-h-48 overflow-auto rounded-md border p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {options.map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={selectedSet.has(option.value)}
                  onCheckedChange={(checked) => onChange(toggleLeague(selected, option.value, Boolean(checked)))}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Label>Liga</Label>
      <Select value={selected[0] ?? "Todos"} onValueChange={(value) => onChange([value])}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
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

function extractVmStatus(payload: unknown) {
  const root = isObj(payload) ? payload : {};
  const data = isObj(root.data) ? root.data : isObj(root.result) ? root.result : root;
  const raw = String(data.status ?? data.state ?? data.situacao ?? "").toUpperCase();
  const erro = data.erro ?? data.error ?? data.message;
  const status =
    raw.includes("RUN") || raw.includes("ROD") || raw.includes("PROCESS")
      ? "RODANDO"
      : raw.includes("DONE") || raw.includes("CONCL") || raw.includes("SUCCESS") || raw.includes("FINISH")
        ? "CONCLUIDA"
        : raw.includes("ERR") || raw.includes("FAIL")
          ? "ERRO"
          : raw.includes("PEND") || raw.includes("QUEUE")
            ? "PENDENTE"
            : raw || "PENDENTE";
  return { status, erro: erro ? String(erro) : null };
}

async function pollVmJob(
  coletaId: string,
  jobId: string,
  onStatus: (status: string) => void,
  maxAttempts = 120,
) {
  let latestStatus = "PENDENTE";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    onStatus(`Coleta em andamento na VM. Você pode sair da tela e voltar depois. Tentativa ${attempt}/${maxAttempts}`);
    const result = await getScrapingJobStatus({ data: { job_id: jobId } });
    const { status, erro } = extractVmStatus(result.payload);
    latestStatus = status;
    await updateCollectionStatus(coletaId, status, erro);

    if (status === "CONCLUIDA") return status;
    if (status === "ERRO") {
      throw new Error(erro || "Job da VM retornou ERRO.");
    }

    await sleep(15000);
  }

  return latestStatus;
}

function sleep(ms: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function isRunningStatus(status: string | null | undefined) {
  const normalized = String(status ?? "").toUpperCase();
  return normalized === "PENDENTE" || normalized === "RODANDO";
}

function isObj(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function formatVmError(e: unknown) {
  const message = extractErrorMessage(e);
  if (/failed to fetch|network/i.test(message)) return "VM offline ou indisponível.";
  if (/401|403|api key|unauthorized|forbidden/i.test(message)) return "API key da VM inválida ou sem permissão.";
  if (/timeout/i.test(message)) return "Timeout ao chamar API da VM.";
  return message || "Erro ao chamar API da VM.";
}

function extractErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (isObj(e)) {
    const direct = e.message ?? e.error ?? e.detail ?? e.statusText;
    if (typeof direct === "string") return direct;
    if (Array.isArray(e.detail)) {
      return e.detail
        .map((item) => {
          if (!isObj(item)) return String(item);
          const loc = Array.isArray(item.loc) ? item.loc.join(".") : "";
          return `${loc ? `${loc}: ` : ""}${String(item.msg ?? item.message ?? item.type ?? "erro")}`;
        })
        .join("; ");
    }
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
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

type LeagueOption = { label: string; value: string };

const ALL_LEAGUES_VALUE = "Todos";

const LEAGUES_BY_SPORT: Record<string, LeagueOption[]> = {
  Basketball: [
    { label: "Todos", value: ALL_LEAGUES_VALUE },
    { label: "NBA", value: "https://www.flashscore.com/basketball/usa/nba/fixtures/" },
    { label: "WNBA", value: "https://www.flashscore.com/basketball/usa/wnba/fixtures/" },
  ],
  Baseball: [
    { label: "Todos", value: ALL_LEAGUES_VALUE },
    { label: "MLB", value: "https://www.flashscore.com/baseball/usa/mlb/fixtures/" },
  ],
  Hockey: [
    { label: "Todos", value: ALL_LEAGUES_VALUE },
    { label: "NHL", value: "https://www.flashscore.com/hockey/usa/nhl/fixtures/" },
  ],
  "American Football": [
    { label: "Todos", value: ALL_LEAGUES_VALUE },
    { label: "NFL", value: "https://www.flashscore.com/american-football/usa/nfl/fixtures/" },
  ],
  Futebol: [
    { label: "Todos", value: ALL_LEAGUES_VALUE },
    { label: "Austria Bundesliga", value: "https://www.flashscore.com/football/austria/bundesliga/fixtures/" },
    { label: "Belgium Jupiler Pro League", value: "https://www.flashscore.com/football/belgium/jupiler-pro-league/fixtures/" },
    { label: "Brazil Série A", value: "https://www.flashscore.com/football/brazil/serie-a-betano/fixtures/" },
    { label: "China Super League", value: "https://www.flashscore.com/football/china/super-league/fixtures/" },
    { label: "Denmark Superliga", value: "https://www.flashscore.com/football/denmark/superliga/fixtures/" },
    { label: "England Championship", value: "https://www.flashscore.com/football/england/championship/fixtures/" },
    { label: "England Premier League", value: "https://www.flashscore.com/football/england/premier-league/fixtures/" },
    { label: "Finland Veikkausliiga", value: "https://www.flashscore.com/football/finland/veikkausliiga/fixtures/" },
    { label: "France Ligue 1", value: "https://www.flashscore.com/football/france/ligue-1/fixtures/" },
    { label: "France Ligue 2", value: "https://www.flashscore.com/football/france/ligue-2/fixtures/" },
    { label: "Germany 2. Bundesliga", value: "https://www.flashscore.com/football/germany/2-bundesliga/fixtures/" },
    { label: "Germany Bundesliga", value: "https://www.flashscore.com/football/germany/bundesliga/fixtures/" },
    { label: "Greece Super League", value: "https://www.flashscore.com/football/greece/super-league/fixtures/" },
    { label: "Ireland Premier Division", value: "https://www.flashscore.com/football/ireland/premier-division/fixtures/" },
    { label: "Italy Serie A", value: "https://www.flashscore.com/football/italy/serie-a/fixtures/" },
    { label: "Italy Serie B", value: "https://www.flashscore.com/football/italy/serie-b/fixtures/" },
    { label: "Japan J1 League", value: "https://www.flashscore.com/football/japan/j1-league/fixtures/" },
    { label: "Mexico Liga MX", value: "https://www.flashscore.com/football/mexico/liga-mx/fixtures/" },
    { label: "Netherlands Eredivisie", value: "https://www.flashscore.com/football/netherlands/eredivisie/fixtures/" },
    { label: "Norway Eliteserien", value: "https://www.flashscore.com/football/norway/eliteserien/fixtures/" },
    { label: "Poland Ekstraklasa", value: "https://www.flashscore.com/football/poland/ekstraklasa/fixtures/" },
    { label: "Portugal Liga Portugal", value: "https://www.flashscore.com/football/portugal/liga-portugal/fixtures/" },
    { label: "Romania Superliga", value: "https://www.flashscore.com/football/romania/superliga/fixtures/" },
    { label: "Scotland Championship", value: "https://www.flashscore.com/football/scotland/championship/fixtures/" },
    { label: "Scotland Premiership", value: "https://www.flashscore.com/football/scotland/premiership/fixtures/" },
    { label: "Spain LaLiga", value: "https://www.flashscore.com/football/spain/laliga/fixtures/" },
    { label: "Spain LaLiga2", value: "https://www.flashscore.com/football/spain/laliga2/fixtures/" },
    { label: "Sweden Allsvenskan", value: "https://www.flashscore.com/football/sweden/allsvenskan/fixtures/" },
    { label: "Switzerland Super League", value: "https://www.flashscore.com/football/switzerland/super-league/fixtures/" },
    { label: "Turkey Super Lig", value: "https://www.flashscore.com/football/turkey/super-lig/fixtures/" },
    { label: "USA MLS", value: "https://www.flashscore.com/football/usa/mls/fixtures/" },
  ],
};

function leagueOptionsForSport(esporte: string) {
  return LEAGUES_BY_SPORT[esporte] ?? LEAGUES_BY_SPORT.Baseball;
}

function selectedLeagueValues(esporte: string, selected: string[]) {
  const values = selected.length ? selected : [ALL_LEAGUES_VALUE];
  if (values.includes(ALL_LEAGUES_VALUE)) return [];
  const validValues = new Set(leagueOptionsForSport(esporte).map((option) => option.value));
  return values.filter((value) => validValues.has(value));
}

function selectedLeagueLabels(esporte: string, selected: string[]) {
  const values = selected.length ? selected : [ALL_LEAGUES_VALUE];
  if (values.includes(ALL_LEAGUES_VALUE)) return ["Todos"];
  const labels = new Map(leagueOptionsForSport(esporte).map((option) => [option.value, option.label]));
  return values.map((value) => labels.get(value)).filter(Boolean) as string[];
}

function toggleLeague(current: string[], value: string, checked: boolean) {
  if (value === ALL_LEAGUES_VALUE) return checked ? [ALL_LEAGUES_VALUE] : [];
  const base = current.filter((item) => item !== ALL_LEAGUES_VALUE);
  if (checked) return [...new Set([...base, value])];
  const next = base.filter((item) => item !== value);
  return next.length ? next : [ALL_LEAGUES_VALUE];
}

function scraperSportName(esporte: string) {
  if (esporte === "Futebol") return "Football";
  return esporte;
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
