import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudDownload, Download, FileSpreadsheet, RefreshCw, Save, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PeriodFilter } from "@/components/period-filter";
import { dateInRange, rangeFromPeriodo, type PeriodoFiltro } from "@/lib/metrics";
import {
  downloadText,
  completeRemoteCollection,
  createRemoteCollection,
  extractNormalizedRows,
  extractRawGames,
  fetchCollections,
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
  getScrapingJobCsv,
  getScrapingJobNormalized,
  getScrapingJobRaw,
  getScrapingJobStatus,
} from "@/lib/scraper-api.functions";

export const Route = createFileRoute("/_authenticated/coleta-dados")({
  component: ColetaDadosPage,
});

function ColetaDadosPage() {
  const qc = useQueryClient();
  const [fileName, setFileName] = useState("");
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
    const rows = normalized?.rows ?? [];
    return {
      esportes: unique([...rows.map((row) => row.esporte), ...coletas.map((row) => row.esporte)]),
      ligas: unique([...rows.map((row) => row.liga), ...coletas.map((row) => row.liga)]),
      status: unique(coletas.map((row) => row.status)),
    };
  }, [normalized, coletas]);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setFileName(file.name);
    setErro(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const normalizedData = normalizeOddsJson(json, { esporte: inferSportFromFilename(file.name) });
      setRawJson(json);
      setNormalized(normalizedData);
      toast.success(`${normalizedData.total_odds} odds normalizadas`);
    } catch (e) {
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
    const { raw, normalizedData } = await carregarOddsDaVm(coleta.job_id, coleta.esporte, setRemoteStatus);

    setRemoteStatus("Salvando odds no banco...");
    const imported = await completeRemoteCollection(coleta.id, raw, normalizedData);
    await qc.invalidateQueries({ queryKey: ["coletas-odds"] });
    setRawJson(raw);
    setNormalized(normalizedData);
    toast.success(`${imported.inserted} odds importadas da VM${imported.duplicated ? ` (${imported.duplicated} duplicadas ignoradas)` : ""}`);
  };

  const executarColeta = async () => {
    setRemoteBusy("pipeline");
    setRemoteStatus("Criando job na VM...");
    setErro(null);
    let coletaCriada: ColetaOdds | null = null;
    try {
      const selectedLeagues = selectedLeagueValues(remoteParams.esporte, remoteParams.leagues);
      const scraperPayload = {
        esporte: scraperSportName(remoteParams.esporte),
        source: "OddsAgora",
        leagues: selectedLeagues.length === 0 ? defaultLeagueValues(remoteParams.esporte) : selectedLeagues,
        mercados: defaultMarketsForSport(remoteParams.esporte),
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
        mercados: scraperPayload.mercados,
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
      const { raw, normalizedData } = await carregarOddsDaVm(coleta.job_id, coleta.esporte, setRemoteStatus);
      if (!normalizedData.total_odds) {
        throw new Error("JSON retornado pela VM não gerou odds normalizadas.");
      }
      const imported = await completeRemoteCollection(coleta.id, raw, normalizedData);
      await qc.invalidateQueries({ queryKey: ["coletas-odds"] });
      setRawJson(raw);
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

  const baixarCsvVm = async (coleta: ColetaOdds) => {
    if (!coleta.job_id) return;
    setRemoteBusy(`csv:${coleta.id}`);
    setErro(null);
    try {
      const result = await getScrapingJobCsv({ data: { job_id: coleta.job_id } });
      downloadText(`coleta_odds_${coleta.job_id}.csv`, result.csv, "text/csv;charset=utf-8");
      toast.success("CSV da coleta baixado");
    } catch (e) {
      const message = formatVmError(e);
      setErro(message);
      toast.error(message);
    } finally {
      setRemoteBusy(null);
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

  const exportRows: NormalizedOdd[] = normalized?.rows ?? [];
  const visibleCollections = filteredCollections.slice(0, 10);

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
              {remoteBusy === "pipeline" ?"Coletando..." : "Executar Coleta"}
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
        <CardContent className="space-y-3">
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

      <Card>
          <CardHeader>
            <CardTitle className="text-base">Histórico de coletas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto rounded-md border">
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
                  {visibleCollections.map((coleta) => (
                    <tr key={coleta.id} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs">{coleta.created_at.slice(0, 10)}</td>
                      <td className="px-3 py-2"><Badge variant={coleta.erro ?"destructive" : "outline"}>{coleta.status}</Badge></td>
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
                          <Button size="sm" variant="outline" disabled={!coleta.job_id || coleta.status !== "CONCLUIDA" || remoteBusy === `csv:${coleta.id}`} onClick={() => baixarCsvVm(coleta)}>
                            <Download className="mr-1 h-3 w-3" /> Baixar CSV
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!filteredCollections.length && <EmptyRow cols={8} />}
                </tbody>
              </table>
            </div>
            {filteredCollections.length > 10 && (
              <p className="mt-2 text-xs text-muted-foreground">Exibindo 10 de {filteredCollections.length} coletas filtradas.</p>
            )}
          </CardContent>
        </Card>
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
  const selectedSet = new Set(selected.length ?selected : ["Todos"]);

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
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={type === "date" ?"[color-scheme:dark] text-foreground" : undefined}
      />
    </div>
  );
}

function extractVmStatus(payload: unknown) {
  const root = isObj(payload) ?payload : {};
  const data = isObj(root.data) ?root.data : isObj(root.result) ?root.result : root;
  const raw = String(data.status ?? data.state ?? data.situacao ?? "").toUpperCase();
  const erro = data.erro ?? data.error ?? data.message;
  const status =
    raw.includes("RUN") || raw.includes("ROD") || raw.includes("PROCESS")
      ?"RODANDO"
      : raw.includes("DONE") || raw.includes("CONCL") || raw.includes("SUCCESS") || raw.includes("FINISH")
        ?"CONCLUIDA"
        : raw.includes("ERR") || raw.includes("FAIL")
          ?"ERRO"
          : raw.includes("PEND") || raw.includes("QUEUE")
            ?"PENDENTE"
            : raw || "PENDENTE";
  return { status, erro: erro ?String(erro) : null };
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

async function carregarOddsDaVm(
  jobId: string,
  esporte: string | null,
  onStatus?: (status: string) => void,
) {
  const normalizedResult = await getScrapingJobNormalized({ data: { job_id: jobId } });
  const normalizedRaw = normalizedResult.normalized_json;
  console.log("Normalized payload:", normalizedRaw);
  const normalizedRows = extractNormalizedRows(normalizedRaw);
  assertTotalLinhasMatches("/normalized", normalizedRaw, normalizedRows);
  const normalizedData = normalizeVmNormalizedPayload(normalizedRaw, { esporte });
  if (normalizedData.total_odds) {
    return { raw: normalizedRaw, normalizedData };
  }

  onStatus?.("Normalizado veio vazio; tentando importar a partir do JSON bruto da VM...");
  const rawResult = await getScrapingJobRaw({ data: { job_id: jobId } });
  const raw = rawResult.raw_json;
  console.log("Raw payload:", raw);
  const rawGames = extractRawGames(raw);
  const rawNormalizedData = normalizeVmNormalizedPayload(raw, { esporte });
  if (rawNormalizedData.total_odds) {
    return { raw, normalizedData: rawNormalizedData };
  }

  const normalizedKeys = payloadKeys(normalizedRaw);
  const rawKeys = payloadKeys(raw);
  const declaredTotal = payloadNumber(normalizedRaw, "total_linhas");
  const legacyFlashScoreHint =
    isObj(raw) && "_default" in raw && !("source" in raw)
      ? "\n\nDiagnostico: o raw veio com _default e sem source=OddsAgora. Isso indica que a VM ainda executou o fluxo legado/FlashScore, ou ainda nao recebeu/deployou a versao do scraper OddsAgora."
      : "";
  if ((declaredTotal ?? 0) > 0 && normalizedRows.length) {
    throw new Error(
      `Payload recebido da VM em /normalized contem ${normalizedRows.length} linhas (total_linhas=${declaredTotal}), mas nenhuma odd importavel foi gerada. Verifique aliases de odd/mercado/pick no normalizador. Chaves disponiveis: normalized: ${normalizedKeys}; raw: ${rawKeys}.${legacyFlashScoreHint}`,
    );
  }
  throw new Error(
    `Payload recebido da VM, porem nenhum formato reconhecido foi encontrado.\n\nChaves disponiveis:\nnormalized: ${normalizedKeys}\nraw: ${rawKeys}\n\nTotais detectados: normalized.linhas=${normalizedRows.length}; raw.jogos=${rawGames.length}.${legacyFlashScoreHint}`,
  );
}

function assertTotalLinhasMatches(label: string, payload: unknown, rows: unknown[]) {
  const totalLinhas = payloadNumber(payload, "total_linhas");
  if (totalLinhas == null || !rows.length) return;
  if (rows.length !== totalLinhas) {
    throw new Error(
      `${label} retornou total_linhas=${totalLinhas}, mas a lista reconhecida tem ${rows.length} linhas. Persistencia interrompida para evitar importacao parcial.`,
    );
  }
}

function payloadNumber(payload: unknown, key: string): number | null {
  if (!isObj(payload)) return null;
  const value = payload[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function payloadKeys(payload: unknown) {
  if (Array.isArray(payload)) return `array(${payload.length})`;
  if (isObj(payload)) return Object.keys(payload).slice(0, 20).join(", ") || "(objeto vazio)";
  return typeof payload;
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
          const loc = Array.isArray(item.loc) ?item.loc.join(".") : "";
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
const ODDSAGORA_MLB_URL = "https://www.oddsagora.com.br/baseball/usa/mlb/";
const DEFAULT_ODDSAGORA_MARKETS = ["home-away", "over-under", "ah"];
const DEFAULT_ODDSAGORA_FOOTBALL_MARKETS = ["1x2", "over-under", "ah"];

const LEAGUES_BY_SPORT: Record<string, LeagueOption[]> = {
  Basketball: [
    { label: "Todos", value: ALL_LEAGUES_VALUE },
    { label: "WNBA", value: "https://www.oddsagora.com.br/basketball/usa/wnba/" },
    { label: "NBA", value: "https://www.oddsagora.com.br/basketball/usa/nba/" },
  ],
  Baseball: [
    { label: "Todos", value: ALL_LEAGUES_VALUE },
    { label: "MLB", value: ODDSAGORA_MLB_URL },
  ],
  Hockey: [
    { label: "Todos", value: ALL_LEAGUES_VALUE },
    { label: "NHL", value: "https://www.oddsagora.com.br/hockey/usa/nhl/" },
  ],
  "American Football": [
    { label: "Todos", value: ALL_LEAGUES_VALUE },
    { label: "NFL", value: "https://www.oddsagora.com.br/american-football/usa/nfl/" },
    { label: "NCAA", value: "https://www.oddsagora.com.br/american-football/usa/ncaa/" },
  ],
  Futebol: [
    { label: "Todos", value: ALL_LEAGUES_VALUE },
    { label: "Germany 2. Bundesliga", value: "https://www.oddsagora.com.br/football/germany/2-bundesliga" },
    { label: "Germany Bundesliga", value: "https://www.oddsagora.com.br/football/germany/bundesliga" },
    { label: "Austria Bundesliga", value: "https://www.oddsagora.com.br/football/austria/bundesliga" },
    { label: "Brazil Brasileirão Betano", value: "https://www.oddsagora.com.br/football/brazil/brasileirao-betano" },
    { label: "China Superliga", value: "https://www.oddsagora.com.br/football/china/superliga" },
    { label: "Denmark Superliga", value: "https://www.oddsagora.com.br/football/denmark/superliga" },
    { label: "England Premier League", value: "https://www.oddsagora.com.br/football/england/campeonato-ingles" },
    { label: "England Championship", value: "https://www.oddsagora.com.br/football/england/2-divisao" },
    { label: "Finland Veikkausliiga", value: "https://www.oddsagora.com.br/football/finland/veikkausliiga" },
    { label: "France Ligue 1", value: "https://www.oddsagora.com.br/football/france/ligue-1" },
    { label: "France Ligue 2", value: "https://www.oddsagora.com.br/football/france/ligue-2" },
    { label: "Ireland Premier Division", value: "https://www.oddsagora.com.br/football/ireland/divisao-premier" },
    { label: "Italy Serie A", value: "https://www.oddsagora.com.br/football/italy/serie-a" },
    { label: "Italy Serie B", value: "https://www.oddsagora.com.br/football/italy/serie-b" },
    { label: "Mexico Liga MX", value: "https://www.oddsagora.com.br/football/mexico/liga-mx" },
    { label: "Netherlands Eredivisie", value: "https://www.oddsagora.com.br/football/netherlands/eredivisie" },
    { label: "Norway Eliteserien", value: "https://www.oddsagora.com.br/football/norway/serie-de-elite/" },
    { label: "Poland Ekstraklasa", value: "https://www.oddsagora.com.br/football/poland/ekstraklasa" },
    { label: "Portugal Liga Portugal", value: "https://www.oddsagora.com.br/football/portugal/liga-portugal" },
    { label: "Romania Superliga", value: "https://www.oddsagora.com.br/football/romania/superliga/" },
    { label: "Scotland Premiership", value: "https://www.oddsagora.com.br/football/scotland/primeira-liga/" },
    { label: "Spain LaLiga", value: "https://www.oddsagora.com.br/football/spain/laliga/" },
    { label: "Spain LaLiga2", value: "https://www.oddsagora.com.br/football/spain/laliga2/" },
    { label: "Sweden Allsvenskan", value: "https://www.oddsagora.com.br/football/sweden/allsvenskan" },
    { label: "Switzerland Superliga", value: "https://www.oddsagora.com.br/football/switzerland/superliga/" },
    { label: "Turkey Super Lig", value: "https://www.oddsagora.com.br/football/turkey/super-lig/" },
    { label: "USA MLS", value: "https://www.oddsagora.com.br/football/usa/mls/" },
  ],
};

function leagueOptionsForSport(esporte: string) {
  return LEAGUES_BY_SPORT[esporte] ?? LEAGUES_BY_SPORT.Baseball;
}

function selectedLeagueValues(esporte: string, selected: string[]) {
  const values = selected.length ?selected : [ALL_LEAGUES_VALUE];
  if (values.includes(ALL_LEAGUES_VALUE)) return [];
  const validValues = new Set(leagueOptionsForSport(esporte).map((option) => option.value));
  return values.filter((value) => validValues.has(value));
}

function selectedLeagueLabels(esporte: string, selected: string[]) {
  const values = selected.length ?selected : [ALL_LEAGUES_VALUE];
  if (values.includes(ALL_LEAGUES_VALUE)) return ["Todos"];
  const labels = new Map(leagueOptionsForSport(esporte).map((option) => [option.value, option.label]));
  return values.map((value) => labels.get(value)).filter(Boolean) as string[];
}

function defaultLeagueValues(esporte: string) {
  return leagueOptionsForSport(esporte)
    .map((option) => option.value)
    .filter((value) => value !== ALL_LEAGUES_VALUE);
}

function defaultMarketsForSport(esporte: string) {
  return esporte === "Futebol" ? DEFAULT_ODDSAGORA_FOOTBALL_MARKETS : DEFAULT_ODDSAGORA_MARKETS;
}

function toggleLeague(current: string[], value: string, checked: boolean) {
  if (value === ALL_LEAGUES_VALUE) return checked ?[ALL_LEAGUES_VALUE] : [];
  const base = current.filter((item) => item !== ALL_LEAGUES_VALUE);
  if (checked) return [...new Set([...base, value])];
  const next = base.filter((item) => item !== value);
  return next.length ?next : [ALL_LEAGUES_VALUE];
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
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("odds");
  const cleaned = rows.map(({ raw_ref: _raw, ...row }) => row);
  if (cleaned.length) {
    const keys = Object.keys(cleaned[0]);
    ws.columns = keys.map((k) => ({ header: k, key: k }));
    ws.addRows(cleaned as Record<string, unknown>[]);
  }
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileName.replace(/\.json$/i, "") || "coleta_odds"}_normalizado.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
