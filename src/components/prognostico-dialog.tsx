import { useEffect, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ESPORTES_DEFAULT,
  MERCADOS_DEFAULT,
  todayBR,
  useCreatePrognostico,
  useUpdatePrognostico,
  type Prognostico,
  type PrognosticoInput,
} from "@/lib/db";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  prognostico?: Prognostico | null;
  template?: Prognostico | null;
  esportes?: string[];
  mercados?: string[];
}

const empty: PrognosticoInput = {
  data: todayBR(),
  hora: null,
  esporte: "Futebol",
  liga: "",
  jogo: "",
  mandante: "",
  visitante: "",
  mercado: "Resultado Final",
  pick: "",
  linha: "-",
  odd_ofertada: 0,
  odd_valor: 0,
  probabilidade_final: 0,
  edge: 0,
  stake: 0,
  status_validacao: "PENDENTE",
  observacoes: null,
};

export function PrognosticoDialog({
  open,
  onOpenChange,
  prognostico,
  template,
  esportes = ESPORTES_DEFAULT,
  mercados = MERCADOS_DEFAULT,
}: Props) {
  const create = useCreatePrognostico();
  const update = useUpdatePrognostico();
  const [form, setForm] = useState<PrognosticoInput>(empty);

  useEffect(() => {
    if (!open) return;
    if (prognostico) {
      setForm({
        data: prognostico.data,
        hora: prognostico.hora,
        esporte: prognostico.esporte,
        liga: prognostico.liga,
        jogo: prognostico.jogo,
        mandante: prognostico.mandante,
        visitante: prognostico.visitante,
        mercado: prognostico.mercado,
        pick: prognostico.pick,
        linha: prognostico.linha,
        odd_ofertada: prognostico.odd_ofertada,
        odd_valor: prognostico.odd_valor,
        probabilidade_final: prognostico.probabilidade_final,
        edge: prognostico.edge,
        stake: prognostico.stake,
        status_validacao: prognostico.status_validacao,
        observacoes: prognostico.observacoes,
      });
    } else if (template) {
      setForm({
        data: new Date().toISOString().slice(0, 10),
        hora: template.hora,
        esporte: template.esporte,
        liga: template.liga,
        jogo: template.jogo,
        mandante: template.mandante,
        visitante: template.visitante,
        mercado: template.mercado,
        pick: template.pick,
        linha: template.linha,
        odd_ofertada: template.odd_ofertada,
        odd_valor: template.odd_valor,
        probabilidade_final: template.probabilidade_final,
        edge: template.edge,
        stake: template.stake,
        status_validacao: "PENDENTE",
        observacoes: template.observacoes,
      });
    } else {
      setForm({ ...empty, data: new Date().toISOString().slice(0, 10) });
    }
  }, [prognostico, template, open]);

  const set = <K extends keyof PrognosticoInput>(k: K, v: PrognosticoInput[K]) =>
    setForm((f) => {
      const next = { ...f, [k]: v } as PrognosticoInput;
      if (k === "odd_ofertada" || k === "odd_valor") {
        const of = Number(next.odd_ofertada);
        const va = Number(next.odd_valor);
        if (of > 0 && va > 0) {
          next.edge = Number((((of / va) - 1) * 100).toFixed(2));
        }
      }
      return next;
    });

  const submit = async () => {
    try {
      if (!form.jogo || !form.pick) {
        toast.error("Jogo e Pick são obrigatórios.");
        return;
      }
      if (prognostico) {
        await update.mutateAsync({ id: prognostico.id, ...form });
        toast.success("Prognóstico atualizado");
      } else {
        await create.mutateAsync(form);
        toast.success("Prognóstico criado");
      }
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{prognostico ? "Editar Prognóstico" : "Novo Prognóstico"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Data">
            <Input type="date" value={form.data} onChange={(e) => set("data", e.target.value)} />
          </Field>
          <Field label="Esporte">
            <Select value={form.esporte} onValueChange={(v) => set("esporte", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {esportes.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Liga">
            <Input value={form.liga} onChange={(e) => set("liga", e.target.value)} />
          </Field>
          <Field label="Mandante">
            <Input value={form.mandante} onChange={(e) => set("mandante", e.target.value)} />
          </Field>
          <Field label="Visitante">
            <Input value={form.visitante} onChange={(e) => set("visitante", e.target.value)} />
          </Field>
          <Field label="Jogo">
            <Input value={form.jogo} onChange={(e) => set("jogo", e.target.value)} placeholder="Mandante x Visitante" />
          </Field>
          <Field label="Mercado">
            <Select value={form.mercado} onValueChange={(v) => set("mercado", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {mercados.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Pick">
            <Input value={form.pick} onChange={(e) => set("pick", e.target.value)} />
          </Field>
          <Field label="Linha">
            <Input value={form.linha ?? ""} onChange={(e) => set("linha", e.target.value)} />
          </Field>
          <Field label="Odd Ofertada">
            <Input type="number" step="0.01" value={form.odd_ofertada} onChange={(e) => set("odd_ofertada", +e.target.value)} />
          </Field>
          <Field label="Odd Valor">
            <Input type="number" step="0.01" value={form.odd_valor} onChange={(e) => set("odd_valor", +e.target.value)} />
          </Field>
          <Field label="Probabilidade (0-1)">
            <Input type="number" step="0.01" value={form.probabilidade_final} onChange={(e) => set("probabilidade_final", +e.target.value)} />
          </Field>
          <Field label="Edge (%) — automático">
            <Input type="number" step="0.01" value={form.edge} readOnly className="bg-muted/40 cursor-not-allowed" />
          </Field>
          <Field label="Stake (u)">
            <Input type="number" step="0.1" value={form.stake} onChange={(e) => set("stake", +e.target.value)} />
          </Field>
          <Field label="Status validação">
            <Select value={form.status_validacao} onValueChange={(v) => set("status_validacao", v as PrognosticoInput["status_validacao"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="PENDENTE">PENDENTE</SelectItem>
                <SelectItem value="CONFIRMA">CONFIRMA</SelectItem>
                <SelectItem value="PULAR">PULAR</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="md:col-span-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Observações</Label>
            <Textarea
              rows={2}
              value={form.observacoes ?? ""}
              onChange={(e) => set("observacoes", e.target.value || null)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={create.isPending || update.isPending}>
            {prognostico ? "Salvar" : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
