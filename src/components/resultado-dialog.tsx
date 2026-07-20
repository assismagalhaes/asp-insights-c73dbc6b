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
import {
  useCreateResultado,
  calcLucro,
  todayBR,
  getOddEfetiva,
  type Prognostico,
  type Resultado,
} from "@/lib/db";
import { lucroUnidades, stakeAnalitica } from "@/lib/metrics";
import { parsePlacar, calcularResultadoAuto, detectRacePick } from "@/lib/resultado-calc";
import { supabase } from "@/lib/supabase-public";
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
  const [racePrimeiro, setRacePrimeiro] = useState<"casa" | "fora" | null>(null);
  const [siblings, setSiblings] = useState<Prognostico[]>([]);

  useEffect(() => {
    if (!open || !prognostico) return;
    setPlacar("");
    setManual(null);
    setRacePrimeiro(null);
    setSiblings([]);

    (async () => {
      // 1) Load current resultado for this prognostico (edit mode)
      const { data: own } = await supabase
        .from("resultados")
        .select("placar_final, resultado, created_at")
        .eq("prognostico_id", prognostico.id)
        .order("created_at", { ascending: false })
        .limit(1);
      const ownLast = (own ?? [])[0] as
        | { placar_final: string | null; resultado: Resultado }
        | undefined;
      if (ownLast?.placar_final) setPlacar(ownLast.placar_final);
      if (ownLast && (ownLast.resultado === "GREEN" || ownLast.resultado === "RED")) {
        setManual(ownLast.resultado);
      }

      // 2) Suggest placar from sibling prognosticos of same match
      let q = supabase
        .from("prognosticos")
        .select("*, resultados(placar_final, created_at)")
        .eq("data", prognostico.data)
        .eq("jogo", prognostico.jogo)
        .eq("esporte", prognostico.esporte)
        .neq("id", prognostico.id);
      if (prognostico.hora) q = q.eq("hora", prognostico.hora);
      const { data } = await q;
      const list = (data ?? []) as unknown as Array<
        Prognostico & { resultados?: Array<{ placar_final: string | null; created_at: string }> }
      >;
      setSiblings(list);
      if (!ownLast?.placar_final) {
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
      }
    })();
  }, [prognostico, open]);

  const parsed = useMemo(() => parsePlacar(placar), [placar]);
  const race = useMemo(() => (prognostico ? detectRacePick(prognostico) : null), [prognostico]);
  const raceAmbiguo = useMemo(() => {
    if (!race || !parsed) return false;
    return parsed.mandante >= race.alvo && parsed.visitante >= race.alvo;
  }, [race, parsed]);
  const auto = useMemo(() => {
    if (!prognostico || !parsed) return null;
    const base = calcularResultadoAuto(prognostico, parsed);
    if (base) return base;
    if (raceAmbiguo && race && racePrimeiro) {
      return racePrimeiro === race.lado ? "GREEN" : "RED";
    }
    return null;
  }, [prognostico, parsed, raceAmbiguo, race, racePrimeiro]);

  const resultadoFinal: Resultado | null = manual ?? (auto as Resultado | null);

  if (!prognostico) return null;

  const oddEfetiva = getOddEfetiva(prognostico);
  const stakeResultado = stakeAnalitica(prognostico);
  const lucroU = resultadoFinal
    ? lucroUnidades({ resultado: resultadoFinal, stake: stakeResultado, odd_ofertada: oddEfetiva })
    : 0;
  const lucroR = lucroU * valorUnidade;

  const submit = async () => {
    if (!resultadoFinal) {
      toast.error("Informe o placar ou marque manualmente GREEN/RED.");
      return;
    }
    try {
      // Edit mode: remove existing resultados for this prognostico before inserting the new one
      const isEdit = prognostico.resultado === "GREEN" || prognostico.resultado === "RED";
      if (isEdit) {
        const { error: delErr } = await supabase
          .from("resultados")
          .delete()
          .eq("prognostico_id", prognostico.id);
        if (delErr) throw delErr;
      }
      await create.mutateAsync({
        prognostico_id: prognostico.id,
        resultado: resultadoFinal,
        placar_final: placar || null,
        odd_fechamento: null,
        lucro_prejuizo: calcLucro(resultadoFinal, stakeResultado, oddEfetiva),
        data_resultado: todayBR(),
      });

      if (placar && siblings.some((s) => s.resultado === "PENDENTE")) {
        toast.info(
          "O placar será sugerido automaticamente ao abrir o resultado dos demais prognósticos deste confronto.",
        );
      }
      toast.success(
        prognostico.status_validacao === "CONFIRMA"
          ? "Resultado financeiro registrado, bankroll atualizada."
          : "Resultado teórico registrado para aprendizado da IA.",
      );
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {prognostico.resultado === "GREEN" || prognostico.resultado === "RED"
              ? "Editar resultado"
              : "Registrar resultado"}{" "}
            — {prognostico.jogo}
          </DialogTitle>
        </DialogHeader>
        <div className="text-xs text-muted-foreground">Odd usada {oddEfetiva.toFixed(2)}</div>
        <div className="text-xs text-muted-foreground">
          {prognostico.mercado} · {prognostico.pick} · Stake {stakeResultado.toFixed(1)}u · Unidade
          R$ {valorUnidade.toFixed(2)}
        </div>

        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Placar final (mandante x visitante)
          </Label>
          <Input
            value={placar}
            onChange={(e) => {
              setPlacar(e.target.value);
              setManual(null);
              setRacePrimeiro(null);
            }}
            placeholder="ex: 1x7"
            autoFocus
          />
        </div>

        {parsed && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm space-y-1">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <span className="text-muted-foreground">Mandante:</span> <b>{parsed.mandante}</b>
              </div>
              <div>
                <span className="text-muted-foreground">Visitante:</span> <b>{parsed.visitante}</b>
              </div>
              <div>
                <span className="text-muted-foreground">Total:</span> <b>{parsed.total}</b>
              </div>
            </div>
            <div className="text-xs">
              <span className="text-muted-foreground">Mercado:</span> {prognostico.mercado}
            </div>
            <div className="text-xs">
              <span className="text-muted-foreground">Pick:</span> {prognostico.pick}
            </div>
            <div className="pt-1">
              <span className="text-muted-foreground text-xs">Resultado calculado: </span>
              {resultadoFinal ? (
                <span
                  className={`text-sm font-bold ${resultadoFinal === "GREEN" ? "text-success" : "text-destructive"}`}
                >
                  {resultadoFinal}
                  {manual ? " (manual)" : ""}
                </span>
              ) : (
                <span className="text-sm font-bold text-muted-foreground">
                  — não calculável, marque manualmente
                </span>
              )}
            </div>
            {resultadoFinal && (
              <div className="text-xs grid grid-cols-2 gap-2 pt-1">
                <div>
                  <span className="text-muted-foreground">Lucro real:</span>{" "}
                  <b>R$ {lucroR.toFixed(2)}</b>
                </div>
                <div>
                  <span className="text-muted-foreground">Lucro (u):</span>{" "}
                  <b>
                    {lucroU > 0 ? "+" : ""}
                    {lucroU.toFixed(2)}u
                  </b>
                </div>
              </div>
            )}
          </div>
        )}

        {race && raceAmbiguo && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm space-y-2">
            <div className="text-xs">
              Ambos os times alcançaram <b>{race.alvo}</b> cantos. Selecione manualmente quem chegou
              primeiro:
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={racePrimeiro === "casa" ? "default" : "outline"}
                onClick={() => setRacePrimeiro("casa")}
              >
                Casa alcançou primeiro
              </Button>
              <Button
                type="button"
                size="sm"
                variant={racePrimeiro === "fora" ? "default" : "outline"}
                onClick={() => setRacePrimeiro("fora")}
              >
                Fora alcançou primeiro
              </Button>
            </div>
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
            {siblings.length} outro(s) prognóstico(s) para este confronto. O placar será sugerido
            automaticamente.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={create.isPending || !resultadoFinal}>
            Confirmar Resultado
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
