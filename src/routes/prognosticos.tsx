import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Upload, Plus, FileSpreadsheet, Pencil, Trash2, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge, ResultBadge } from "@/components/status-badge";
import {
  usePrognosticos,
  useDeletePrognostico,
  useConfiguracao,
  type Prognostico,
} from "@/lib/db";
import { PrognosticoDialog } from "@/components/prognostico-dialog";
import { ResultadoDialog } from "@/components/resultado-dialog";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/prognosticos")({
  head: () => ({ meta: [{ title: "Prognósticos — ASP Insights" }] }),
  component: Prognosticos,
});

function Prognosticos() {
  const { data: prognosticos = [], isLoading } = usePrognosticos();
  const { data: cfg } = useConfiguracao();
  const del = useDeletePrognostico();

  const [editing, setEditing] = useState<Prognostico | null>(null);
  const [openForm, setOpenForm] = useState(false);
  const [resultadoFor, setResultadoFor] = useState<Prognostico | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Prognostico | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Prognósticos</h1>
          <p className="text-sm text-muted-foreground">
            Cadastro, edição e gerenciamento dos prognósticos gerados.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => toast.info("Importação CSV/XLSX em breve — schema já preparado.")}
          >
            <Upload className="h-4 w-4" /> Importar
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setOpenForm(true);
            }}
          >
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
              data, esporte, liga, jogo, mandante, visitante, mercado, pick, linha, odd_ofertada, odd_valor, probabilidade_final, edge, stake
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
                <th className="px-3 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={14} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Carregando...
                  </td>
                </tr>
              )}
              {!isLoading && prognosticos.length === 0 && (
                <tr>
                  <td colSpan={14} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Nenhum prognóstico cadastrado.
                  </td>
                </tr>
              )}
              {prognosticos.map((p) => (
                <tr key={p.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{p.data}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{p.esporte}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{p.liga}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{p.jogo}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{p.mercado}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{p.pick}</td>
                  <td className="px-3 py-2 text-right font-mono">{p.odd_ofertada.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono">{p.odd_valor.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono">{(p.probabilidade_final * 100).toFixed(1)}%</td>
                  <td className={`px-3 py-2 text-right font-mono ${p.edge >= 0 ? "text-success" : "text-destructive"}`}>
                    {(p.edge * 100).toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{p.stake.toFixed(1)}u</td>
                  <td className="px-3 py-2"><StatusBadge status={p.status_validacao} /></td>
                  <td className="px-3 py-2"><ResultBadge result={p.resultado} /></td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <div className="flex justify-end gap-1">
                      {p.resultado === "PENDENTE" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Registrar resultado"
                          onClick={() => setResultadoFor(p)}
                        >
                          <Trophy className="h-4 w-4 text-warning" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Editar"
                        onClick={() => {
                          setEditing(p);
                          setOpenForm(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Excluir"
                        onClick={() => setConfirmDelete(p)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <PrognosticoDialog
        open={openForm}
        onOpenChange={setOpenForm}
        prognostico={editing}
        esportes={cfg?.esportes_ativos}
        mercados={cfg?.mercados_ativos}
      />

      <ResultadoDialog
        open={!!resultadoFor}
        onOpenChange={(o) => !o && setResultadoFor(null)}
        prognostico={resultadoFor}
        valorUnidade={cfg?.valor_unidade_padrao}
      />

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir prognóstico?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.jogo} — {confirmDelete?.pick}. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!confirmDelete) return;
                try {
                  await del.mutateAsync(confirmDelete.id);
                  toast.success("Prognóstico excluído");
                } catch (e) {
                  toast.error((e as Error).message);
                }
                setConfirmDelete(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
