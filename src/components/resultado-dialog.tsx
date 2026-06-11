import { useState, useEffect } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateResultado, calcLucro, todayBR, type Prognostico, type Resultado } from "@/lib/db";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  prognostico: Prognostico | null;
  valorUnidade?: number;
}

const RESULTADOS: Resultado[] = ["GREEN", "HALF GREEN", "RED", "HALF RED", "PUSH", "VOID"];

export function ResultadoDialog({ open, onOpenChange, prognostico, valorUnidade = 10 }: Props) {
  const create = useCreateResultado();
  const [resultado, setResultado] = useState<Resultado>("GREEN");
  const [placar, setPlacar] = useState("");
  const [oddFech, setOddFech] = useState<number>(0);
  const [lucro, setLucro] = useState<number>(0);
  const [siblings, setSiblings] = useState<Prognostico[]>([]);

  useEffect(() => {
    if (!open || !prognostico) return;
    setResultado("GREEN");
    setPlacar("");
    setOddFech(prognostico.odd_ofertada);
    setLucro(calcLucro("GREEN", prognostico.stake, prognostico.odd_ofertada));
    setSiblings([]);

    // procura outros prognósticos do mesmo confronto (data + hora + jogo + esporte)
    (async () => {
      let q = supabase
        .from("prognosticos")
        .select("*, resultados(placar_final, created_at)")
        .eq("data", prognostico.data)
        .eq("jogo", prognostico.jogo)
        .eq("esporte", prognostico.esporte)
        .neq("id", prognostico.id);
      if (prognostico.hora) q = q.eq("hora", prognostico.hora);
      const { data } = await q;
      const list = (data ?? []) as unknown as Array<Prognostico & { resultados?: Array<{ placar_final: string | null; created_at: string }> }>;
      setSiblings(list);

      // se algum irmão já tem placar registrado, preenche automaticamente
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

  useEffect(() => {
    if (!prognostico) return;
    setLucro(calcLucro(resultado, prognostico.stake, prognostico.odd_ofertada));
  }, [resultado, prognostico]);

  if (!prognostico) return null;

  const submit = async () => {
    try {
      await create.mutateAsync({
        prognostico_id: prognostico.id,
        resultado,
        placar_final: placar || null,
        odd_fechamento: oddFech || null,
        lucro_prejuizo: lucro,
        data_resultado: todayBR(),
      });

      // propaga placar para irmãos sem resultado ainda (não define GREEN/RED — usuário escolhe por pick)
      if (placar) {
        const semResultado = siblings.filter((s) => s.resultado === "PENDENTE");
        if (semResultado.length) {
          const ok = window.confirm(
            `Foram encontrados ${semResultado.length} prognóstico(s) para o mesmo confronto. Deseja preencher o placar "${placar}" automaticamente neles? (Você ainda precisa definir GREEN/RED por pick.)`,
          );
          if (ok) {
            // grava um resultado VOID temporário? Não — apenas atualiza placar no prognostico.
            // Como placar_final fica em resultados, criamos resultados PENDENTE não é permitido.
            // Alternativa: salvar como observação leve via update do prognostico em campo livre não existe.
            // Usamos a abordagem de pré-preencher quando o diálogo abrir (já feito acima).
            toast.info("O placar será sugerido automaticamente ao abrir o resultado de cada irmão.");
          }
        }
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
          {prognostico.mercado} · {prognostico.pick} · Stake {prognostico.stake.toFixed(1)}u · Unidade R$ {valorUnidade.toFixed(2)}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Resultado</Label>
            <Select value={resultado} onValueChange={(v) => setResultado(v as Resultado)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RESULTADOS.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Placar final</Label>
            <Input value={placar} onChange={(e) => setPlacar(e.target.value)} placeholder="ex: 2x1" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Odd de fechamento</Label>
            <Input type="number" step="0.01" value={oddFech} onChange={(e) => setOddFech(+e.target.value)} />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Lucro/Prejuízo (u)</Label>
            <Input type="number" step="0.01" value={lucro} onChange={(e) => setLucro(+e.target.value)} />
          </div>
        </div>
        {siblings.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {siblings.length} outro(s) prognóstico(s) para este confronto. O placar será sugerido automaticamente.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={create.isPending}>Registrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
