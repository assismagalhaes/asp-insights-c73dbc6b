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
import { useCreateResultado, type Prognostico, type Resultado } from "@/lib/db";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  prognostico: Prognostico | null;
  valorUnidade?: number;
}

export function ResultadoDialog({ open, onOpenChange, prognostico, valorUnidade = 10 }: Props) {
  const create = useCreateResultado();
  const [resultado, setResultado] = useState<Resultado>("GREEN");
  const [placar, setPlacar] = useState("");
  const [oddFech, setOddFech] = useState<number>(0);
  const [lucro, setLucro] = useState<number>(0);

  useEffect(() => {
    if (prognostico) {
      setResultado("GREEN");
      setPlacar("");
      setOddFech(prognostico.odd_ofertada);
      // sugestão de lucro em unidades
      const sugerido =
        prognostico.stake * (prognostico.odd_ofertada - 1);
      setLucro(Number(sugerido.toFixed(2)));
    }
  }, [prognostico, open]);

  // atualiza sugestão conforme resultado
  useEffect(() => {
    if (!prognostico) return;
    if (resultado === "GREEN") {
      setLucro(Number((prognostico.stake * (prognostico.odd_ofertada - 1)).toFixed(2)));
    } else if (resultado === "RED") {
      setLucro(Number((-prognostico.stake).toFixed(2)));
    } else {
      setLucro(0);
    }
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
        data_resultado: new Date().toISOString().slice(0, 10),
      });
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
                <SelectItem value="GREEN">GREEN</SelectItem>
                <SelectItem value="RED">RED</SelectItem>
                <SelectItem value="PUSH">PUSH</SelectItem>
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
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={create.isPending}>Registrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
