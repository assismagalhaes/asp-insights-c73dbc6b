import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Upload, Plus, FileSpreadsheet, Pencil, Trash2, Trophy, Megaphone, Copy, Ban, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge, ResultBadge, PublicacaoBadge } from "@/components/status-badge";
import {
  usePrognosticos,
  useDeletePrognostico,
  useConfiguracao,
  usePublicarPrognostico,
  useCancelarPrognostico,
  gerarTipTexto,
  ESPORTES_DEFAULT,
  MERCADOS_DEFAULT,
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

export const Route = createFileRoute("/_authenticated/prognosticos")({
  head: () => ({ meta: [{ title: "Prognósticos — ASP Insights" }] }),
  component: Prognosticos,
});

type SortKey =
  | "data"
  | "esporte"
  | "liga"
  | "jogo"
  | "mercado"
  | "pick"
  | "odd_ofertada"
  | "odd_valor"
  | "probabilidade_final"
  | "edge"
  | "stake"
  | "status_validacao"
  | "status_publicacao"
  | "resultado";

function formatDateBR(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function Prognosticos() {
  const { data: prognosticos = [], isLoading } = usePrognosticos();
  const { data: cfg } = useConfiguracao();
  const del = useDeletePrognostico();
  const publicar = usePublicarPrognostico();
  const cancelar = useCancelarPrognostico();

  const [editing, setEditing] = useState<Prognostico | null>(null);
  const [template, setTemplate] = useState<Prognostico | null>(null);
  const [openForm, setOpenForm] = useState(false);
  const [askRepeat, setAskRepeat] = useState(false);
  const [resultadoFor, setResultadoFor] = useState<Prognostico | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Prognostico | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("data");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const esportes = cfg?.esportes_ativos ?? ESPORTES_DEFAULT;
  const mercados = cfg?.mercados_ativos ?? MERCADOS_DEFAULT;
  const [fEsporte, setFEsporte] = useState("all");
  const [fMercado, setFMercado] = useState("all");
  const [fValidacao, setFValidacao] = useState("all");
  const [fPublicacao, setFPublicacao] = useState("all");
  const [fResultado, setFResultado] = useState("all");
  const [fData, setFData] = useState("");

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  };

  const sorted = useMemo(() => {
    const arr = prognosticos.filter((p) => {
      if (fEsporte !== "all" && p.esporte !== fEsporte) return false;
      if (fMercado !== "all" && p.mercado !== fMercado) return false;
      if (fValidacao !== "all" && p.status_validacao !== fValidacao) return false;
      if (fPublicacao !== "all" && p.status_publicacao !== fPublicacao) return false;
      if (fResultado !== "all" && p.resultado !== fResultado) return false;
      if (fData && p.data !== fData) return false;
      return true;
    });
    arr.sort((a, b) => {
      const av = a[sortKey] as unknown;
      const bv = b[sortKey] as unknown;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv), "pt-BR", { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [prognosticos, sortKey, sortDir, fEsporte, fMercado, fValidacao, fPublicacao, fResultado, fData]);


  const podePublicar = (p: Prognostico) =>
    p.status_publicacao === "NAO_PUBLICADO" &&
    (p.status_validacao === "CONFIRMA" || p.status_validacao === "CONFIRMA COM CAUTELA");


  const copyTip = async (p: Prognostico) => {
    await navigator.clipboard.writeText(p.tip_texto || gerarTipTexto(p));
    toast.success("TIP copiada");
  };

  const handlePublicar = async (p: Prognostico) => {
    if (!podePublicar(p)) {
      toast.error("Apenas CONFIRMA / CONFIRMA COM CAUTELA podem ser publicados");
      return;
    }
    await publicar.mutateAsync({ id: p.id, tip_texto: gerarTipTexto(p) });
    toast.success("Pick publicada");
  };

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
          <Button variant="outline" asChild>
            <Link to="/importar">
              <Upload className="h-4 w-4" /> Importar
            </Link>
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
              data, hora, esporte, liga, jogo, mandante, visitante, mercado, pick, linha, odd_ofertada, odd_valor, probabilidade_final, edge, stake
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Input type="date" value={fData} onChange={(e) => setFData(e.target.value)} />
        <Select value={fEsporte} onValueChange={setFEsporte}>
          <SelectTrigger><SelectValue placeholder="Esporte" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os esportes</SelectItem>
            {esportes.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fMercado} onValueChange={setFMercado}>
          <SelectTrigger><SelectValue placeholder="Mercado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os mercados</SelectItem>
            {mercados.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fValidacao} onValueChange={setFValidacao}>
          <SelectTrigger><SelectValue placeholder="Validação" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as validações</SelectItem>
            <SelectItem value="CONFIRMA">CONFIRMA</SelectItem>
            <SelectItem value="CONFIRMA COM CAUTELA">CONFIRMA COM CAUTELA</SelectItem>
            <SelectItem value="AGUARDAR NOTÍCIA">AGUARDAR NOTÍCIA</SelectItem>
            <SelectItem value="PASS">PASS</SelectItem>
            <SelectItem value="PENDENTE">PENDENTE</SelectItem>
          </SelectContent>
        </Select>
        <Select value={fPublicacao} onValueChange={setFPublicacao}>
          <SelectTrigger><SelectValue placeholder="Publicação" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as publicações</SelectItem>
            <SelectItem value="NAO_PUBLICADO">Não publicado</SelectItem>
            <SelectItem value="PUBLICADO">Publicado</SelectItem>
            <SelectItem value="FINALIZADO">Finalizado</SelectItem>
            <SelectItem value="CANCELADO">Cancelado</SelectItem>
          </SelectContent>
        </Select>
        <Select value={fResultado} onValueChange={setFResultado}>
          <SelectTrigger><SelectValue placeholder="Resultado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os resultados</SelectItem>
            <SelectItem value="GREEN">GREEN</SelectItem>
            <SelectItem value="HALF GREEN">HALF GREEN</SelectItem>
            <SelectItem value="RED">RED</SelectItem>
            <SelectItem value="HALF RED">HALF RED</SelectItem>
            <SelectItem value="PUSH">PUSH</SelectItem>
            <SelectItem value="VOID">VOID</SelectItem>
            <SelectItem value="PENDENTE">PENDENTE</SelectItem>
          </SelectContent>
        </Select>
      </div>


      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <SortableTh label="Data" k="data" align="left" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh label="Esporte" k="esporte" align="left" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh label="Liga" k="liga" align="left" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh label="Jogo" k="jogo" align="left" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <th className="px-3 py-2 text-left text-xs uppercase tracking-wider text-muted-foreground">Placar</th>
                <SortableTh label="Mercado" k="mercado" align="left" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh label="Pick" k="pick" align="left" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh label="Odd Of." k="odd_ofertada" align="right" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh label="Odd Val." k="odd_valor" align="right" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh label="Prob." k="probabilidade_final" align="right" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh label="Edge" k="edge" align="right" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh label="Stake" k="stake" align="right" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh label="Validação" k="status_validacao" align="left" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh label="Publicação" k="status_publicacao" align="left" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh label="Resultado" k="resultado" align="left" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <th className="px-3 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={16} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Carregando...
                  </td>
                </tr>
              )}
              {!isLoading && sorted.length === 0 && (
                <tr>
                  <td colSpan={16} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Nenhum prognóstico cadastrado.
                  </td>
                </tr>
              )}
              {sorted.map((p) => (
                <tr key={p.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{formatDateBR(p.data)}{p.hora ? ` ${p.hora.slice(0,5)}` : ""}</td>

                  <td className="px-3 py-2 whitespace-nowrap">{p.esporte}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{p.liga}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{p.jogo}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{p.placar_final ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{p.mercado}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{p.pick}</td>
                  <td className="px-3 py-2 text-right font-mono">{p.odd_ofertada.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono">{p.odd_valor.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono">{p.probabilidade_final.toFixed(1)}%</td>
                  <td className={`px-3 py-2 text-right font-mono ${p.edge >= 0 ? "text-success" : "text-destructive"}`}>
                    {p.edge.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{p.stake.toFixed(1)}u</td>
                  <td className="px-3 py-2"><StatusBadge status={p.status_validacao} /></td>
                  <td className="px-3 py-2"><PublicacaoBadge status={p.status_publicacao} /></td>
                  <td className="px-3 py-2"><ResultBadge result={p.resultado} /></td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <div className="flex justify-end gap-1">
                      {podePublicar(p) && (
                        <Button size="icon" variant="ghost" title="Publicar" onClick={() => handlePublicar(p)}>
                          <Megaphone className="h-4 w-4 text-primary" />
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" title="Copiar TIP" onClick={() => copyTip(p)}>
                        <Copy className="h-4 w-4" />
                      </Button>
                      {p.status_publicacao !== "CANCELADO" && p.status_publicacao !== "FINALIZADO" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Cancelar pick"
                          onClick={() => cancelar.mutate(p.id)}
                        >
                          <Ban className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
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

function SortableTh({
  label,
  k,
  align,
  sortKey,
  sortDir,
  onClick,
}: {
  label: string;
  k: SortKey;
  align: "left" | "right";
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onClick: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={`px-3 py-2 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${
          align === "right" ? "flex-row-reverse" : ""
        } ${active ? "text-foreground" : ""}`}
      >
        <span>{label}</span>
        <Icon className={`h-3 w-3 ${active ? "opacity-100" : "opacity-40"}`} />
      </button>
    </th>
  );
}

