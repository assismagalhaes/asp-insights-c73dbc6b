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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  addBaseballLine,
  getBaseballTeamLastLines,
  getBaseballTeams,
  getBaseballYears,
  removeBaseballLastLine,
  validateBaseballLine,
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
};

type BaseballTeam = {
  sigla: string;
  nome: string;
  arquivo?: string;
  caminho?: string;
};

type ValidationResult = {
  valida?: boolean;
  erros?: string[];
  avisos?: string[];
  linha?: string;
  arquivo?: string;
  ano?: number;
  sigla_time?: string;
};

type OperationResult = {
  status?: string;
  mensagem?: string;
  ano?: number;
  sigla_time?: string;
  nome_time?: string;
  arquivo?: string;
  backup?: string;
  linha_adicionada?: string;
  linha_removida?: string;
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

function BaseDadosPage() {
  const getYears = useServerFn(getBaseballYears);
  const getTeams = useServerFn(getBaseballTeams);
  const getLastLines = useServerFn(getBaseballTeamLastLines);
  const validateLine = useServerFn(validateBaseballLine);
  const addLine = useServerFn(addBaseballLine);
  const removeLastLine = useServerFn(removeBaseballLastLine);

  const [sport, setSport] = useState<SportKey | "">("");
  const [league, setLeague] = useState("");
  const [years, setYears] = useState<BaseballYear[]>([]);
  const [year, setYear] = useState("");
  const [teams, setTeams] = useState<BaseballTeam[]>([]);
  const [team, setTeam] = useState("");
  const [line, setLine] = useState("");
  const [lastLines, setLastLines] = useState<string[]>([]);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [operation, setOperation] = useState<OperationResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const leagues = sport ? LEAGUES_BY_SPORT[sport] : [];
  const isBaseballMlb = sport === "baseball" && league === "MLB";
  const maxYear = years.length ? Math.max(...years.map((item) => item.ano)) : null;
  const selectedYear = year ? Number(year) : null;
  const selectedTeam = teams.find((item) => item.sigla === team) ?? null;
  const isHistoricalYear = Boolean(selectedYear && maxYear && selectedYear < maxYear);
  const canValidate = Boolean(isBaseballMlb && selectedYear && team && line.trim() && !busy);
  const canAdd = Boolean(canValidate && validation?.valida === true && !validation?.erros?.length);
  const canRemove = Boolean(isBaseballMlb && selectedYear && team && !busy);

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
    if (!isBaseballMlb) return;

    let cancelled = false;
    setBusy("years");
    getYears({ data: {} })
      .then((payload) => {
        if (cancelled) return;
        const parsed = parseYears(payload);
        setYears(parsed);
        const latest = parsed.length ? Math.max(...parsed.map((item) => item.ano)) : null;
        setYear(latest ? String(latest) : "");
        if (!parsed.length) toast.warning("A VM respondeu, mas nao retornou anos de base MLB.");
      })
      .catch((e) => toast.error(formatError(e)))
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isBaseballMlb]);

  useEffect(() => {
    resetTeamState();
    if (!isBaseballMlb || !selectedYear) return;

    let cancelled = false;
    setBusy("teams");
    getTeams({ data: { ano: selectedYear } })
      .then((payload) => {
        if (cancelled) return;
        const parsed = parseTeams(payload);
        setTeams(parsed);
        if (!parsed.length) toast.warning(`A VM respondeu, mas nao retornou times MLB para ${selectedYear}.`);
      })
      .catch((e) => toast.error(formatError(e)))
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isBaseballMlb, selectedYear]);

  useEffect(() => {
    setLastLines([]);
    setValidation(null);
    setOperation(null);
    if (!isBaseballMlb || !selectedYear || !team) return;
    void loadLastLines(selectedYear, team);
  }, [isBaseballMlb, selectedYear, team]);

  const placeholderMessage = useMemo(() => {
    if (!sport) return "Selecione um esporte/modelo para carregar a base de dados.";
    if (!isBaseballMlb) return "Base ainda não integrada à API. Integração prevista para etapa futura.";
    return null;
  }, [sport, isBaseballMlb]);

  function resetTeamState() {
    setTeams([]);
    setTeam("");
    setLine("");
    setLastLines([]);
    setValidation(null);
    setOperation(null);
  }

  async function loadLastLines(ano: number, sigla: string) {
    setBusy("last-lines");
    try {
      const payload = await getLastLines({ data: { ano, sigla_time: sigla, limite: 10 } });
      setLastLines(parseLastLines(payload));
    } catch (e) {
      toast.error(formatError(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleValidate() {
    if (!selectedYear || !team || !line.trim()) {
      toast.error("Informe ano, time e linha antes de validar.");
      return;
    }
    setBusy("validate");
    setOperation(null);
    try {
      const payload = await validateLine({ data: { ano: selectedYear, sigla_time: team, linha: line.trim() } });
      const result = payload as ValidationResult;
      setValidation(result);
      if (result.valida) toast.success("Linha validada com sucesso.");
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
      const payload = await addLine({ data: { ano: selectedYear, sigla_time: team, linha: line.trim() } });
      setOperation(payload as OperationResult);
      toast.success("Linha adicionada à base MLB.");
      await loadLastLines(selectedYear, team);
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
      const payload = await removeLastLine({ data: { ano: selectedYear, sigla_time: team } });
      setOperation(payload as OperationResult);
      setValidation(null);
      toast.success("Última linha removida da base MLB.");
      await loadLastLines(selectedYear, team);
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
                <Select value={sport} onValueChange={(value) => setSport(value as SportKey)}>
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
                            {item.ano} · {item.total_csvs ?? 0} CSVs
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field label="Time MLB">
                    <Select value={team} onValueChange={setTeam} disabled={busy === "teams" || !teams.length}>
                      <SelectTrigger><SelectValue placeholder={busy === "teams" ? "Carregando..." : teams.length ? "Selecione o time" : "Nenhum time encontrado"} /></SelectTrigger>
                      <SelectContent>
                        {teams.map((item) => (
                          <SelectItem key={item.sigla} value={item.sigla}>
                            {item.sigla} · {item.nome}
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
                    placeholder="Cole aqui a linha no formato esperado pelo CSV histórico da MLB."
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
      <MessageList title="Erros" items={validation.erros ?? []} tone="bad" />
      <MessageList title="Avisos" items={validation.avisos ?? []} tone="warn" />
      {validation.linha && <InfoBlock title="Linha validada" value={validation.linha} />}
    </div>
  );
}

function OperationPanel({ operation }: { operation: OperationResult }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant={operation.status === "ok" ? "outline" : "destructive"}>{operation.status ?? "retorno"}</Badge>
        {operation.mensagem && <span className="text-sm">{operation.mensagem}</span>}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <Info label="Ano" value={operation.ano ?? "-"} />
        <Info label="Time" value={operation.nome_time ?? operation.sigla_time ?? "-"} />
        <Info label="Arquivo" value={operation.arquivo ?? "-"} />
        <Info label="Backup" value={operation.backup ?? "-"} />
      </div>
      {operation.linha_adicionada && <InfoBlock title="Linha adicionada" value={operation.linha_adicionada} />}
      {operation.linha_removida && <InfoBlock title="Linha removida" value={operation.linha_removida} />}
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

function InfoBlock({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{title}</div>
      <pre className="whitespace-pre-wrap rounded-md border border-border bg-background/60 p-3 font-mono text-xs">{value}</pre>
    </div>
  );
}

function parseYears(payload: unknown): BaseballYear[] {
  const value = unwrapPayload(payload);
  const obj = value as { anos?: unknown[] };
  const rows = Array.isArray(value) ? value : obj.anos;
  return (rows ?? [])
    .map((item) => {
      if (typeof item === "number" || typeof item === "string") {
        return { ano: Number(item), total_csvs: 0 };
      }
      const row = item as BaseballYear;
      return { ...row, ano: Number(row.ano), total_csvs: Number(row.total_csvs ?? 0) };
    })
    .filter((item) => Number.isFinite(item.ano))
    .sort((a, b) => b.ano - a.ano);
}

function parseTeams(payload: unknown): BaseballTeam[] {
  const value = unwrapPayload(payload);
  const obj = value as { times?: unknown[] };
  const rows = Array.isArray(value) ? value : obj.times;
  return (rows ?? [])
    .map((item) => {
      if (typeof item === "string") return { sigla: item, nome: item };
      return item as BaseballTeam;
    })
    .filter((item) => item.sigla)
    .map((item) => ({ ...item, nome: item.nome || item.sigla }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

function parseLastLines(payload: unknown): string[] {
  const value = unwrapPayload(payload);
  const obj = value as { ultimas_linhas?: unknown[]; linhas?: unknown[] };
  const rows = Array.isArray(value) ? value : (obj.ultimas_linhas ?? obj.linhas);
  return (rows ?? []).map((item) => String(item));
}

function unwrapPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const obj = payload as { data?: unknown; result?: unknown; payload?: unknown };
  return obj.data ?? obj.result ?? obj.payload ?? payload;
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
