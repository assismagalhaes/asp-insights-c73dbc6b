import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Brain, Copy, Globe, Loader2, Send, Trash2, Wand2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatBR, formatHora } from "@/lib/date-br";
import { analisarValidacao } from "@/lib/validacao-ia.functions";
import { analisarValidacaoOnline } from "@/lib/validacao-ia-online.functions";
import { useCreateValidacao } from "@/lib/db";
import { supabase } from "@/integrations/supabase/client";
import {
  clearCriticalValidationDraft,
  readCriticalValidationDraft,
  type MlbCriticalValidationDraft,
} from "@/lib/mlb/screenerToCriticalValidationAdapter";

const READINESS_LABELS: Record<string, string> = {
  pronto_para_validator: "pronto_para_validacao_critica",
  revisar_antes_do_validator: "revisar_antes_de_decidir",
  contexto_incompleto: "contexto_incompleto",
  nao_recomendado_para_validator: "nao_recomendado",
};
const displayReadiness = (s: string) => READINESS_LABELS[s] ?? s;

interface IAResult {
  parecer: string;
  decisao_sugerida: string | null;
  stake_sugerida: number | null;
  prompt_versao: string;
  modo: "local" | "online";
  fontes_consultadas?: { titulo: string; url: string }[];
  buscas_realizadas?: string[];
}

const STAKES = ["0", "0.5", "1.0", "1.5"];

