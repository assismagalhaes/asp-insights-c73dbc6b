import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { esportes, mercados } from "@/lib/mock-data";
import { toast } from "sonner";
import { Activity } from "lucide-react";

export const Route = createFileRoute("/configuracoes")({
  head: () => ({ meta: [{ title: "Configurações — ASP Insights" }] }),
  component: Configuracoes,
});

function Configuracoes() {
  const [nome, setNome] = useState("ASP Insights - AI Sports Predictions");
  const [unidade, setUnidade] = useState(10);
  const [esportesAtivos, setEsportesAtivos] = useState<Record<string, boolean>>(
    Object.fromEntries(esportes.map((e) => [e, true])),
  );
  const [mercadosAtivos, setMercadosAtivos] = useState<Record<string, boolean>>(
    Object.fromEntries(mercados.map((m) => [m, true])),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Parâmetros gerais da plataforma e ativação de esportes/mercados.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Identidade
          </h3>
          <div className="mt-4 grid gap-3">
            <div>
              <Label>Nome da plataforma</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <div>
              <Label>Logotipo</Label>
              <div className="mt-1 flex items-center gap-3 rounded-md border border-dashed border-border bg-background/40 p-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <Activity className="h-6 w-6" />
                </div>
                <Button variant="outline" size="sm" onClick={() => toast.info("Upload de logo em breve.")}>
                  Trocar logotipo
                </Button>
              </div>
            </div>
            <div>
              <Label>Valor padrão da unidade (R$)</Label>
              <Input type="number" value={unidade} onChange={(e) => setUnidade(+e.target.value)} />
            </div>
            <Button onClick={() => toast.success("Configurações salvas")}>Salvar</Button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Esportes ativos
            </h3>
            <div className="mt-4 space-y-2">
              {esportes.map((e) => (
                <div key={e} className="flex items-center justify-between rounded-md border border-border bg-background/40 px-3 py-2">
                  <span className="text-sm font-medium">{e}</span>
                  <Switch
                    checked={esportesAtivos[e]}
                    onCheckedChange={(v) => setEsportesAtivos({ ...esportesAtivos, [e]: v })}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Mercados ativos
            </h3>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {mercados.map((m) => (
                <div key={m} className="flex items-center justify-between rounded-md border border-border bg-background/40 px-3 py-2">
                  <span className="text-sm">{m}</span>
                  <Switch
                    checked={mercadosAtivos[m]}
                    onCheckedChange={(v) => setMercadosAtivos({ ...mercadosAtivos, [m]: v })}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
