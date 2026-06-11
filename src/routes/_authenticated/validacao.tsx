import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AlertTriangle, Sparkles, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { usePrognosticos, useCreateValidacao, useUpdatePrognostico, type Prognostico, type Status } from "@/lib/db";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/validacao")({
  head: () => ({ meta: [{ title: "Validação Crítica — ASP Insights" }] }),
  component: Validacao,
});

const decisoes: { label: Status; color: string }[] = [
  { label: "CONFIRMA", color: "bg-success text-success-foreground hover:bg-success/90" },
  { label: "PULAR", color: "bg-destructive text-destructive-foreground hover:bg-destructive/90" },
];

function autoCheck(p: Prognostico) {
  if (p.odd_ofertada < p.odd_valor) return { auto: "PULAR" as const, reason: "Odd ofertada menor que odd de valor" };
  if (p.edge < 0) return { auto: "PULAR" as const, reason: "Edge negativo" };
  if (p.probabilidade_final < 55) return { auto: "ALERTA" as const, reason: "Probabilidade inferior a 55%" };
  if (p.probabilidade_final > 60) return { auto: "DESTAQUE" as const, reason: "Probabilidade superior a 60%" };
  return null;
}

function formatDateBR(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function Validacao() {
  const { data: prognosticos = [] } = usePrognosticos();
  const createVal = useCreateValidacao();
  const updateProg = useUpdatePrognostico();
  const [justificativas, setJustificativas] = useState<Record<string, string>>({});
  const [riscos, setRiscos] = useState<Record<string, string>>({});
  const [comentarios, setComentarios] = useState<Record<string, string>>({});
  const [stakes, setStakes] = useState<Record<string, string>>({});
  const [odds, setOdds] = useState<Record<string, string>>({});

  const pendentes = prognosticos
    .filter((p) => p.resultado === "PENDENTE" && p.status_validacao === "PENDENTE")
    .slice()
    .sort((a, b) => {
      if (a.data !== b.data) return a.data < b.data ? -1 : 1;
      const ha = a.hora ?? "99:99";
      const hb = b.hora ?? "99:99";
      return ha < hb ? -1 : ha > hb ? 1 : 0;
    });

  const decidir = async (p: Prognostico, decisao: Status) => {
    if (!justificativas[p.id]?.trim()) {
      toast.error("Justificativa da decisão é obrigatória.");
      return;
    }
    try {
      const oddAtual = odds[p.id] ? Number(odds[p.id]) : p.odd_ofertada;
      if (oddAtual && oddAtual !== p.odd_ofertada) {
        await updateProg.mutateAsync({ id: p.id, odd_ofertada: oddAtual });
      }
      await createVal.mutateAsync({
        prognostico_id: p.id,
        decisao,
        stake_confirmada: stakes[p.id] ? Number(stakes[p.id]) : p.stake,
        justificativa: justificativas[p.id] ?? null,
        riscos_identificados: riscos[p.id] ?? null,
        comentarios_analista: comentarios[p.id] ?? null,
      });
      toast.success(`Decisão registrada: ${decisao}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };


  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Validação Crítica</h1>
        <p className="text-sm text-muted-foreground">
          Segunda análise dos prognósticos gerados pelos modelos antes da publicação.
        </p>
      </div>

      {pendentes.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Não há prognósticos pendentes de validação.
        </div>
      )}

      <div className="space-y-4">
        {pendentes.map((p) => {
          const check = autoCheck(p);
          return (
            <div
              key={p.id}
              className={cn(
                "rounded-lg border bg-card p-5",
                check?.auto === "PULAR" && "border-destructive/40",
                check?.auto === "DESTAQUE" && "border-success/40",
                check?.auto === "ALERTA" && "border-warning/40",
                !check && "border-border",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-muted-foreground">{formatDateBR(p.data)}</span>
                    <span className="text-xs font-mono text-muted-foreground">•</span>
                    <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                      {p.esporte}
                    </span>
                    <span className="text-xs text-muted-foreground">• {p.liga}</span>
                  </div>
                  <h3 className="mt-1 text-lg font-semibold">{p.jogo}</h3>
                  <p className="text-sm text-muted-foreground">
                    {p.mercado} — <span className="text-foreground font-medium">{p.pick}</span>
                  </p>
                </div>
                <StatusBadge status={p.status_validacao} />
              </div>

              {check && (
                <div
                  className={cn(
                    "mt-3 flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium",
                    check.auto === "PULAR" && "border-destructive/40 bg-destructive/10 text-destructive",
                    check.auto === "ALERTA" && "border-warning/40 bg-warning/10 text-warning",
                    check.auto === "DESTAQUE" && "border-success/40 bg-success/10 text-success",
                  )}
                >
                  {check.auto === "DESTAQUE" ? (
                    <Sparkles className="h-3.5 w-3.5" />
                  ) : check.auto === "ALERTA" ? (
                    <ShieldAlert className="h-3.5 w-3.5" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5" />
                  )}
                  <span className="uppercase tracking-wider">{check.auto}</span>
                  <span className="text-foreground/80 normal-case tracking-normal">— {check.reason}</span>
                </div>
              )}

              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
                <Metric label="Odd Ofertada" value={p.odd_ofertada.toFixed(2)} />
                <Metric label="Odd Valor" value={p.odd_valor.toFixed(2)} />
                <Metric
                  label="Probabilidade"
                  value={`${p.probabilidade_final.toFixed(2)}%`}
                  tone={p.probabilidade_final > 60 ? "good" : p.probabilidade_final < 55 ? "warn" : undefined}
                />
                <Metric
                  label="Edge"
                  value={`${p.edge.toFixed(2)}%`}
                  tone={p.edge < 0 ? "bad" : "good"}
                />

                <Metric label="Stake sugerida" value={`${p.stake.toFixed(1)}u`} />
              </div>

              {p.observacoes && (
                <p className="mt-3 text-xs text-muted-foreground">
                  <span className="font-semibold uppercase tracking-wider">Obs:</span> {p.observacoes}
                </p>
              )}

              <div className="mt-4 grid gap-3 md:grid-cols-5">
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Odd ofertada (ajustar)
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={odds[p.id] ?? p.odd_ofertada}
                    onChange={(e) => setOdds({ ...odds, [p.id]: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Stake confirmada
                  </Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={stakes[p.id] ?? p.stake}
                    onChange={(e) => setStakes({ ...stakes, [p.id]: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Justificativa *
                  </Label>
                  <Textarea
                    rows={2}
                    value={justificativas[p.id] || ""}
                    onChange={(e) => setJustificativas({ ...justificativas, [p.id]: e.target.value })}
                    placeholder="Justificativa da decisão"
                  />
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Riscos identificados
                  </Label>
                  <Textarea
                    rows={2}
                    value={riscos[p.id] || ""}
                    onChange={(e) => setRiscos({ ...riscos, [p.id]: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Comentários
                  </Label>
                  <Textarea
                    rows={2}
                    value={comentarios[p.id] || ""}
                    onChange={(e) => setComentarios({ ...comentarios, [p.id]: e.target.value })}
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {decisoes.map((d) => (
                  <Button
                    key={d.label}
                    onClick={() => decidir(p, d.label)}
                    className={cn("font-semibold", d.color)}
                    disabled={createVal.isPending}
                  >
                    {d.label}
                  </Button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad" | "warn";
}) {
  return (
    <div className="rounded-md border border-border bg-background/50 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-0.5 font-mono text-base font-bold",
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