function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(2)}%`;
}

function fmtNum(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return value.toFixed(digits);
}

/**
 * Painel de rascunho vindo do ASP Screener MLB.
 * Não cria prognóstico automaticamente. Não altera bankroll.
 * O usuário decide manualmente Confirmar/Pular.
 */
export function ScreenerCriticalDraftPanel({ onApplied }: { onApplied?: () => void }) {
  const [draftState, setDraftState] = useState<MlbCriticalValidationDraft | null>(null);
  const [contexto, setContexto] = useState<string>("");
  const [stake, setStake] = useState<string>("1.0");
  const [parecer, setParecer] = useState<string>("");
  const [ia, setIa] = useState<IAResult | null>(null);
  const [iaLoading, setIaLoading] = useState<"local" | "online" | null>(null);
  const [busy, setBusy] = useState<null | "confirmar" | "pular" | "descartar">(null);

  const callIA = useServerFn(analisarValidacao);
  const callIAOnline = useServerFn(analisarValidacaoOnline);
  const createVal = useCreateValidacao();

  useEffect(() => {
    const { draft } = readCriticalValidationDraft();
    if (draft) {
      setDraftState(draft);
      setContexto(draft.input.imported_context_summary);
    }
  }, []);

  const input = draftState?.input;

  const jogo = useMemo(() => (input ? `${input.home_team} vs ${input.away_team}` : ""), [input]);

  if (!draftState || !input) return null;

  const odd = input.adjusted_odd ?? input.odd ?? 0;
  const probPct = input.model_probability != null ? input.model_probability * 100 : 0;
  const edgePct = input.probability_edge != null ? input.probability_edge * 100 : 0;
  const evPct = input.ev != null ? input.ev * 100 : null;

  const isStrongConflict = input.critical_adjusted_status === "strong_conflict";
  const isReviewBefore = input.critical_adjusted_status === "review_before_validator";

  const rodarIA = async (modo: "local" | "online") => {
    setIaLoading(modo);
    try {
      const payload = {
        data: {
          prognostico: {
            data: input.event_date ?? new Date().toISOString().slice(0, 10),
            hora: input.event_time,
            esporte: input.sport,
            liga: input.league,
            jogo,
            mercado: input.market,
            pick: input.pick ?? "-",
            linha: input.line != null ? String(input.line) : null,
            odd_original: input.odd ?? 0,
            odd_ajustada: input.adjusted_odd ?? input.odd ?? 0,
            odd_valor: input.fair_odd ?? input.odd ?? 0,
            probabilidade_final: probPct,
            edge_original: edgePct,
            edge_ajustado: edgePct,
            stake_sugerida: Number(stake) || 1,
          },
          opcoes_mesmo_mercado: [],
          prognosticos_correlacionados: [],
          dados_tecnicos: contexto,
          contexto_local: contexto,
          calibracao_interna: null,
          ...(modo === "online" ? { contexto_online: null } : {}),
        },
      };
      const raw = modo === "online" ? await callIAOnline(payload) : await callIA(payload);
      const r: IAResult = { ...(raw as Omit<IAResult, "modo">), modo };
      setIa(r);
      if (r.decisao_sugerida === "PULAR") {
        setStake("0");
      } else if (r.stake_sugerida && STAKES.includes(r.stake_sugerida.toFixed(1))) {
        setStake(r.stake_sugerida.toFixed(1));
      }
      const decisao = r.decisao_sugerida === "CONFIRMA" ? "CONFIRMAR" : "PULAR";
      const resumo = `${decisao}${r.decisao_sugerida === "PULAR" ? " - 0u" : r.stake_sugerida ? ` - ${r.stake_sugerida}u` : ""}`;
      setParecer((p) => p || resumo);
      toast.success(modo === "online" ? "Análise online concluída" : "Análise local gerada");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setIaLoading(null);
    }
  };

  const criarPrognosticoAPartirDoDraft = async (
    statusValidacao: "CONFIRMA" | "PULAR",
  ): Promise<string> => {
    const oddOfertada = input.odd ?? 0;
    const oddAjustada = input.adjusted_odd ?? null;
    const oddValor = input.fair_odd ?? oddOfertada;
    const stakeNum = statusValidacao === "CONFIRMA" ? Number(stake) || 1 : 0;
    // IMPORTANTE: enviar apenas colunas que EXISTEM em `prognosticos`.
    // Não incluir arquivo_contexto / contexto_modelo / origem_modelo /
    // job_id_coleta — não estão no schema atual e causam erro
    // "Could not find the '<coluna>' column of 'prognosticos' in the schema cache".
    const contextoFinal = contexto || input.imported_context_summary;
    const observacoesFinal = [
      "Origem: ASP Screener MLB",
      `Draft ID: ${draftState.draft_id}`,
    ].join(" · ");
    const body = {
      data: input.event_date ?? new Date().toISOString().slice(0, 10),
      hora: input.event_time,
      esporte: input.sport,
      liga: input.league,
      jogo,
      mandante: input.home_team,
      visitante: input.away_team,
      mercado: input.market,
      pick: input.pick ?? "-",
      linha: input.line != null ? String(input.line) : null,
      odd_ofertada: oddOfertada,
      odd_ajustada: oddAjustada,
      odd_valor: oddValor,
      probabilidade_final: probPct,
      edge: edgePct,
      edge_ajustado: edgePct,
      stake: stakeNum,
      status_validacao: statusValidacao,
      status_publicacao: "NAO_PUBLICADO",
      observacoes: observacoesFinal,
      dados_tecnicos: contextoFinal,
    };
    const { data, error } = await supabase
      .from("prognosticos")
      .insert(body as never)
      .select("id")
      .single();
    if (error) throw error;
    return (data as { id: string }).id;
  };

  const decidir = async (decisao: "CONFIRMA" | "PULAR") => {
    if (decisao === "CONFIRMA" && !parecer.trim()) {
      toast.error("Resumo da decisão é obrigatório para confirmar.");
      return;
    }
    setBusy(decisao === "CONFIRMA" ? "confirmar" : "pular");
    try {
      const prognosticoId = await criarPrognosticoAPartirDoDraft(decisao);
      const stakeNum = decisao === "CONFIRMA" ? Number(stake) || 1 : 0;
      await createVal.mutateAsync({
        prognostico_id: prognosticoId,
        decisao,
        stake_confirmada: stakeNum,
        parecer_validacao: parecer || "Rascunho do ASP Screener MLB decidido na Validação Crítica.",
        contexto_adicional: contexto || null,
        parecer_ia: ia?.parecer ?? null,
        decisao_ia_sugerida: ia?.decisao_sugerida ?? null,
        stake_ia_sugerida: ia?.stake_sugerida ?? null,
        data_analise_ia: ia ? new Date().toISOString() : null,
        prompt_versao: ia?.prompt_versao ?? null,
        modo_ia: ia?.modo ?? null,
        fontes_consultadas: ia?.fontes_consultadas ?? null,
        buscas_realizadas: ia?.buscas_realizadas ?? null,
      });
      clearCriticalValidationDraft();
      setDraftState(null);
      toast.success(
        decisao === "CONFIRMA"
          ? "Rascunho confirmado e prognóstico registrado."
          : "Rascunho descartado como PULAR e registrado no histórico.",
      );
      onApplied?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const descartar = () => {
    setBusy("descartar");
    try {
      clearCriticalValidationDraft();
      setDraftState(null);
      toast.success("Rascunho do Screener descartado.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-lg border-2 border-primary/50 bg-primary/5 p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="outline" className="border-primary/50 text-primary">
              Rascunho ASP Screener MLB
            </Badge>
            <span className="font-mono text-muted-foreground">
              {input.event_date ? formatBR(input.event_date) : "-"}
            </span>
            {input.event_time && (
              <span className="font-mono text-muted-foreground">às {formatHora(input.event_time)}</span>
            )}
            <span className="text-muted-foreground">-</span>
            <span className="font-semibold uppercase tracking-wider text-primary">{input.sport}</span>
            <span className="text-muted-foreground">- {input.league}</span>
          </div>
          <h3 className="mt-1 text-lg font-semibold">{jogo}</h3>
          <div className="mt-1 text-xs text-muted-foreground">
            Mercado: <span className="font-semibold text-foreground">{input.market}</span>
            {input.pick && <> · Pick: <span className="font-semibold text-foreground">{input.pick}</span></>}
            {input.line != null && <> · Linha: <span className="font-mono text-foreground">{input.line}</span></>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {isStrongConflict && <Badge variant="destructive">Conflito forte com o Screener</Badge>}
          {isReviewBefore && !isStrongConflict && (
            <Badge variant="outline" className="border-warning/60 text-warning">
              Revisar antes de decidir
            </Badge>
          )}
          <Badge variant="outline">{input.readiness_status}</Badge>
          <Button
            size="sm"
            variant="ghost"
            title="Descartar rascunho (não altera bankroll)"
            onClick={descartar}
            disabled={busy !== null}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <Metric label="Odd ofertada" value={fmtNum(input.odd)} />
        <Metric label="Odd ajustada" value={fmtNum(input.adjusted_odd ?? input.odd)} />
        <Metric label="Odd justa" value={fmtNum(input.fair_odd)} />
        <Metric label="Prob. ASP" value={fmtPct(input.model_probability)} />
        <Metric label="No-vig mercado" value={fmtPct(input.market_probability_no_vig)} />
        <Metric
          label="Edge prob."
          value={fmtPct(input.probability_edge)}
          tone={edgePct >= 0 ? "good" : "bad"}
        />
        <Metric
          label="EV ASP"
          value={evPct != null ? `${evPct.toFixed(2)}%` : "-"}
          tone={evPct != null && evPct >= 0 ? "good" : "bad"}
        />
        <Metric label="Opp. Score (bruto)" value={String(input.raw_opportunity_score)} />
        <Metric label="Confidence (bruto)" value={String(input.raw_confidence_score)} />
        <Metric label="Score pós-contexto" value={String(input.critical_adjusted_score)} />
        <Metric label="Confiança pós-contexto" value={String(input.critical_adjusted_confidence)} />
        <Metric label="Alinhamento" value={`${input.alignment_status} (${input.alignment_score})`} />
      </div>

      {(input.supporting_factors.length > 0 || input.conflicting_factors.length > 0 || input.alerts.length > 0) && (
        <div className="grid gap-2 md:grid-cols-3 text-xs">
          <FactorList title="Fatores de suporte" items={input.supporting_factors} tone="good" />
          <FactorList title="Fatores de conflito" items={input.conflicting_factors} tone="bad" />
          <FactorList title="Alertas / risk flags" items={[...input.alerts, ...input.risk_flags, ...input.post_context_risk_flags]} tone="warn" />
        </div>
      )}

      <div>
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Dados Técnicos / Contexto Local (pré-preenchido pelo Screener)
        </Label>
        <Textarea
          rows={8}
          value={contexto}
          onChange={(e) => setContexto(e.target.value)}
          className="font-mono text-xs"
        />
      </div>

      <div className="rounded-md border border-primary/30 bg-background/40 p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <Wand2 className="h-4 w-4" />
            Análise crítica pela IA
            {ia?.modo === "online" && (
              <span className="flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                <Globe className="h-3 w-3" /> online
              </span>
            )}
            {ia?.modo === "local" && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                local
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => rodarIA("local")}
              disabled={iaLoading !== null}
            >
              {iaLoading === "local" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Brain className="h-3 w-3 mr-1" />}
              IA Local
            </Button>
            <Button
              size="sm"
              onClick={() => rodarIA("online")}
              disabled={iaLoading !== null}
              title="Usa modelo online com pesquisa (consome créditos extras)"
            >
              {iaLoading === "online" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Globe className="h-3 w-3 mr-1" />}
              IA Local + Pesquisa
            </Button>
            {ia && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await navigator.clipboard.writeText(ia.parecer);
                    toast.success("Copiado");
                  }}
                >
                  <Copy className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setIa(null)}>
                  <X className="h-3 w-3" />
                </Button>
              </>
            )}
          </div>
        </div>
        {iaLoading === "online" && (
          <p className="text-xs text-primary/80">
            Pesquisando notícias, lineups e contexto na web; pode levar 15-40s.
          </p>
        )}
        {ia ? (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              {ia.decisao_sugerida && (
                <span className="rounded border border-border bg-background px-2 py-0.5">
                  Decisão: <strong>{ia.decisao_sugerida === "CONFIRMA" ? "CONFIRMAR" : "PULAR"}</strong>
                </span>
              )}
              {ia.stake_sugerida != null && (
                <span className="rounded border border-border bg-background px-2 py-0.5">
                  Stake sugerida: <strong>{ia.stake_sugerida}u</strong>
                </span>
              )}
            </div>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-border bg-background/60 p-2 font-mono text-xs">
              {ia.parecer}
            </pre>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            <strong>IA Local</strong> analisa apenas contexto local. <strong>IA Local + Pesquisa</strong> adiciona notícias, lineups, lesões online. Nenhuma IA roda automaticamente.
          </p>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="md:col-span-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Resumo da decisão *
          </Label>
          <Textarea
            rows={3}
            placeholder="Ex.: CONFIRMAR - Chicago White Sox +1.5 - 1.0u"
            value={parecer}
            onChange={(e) => setParecer(e.target.value)}
          />
          <p className="mt-1 text-[11px] text-muted-foreground flex items-start gap-1">
            <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
            Este rascunho ainda não gerou prognóstico nem alterou a bankroll. Somente após Confirmar/Pular o fluxo padrão prossegue.
          </p>
        </div>
        <div className="space-y-2">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Stake (u)</Label>
            <Select value={stake} onValueChange={setStake}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STAKES.map((s) => <SelectItem key={s} value={s}>{s}u</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Button
              onClick={() => decidir("CONFIRMA")}
              disabled={busy !== null}
              className="font-semibold w-full bg-success text-success-foreground hover:bg-success/90"
              size="sm"
            >
              {busy === "confirmar" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Send className="h-3 w-3 mr-1" />}
              Confirmar
            </Button>
            <Button
              onClick={() => decidir("PULAR")}
              disabled={busy !== null}
              className="font-semibold w-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
              size="sm"
            >
              Pular
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className="min-h-[62px] rounded-md border border-border bg-background/50 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 font-mono text-sm font-bold",
          tone === "good" && "text-success",
          tone === "bad" && "text-destructive",
          tone === "warn" && "text-warning",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function FactorList({ title, items, tone }: { title: string; items: string[]; tone: "good" | "bad" | "warn" }) {
  if (!items.length) return null;
  return (
    <div className="rounded-md border border-border bg-background/40 p-2">
      <div className={cn(
        "text-[10px] font-semibold uppercase tracking-wider",
        tone === "good" && "text-success",
        tone === "bad" && "text-destructive",
        tone === "warn" && "text-warning",
      )}>
        {title}
      </div>
      <ul className="mt-1 space-y-0.5 text-muted-foreground">
        {items.slice(0, 6).map((item, i) => (
          <li key={`${title}-${i}`}>· {item}</li>
        ))}
      </ul>
    </div>
  );
}
