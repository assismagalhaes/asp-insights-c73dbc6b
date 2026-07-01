import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Database, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  addBaseLine,
  createBaseSeason,
  getBaseTeamLastLines,
  getBaseTeams,
  getBaseYears,
  removeBaseLastLine,
  validateBaseLine,
} from "@/lib/scraper-api.functions";

export const Route = createFileRoute("/_authenticated/base-dados")({
  component: BaseDadosPage,
});

type SportKey =
  | "baseball"
  | "basketball"
  | "hockey"
  | "american-football"
  | "football"
  | "football-goals"
  | "football-corners";

type BaseballYear = {
  ano: number;
  pasta?: string;
  total_csvs?: number;
  label?: string;
};

type BaseballYearDetail = {
  ano: number;
  total_csvs?: number;
};

type BaseballTeam = {
  sigla: string;
  nome: string;
  label?: string;
  arquivo?: string;
  caminho?: string;
};

type ValidationResult = {
  ok?: boolean;
  valida?: boolean;
  valido?: boolean;
  valid?: boolean;
  erros?: string[];
  avisos?: string[];
  linha?: string | string[];
  arquivo?: string;
  liga?: string;
  ano?: number;
  sigla?: string;
  sigla_time?: string;
  basic_identificado?: boolean;
  advanced_identificado?: boolean;
  registros_identificados?: number;
};

type OperationResult = {
  ok?: boolean;
  status?: string;
  mensagem?: string;
  esporte?: string;
  liga?: string;
  ano?: number;
  ano_destino?: number;
  ano_origem?: number;
  sigla?: string;
  sigla_time?: string;
  nome_time?: string;
  arquivo?: string;
  backup?: string;
  stdout?: string;
  stderr?: string;
  arquivos_criados?: number;
  registros_lidos?: number;
  registros_identificados?: number;
  registros_basicos_importados?: number;
  registros_avancados_importados?: number;
  erros_ignorados?: number | string[] | string;
  arquivo_merged?: string;
  raw_salvo?: string;
  log_salvo?: string;
  linha_adicionada?: string | string[];
  linha_removida?: string | string[];
};

type LastLinesResult = {
  cabecalho: string | null;
  linhas: string[];
};

const SPORTS: Array<{ value: SportKey; label: string }> = [
  { value: "baseball", label: "Baseball" },
  { value: "basketball", label: "Basketball" },
  { value: "hockey", label: "Hockey" },
  { value: "american-football", label: "American Football" },
  { value: "football", label: "Futebol" },
  { value: "football-goals", label: "ASP GoalMatrix" },
  { value: "football-corners", label: "ASP CornerMatrix" },
];

const LEAGUES_BY_SPORT: Record<SportKey, Array<{ value: string; label: string }>> = {
  baseball: [{ value: "MLB", label: "MLB" }],
  basketball: [
    { value: "NBA", label: "NBA" },
    { value: "WNBA", label: "WNBA" },
  ],
  hockey: [{ value: "NHL", label: "NHL" }],
  "american-football": [{ value: "NFL", label: "NFL" }],
  football: [{ value: "Futebol", label: "Futebol" }],
  "football-goals": [{ value: "Futebol - Gols", label: "Futebol - Gols" }],
  "football-corners": [{ value: "Futebol - Escanteios", label: "Futebol - Escanteios" }],
};

const CURRENT_BASKETBALL_SEASON_YEAR = 2026;

const BASKETBALL_TEAM_NAMES: Record<"nba" | "wnba", Record<string, string>> = {
  nba: {
    ATL: "Atlanta Hawks",
    BOS: "Boston Celtics",
    BRK: "Brooklyn Nets",
    CHO: "Charlotte Hornets",
    CHI: "Chicago Bulls",
    CLE: "Cleveland Cavaliers",
    DAL: "Dallas Mavericks",
    DEN: "Denver Nuggets",
    DET: "Detroit Pistons",
    GSW: "Golden State Warriors",
    HOU: "Houston Rockets",
    IND: "Indiana Pacers",
    LAC: "Los Angeles Clippers",
    LAL: "Los Angeles Lakers",
    MEM: "Memphis Grizzlies",
    MIA: "Miami Heat",
    MIL: "Milwaukee Bucks",
    MIN: "Minnesota Timberwolves",
    NOP: "New Orleans Pelicans",
    NYK: "New York Knicks",
    OKC: "Oklahoma City Thunder",
    ORL: "Orlando Magic",
    PHI: "Philadelphia 76ers",
    PHO: "Phoenix Suns",
    POR: "Portland Trail Blazers",
    SAC: "Sacramento Kings",
    SAS: "San Antonio Spurs",
    TOR: "Toronto Raptors",
    UTA: "Utah Jazz",
    WAS: "Washington Wizards",
  },
  wnba: {
    ATL: "Atlanta Dream W",
    CHI: "Chicago Sky W",
    CON: "Connecticut Sun W",
    DAL: "Dallas Wings W",
    GSV: "Golden State Valkyries W",
    IND: "Indiana Fever W",
    LVA: "Las Vegas Aces W",
    LAS: "Los Angeles Sparks W",
    MIN: "Minnesota Lynx W",
    NYL: "New York Liberty W",
    PHO: "Phoenix Mercury W",
    SEA: "Seattle Storm W",
    WAS: "Washington Mystics W",
    TOR: "Toronto Tempo W",
    POR: "Portland Fire W",
  },
};

