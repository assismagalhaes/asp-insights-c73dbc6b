import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Trophy,
  Megaphone,
  Copy,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Activity,
  ShieldCheck,
  Clock3,
  CircleCheckBig,
  TrendingUp,
  RotateCcw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge, ResultBadge } from "@/components/status-badge";
import { LeagueFilter } from "@/components/league-filter";
import { PeriodFilter } from "@/components/period-filter";
import {
  rangeFromPeriodo,
  dateInRange,
  computeMetrics,
  isStatusConfirma,
  type PeriodoFiltro,
} from "@/lib/metrics";
import { StatCard } from "@/components/stat-card";
import { AmbientBackdrop, PageIntro } from "@/components/command-center";
import {
  usePrognosticos,
  useDeletePrognostico,
  useBulkDeletePrognosticos,
  useConfiguracao,
  usePublicarPrognostico,
  gerarTipTexto,
  getOddEfetiva,
  getEdgeEfetivo,
  ESPORTES_DEFAULT,
  MERCADOS_DEFAULT,
  type Prognostico,
} from "@/lib/db";
import { PrognosticoDialog } from "@/components/prognostico-dialog";
import { ResultadoDialog } from "@/components/resultado-dialog";
import { DadosTecnicosViewer } from "@/components/dados-tecnicos-viewer";
import { supabase } from "@/lib/supabase-public";
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
  head: () => ({ meta: [{ title: "Prognósticos - ASP Insights" }] }),
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
  | "odd_ofertada"
  | "odd_valor"
  | "probabilidade_final"
  | "edge"
  | "stake"
  | "status_validacao"
  | "resultado";

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

