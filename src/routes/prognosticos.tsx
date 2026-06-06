import { createFileRoute } from "@tanstack/react-router";
import { Upload, Plus, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge, ResultBadge } from "@/components/status-badge";
import { prognosticos } from "@/lib/mock-data";
import { toast } from "sonner";

export const Route = createFileRoute("/prognosticos")({
  head: () => ({ meta: [{ title: "Prognósticos — ASP Insights" }] }),
  component: Prognosticos,
});

function Prognosticos() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Prognósticos</h1>
          <p className="text-sm text-muted-foreground">
            Importação, cadastro e gerenciamento dos prognósticos gerados.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => toast.info("Importação CSV/XLSX será conectada ao backend.")}
          >
            <Upload className="h-4 w-4" /> Importar Prognósticos
          </Button>
          <Button onClick={() => toast.info("Formulário de cadastro será aberto.")}>
            <Plus className="h-4 w-4" /> Novo Prognóstico
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-dashed border-border bg-card/50 p-4">
        <div className="flex items-start gap-3">
          <FileSpreadsheet className="mt-0.5 h-5 w-5 text-primary" />
          <div className="text-sm">
            <p className="font-medium">Estrutura esperada (CSV / XLSX)</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              Data, Esporte, Jogo, Mercado, Pick, Odd Ofertada, Odd Valor, Probabilidade, Edge, Stake
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Data</th>
                <th className="px-3 py-2 text-left">Esporte</th>
                <th className="px-3 py-2 text-left">Liga</th>
                <th className="px-3 py-2 text-left">Jogo</th>
                <th className="px-3 py-2 text-left">Mercado</th>
                <th className="px-3 py-2 text-left">Pick</th>
                <th className="px-3 py-2 text-right font-mono">Odd Of.</th>
                <th className="px-3 py-2 text-right font-mono">Odd Val.</th>
                <th className="px-3 py-2 text-right font-mono">Prob.</th>
                <th className="px-3 py-2 text-right font-mono">Edge</th>
                <th className="px-3 py-2 text-right font-mono">Stake</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {prognosticos.map((p) => (
                <tr key={p.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{p.data}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{p.esporte}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{p.liga}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{p.jogo}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{p.mercado}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{p.pick}</td>
                  <td className="px-3 py-2 text-right font-mono">{p.oddOfertada.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono">{p.oddValor.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono">{(p.probabilidade * 100).toFixed(1)}%</td>
                  <td className={`px-3 py-2 text-right font-mono ${p.edge >= 0 ? "text-success" : "text-destructive"}`}>
                    {(p.edge * 100).toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{p.stake.toFixed(1)}u</td>
                  <td className="px-3 py-2"><StatusBadge status={p.status} /></td>
                  <td className="px-3 py-2"><ResultBadge result={p.resultado} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
