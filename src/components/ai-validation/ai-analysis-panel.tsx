import { AlertTriangle, Brain, Copy, ExternalLink, Globe, Loader2, Wand2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { FonteIa } from "@/lib/db";
import { formatAiOpinionForDisplay, getOnlineResearchAlerts } from "./ai-analysis-panel-utils";

export type AiAnalysisMode = "local" | "online";

export interface AiAnalysisPanelResult {
  parecer: string;
  decisao_sugerida: string | null;
  stake_sugerida: number | null;
  modo: AiAnalysisMode;
  pick_escolhida?: string | null;
  aviso_opcao?: string | null;
  fontes_consultadas?: FonteIa[];
  buscas_realizadas?: string[];
}

export interface AiAnalysisPanelProps {
  result?: AiAnalysisPanelResult;
  loadingMode?: AiAnalysisMode;
  onRun: (mode: AiAnalysisMode) => void;
  onApply: () => void;
  onCopy: (text: string) => void;
  onDismiss: () => void;
}

export function AiAnalysisPanel({
  result,
  loadingMode,
  onRun,
  onApply,
  onCopy,
  onDismiss,
}: AiAnalysisPanelProps) {
  const opinionDisplay = result ? formatAiOpinionForDisplay(result.parecer) : "";
  const onlineAlerts = result?.modo === "online" ? getOnlineResearchAlerts(result.parecer) : [];

  return (
    <section
      aria-labelledby="ai-analysis-title"
      className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          id="ai-analysis-title"
          className="flex items-center gap-2 text-sm font-semibold text-primary"
        >
          <Wand2 aria-hidden="true" className="h-4 w-4" />
          Análise sugerida pela IA
          {result?.modo === "online" ? (
            <span className="flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
              <Globe aria-hidden="true" className="h-3 w-3" /> online
            </span>
          ) : null}
          {result?.modo === "local" ? (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              local
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRun("local")}
            disabled={Boolean(loadingMode)}
          >
            {loadingMode === "local" ? (
              <Loader2 aria-hidden="true" className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Brain aria-hidden="true" className="mr-1 h-3 w-3" />
            )}
            IA Local
          </Button>
          <Button
            size="sm"
            className="text-slate-950"
            onClick={() => onRun("online")}
            disabled={Boolean(loadingMode)}
            title="Usa Gemini com pesquisa online (Firecrawl) - consome créditos extras"
          >
            {loadingMode === "online" ? (
              <Loader2 aria-hidden="true" className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Globe aria-hidden="true" className="mr-1 h-3 w-3" />
            )}
            IA Local + Pesquisa
          </Button>
          {result ? (
            <>
              <Button size="sm" variant="outline" onClick={onApply}>
                Aplicar
              </Button>
              <Button
                aria-label="Copiar parecer da IA"
                size="sm"
                variant="outline"
                onClick={() => onCopy(opinionDisplay)}
              >
                <Copy aria-hidden="true" className="h-3 w-3" />
              </Button>
              <Button
                aria-label="Fechar parecer da IA"
                size="sm"
                variant="ghost"
                onClick={onDismiss}
              >
                <X aria-hidden="true" className="h-3 w-3" />
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {loadingMode === "online" ? (
        <p aria-live="polite" className="text-xs text-primary">
          Pesquisando notícias, lineups e contexto na web; pode levar 15-40s.
        </p>
      ) : null}

      {result ? (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            {result.decisao_sugerida ? (
              <span className="rounded border border-border bg-background px-2 py-0.5">
                Decisão:{" "}
                <strong>{result.decisao_sugerida === "CONFIRMA" ? "CONFIRMAR" : "PULAR"}</strong>
              </span>
            ) : null}
            {result.stake_sugerida != null ? (
              <span className="rounded border border-border bg-background px-2 py-0.5">
                Stake sugerida: <strong>{result.stake_sugerida}u</strong>
              </span>
            ) : null}
            {result.pick_escolhida ? (
              <span className="rounded border border-border bg-background px-2 py-0.5">
                Pick escolhida: <strong>{result.pick_escolhida}</strong>
              </span>
            ) : null}
          </div>

          {result.aviso_opcao ? (
            <div
              role="alert"
              className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
            >
              {result.aviso_opcao}
            </div>
          ) : null}

          {onlineAlerts.length > 0 ? (
            <div
              role="alert"
              className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
            >
              <div className="mb-1 flex items-center gap-1 font-semibold">
                <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
                Alertas da pesquisa online
              </div>
              <div className="flex flex-wrap gap-1.5">
                {onlineAlerts.map((alert) => (
                  <span
                    key={alert}
                    className="rounded border border-warning/30 bg-background/50 px-2 py-0.5"
                  >
                    {alert}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-border bg-background/60 p-2 font-mono text-xs">
            {opinionDisplay}
          </pre>

          {result.modo === "online" &&
          (result.fontes_consultadas?.length || result.buscas_realizadas?.length) ? (
            <div className="space-y-1.5 rounded border border-border bg-background/60 p-2">
              {result.buscas_realizadas?.length ? (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Buscas realizadas
                  </div>
                  <ul className="mt-0.5 space-y-0.5 text-xs">
                    {result.buscas_realizadas.map((query) => (
                      <li key={query} className="text-muted-foreground">
                        - {query}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {result.fontes_consultadas?.length ? (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Rastreabilidade de fontes
                  </div>
                  <ul className="mt-0.5 space-y-0.5 text-xs">
                    {result.fontes_consultadas.map((source) => (
                      <li key={source.url} className="flex flex-wrap items-center gap-1">
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          <ExternalLink aria-hidden="true" className="h-3 w-3" />
                          {source.titulo}
                        </a>
                        <span className="text-[10px] text-muted-foreground">
                          {source.tipo === "SEARCH_RESULT" && source.consultada === false
                            ? "resultado de busca"
                            : "página consultada"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          <strong>IA Local</strong>: analisa apenas dados internos e contexto local/manual.{" "}
          <strong>IA Local + Pesquisa</strong>: usa os dados internos e adiciona notícias, lineups,
          lesões e contexto online pesquisado.
        </p>
      )}
    </section>
  );
}