function formatDateBR(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function sportVisual(sport: string) {
  const normalized = sport.toLocaleLowerCase("pt-BR");
  if (normalized.includes("baseball") || normalized.includes("beisebol")) {
    return { symbol: "⚾", className: "bg-red-500/10 text-red-400" };
  }
  if (normalized.includes("basket") || normalized.includes("basquete")) {
    return { symbol: "🏀", className: "bg-orange-500/10 text-orange-400" };
  }
  if (normalized.includes("futebol") || normalized.includes("football")) {
    return { symbol: "⚽", className: "bg-emerald-500/10 text-emerald-400" };
  }
  return { symbol: "◆", className: "bg-primary/10 text-primary" };
}

function Prognosticos() {
  const { data: prognosticos = [], isLoading } = usePrognosticos();
  const { data: cfg } = useConfiguracao();
  const del = useDeletePrognostico();
  const bulkDel = useBulkDeletePrognosticos();
  const publicar = usePublicarPrognostico();

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
  const [fResultado, setFResultado] = useState("all");
  const [fTopFinal, setFTopFinal] = useState("all");
  const [periodo, setPeriodo] = useState<PeriodoFiltro>("tudo");
  const [customIni, setCustomIni] = useState("");
  const [customFim, setCustomFim] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(10);

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
      if (fResultado !== "all" && p.resultado !== fResultado) return false;
      if (fTopFinal === "yes" && !p.is_top_final) return false;
      if (fTopFinal === "no" && p.is_top_final) return false;
      return true;
    });
    arr.sort((a, b) => {
      if (sortKey === "odd_ofertada") {
        const cmp = getOddEfetiva(a) - getOddEfetiva(b);
        return sortDir === "asc" ? cmp : -cmp;
      }
      if (sortKey === "edge") {
        const cmp = getEdgeEfetivo(a) - getEdgeEfetivo(b);
        return sortDir === "asc" ? cmp : -cmp;
      }
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
  }, [
    prognosticos,
    sortKey,
    sortDir,
    ini,
    fim,
    fEsporte,
    fLiga,
    fMercado,
    fValidacao,
    fResultado,
    fTopFinal,
  ]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, currentPage, pageSize]);

  const summary = useMemo(() => {
    const metrics = computeMetrics(sorted, cfg);
    return {
      total: sorted.length,
      confirmed: sorted.filter((p) => isStatusConfirma(p.status_validacao)).length,
      pending: sorted.filter((p) => p.status_validacao === "PENDENTE").length,
      greens: metrics.greens,
      roi: metrics.roi,
      averageOdd: sorted.length
        ? sorted.reduce((sum, p) => sum + getOddEfetiva(p), 0) / sorted.length
        : 0,
    };
  }, [sorted, cfg]);

  const clearFilters = () => {
    setPeriodo("tudo");
    setCustomIni("");
    setCustomFim("");
    setFEsporte("all");
    setFLiga("all");
    setFMercado("all");
    setFValidacao("all");
    setFResultado("all");
    setFTopFinal("all");
  };

  useEffect(() => {
    setPage(1);
  }, [ini, fim, fEsporte, fLiga, fMercado, fValidacao, fResultado, pageSize]);

  const allSelected = paginated.length > 0 && paginated.every((p) => selected.has(p.id));
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = () => {
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        paginated.forEach((p) => next.delete(p.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        paginated.forEach((p) => next.add(p.id));
        return next;
      });
    }
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
    p.status_publicacao === "NAO_PUBLICADO" && p.status_validacao === "CONFIRMA";

  const copyTip = async (p: Prognostico) => {
    if (p.status_validacao === "PULAR") {
      toast.info("Prognósticos pulados não geram TIP para publicação.");
      return;
    }
    const { data, error } = await supabase
      .from("validacoes")
      .select("parecer_validacao")
      .eq("prognostico_id", p.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      toast.error(error.message);
      return;
    }
    const justificativaFinal = String(data?.parecer_validacao ?? "").trim();
    if (!justificativaFinal) {
      toast.info("Este prognóstico ainda não tem justificativa final para copiar.");
      return;
    }
    await navigator.clipboard.writeText(gerarTipTexto(p, { parecer: justificativaFinal }));
    toast.success("TIP copiada para a área de transferência");
  };

  const handlePublicar = async (p: Prognostico) => {
    if (!podePublicar(p)) {
      toast.error("Só é possível publicar picks confirmadas.");
      return;
    }
    await publicar.mutateAsync({ id: p.id, tip_texto: gerarTipTexto(p) });
    toast.success("Pick publicada com sucesso");
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
  }, [paginated.length]);

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
    <div className="page-stack relative">
      <AmbientBackdrop />
      <PageIntro
        title="Prognósticos"
        description="Visualize, filtre e gerencie todos os prognósticos gerados."
        status="Operação preditiva"
        actions={
          <div className="w-full sm:w-auto">
            <Button
              className="w-full sm:w-auto"
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
              <Plus data-icon="inline-start" /> Novo Prognóstico
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Total"
          value={String(summary.total)}
          icon={Activity}
          accent="blue"
          meta="No recorte selecionado"
        />
        <StatCard
          label="Confirmados"
          value={String(summary.confirmed)}
          icon={ShieldCheck}
          tone="up"
          accent="green"
          meta={`${summary.total ? ((summary.confirmed / summary.total) * 100).toFixed(1) : "0.0"}% do total`}
        />
        <StatCard
          label="Pendentes"
          value={String(summary.pending)}
          icon={Clock3}
          tone="neutral"
          accent="amber"
          meta="Aguardando validação"
        />
        <StatCard
          label="Green"
          value={String(summary.greens)}
          icon={CircleCheckBig}
          tone="up"
          accent="violet"
          meta="Picks confirmadas resolvidas"
        />
        <StatCard
          label="ROI"
          value={`${summary.roi >= 0 ? "+" : ""}${summary.roi.toFixed(2)}%`}
          icon={TrendingUp}
          tone={summary.roi > 0 ? "up" : summary.roi < 0 ? "down" : "neutral"}
          accent="cyan"
          meta="Retorno das picks confirmadas"
        />
        <StatCard
          className="col-span-2 lg:col-span-1"
          label="Odd média"
          value={summary.averageOdd.toFixed(2)}
          icon={TrendingUp}
          tone="neutral"
          accent="blue"
          meta="Odd efetiva do recorte"
        />
      </div>

      <div className="filter-surface flex flex-col gap-3" aria-label="Filtros de prognósticos">
        <PeriodFilter
          periodo={periodo}
          onPeriodoChange={setPeriodo}
          customIni={customIni}
          customFim={customFim}
          onCustomIniChange={setCustomIni}
          onCustomFimChange={setCustomFim}
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <FilterField label="Esporte" htmlFor="prognosticos-esporte">
            <Select
              value={fEsporte}
              onValueChange={(v) => {
                setFEsporte(v);
                setFLiga("all");
              }}
            >
              <SelectTrigger id="prognosticos-esporte" className="h-10 w-full">
                <SelectValue placeholder="Esporte" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os esportes</SelectItem>
                {esportes.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Liga" htmlFor="prognosticos-liga">
            <LeagueFilter
              sport={fEsporte}
              value={fLiga}
              onChange={setFLiga}
              id="prognosticos-liga"
              className="h-10 w-full"
            />
          </FilterField>
          <FilterField label="Mercado" htmlFor="prognosticos-mercado">
            <Select value={fMercado} onValueChange={setFMercado}>
              <SelectTrigger id="prognosticos-mercado" className="h-10 w-full">
                <SelectValue placeholder="Mercado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os mercados</SelectItem>
                {mercados.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Validação" htmlFor="prognosticos-validacao">
            <Select value={fValidacao} onValueChange={setFValidacao}>
              <SelectTrigger id="prognosticos-validacao" className="h-10 w-full">
                <SelectValue placeholder="Validação" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as validações</SelectItem>
                <SelectItem value="CONFIRMA">CONFIRMA</SelectItem>
                <SelectItem value="PULAR">PULAR</SelectItem>
                <SelectItem value="PENDENTE">PENDENTE</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Resultado" htmlFor="prognosticos-resultado">
            <Select value={fResultado} onValueChange={setFResultado}>
              <SelectTrigger id="prognosticos-resultado" className="h-10 w-full">
                <SelectValue placeholder="Resultado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os resultados</SelectItem>
                <SelectItem value="GREEN">GREEN</SelectItem>
                <SelectItem value="RED">RED</SelectItem>
                <SelectItem value="PENDENTE">PENDENTE</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Origem shortlist" htmlFor="prognosticos-origem">
            <Select value={fTopFinal} onValueChange={setFTopFinal}>
              <SelectTrigger id="prognosticos-origem" className="h-10 w-full">
                <SelectValue placeholder="Origem shortlist" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos: Top Final</SelectItem>
                <SelectItem value="yes">Somente Top Final</SelectItem>
                <SelectItem value="no">Fora do Top Final</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
          <Button
            type="button"
            variant="outline"
            onClick={clearFilters}
            className="h-10 self-end sm:col-span-2 xl:justify-self-end"
          >
            <RotateCcw data-icon="inline-start" />
            Limpar filtros
          </Button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="selection-toolbar flex-col items-stretch text-sm sm:flex-row sm:items-center">
          <span className="font-mono">{selected.size} selecionado(s)</span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Limpar seleção
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setConfirmBulkDelete(true)}>
              <Trash2 className="h-4 w-4" /> Excluir selecionados
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-3 md:hidden" aria-label="Lista móvel de prognósticos">
        {isLoading ? (
          <div className="surface-panel py-10 text-center text-sm text-muted-foreground">
            Carregando...
          </div>
        ) : null}
        {!isLoading && sorted.length === 0 ? (
          <div className="surface-panel py-10 text-center text-sm text-muted-foreground">
            Nenhum prognóstico encontrado.
          </div>
        ) : null}
        {paginated.map((p) => {
          const oddEfetiva = getOddEfetiva(p);
          const edgeEfetivo = getEdgeEfetivo(p);
          return (
            <article key={p.id} className="surface-panel overflow-hidden p-0">
              <div className="flex items-start gap-3 border-b border-border/70 p-3">
                <Checkbox
                  checked={selected.has(p.id)}
                  onCheckedChange={() => toggleOne(p.id)}
                  aria-label={`Selecionar ${p.jogo}`}
                  className="mt-1"
                />
                <SportMark sport={p.esporte} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {formatDateBR(p.data)} · {p.hora ? p.hora.slice(0, 5) : "-"}
                    </span>
                    <StatusBadge status={p.status_validacao} />
                  </div>
                  <h2 className="mt-1 text-sm font-semibold leading-snug">{p.jogo}</h2>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {p.esporte} · {p.liga}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 p-3 text-xs">
                <MobileDatum label="Mercado / Pick" value={`${p.mercado} · ${p.pick}`} />
                <MobileDatum label="Placar" value={p.placar_final ?? "-"} />
                <MobileDatum label="Odd efetiva" value={oddEfetiva.toFixed(2)} mono />
                <MobileDatum label="Odd de valor" value={p.odd_valor.toFixed(2)} mono />
                <MobileDatum
                  label="Probabilidade"
                  value={`${p.probabilidade_final.toFixed(1)}%`}
                  mono
                />
                <MobileDatum
                  label="Edge"
                  value={`${edgeEfetivo >= 0 ? "+" : ""}${edgeEfetivo.toFixed(1)}%`}
                  mono
                  tone={edgeEfetivo >= 0 ? "success" : "danger"}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 bg-background/20 px-3 py-2">
                <div className="flex items-center gap-2">
                  <ResultBadge result={p.resultado} />
                  <span className="font-mono text-xs">{p.stake.toFixed(1)}u</span>
                </div>
                <div className="flex items-center gap-0.5">
                  <DadosTecnicosViewer prognostico={p} />
                  {podePublicar(p) ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Publicar"
                      onClick={() => handlePublicar(p)}
                    >
                      <Megaphone className="size-4 text-primary" />
                    </Button>
                  ) : null}
                  <Button size="icon" variant="ghost" title="Copiar TIP" onClick={() => copyTip(p)}>
                    <Copy className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Registrar resultado"
                    onClick={() => setResultadoFor(p)}
                  >
                    <Trophy className="size-4 text-warning" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Editar"
                    onClick={() => {
                      setEditing(p);
                      setOpenForm(true);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Excluir"
                    onClick={() => setConfirmDelete(p)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div
        className="data-surface hidden md:block"
        role="region"
        aria-label="Tabela de prognósticos"
        tabIndex={0}
      >
        {/* Top horizontal scrollbar */}
        <div
          ref={topScrollRef}
          onScroll={syncFromTop}
          className="overflow-x-auto overflow-y-hidden"
        >
          <div style={{ width: tableWidth, height: 1 }} />
        </div>

        <div ref={bottomScrollRef} onScroll={syncFromBottom} className="overflow-x-auto">
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
                  <SortableTh
                    label="Data"
                    k="data"
                    align="left"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onClick={toggleSort}
                  />
                  <SortableTh
                    label="Hora"
                    k="hora"
                    align="left"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onClick={toggleSort}
                  />
                  <SortableTh
                    label="Esporte"
                    k="esporte"
                    align="left"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onClick={toggleSort}
                  />
                  <SortableTh
                    label="Liga"
                    k="liga"
                    align="left"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onClick={toggleSort}
                  />
                  <SortableTh
                    label="Jogo"
                    k="jogo"
                    align="left"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onClick={toggleSort}
                  />
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    Placar
                  </th>
                  <SortableTh
                    label="Mercado"
                    k="mercado"
                    align="left"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onClick={toggleSort}
                  />
                  <SortableTh
                    label="Pick"
                    k="pick"
                    align="left"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onClick={toggleSort}
                  />
                  <SortableTh
                    label="Odd Of."
                    k="odd_ofertada"
                    align="right"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onClick={toggleSort}
                  />
                  <SortableTh
                    label="Odd Val."
                    k="odd_valor"
                    align="right"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onClick={toggleSort}
                  />
                  <SortableTh
                    label="Prob."
                    k="probabilidade_final"
                    align="right"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onClick={toggleSort}
                  />
                  <SortableTh
                    label="Edge"
                    k="edge"
                    align="right"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onClick={toggleSort}
                  />
                  <SortableTh
                    label="Stake"
                    k="stake"
                    align="right"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onClick={toggleSort}
                  />
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    Top final
                  </th>
                  <SortableTh
                    label="Validação"
                    k="status_validacao"
                    align="left"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onClick={toggleSort}
                  />
                  <SortableTh
                    label="Resultado"
                    k="resultado"
                    align="left"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onClick={toggleSort}
                  />
                  <th className="px-3 py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td
                      colSpan={18}
                      className="px-4 py-8 text-center text-sm text-muted-foreground"
                    >
                      Carregando...
                    </td>
                  </tr>
                )}
                {!isLoading && sorted.length === 0 && (
                  <tr>
                    <td
                      colSpan={18}
                      className="px-4 py-8 text-center text-sm text-muted-foreground"
                    >
                      Nenhum prognóstico cadastrado ainda.
                    </td>
                  </tr>
                )}
                {paginated.map((p) => {
                  const oddEfetiva = getOddEfetiva(p);
                  const edgeEfetivo = getEdgeEfetivo(p);
                  return (
                    <tr
                      key={p.id}
                      className="border-t border-border transition-colors hover:bg-primary/[0.035] [content-visibility:auto] [contain-intrinsic-size:0_48px]"
                    >
                      <td className="px-3 py-2">
                        <Checkbox
                          checked={selected.has(p.id)}
                          onCheckedChange={() => toggleOne(p.id)}
                          aria-label="Selecionar"
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                        {formatDateBR(p.data)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                        {p.hora ? p.hora.slice(0, 5) : "-"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <SportMark sport={p.esporte} />
                          {p.esporte}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {p.liga}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{p.jogo}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">
                        {p.placar_final ?? "-"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {p.mercado}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{p.pick}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {oddEfetiva.toFixed(2)}
                        {p.odd_ajustada != null && (
                          <span className="ml-1 text-[10px] text-muted-foreground">aj.</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{p.odd_valor.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {p.probabilidade_final.toFixed(1)}%
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono ${edgeEfetivo >= 0 ? "text-success" : "text-destructive"}`}
                      >
                        {edgeEfetivo.toFixed(1)}%
                        {p.edge_ajustado != null && (
                          <span className="ml-1 text-[10px] text-muted-foreground">aj.</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{p.stake.toFixed(1)}u</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {p.is_top_final ? (
                          <Badge title="Prognóstico selecionado no ranking final da shortlist">
                            <Trophy className="size-3" />
                            TOP FINAL{p.top_final_rank ? ` #${p.top_final_rank}` : ""}
                          </Badge>
                        ) : (
                          <Badge variant="outline" title="Prognóstico fora do Top Final">
                            Não
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={p.status_validacao} />
                      </td>
                      <td className="px-3 py-2">
                        <ResultBadge result={p.resultado} />
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <div className="flex justify-end gap-1">
                          <DadosTecnicosViewer prognostico={p} />

                          {podePublicar(p) && (
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Publicar"
                              onClick={() => handlePublicar(p)}
                            >
                              <Megaphone className="h-4 w-4 text-primary" />
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Copiar TIP"
                            onClick={() => copyTip(p)}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title={
                              p.resultado === "PENDENTE"
                                ? "Registrar resultado"
                                : "Editar resultado / placar"
                            }
                            onClick={() => setResultadoFor(p)}
                          >
                            <Trophy
                              className={`h-4 w-4 ${p.resultado === "PENDENTE" ? "text-warning" : "text-muted-foreground"}`}
                            />
                          </Button>

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
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <div>
          Mostrando {sorted.length ? (currentPage - 1) * pageSize + 1 : 0}
          {"-"}
          {Math.min(currentPage * pageSize, sorted.length)} de {sorted.length} prognóstico(s)
        </div>
        <div className="flex items-center gap-2">
          <span>Exibir</span>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => setPageSize(Number(v) as typeof pageSize)}
          >
            <SelectTrigger className="h-9 w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
          >
            Anterior
          </Button>
          <span className="font-mono text-xs">
            Página {currentPage}/{totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
          >
            Próxima
          </Button>
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
              {confirmDelete?.jogo} - {confirmDelete?.pick}. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!confirmDelete) return;
                try {
                  await del.mutateAsync(confirmDelete.id);
                  toast.success("Prognóstico excluído com sucesso");
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
            <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
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
                <>
                  Último:{" "}
                  <span className="font-medium text-foreground">{prognosticos[0].jogo}</span> -{" "}
                  {prognosticos[0].mercado} / {prognosticos[0].pick}.
                </>
              )}
              <br />
              Você pode reaproveitar os dados (times, liga, mercado, etc.) e ajustar o que mudou, ou
              começar um prognóstico totalmente novo.
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

function FilterField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="panel-kicker mb-1 block">
        {label}
      </label>
      {children}
    </div>
  );
}

function SportMark({ sport }: { sport: string }) {
  const visual = sportVisual(sport);
  return (
    <span
      aria-hidden="true"
      className={`inline-flex size-7 shrink-0 items-center justify-center rounded-md text-sm ${visual.className}`}
    >
      {visual.symbol}
    </span>
  );
}

function MobileDatum({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "success" | "danger";
}) {
  return (
    <div className="min-w-0">
      <p className="panel-kicker">{label}</p>
      <p
        className={`mt-1 break-words ${mono ? "font-mono tabular-nums" : ""} ${
          tone === "success" ? "text-success" : tone === "danger" ? "text-destructive" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