function BaseDadosPage() {
  const getYears = useServerFn(getBaseYears);
  const getTeams = useServerFn(getBaseTeams);
  const getLastLines = useServerFn(getBaseTeamLastLines);
  const validateLine = useServerFn(validateBaseLine);
  const addLine = useServerFn(addBaseLine);
  const removeLastLine = useServerFn(removeBaseLastLine);
  const createSeason = useServerFn(createBaseSeason);

  const [sport, setSport] = useState<SportKey | "">("");
  const [league, setLeague] = useState("");
  const [years, setYears] = useState<BaseballYear[]>([]);
  const [year, setYear] = useState("");
  const [teams, setTeams] = useState<BaseballTeam[]>([]);
  const [team, setTeam] = useState("");
  const [line, setLine] = useState("");
  const [lastLines, setLastLines] = useState<string[]>([]);
  const [lastLinesHeader, setLastLinesHeader] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [operation, setOperation] = useState<OperationResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [seasonDialog, setSeasonDialog] = useState(false);
  const [seasonSport, setSeasonSport] = useState<"baseball" | "basketball">("baseball");
  const [seasonLeague, setSeasonLeague] = useState("MLB");
  const [seasonOriginYear, setSeasonOriginYear] = useState("");
  const [seasonTargetYear, setSeasonTargetYear] = useState("");
  const [scraperUnavailable, setScraperUnavailable] = useState(false);

  const leagues = sport ? LEAGUES_BY_SPORT[sport] : [];
  const isBaseballMlb = sport === "baseball" && league === "MLB";
  const isBasketball = sport === "basketball" && ["NBA", "WNBA"].includes(league);
  const isIntegratedBase = isBaseballMlb || isBasketball;
  const apiSport: "baseball" | "basketball" = sport === "basketball" ? "basketball" : "baseball";
  const apiLeague = league.toLowerCase() as "mlb" | "nba" | "wnba";
  const maxYear = years.length ? Math.max(...years.map((item) => item.ano)) : null;
  const selectedYear = year ? Number(year) : null;
  const selectedTeam = teams.find((item) => item.sigla === team) ?? null;
  const selectedBasketballSeasonStatus = isBasketball && selectedYear ? getBasketballSeasonStatus(selectedYear) : null;
  const isHistoricalYear = Boolean(
    selectedYear &&
    (isBasketball ? selectedBasketballSeasonStatus === "closed" : maxYear && selectedYear < maxYear),
  );
  const canValidate = Boolean(isIntegratedBase && selectedYear && team && line.trim() && !busy);
  const canAdd = Boolean(canValidate && validation && isValidationSuccess(validation));
  const canRemove = Boolean(isIntegratedBase && selectedYear && team && !busy);

  useEffect(() => {
    if (!sport) {
      setLeague("");
      return;
    }
    const first = LEAGUES_BY_SPORT[sport][0]?.value ?? "";
    setLeague(first);
  }, [sport]);

  useEffect(() => {
    setYears([]);
    setYear("");
    resetTeamState();
    if (!isIntegratedBase) return;

    let cancelled = false;
    setBusy("years");
    getYears({ data: { esporte: apiSport, liga: apiLeague } })
      .then(async (payload) => {
        if (cancelled) return;
        const parsed = parseYears(payload);
        const resolved = isBasketball ? await hydrateYearCounts(parsed, apiSport, apiLeague) : parsed;
        if (cancelled) return;
        setYears(resolved);
        const defaultYear = isBasketball && resolved.some((item) => item.ano === CURRENT_BASKETBALL_SEASON_YEAR)
          ? CURRENT_BASKETBALL_SEASON_YEAR
          : resolved.length ? Math.max(...resolved.map((item) => item.ano)) : null;
        setYear(defaultYear ? String(defaultYear) : "");
        if (!parsed.length) toast.warning(`A VM respondeu, mas nao retornou anos de base ${league}.`);
      })
      .catch((e) => toast.error(formatError(e)))
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isIntegratedBase, apiSport, apiLeague, league]);

  useEffect(() => {
    resetTeamState();
    if (!isIntegratedBase || !selectedYear) return;

    let cancelled = false;
    setBusy("teams");
    getTeams({ data: { esporte: apiSport, liga: apiLeague, ano: selectedYear } })
      .then((payload) => {
        if (cancelled) return;
        const parsed = parseTeams(payload, apiLeague);
        setTeams(parsed);
        if (!parsed.length) toast.warning(`A VM respondeu, mas nao retornou times ${league} para ${selectedYear}.`);
      })
      .catch((e) => toast.error(formatError(e)))
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isIntegratedBase, selectedYear, apiSport, apiLeague, league]);

  useEffect(() => {
    setLastLines([]);
    setLastLinesHeader(null);
    setValidation(null);
    setOperation(null);
    if (!isIntegratedBase || !selectedYear || !team) return;
    void loadLastLines(selectedYear, team);
  }, [isIntegratedBase, selectedYear, team]);

  const placeholderMessage = useMemo(() => {
    if (!sport) return "Selecione um esporte/modelo para carregar a base de dados.";
    if (!isIntegratedBase) return "Base ainda não integrada à API. Integração prevista para etapa futura.";
    return null;
  }, [sport, isIntegratedBase]);

  function resetTeamState() {
    setTeams([]);
    setTeam("");
    setLine("");
    setLastLines([]);
    setLastLinesHeader(null);
    setValidation(null);
    setOperation(null);
  }

  async function loadLastLines(ano: number, sigla: string) {
    setBusy("last-lines");
    try {
      const payload = await getLastLines({ data: { esporte: apiSport, liga: apiLeague, ano, sigla, limite: 10 } });
      const parsed = parseLastLines(payload);
      setLastLinesHeader(parsed.cabecalho);
      setLastLines(parsed.linhas);
      return parsed;
    } catch (e) {
      toast.error(formatError(e));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function refreshLastLinesAfterMutation(ano: number, sigla: string, optimisticLine?: string) {
    let latest: LastLinesResult | null = null;
    for (const waitMs of [250, 750, 1500]) {
      await delay(waitMs);
      latest = await loadLastLines(ano, sigla);
    }
    if (optimisticLine && latest && !hasEquivalentLine(latest.linhas, optimisticLine)) {
      setLastLines([...latest.linhas, optimisticLine].slice(-10));
    } else if (optimisticLine && !latest) {
      setLastLines((current) => [...current, optimisticLine].slice(-10));
    }
  }

  async function hydrateYearCounts(items: BaseballYear[], esporte: "baseball" | "basketball", liga: "mlb" | "nba" | "wnba") {
    return Promise.all(
      items.map(async (item) => {
        if (Number(item.total_csvs ?? 0) > 0) return item;
        try {
          const payload = await getTeams({ data: { esporte, liga, ano: item.ano } });
          const total = parseTeams(payload, liga).length;
          return total > 0 ? { ...item, total_csvs: total, label: undefined } : item;
        } catch {
          return item;
        }
      }),
    );
  }

  async function handleValidate() {
    if (!selectedYear || !team || !line.trim()) {
      toast.error("Informe ano, time e linha antes de validar.");
      return;
    }
    setBusy("validate");
    setOperation(null);
    try {
      const payload = await validateLine({ data: { esporte: apiSport, liga: apiLeague, ano: selectedYear, sigla: team, linha: parseLineForBase(line, isBasketball) } });
      const result = payload as ValidationResult;
      result.valida = isValidationSuccess(result);
      setValidation(result);
      if (isValidationSuccess(result)) toast.success("Linha validada com sucesso.");
      else toast.error("A linha possui erros de validação.");
    } catch (e) {
      toast.error(formatError(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleAdd() {
    if (!canAdd || !selectedYear || !team) return;
    setBusy("add");
    try {
      const parsedLine = parseLineForBase(line, isBasketball);
      const payload = await addLine({ data: { esporte: apiSport, liga: apiLeague, ano: selectedYear, sigla: team, linha: parsedLine } });
      const result = payload as OperationResult;
      setValidation(null);
      setOperation(result);
      if (!isAddOperationSuccess(result, isBasketball)) {
        toast.error(getOperationErrorMessage(result));
        return;
      }
      toast.success(`Linha adicionada à base ${league}.`);
      await refreshLastLinesAfterMutation(selectedYear, team, formatLineValue(parsedLine));
    } catch (e) {
      toast.error(formatError(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove() {
    if (!canRemove || !selectedYear || !team) return;
    setConfirmRemove(false);
    setBusy("remove");
    try {
      const payload = await removeLastLine({ data: { esporte: apiSport, liga: apiLeague, ano: selectedYear, sigla: team } });
      setOperation(payload as OperationResult);
      setValidation(null);
      toast.success(`Última linha removida da base ${league}.`);
      await loadLastLines(selectedYear, team);
    } catch (e) {
      toast.error(formatError(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleCreateSeason() {
    const targetYear = Number(seasonTargetYear);
    const originYear = Number(seasonOriginYear);
    if (!Number.isFinite(targetYear) || targetYear < 2000 || targetYear > 2100) {
      toast.error("Informe um ano destino válido.");
      return;
    }
    if (seasonSport === "basketball" && (!Number.isFinite(originYear) || originYear < 2000 || originYear > 2100)) {
      toast.error("Informe o ano origem/schema para Basketball.");
      return;
    }
    setBusy("create-season");
    try {
      const payload = await createSeason({
        data: {
          esporte: seasonSport,
          liga: seasonLeague.toLowerCase() as "mlb" | "nba" | "wnba",
          ano_destino: targetYear,
          ...(seasonSport === "basketball" ? { ano_origem: originYear } : {}),
        },
      });
      setOperation(payload as OperationResult);
      setSeasonDialog(false);
      setSport(seasonSport);
      setLeague(seasonLeague);
      setYear(String(targetYear));
      toast.success("Temporada criada/atualizada com sucesso.");
      const refreshed = await getYears({ data: { esporte: seasonSport, liga: seasonLeague.toLowerCase() as "mlb" | "nba" | "wnba" } });
      const parsedYears = parseYears(refreshed);
      setYears(seasonSport === "basketball"
        ? await hydrateYearCounts(parsedYears, seasonSport, seasonLeague.toLowerCase() as "mlb" | "nba" | "wnba")
        : parsedYears);
    } catch (e) {
      toast.error(formatError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Database className="h-6 w-6 text-primary" />
          Base de Dados
        </h1>
        <p className="text-sm text-muted-foreground">
          Atualização e consulta das bases históricas dos modelos esportivos via API da VM.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(320px,420px)_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filtros e operação</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <Field label="Esporte/modelo">
                <Select
                  value={sport}
                  onValueChange={(value) => {
                    setSport(value as SportKey);
                    setLeague("");
                    setYear("");
                    setLine("");
                    resetTeamState();
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {SPORTS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Liga/modelo específico">
                <Select value={league} onValueChange={setLeague} disabled={!sport}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {leagues.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {placeholderMessage ? (
              <div className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                {placeholderMessage}
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <Field label="Ano da base">
                    <div className="flex gap-2">
                    <Select
                      value={year}
                      onValueChange={(value) => {
                        setYear(value);
                        resetTeamState();
                      }}
                      disabled={busy === "years" || !years.length}
                    >
                      <SelectTrigger><SelectValue placeholder={busy === "years" ? "Carregando..." : years.length ? "Ano" : "Nenhum ano encontrado"} /></SelectTrigger>
                      <SelectContent>
                        {years.map((item) => (
                          <SelectItem key={item.ano} value={String(item.ano)}>
                            {formatYearOption(item, isBasketball)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => {
                        setSeasonSport(apiSport as "baseball" | "basketball");
                        setSeasonLeague(league || (apiSport === "basketball" ? "NBA" : "MLB"));
                        setSeasonOriginYear(String(selectedYear ?? maxYear ?? ""));
                        setSeasonTargetYear("");
                        setSeasonDialog(true);
                      }}
                    >
                      + Nova Temporada
                    </Button>
                    </div>
                  </Field>

                  <Field label={isBasketball ? `Time ${league}` : "Time MLB"}>
                    <Select value={team} onValueChange={setTeam} disabled={busy === "teams" || !teams.length}>
                      <SelectTrigger><SelectValue placeholder={busy === "teams" ? "Carregando..." : teams.length ? "Selecione o time" : "Nenhum time encontrado"} /></SelectTrigger>
                      <SelectContent>
                        {teams.map((item) => (
                          <SelectItem key={item.sigla} value={item.sigla}>
                            {item.label || item.nome || item.sigla}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                {isHistoricalYear && (
                  <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>Atenção: você está visualizando/editando uma base histórica de ano encerrado. Altere apenas se tiver certeza.</span>
                  </div>
                )}

                <Field label="Linha a adicionar">
                  <Textarea
                    rows={6}
                    value={line}
                    onChange={(e) => {
                      setLine(e.target.value);
                      setValidation(null);
                      setOperation(null);
                    }}
                    placeholder={getLinePlaceholder(isBasketball, league)}
                  />
                </Field>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={handleValidate} disabled={!canValidate}>
                    {busy === "validate" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                    Validar Linha
                  </Button>
                  <Button onClick={handleAdd} disabled={!canAdd}>
                    {busy === "add" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Adicionar Linha
                  </Button>
                  <Button variant="destructive" onClick={() => setConfirmRemove(true)} disabled={!canRemove}>
                    {busy === "remove" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                    Remover Última Linha
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <CardTitle className="text-base">Últimas linhas do time</CardTitle>
              <Button
                size="sm"
                variant="outline"
                disabled={!selectedYear || !team || busy === "last-lines"}
                onClick={() => selectedYear && team && loadLastLines(selectedYear, team)}
              >
                {busy === "last-lines" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                Atualizar
              </Button>
            </CardHeader>
            <CardContent>
              {selectedTeam && (
                <div className="mb-3 flex flex-wrap gap-2 text-sm">
                  <Badge variant="outline">{selectedTeam.sigla}</Badge>
                  <span className="text-muted-foreground">{selectedTeam.nome}</span>
                </div>
              )}
              {lastLines.length ? (
                <div className="max-h-[420px] space-y-2 overflow-auto rounded-md border border-border bg-background/50 p-3">
                  {lastLinesHeader && (
                    <pre className="whitespace-pre-wrap rounded border border-border/70 bg-muted/60 p-2 font-mono text-xs text-muted-foreground">
                      {lastLinesHeader}
                    </pre>
                  )}
                  {lastLines.map((item, index) => (
                    <pre key={`${index}-${item}`} className="whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono text-xs">
                      {item}
                    </pre>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
                  {team ? "Nenhuma linha carregada para este time." : "Selecione um time para consultar as últimas linhas."}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resultado da operação</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {validation && <ValidationPanel validation={validation} />}
              {operation && <OperationPanel operation={operation} />}
              {!validation && !operation && (
                <div className="rounded-md border border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
                  Valide, adicione ou remova uma linha para ver o retorno da API.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover última linha?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover a última linha da base de {selectedTeam?.nome ?? team}? Essa ação altera o CSV histórico, mas um backup será criado automaticamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemove}>Remover última linha</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={seasonDialog} onOpenChange={setSeasonDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar Nova Temporada</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Esporte/modelo">
                <Select
                  value={seasonSport}
                  onValueChange={(value) => {
                    const nextSport = value as "baseball" | "basketball";
                    setSeasonSport(nextSport);
                    setSeasonLeague(nextSport === "basketball" ? "NBA" : "MLB");
                    setSeasonOriginYear("");
                    setSeasonTargetYear("");
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="baseball">Baseball</SelectItem>
                    <SelectItem value="basketball">Basketball</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Liga/modelo especifico">
                <Select value={seasonLeague} onValueChange={setSeasonLeague}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {seasonSport === "basketball" ? (
                      <>
                        <SelectItem value="NBA">NBA</SelectItem>
                        <SelectItem value="WNBA">WNBA</SelectItem>
                      </>
                    ) : (
                      <SelectItem value="MLB">MLB</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {seasonSport === "basketball" && (
              <Field label="Ano origem/schema">
                <Select value={seasonOriginYear} onValueChange={setSeasonOriginYear}>
                  <SelectTrigger><SelectValue placeholder={years.length ? "Selecione o ano origem" : "Informe manualmente abaixo"} /></SelectTrigger>
                  <SelectContent>
                    {years.map((item) => (
                      <SelectItem key={`origin-${item.ano}`} value={String(item.ano)}>
                        {item.ano}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!years.length && (
                  <Input
                    className="mt-2"
                    inputMode="numeric"
                    value={seasonOriginYear}
                    onChange={(event) => setSeasonOriginYear(event.target.value)}
                    placeholder="Ex.: 2025"
                  />
                )}
              </Field>
            )}

            <Field label="Ano da nova temporada">
              <Input
                inputMode="numeric"
                value={seasonTargetYear}
                onChange={(event) => setSeasonTargetYear(event.target.value)}
                placeholder="Ex.: 2027"
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSeasonDialog(false)}>Cancelar</Button>
            <Button onClick={handleCreateSeason} disabled={busy === "create-season"}>
              {busy === "create-season" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Criar temporada
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ValidationPanel({ validation }: { validation: ValidationResult }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant={validation.valida ? "outline" : "destructive"}>{validation.valida ? "Válida" : "Inválida"}</Badge>
        {validation.arquivo && <span className="text-xs text-muted-foreground">{validation.arquivo}</span>}
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        {validation.liga && <Info label="Liga" value={validation.liga} />}
        {validation.ano && <Info label="Ano" value={validation.ano} />}
        {validation.registros_identificados != null && <Info label="Registros identificados" value={validation.registros_identificados} />}
        {validation.basic_identificado != null && <Info label="Basic identificado" value={validation.basic_identificado ? "Sim" : "Nao"} />}
        {validation.advanced_identificado != null && <Info label="Advanced identificado" value={validation.advanced_identificado ? "Sim" : "Nao"} />}
      </div>
      <MessageList title="Erros" items={validation.erros ?? []} tone="bad" />
      <MessageList title="Avisos" items={validation.avisos ?? []} tone="warn" />
      {validation.linha && <InfoBlock title="Linha validada" value={validation.linha} />}
    </div>
  );
}

function OperationPanel({ operation }: { operation: OperationResult }) {
  const hasRuntimeError = textIncludesRuntimeError(operation.stderr) || textIncludesRuntimeError(operation.stdout);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant={operation.status === "ok" && !hasRuntimeError ? "outline" : "destructive"}>
          {hasRuntimeError ? "erro" : operation.status ?? "retorno"}
        </Badge>
        {operation.mensagem && <span className="text-sm">{operation.mensagem}</span>}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <Info label="Esporte" value={operation.esporte ?? "-"} />
        <Info label="Liga" value={operation.liga ?? "-"} />
        <Info label="Ano" value={operation.ano ?? "-"} />
        <Info label="Ano destino" value={operation.ano_destino ?? "-"} />
        <Info label="Ano origem" value={operation.ano_origem ?? "-"} />
        <Info label="Time" value={operation.nome_time ?? operation.sigla ?? operation.sigla_time ?? "-"} />
        <Info label="Arquivos criados" value={operation.arquivos_criados ?? "-"} />
        <Info label="Registros lidos" value={operation.registros_lidos ?? operation.registros_identificados ?? "-"} />
        <Info label="Basic importados" value={operation.registros_basicos_importados ?? "-"} />
        <Info label="Advanced importados" value={operation.registros_avancados_importados ?? "-"} />
        <Info label="Arquivo" value={operation.arquivo_merged ?? operation.arquivo ?? "-"} />
        <Info label="Backup" value={operation.backup ?? "-"} />
        <Info label="Raw salvo" value={operation.raw_salvo ?? "-"} />
        <Info label="Log salvo" value={operation.log_salvo ?? "-"} />
      </div>
      {operation.erros_ignorados && <InfoBlock title="Erros/ignorados" value={formatLineValue(operation.erros_ignorados)} />}
      {operation.linha_adicionada && <InfoBlock title="Linha adicionada" value={operation.linha_adicionada} />}
      {operation.linha_removida && <InfoBlock title="Linha removida" value={operation.linha_removida} />}
      {operation.stdout && <InfoBlock title="Retorno da VM" value={operation.stdout} />}
      {operation.stderr && <InfoBlock title="Detalhes/erros da VM" value={operation.stderr} />}
    </div>
  );
}

function MessageList({ title, items, tone }: { title: string; items: string[]; tone: "bad" | "warn" }) {
  if (!items.length) return null;
  return (
    <div className={tone === "bad" ? "rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" : "rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning"}>
      <div className="mb-1 font-semibold">{title}</div>
      <ul className="list-inside list-disc space-y-1">
        {items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}
      </ul>
    </div>
  );
}

function Info({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-md border border-border bg-background/50 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 break-all text-sm font-medium">{String(value)}</div>
    </div>
  );
}

function InfoBlock({ title, value }: { title: string; value: unknown }) {
  const displayValue = formatLineValue(value);
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{title}</div>
      <pre className="whitespace-pre-wrap rounded-md border border-border bg-background/60 p-3 font-mono text-xs">{displayValue}</pre>
    </div>
  );
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return 0;
}

function getBasketballSeasonStatus(year: number) {
  if (year === CURRENT_BASKETBALL_SEASON_YEAR) return "current";
  if (year > CURRENT_BASKETBALL_SEASON_YEAR) return "future";
  return "closed";
}

function formatBasketballSeasonStatus(year: number) {
  const status = getBasketballSeasonStatus(year);
  if (status === "current") return "Atual";
  if (status === "future") return "Futura";
  return "Encerrada";
}

function formatYearOption(item: BaseballYear, isBasketball: boolean) {
  const count = Number(item.total_csvs ?? 0);
  const rawLabel = typeof item.label === "string" ? item.label : "";
  const labelHasCsvCount = /\d+\s*CSVs?/i.test(rawLabel);
  const label = labelHasCsvCount && (!/0\s*CSVs?/i.test(rawLabel) || count <= 0)
    ? rawLabel
    : `${item.ano} - ${count} CSVs`;
  return isBasketball ? `${label} - ${formatBasketballSeasonStatus(item.ano)}` : label;
}

function parseYears(payload: unknown): BaseballYear[] {
  const value = unwrapPayload(payload);
  const obj = value as { anos?: unknown[]; years?: unknown[]; items?: unknown[]; options?: unknown[]; detalhes?: BaseballYearDetail[] };
  const rows = Array.isArray(value) ? value : (obj.anos ?? obj.years ?? obj.items ?? obj.options);
  const detailsByYear = new Map(
    (obj.detalhes ?? [])
      .map((item) => [Number(item.ano), Number(item.total_csvs ?? 0)] as const)
      .filter(([ano]) => Number.isFinite(ano)),
  );

  return (rows ?? [])
    .map((item) => {
      if (typeof item === "number" || typeof item === "string") {
        const ano = Number(item);
        return { ano, total_csvs: detailsByYear.get(ano) ?? 0 };
      }
      const row = item as Record<string, unknown>;
      const ano = Number(row.ano ?? row.year ?? row.value);
      const csvCount = firstNumber(row.csv_count, row.total_csvs, row.arquivos_csv, row.count, detailsByYear.get(ano), 0);
      return { ...row, ano, label: typeof row.label === "string" ? row.label : undefined, total_csvs: csvCount };
    })
    .filter((item) => Number.isFinite(item.ano))
    .sort((a, b) => b.ano - a.ano);
}

function parseTeams(payload: unknown, league?: string): BaseballTeam[] {
  const value = unwrapPayload(payload);
  const obj = value as {
    times?: unknown[];
    teams?: unknown[];
    items?: unknown[];
    options?: unknown[];
    times_detalhados?: unknown[];
    teams_detalhados?: unknown[];
  };
  const rows = Array.isArray(value)
    ? value
    : (obj.options ?? obj.items ?? obj.times_detalhados ?? obj.teams_detalhados ?? obj.times ?? obj.teams);
  return (rows ?? [])
    .map((item) => {
      if (typeof item === "string") return { sigla: item, nome: item };
      const row = item as Record<string, unknown>;
      const sigla = String(row.value ?? row.sigla ?? row.codigo ?? row.time ?? row.team ?? "").trim();
      const nome = String(row.nome ?? row.name ?? row.display ?? row.label ?? sigla).trim();
      const label = String(row.label ?? row.display ?? (nome && nome !== sigla ? `${sigla} - ${nome}` : sigla)).trim();
      return { ...(item as BaseballTeam), sigla, nome, label };
    })
    .filter((item) => item.sigla)
    .map((item) => {
      const sigla = normalizeMlbSigla(item.sigla);
      const basketballName = league === "nba" || league === "wnba" ? BASKETBALL_TEAM_NAMES[league][sigla] : undefined;
      const nome = basketballName ?? item.nome ?? sigla;
      const existingLabel = "label" in item ? item.label : undefined;
      return { ...item, sigla, nome, label: existingLabel || (basketballName ? `${sigla} - ${basketballName}` : nome) };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

function parseLastLines(payload: unknown): LastLinesResult {
  const value = unwrapPayload(payload);
  const obj = value as { cabecalho?: unknown[]; ultimas_linhas?: unknown[]; linhas?: unknown[]; rows?: unknown[]; data?: unknown[]; mensagem?: string; message?: string };
  const rows = Array.isArray(value) ? value : (obj.ultimas_linhas ?? obj.linhas ?? obj.rows ?? obj.data);
  const rowItems = rows ?? [];
  const parsed = rowItems.map(formatLastLine).filter((item) => item.length > 0);
  const message = obj.mensagem ?? obj.message;
  const syntheticHeader = getSyntheticLastLinesHeader(rowItems);
  return {
    cabecalho: Array.isArray(obj.cabecalho) ? obj.cabecalho.map((item) => String(item)).join(",") : syntheticHeader,
    linhas: parsed.length ? parsed : message ? [message] : [],
  };
}

function unwrapPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const obj = payload as { data?: unknown; result?: unknown; payload?: unknown };
  return obj.data ?? obj.result ?? obj.payload ?? payload;
}

function formatLastLine(item: unknown): string {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return "";
  const row = item as { valores?: unknown[]; linha?: unknown[]; registro?: Record<string, unknown> };
  if (Array.isArray(row.valores)) return row.valores.map((value) => String(value)).join(",");
  if (Array.isArray(row.linha)) return row.linha.map((value) => String(value)).join(",");
  const record = row.registro ?? (item as Record<string, unknown>);
  const basketballLine = formatBasketballLastLine(record);
  if (basketballLine) return basketballLine;

  const preferred = ["data", "local", "adversario", "resultado", "pontos_time", "pontos_adversario", "off_rtg", "def_rtg", "pace", "ts_pct"];
  const keys = preferred.filter((key) => key in record);
  const visibleKeys = keys.length ? keys : Object.keys(record).slice(0, 12);
  return visibleKeys.map((key) => `${key}: ${String(record[key] ?? "")}`).join(" | ");
}

function formatBasketballLastLine(record: Record<string, unknown>): string | null {
  const fields: Array<[string, string[]]> = [
    ["rk", ["rk", "Rk", "Rk.1", "G#", "G#_basic"]],
    ["data", ["data", "Date", "date"]],
    ["local", ["local", "Unnamed: 3", "Unnamed: 44"]],
    ["adversario", ["adversario", "Opp", "Opp.2"]],
    ["resultado", ["resultado", "W/L", "W/L.1"]],
    ["pontos_time", ["pontos_time", "Tm", "Tm.1"]],
    ["pontos_adversario", ["pontos_adversario", "Opp.1", "Opp.3"]],
    ["off_rtg", ["off_rtg", "ORtg"]],
    ["def_rtg", ["def_rtg", "DRtg"]],
    ["pace", ["pace", "Pace"]],
    ["ts_pct", ["ts_pct", "TS%"]],
  ];

  const values = fields.map(([, keys]) => firstRecordValue(record, keys) ?? "");

  return values.filter(Boolean).length >= 3 ? values.join(",") : null;
}

function getSyntheticLastLinesHeader(rows: unknown[]): string | null {
  const firstRecord = rows
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const row = item as { registro?: Record<string, unknown> };
      return row.registro ?? (item as Record<string, unknown>);
    })
    .find((record) => record && formatBasketballLastLine(record));

  return firstRecord ? "rk,data,local,adversario,resultado,pontos_time,pontos_adversario,off_rtg,def_rtg,pace,ts_pct" : null;
}

function firstRecordValue(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (!(key in record)) continue;
    const value = record[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function parseLineForBase(input: string, isBasketball: boolean): string | string[] {
  return isBasketball ? normalizeBasketballLineInput(input) : parseCsvLine(input);
}

function normalizeBasketballLineInput(input: string): string {
  return input
    .trimEnd()
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+(?=\d+,20\d{2}-\d{2}-\d{2},)/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function parseCsvLine(input: string): string[] {
  return input
    .trimEnd()
    .split(",")
    .map((value) => value.trim());
}

function getLinePlaceholder(isBasketball: boolean, league: string) {
  if (!isBasketball) return "Cole aqui a linha no formato esperado pelo CSV historico da MLB.";
  if (league === "WNBA") return "Cole aqui a linha basic da WNBA e, em seguida, a linha advanced. Pode separar por espaco ou quebra de linha.";
  return "Cole aqui a linha basic da NBA e, em seguida, a linha advanced. Pode separar por espaco ou quebra de linha.";
}

function formatLineValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(",");
  if (value && typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value ?? "");
}

function textIncludesRuntimeError(value: unknown) {
  const text = formatLineValue(value).toLowerCase();
  return /traceback|modulenotfounderror|exception|error:|erro:|no module named/.test(text);
}

function isAddOperationSuccess(operation: OperationResult, isBasketball: boolean) {
  if (operation.ok === false) return false;
  if (operation.status && !/^ok|success|sucesso$/i.test(operation.status)) return false;
  if (textIncludesRuntimeError(operation.stderr) || textIncludesRuntimeError(operation.stdout)) return false;

  if (isBasketball) {
    const basic = Number(operation.registros_basicos_importados ?? 0);
    const advanced = Number(operation.registros_avancados_importados ?? 0);
    const identified = Number(operation.registros_identificados ?? operation.registros_lidos ?? 0);
    if (basic <= 0 && advanced <= 0 && identified <= 0) return false;
  }

  return true;
}

function getOperationErrorMessage(operation: OperationResult) {
  const details = [operation.stderr, operation.stdout, operation.mensagem, operation.erros_ignorados]
    .map((value) => formatLineValue(value).trim())
    .find(Boolean);
  if (/no module named ['"]?pandas/i.test(details ?? "")) {
    return "A VM nao conseguiu adicionar: falta instalar o pacote pandas no Python usado pela API.";
  }
  return details || "A VM retornou erro ao adicionar a linha.";
}

function normalizeLineForCompare(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function hasEquivalentLine(lines: string[], target: string) {
  const normalizedTarget = normalizeLineForCompare(target);
  return lines.some((line) => normalizeLineForCompare(line).includes(normalizedTarget));
}

function delay(ms: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function normalizeMlbSigla(sigla: string) {
  const value = sigla.toUpperCase().trim();
  return value === "OAK" ? "ATH" : value;
}

function isValidationSuccess(validation: ValidationResult) {
  return (validation.ok === true || validation.valida === true || validation.valido === true || validation.valid === true) && !validation.erros?.length;
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
