import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Send, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  clearCriticalValidationDraft,
  readCriticalValidationDraft,
  type MlbCriticalValidationDraft,
} from "@/lib/mlb/screenerToCriticalValidationAdapter";

/**
 * Banner discreto exibido no topo da Validacao Critica quando existe
 * um rascunho vindo de modelo preditivo em sessionStorage.
 *
 * - Ao importar, cria um prognostico PENDENTE.
 * - A origem aparece apenas como metadado.
 * - Nao altera bankroll e nao confirma nada automaticamente.
 */
export function ScreenerCriticalDraftPanel({ onApplied }: { onApplied?: () => void }) {
  const [draft, setDraft] = useState<MlbCriticalValidationDraft | null>(null);
  const [busy, setBusy] = useState<null | "importar" | "descartar">(null);

  useEffect(() => {
    const { draft: d } = readCriticalValidationDraft();
    if (d) setDraft(d);
  }, []);

  if (!draft) return null;
  const input = draft.input;
  const jogo = `${input.home_team} vs ${input.away_team}`;

  const probPct = input.model_probability != null ? input.model_probability * 100 : 0;
  const edgePct = input.probability_edge != null ? input.probability_edge * 100 : 0;

  const importar = async () => {
    setBusy("importar");
    try {
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
        odd_ofertada: input.odd ?? 0,
        odd_ajustada: input.adjusted_odd ?? null,
        odd_valor: input.fair_odd ?? input.odd ?? 0,
        probabilidade_final: probPct,
        edge: edgePct,
        edge_ajustado: edgePct,
        stake: 0,
        status_validacao: "PENDENTE",
        status_publicacao: "NAO_PUBLICADO",
        resultado: "PENDENTE",
        observacoes: `Origem: ${input.source} - Draft ${draft.draft_id}`,
        dados_tecnicos: input.imported_context_summary,
      };
      const { error } = await supabase.from("prognosticos").insert(body as never);
      if (error) throw error;
      clearCriticalValidationDraft();
      setDraft(null);
      toast.success("Rascunho importado como prognostico pendente na Validacao Critica.");
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
      setDraft(null);
      toast.success("Rascunho de modelo preditivo descartado.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 px-4 py-3 flex flex-wrap items-center gap-3">
      <Badge variant="outline" className="border-primary/50 text-primary">
        Rascunho de modelo preditivo
      </Badge>
      <span className="text-sm text-foreground">
        <strong>{jogo}</strong>
        <span className="text-muted-foreground"> | {input.market}</span>
        {input.pick && <span className="text-muted-foreground"> | {input.pick}</span>}
        {input.line != null && <span className="text-muted-foreground"> | linha {input.line}</span>}
      </span>
      <span className="text-xs text-muted-foreground">
        Origem: {input.source}. Dados adicionados ao contexto tecnico; nenhum prognostico e criado ate voce importar.
      </span>
      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" onClick={importar} disabled={busy !== null}>
          {busy === "importar" ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <Send className="h-3 w-3 mr-1" />
          )}
          Importar como pendente
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={descartar}
          disabled={busy !== null}
          title="Descartar rascunho"
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}
