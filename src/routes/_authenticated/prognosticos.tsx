import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Upload, Plus, FileSpreadsheet, Pencil, Trash2, Trophy, Megaphone, Copy, Ban, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge, ResultBadge, PublicacaoBadge } from "@/components/status-badge";
import { LeagueFilter } from "@/components/league-filter";
import { PeriodFilter } from "@/components/period-filter";
import { rangeFromPeriodo, dateInRange, type PeriodoFiltro } from "@/lib/metrics";
import { shouldShowLinha } from "@/lib/date-br";
import {
  usePrognosticos,
  useDeletePrognostico,
  useBulkDeletePrognosticos,
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
  | "hora"
  | "esporte"
  | "liga"
  | "jogo"
  | "mercado"
  | "pick"
  | "linha"
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
  const bulkDel = useBulkDeletePrognosticos();
  const publicar = usePublicarPrognostico();
  const cancelar = useCancelarPrognostico();

  const [editing, setEditing] = useState<Prognostico | null>(null);
  const [template, setTemplate] = useState<Prognostico | null>(null);
  const [openForm, setOpenForm] = useState(false);
  const [askRepeat, setAskRepeat] = useState(false);
  const [resultadoFor, setResultadoFor] = useState<Prognostico | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Prognostico | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("data");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const esportes = cfg?.esportes_ativos ?? ESPORTES_DEFAULT;
  const mercados = cfg?.mercados_ativos ?? MERCADOS_DEFAULT;
  const [fEsporte, setFEsporte] = useState("all");
  const [fLiga, setFLiga] = useState("all");
  const [fMercado, setFMercado] = useState("all");
  const [fValidacao, setFValidacao] = useState("all");
  const [fPublicacao, setFPublicacao] = useState("all");
  const [fResultado, setFResultado] = useState("all");
  const [fLinha, setFLinha] = useState("");
  const [periodo, setPeriodo] = useState<PeriodoFiltro>("tudo");
  const [customIni, setCustomIni] = useState("");
  const [customFim, setCustomFim] = useState("");

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  };

  const { ini, fim } = rangeFromPeriodo(periodo, customIni, customFim);

  const sorted = useMemo(() => {
    const arr = prognosticos.filter((p) => {
      if (!dateInRange(p.data, ini, fim)) return false;
      if (fEsporte !== "all" && p.esporte !== fEsporte) return false;
      if (fLiga !== "all" && p.liga !== fLiga) return false;
      if (fMercado !== "all" && p.mercado !== fMercado) return false;
      if (fValidacao !== "all" && p.status_validacao !== fValidacao) return false;
      if (fPublicacao !== "all" && p.status_publicacao !== fPublicacao) return false;
      if (fResultado !== "all" && p.resultado !== fResultado) return false;
      if (fLinha.trim()) {
        const q = fLinha.trim().toLowerCase();
        const inLinha = (p.linha ?? "").toString().toLowerCase().includes(q);
        const inPick = (p.pick ?? "").toLowerCase().includes(q);
        if (!inLinha && !inPick) return false;
      }
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
  }, [prognosticos, sortKey, sortDir, ini, fim, fEsporte, fLiga, fMercado, fValidacao, fPublicacao, fResultado, fLinha]);

  const allSelected = sorted.length > 0 && sorted.every((p) => selected.has(p.id));
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(sorted.map((p) => p.id)));
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const podePublicar = (p: Prognostico) =>
    p.status_publicacao === "NAO_PUBLICADO" &&
    p.status_validacao === "CONFIRMA";

  const copyTip = async (p: Prognostico) => {
    await navigator.clipboard.writeText(p.tip_texto || gerarTipTexto(p));
    toast.success("TIP copiada");
  };

  const handlePublicar = async (p: Prognostico) => {
    if (!podePublicar(p)) {
      toast.error("Apenas CONFIRMA pode ser publicado");
      return;
    }
    await publicar.mutateAsync({ id: p.id, tip_texto: gerarTipTexto(p) });
    toast.success("Pick publicada");
  };

  // Dual horizontal scrollbar (top + bottom synced)
  const topScrollRef = useRef<HTMLDivElement>(null);
  const bottomScrollRef = useRef<HTMLDivElement>(null);
  const tableWidthRef = useRef<HTMLDivElement>(null);
  const [tableWidth, setTableWidth] = useState(0);

  useEffect(() => {
    const update = () => {
      if (tableWidthRef.current) setTableWidth(tableWidthRef.current.scrollWidth);
    };
    update();
    const ro = new ResizeObserver(update);
    if (tableWidthRef.current) ro.observe(tableWidthRef.current);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [sorted.length]);

  const syncFromTop = () => {
    if (topScrollRef.current && bottomScrollRef.current) {
      bottomScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
  };
  const syncFromBottom = () => {
    if (topScrollRef.current && bottomScrollRef.current) {
      topScrollRef.current.scrollLeft = bottomScrollRef.current.scrollLeft;
    }
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
              if (prognosticos.length > 0) {
                setAskRepeat(true);
              } else {
                setTemplate(null);
                setOpenForm(true);
              }
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
              data, hora, esporte, liga, jogo, mandante, visitante, mercado, pick, linha, odd_ofertada, odd_valor, probabilidade_final, edge
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-3 space-y-3">
        <PeriodFilter
          periodo={periodo}
          onPeriodoChange={setPeriodo}
          customIni={customIni}
          customFim={customFim}
          onCustomIniChange={setCustomIni}
          onCustomFimChange={setCustomFim}
        />
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-7">
          <Select value={fEsporte} onValueChange={(v) => { setFEsporte(v); setFLiga("all"); }}>
            <SelectTrigger><SelectValue placeholder="Esporte" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os esportes</SelectItem>
              {esportes.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <LeagueFilter sport={fEsporte} value={fLiga} onChange={setFLiga} />
          <Select value={fMercado} onValueChange={setFMercado}>
            <SelectTrigger><SelectValue placeholder="Mercado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os mercados</SelectItem>
              {mercados.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            placeholder="Linha (ex: 2.5, +1.5)"
            value={fLinha}
            onChange={(e) => setFLinha(e.target.value)}
          />
          <Select value={fValidacao} onValueChange={setFValidacao}>
            <SelectTrigger><SelectValue placeholder="Validação" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as validações</SelectItem>
              <SelectItem value="CONFIRMA">CONFIRMA</SelectItem>
              <SelectItem value="PULAR">PULAR</SelectItem>
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
              <SelectItem value="RED">RED</SelectItem>
              <SelectItem value="PENDENTE">PENDENTE</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          <span>{selected.size} selecionado(s)</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Limpar seleção
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setConfirmBulkDelete(true)}
            >
              <Trash2 className="h-4 w-4" /> Excluir selecionados
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {/* Top horizontal scrollbar */}
        <div
          ref={topScrollRef}
          onScroll={syncFromTop}
          className="overflow-x-auto overflow-y-hidden"
        >
          <div style={{ width: tableWidth, height: 1 }} />
        </div>

        <div
          ref={bottomScrollRef}
          onScroll={syncFromBottom}
          className="overflow-x-auto"
        >
          <div ref={tableWidthRef}>
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 w-10">
                    <Checkbox
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={toggleAll}
                      aria-label="Selecionar todos"
                    />
                  </th>
                  <SortableTh label="Data" k="data" align="left" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <SortableTh label="Hora" k="hora" align="left" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
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
                  <SortableTh label="Resultado" k="resultado" align="left" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <th className="px-3 py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={17} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      Carregando...
                    </td>
                  </tr>
                )}
                {!isLoading && sorted.length === 0 && (
                  <tr>
                    <td colSpan={17} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      Nenhum prognóstico cadastrado.
                    </td>
                  </tr>
                )}
                {sorted.map((p) => (
                  <tr key={p.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <Checkbox
                        checked={selected.has(p.id)}
                        onCheckedChange={() => toggleOne(p.id)}
                        aria-label="Selecionar"
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{formatDateBR(p.data)}</td>
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{p.hora ? p.hora.slice(0, 5) : "—"}</td>
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
      </div>

      <PrognosticoDialog
        open={openForm}
        onOpenChange={(o) => {
          setOpenForm(o);
          if (!o) setTemplate(null);
        }}
        prognostico={editing}
        template={editing ? null : template}
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

      <AlertDialog open={confirmBulkDelete} onOpenChange={setConfirmBulkDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {selected.size} prognóstico(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  await bulkDel.mutateAsync(Array.from(selected));
                  toast.success(`${selected.size} prognóstico(s) excluído(s)`);
                  setSelected(new Set());
                } catch (e) {
                  toast.error((e as Error).message);
                }
                setConfirmBulkDelete(false);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={askRepeat} onOpenChange={setAskRepeat}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Repetir dados do último prognóstico?</AlertDialogTitle>
            <AlertDialogDescription>
              {prognosticos[0] && (
                <>Último: <span className="font-medium text-foreground">{prognosticos[0].jogo}</span> — {prognosticos[0].mercado} / {prognosticos[0].pick}.</>
              )}
              <br />
              Você pode reaproveitar os dados (times, liga, mercado, etc.) e ajustar o que mudou, ou começar um prognóstico totalmente novo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setTemplate(null);
                setAskRepeat(false);
                setOpenForm(true);
              }}
            >
              Começar novo
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setTemplate(prognosticos[0] ?? null);
                setAskRepeat(false);
                setOpenForm(true);
              }}
            >
              Repetir dados
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
