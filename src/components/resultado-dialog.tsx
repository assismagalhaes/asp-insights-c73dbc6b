import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useCreateResultado, calcLucro, getOddEfetiva, todayBR, type Prognostico, type Resultado } from "@/lib/db";
import { lucroUnidades } from "@/lib/metrics";
import { parsePlacar, calcularResultadoAuto, extrairLinha } from "@/lib/resultado-calc";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  prognostico: Prognostico | null;
  valorUnidade?: number;
}

export function ResultadoDialog({ open, onOpenChange, prognostico, valorUnidade = 10 }: Props) {
  const create = useCreateResultado();
  const [placar, setPlacar] = useState("");
  const [manual, setManual] = useState<Resultado | null>(null);
  const [siblings, setSiblings] = useState<Prognostico[]>([]);

  useEffect(() => {
    if (!open || !prognostico) return;
    setPlacar("");
    setManual(null);
    setSiblings([]);

    (async () => {
      let q = supabase
        .from("prognosticos")
        .select("*, resultados(placar_final, created_at)")
        .eq("data", prognostico.data)
        .eq("jogo", prognostico.jogo)
        .eq("esporte", prognostico.esporte)
        .neq("id", prognostico.id);
      if (prognostico.hora) q = q.eq("hora", prognostico.hora);
      let { data, error } = await q;
      if (error) {
        let fallback = supabase
          .from("prognosticos")
          .select("*")
          .eq("data", prognostico.data)
          .eq("jogo", prognostico.jogo)
          .eq("esporte", prognostico.esporte)
          .neq("id", prognostico.id);
        if (prognostico.hora) fallback = fallback.eq("hora", prognostico.hora);
        const fallbackResult = await fallback;
        data = fallbackResult.data;
      }
      const list = (data ?? []) as unknown as Array<Prognostico & { resultados?: Array<{ placar_final: string | null; created_at: string }> }>;
      setSiblings(list);
      for (const s of list) {
        const rs = s.resultados ?? [];
        if (rs.length) {
          const last = [...rs].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
          if (last.placar_final) {
            setPlacar(last.placar_final);
            break;
          }
        }
      }
    })();
  }, [prognostico, open]);

  const parsed = useMemo(() => parsePlacar(placar), [placar]);
  const auto = useMemo(() => {
    if (!prognostico || !parsed) return null;
    return calcularResultadoAuto(prognostico, parsed);
  }, [prognostico, parsed]);

  const resultadoFinal: Resultado | null = manual ?? (auto as Resultado | null);

  const linhaInfo = useMemo(() => {
    if (!prognostico) return null;
    if (prognostico.linha) return String(prognostico.linha);
    const e = extrairLinha(prognostico.pick ?? "");
    return e != null ? String(e) : null;
  }, [prognostico]);

  if (!prognostico) return null;

  const oddEfetiva = getOddEfetiva(prognostico);
  const lucroU = resultadoFinal ? lucroUnidades({ ...prognostico, resultado: resultadoFinal }) : 0;
  const lucroR = lucroU * valorUnidade;

  const submit = async () => {
    if (!resultadoFinal) {
      toast.error("Informe o placar ou marque manualmente GREEN/RED.");
      return;
    }
    try {
      await create.mutateAsync({
        prognostico_id: prognostico.id,
        resultado: resultadoFinal,
        placar_final: placar || null,
        odd_fechamento: null,
        lucro_prejuizo: calcLucro(resultadoFinal, prognostico.stake, oddEfetiva),
        data_resultado: todayBR(),
      });

      if (placar && siblings.some((s) => s.resultado === "PENDENTE")) {
        toast.info("O placar será sugerido automaticamente ao abrir o resultado dos demais prognósticos deste confronto.");
      }
      toast.success("Resultado registrado, bankroll atualizada.");
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar resultado — {prognostico.jogo}</DialogTitle>
        </DialogHeader>
        <div className="text-xs text-muted-foreground">
          {prognostico.mercado} · {prognostico.pick} · Odd {oddEfetiva.toFixed(2)} · Stake {prognostico.stake.toFixed(1)}u · Unidade R$ {valorUnidade.toFixed(2)}
        </div>

        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Placar final (mandante x visitante)
          </Label>
          <Input
            value={placar}
            onChange={(e) => { setPlacar(e.target.value); setManual(null); }}
            placeholder="ex: 1x7"
            autoFocus
          />
        </div>

        {parsed && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm space-y-1">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div><span className="text-muted-foreground">Mandante:</span> <b>{parsed.mandante}</b></div>
              <div><span className="text-muted-foreground">Visitante:</span> <b>{parsed.visitante}</b></div>
              <div><span className="text-muted-foreground">Total:</span> <b>{parsed.total}</b></div>
            </div>
            <div className="text-xs"><span className="text-muted-foreground">Mercado:</span> {prognostico.mercado}</div>
            <div className="text-xs"><span className="text-muted-foreground">Pick:</span> {prognostico.pick}</div>
            {linhaInfo && <div className="text-xs"><span className="text-muted-foreground">Linha:</span> {linhaInfo}</div>}
            <div className="pt-1">
              <span className="text-muted-foreground text-xs">Resultado calculado: </span>
              {resultadoFinal ? (
                <span className={`text-sm font-bold ${resultadoFinal === "GREEN" ? "text-success" : "text-destructive"}`}>
                  {resultadoFinal}{manual ? " (manual)" : ""}
                </span>
              ) : (
                <span className="text-sm font-bold text-muted-foreground">— não calculável, marque manualmente</span>
              )}
            </div>
            {resultadoFinal && (
              <div className="text-xs grid grid-cols-2 gap-2 pt-1">
                <div><span className="text-muted-foreground">Lucro real:</span> <b>R$ {lucroR.toFixed(2)}</b></div>
                <div><span className="text-muted-foreground">Lucro (u):</span> <b>{lucroU > 0 ? "+" : ""}{lucroU.toFixed(2)}u</b></div>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            type="button"
            variant={manual === "GREEN" ? "default" : "outline"}
            size="sm"
            onClick={() => setManual("GREEN")}
          >
            Marcar GREEN
          </Button>
          <Button
            type="button"
            variant={manual === "RED" ? "destructive" : "outline"}
            size="sm"
            onClick={() => setManual("RED")}
          >
            Marcar RED
          </Button>
          {manual && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setManual(null)}>
              Limpar manual
            </Button>
          )}
        </div>

        {siblings.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {siblings.length} outro(s) prognóstico(s) para este confronto. O placar será sugerido automaticamente.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={create.isPending || !resultadoFinal}>
            Confirmar Resultado
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
