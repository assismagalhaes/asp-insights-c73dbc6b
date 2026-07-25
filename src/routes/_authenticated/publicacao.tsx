import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Megaphone,
  Copy,
  Ban,
  Send,
  CheckSquare,
  Square,
  Eye,
  FileCheck2,
  ListChecks,
  Coins,
  RotateCcw,
  RadioTower,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  usePrognosticos,
  useConfiguracao,
  usePublicarPrognostico,
  useCancelarPrognostico,
  useValidacaoByPrognostico,
  gerarTipTexto,
  ESPORTES_DEFAULT,
  MERCADOS_DEFAULT,
  type Prognostico,
} from "@/lib/db";
import { StatusBadge, PublicacaoBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LeagueFilter } from "@/components/league-filter";
import { SportFilterSelect } from "@/components/sport-filter-select";
import { PeriodFilter } from "@/components/period-filter";
import { rangeFromPeriodo, dateInRange, type PeriodoFiltro } from "@/lib/metrics";
import { formatBR, formatHora } from "@/lib/date-br";
import { toast } from "sonner";
import { DadosTecnicosViewer } from "@/components/dados-tecnicos-viewer";
import { AmbientBackdrop, PageIntro, PanelHeading } from "@/components/command-center";
import { StatCard } from "@/components/stat-card";
import { SportMark } from "@/components/sport-filter-select";

export const Route = createFileRoute("/_authenticated/publicacao")({
  head: () => ({ meta: [{ title: "Publicação — ASP Insights" }] }),
  component: PublicacaoPage,
});

function PublicacaoPage() {
  const { data: prognosticos = [], isLoading: loadingPrognosticos } = usePrognosticos();
  const { data: cfg } = useConfiguracao();
  const publicar = usePublicarPrognostico();
  const cancelar = useCancelarPrognostico();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewFor, setPreviewFor] = useState<Prognostico | null>(null);
  const [canal, setCanal] = useState("Telegram");
  const [fEsporte, setFEsporte] = useState("all");
  const [fLiga, setFLiga] = useState("all");
  const [fMercado, setFMercado] = useState("all");
  const [periodo, setPeriodo] = useState<PeriodoFiltro>("tudo");
  const [customIni, setCustomIni] = useState("");
  const [customFim, setCustomFim] = useState("");
  const [showAllEligible, setShowAllEligible] = useState(false);

  const esportes = cfg?.esportes_ativos ?? ESPORTES_DEFAULT;
  const mercados = cfg?.mercados_ativos ?? MERCADOS_DEFAULT;

  const { ini, fim } = rangeFromPeriodo(periodo, customIni, customFim);

  const elegiveis = useMemo(
    () =>
      prognosticos.filter(
        (p) =>
          p.status_publicacao === "NAO_PUBLICADO" &&
          p.status_validacao === "CONFIRMA" &&
          dateInRange(p.data, ini, fim) &&
          (fEsporte === "all" || p.esporte === fEsporte) &&
          (fLiga === "all" || p.liga === fLiga) &&
          (fMercado === "all" || p.mercado === fMercado),
      ),
    [prognosticos, ini, fim, fEsporte, fLiga, fMercado],
  );

  const podePublicar = (p: Prognostico) => p.status_validacao === "CONFIRMA";
  const visibleElegiveis = showAllEligible ? elegiveis : elegiveis.slice(0, 8);

  const publicadasHoje = useMemo(() => {
    const hoje = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    return prognosticos.filter(
      (p) =>
        p.status_publicacao === "PUBLICADO" &&
        p.data_publicacao &&
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Sao_Paulo",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(p.data_publicacao)) === hoje,
    ).length;
  }, [prognosticos]);

  const stakeElegivel = useMemo(
    () => elegiveis.reduce((total, prognostico) => total + prognostico.stake, 0),
    [elegiveis],
  );

  const limparFiltros = () => {
    setPeriodo("tudo");
    setCustomIni("");
    setCustomFim("");
    setFEsporte("all");
    setFLiga("all");
    setFMercado("all");
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const publicarLote = async () => {
    const alvos = elegiveis.filter((p) => selected.has(p.id) && podePublicar(p));
    if (!alvos.length) {
      toast.error("Selecione ao menos um prognóstico confirmado para publicar.");
      return;
    }
    for (const p of alvos) {
      await publicar.mutateAsync({
        id: p.id,
        tip_texto: gerarTipTexto(p),
        canal_publicacao: canal,
      });
    }
    toast.success(`${alvos.length} pick(s) publicada(s)`);
    setSelected(new Set());
  };

  return (
    <div className="page-stack relative isolate">
      <AmbientBackdrop />
      <PageIntro
        title="Publicação"
        description="Transforme prognósticos validados em picks oficiais."
        status={
          loadingPrognosticos ? "Carregando fila..." : `${elegiveis.length} pick(s) elegível(is)`
        }
        icon={Megaphone}
        actions={
          <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-[11rem_auto]">
            <div className="relative">
              <RadioTower
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-primary"
              />
              <Label htmlFor="canal-publicacao" className="sr-only">
                Canal de publicação
              </Label>
              <Select value={canal} onValueChange={setCanal}>
                <SelectTrigger
                  id="canal-publicacao"
                  aria-label="Canal de publicação"
                  className="h-10 w-full pl-9 sm:w-44"
                >
                  <SelectValue placeholder="Canal" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Telegram">Telegram</SelectItem>
                  <SelectItem value="WhatsApp">WhatsApp</SelectItem>
                  <SelectItem value="Manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              className="h-10 shadow-[0_0_24px_rgb(59_130_246/0.16)]"
              onClick={publicarLote}
              disabled={loadingPrognosticos || selected.size === 0 || publicar.isPending}
            >
              <Send className="mr-2 size-4" /> Publicar em lote ({selected.size})
            </Button>
          </div>
        }
      />

      <section className="relative overflow-hidden rounded-lg border border-border/90 bg-card/80 p-3 shadow-[0_16px_36px_rgb(0_0_0/0.12)]">
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-0.5 bg-[linear-gradient(var(--color-primary),var(--color-ai))]"
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1.1fr_1.1fr_1.2fr_auto] xl:items-end">
          <PeriodFilter
            periodo={periodo}
            onPeriodoChange={setPeriodo}
            customIni={customIni}
            customFim={customFim}
            onCustomIniChange={setCustomIni}
            onCustomFimChange={setCustomFim}
          />
          <div className="min-w-0">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Esporte
            </Label>
            <SportFilterSelect
              value={fEsporte}
              onValueChange={(v) => {
                setFEsporte(v);
                setFLiga("all");
              }}
              options={esportes}
              className="h-9 w-full"
            />
          </div>
          <div className="min-w-0">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Liga
            </Label>
            <LeagueFilter
              sport={fEsporte}
              value={fLiga}
              onChange={setFLiga}
              className="h-9 w-full"
            />
          </div>
          <div className="min-w-0">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Mercado
            </Label>
            <Select value={fMercado} onValueChange={setFMercado}>
              <SelectTrigger className="h-9 w-full">
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
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-9 sm:col-span-2 xl:col-span-1"
            onClick={limparFiltros}
          >
            <RotateCcw aria-hidden="true" className="mr-2 size-3.5" />
            Limpar filtros
          </Button>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          label="Elegíveis"
          value={loadingPrognosticos ? "—" : String(elegiveis.length)}
          icon={FileCheck2}
          accent="blue"
          meta="Validadas e não publicadas"
          layout="horizontal"
        />
        <StatCard
          label="Selecionadas"
          value={loadingPrognosticos ? "—" : String(selected.size)}
          icon={ListChecks}
          accent="green"
          tone={selected.size > 0 ? "up" : "off"}
          meta="Prontas para o lote atual"
          layout="horizontal"
        />
        <StatCard
          label="Publicadas hoje"
          value={loadingPrognosticos ? "—" : String(publicadasHoje)}
          icon={Send}
          accent="cyan"
          tone={publicadasHoje > 0 ? "up" : "off"}
          meta="Horário de Brasília"
          layout="horizontal"
        />
        <StatCard
          label="Stake elegível"
          value={loadingPrognosticos ? "—" : `${stakeElegivel.toFixed(1)}u`}
          icon={Coins}
          accent="amber"
          meta="Soma do recorte selecionado"
          layout="horizontal"
        />
      </div>

      <Card className="overflow-hidden border-primary/15">
        <CardHeader className="border-b border-border/80 pb-3">
          <PanelHeading
            title="Picks prontas para publicação"
            eyebrow="Fila operacional"
            icon={Megaphone}
            value={
              <span className="rounded border border-primary/30 bg-primary/8 px-2 py-1 font-mono text-xs text-primary">
                {elegiveis.length}
              </span>
            }
            className="mb-0"
          />
          <CardDescription>
            Apenas prognósticos com validação <strong>CONFIRMA</strong> podem ser publicados.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="hidden md:block">
            <table className="w-full table-fixed text-[12px]">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="w-9 px-2 py-2"></th>
                  <th className="w-[76px] px-2 py-2 text-left">Data</th>
                  <th className="w-[52px] px-2 py-2 text-left">Hora</th>
                  <th className="w-[94px] px-2 py-2 text-left">Esporte</th>
                  <th className="w-[10%] px-2 py-2 text-left">Liga</th>
                  <th className="w-[17%] px-2 py-2 text-left">Jogo</th>
                  <th className="w-[10%] px-2 py-2 text-left">Mercado</th>
                  <th className="w-[10%] px-2 py-2 text-left">Pick</th>
                  <th className="w-[52px] px-2 py-2 text-right font-mono">Odd</th>
                  <th className="w-[58px] px-2 py-2 text-right font-mono">Stake</th>
                  <th className="w-[86px] px-2 py-2 text-left">Validação</th>
                  <th className="w-[142px] px-2 py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loadingPrognosticos && (
                  <tr>
                    <td colSpan={12} className="px-4 py-10 text-center text-muted-foreground">
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="size-4 animate-spin text-primary" />
                        Carregando picks elegíveis...
                      </span>
                    </td>
                  </tr>
                )}
                {!loadingPrognosticos && elegiveis.length === 0 && (
                  <tr>
                    <td
                      colSpan={12}
                      className="px-4 py-8 text-center text-sm text-muted-foreground"
                    >
                      Nenhum prognóstico aguardando publicação no momento.
                    </td>
                  </tr>
                )}
                {!loadingPrognosticos &&
                  visibleElegiveis.map((p) => {
                    const canSelect = podePublicar(p);
                    return (
                      <tr
                        key={p.id}
                        className="border-t border-border transition-colors hover:bg-primary/[0.035]"
                      >
                        <td className="px-2 py-2">
                          <button
                            disabled={!canSelect}
                            onClick={() => toggle(p.id)}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                          >
                            {selected.has(p.id) ? (
                              <CheckSquare className="h-4 w-4 text-primary" />
                            ) : (
                              <Square className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 font-mono text-[11px]">
                          {formatBR(p.data)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 font-mono text-[11px]">
                          {p.hora ? formatHora(p.hora) : "—"}
                        </td>
                        <td className="px-2 py-2">
                          <span className="inline-flex max-w-full items-center gap-1.5">
                            <SportMark sport={p.esporte} />
                            <span className="truncate">{p.esporte}</span>
                          </span>
                        </td>
                        <td className="px-2 py-2 text-muted-foreground">
                          <span className="block truncate" title={p.liga}>
                            {p.liga}
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          <span className="block truncate font-medium" title={p.jogo}>
                            {p.jogo}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-muted-foreground">
                          <span className="block truncate" title={p.mercado}>
                            {p.mercado}
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          <span className="block truncate" title={p.pick}>
                            {p.pick}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right font-mono">
                          {p.odd_ofertada.toFixed(2)}
                        </td>
                        <td className="px-2 py-2 text-right font-mono">{p.stake.toFixed(1)}u</td>
                        <td className="px-2 py-2">
                          <StatusBadge status={p.status_validacao} />
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-right">
                          <div className="flex justify-end gap-0.5">
                            <DadosTecnicosViewer prognostico={p} />
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setPreviewFor(p)}
                              title="Pré-visualizar TIP"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => cancelar.mutate(p.id)}
                              title="Cancelar pick"
                            >
                              <Ban className="h-4 w-4 text-destructive" />
                            </Button>
                            <Button
                              size="icon"
                              onClick={() => setPreviewFor(p)}
                              title="Publicar pick"
                              aria-label={`Publicar ${p.jogo}`}
                            >
                              <Send className="size-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-border md:hidden">
            {loadingPrognosticos ? (
              <p className="flex items-center justify-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin text-primary" />
                Carregando picks elegíveis...
              </p>
            ) : null}
            {!loadingPrognosticos && elegiveis.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                Nenhum prognóstico aguardando publicação no momento.
              </p>
            ) : null}
            {!loadingPrognosticos &&
              visibleElegiveis.map((p) => (
                <article
                  key={p.id}
                  className="relative grid grid-cols-[auto_1fr] gap-2.5 px-3 py-3 transition-colors hover:bg-primary/[0.035]"
                >
                  <button
                    type="button"
                    disabled={!podePublicar(p)}
                    onClick={() => toggle(p.id)}
                    className="mt-0.5 flex size-10 items-center justify-center rounded-md border border-border bg-background/45 text-muted-foreground disabled:opacity-30"
                    aria-label={`${selected.has(p.id) ? "Remover" : "Selecionar"} ${p.jogo}`}
                  >
                    {selected.has(p.id) ? (
                      <CheckSquare className="size-5 text-success" />
                    ) : (
                      <SportMark sport={p.esporte} size="md" />
                    )}
                  </button>
                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="line-clamp-2 text-sm font-semibold leading-tight">
                          {p.jogo}
                        </h3>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {p.liga} · {formatBR(p.data)} {p.hora ? formatHora(p.hora) : ""}
                        </p>
                      </div>
                      <StatusBadge status={p.status_validacao} />
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 border-y border-border/70 py-1.5">
                      <div>
                        <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
                          Pick
                        </p>
                        <p className="truncate text-xs font-semibold text-success">{p.pick}</p>
                      </div>
                      <div>
                        <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
                          Odd
                        </p>
                        <p className="font-mono text-sm">{p.odd_ofertada.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
                          Stake
                        </p>
                        <p className="font-mono text-sm">{p.stake.toFixed(1)}u</p>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">{p.mercado}</span>
                      <div className="flex shrink-0 gap-1">
                        <DadosTecnicosViewer prognostico={p} />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setPreviewFor(p)}
                          aria-label={`Pré-visualizar ${p.jogo}`}
                        >
                          <Eye className="size-4" />
                        </Button>
                        <Button size="sm" onClick={() => setPreviewFor(p)}>
                          <Send className="mr-1 size-4" /> Publicar
                        </Button>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
          </div>
          {elegiveis.length > 8 && (
            <div className="border-t border-border/80 p-2 text-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAllEligible((value) => !value)}
              >
                {showAllEligible ? (
                  <ChevronUp className="mr-1.5 size-4" />
                ) : (
                  <ChevronDown className="mr-1.5 size-4" />
                )}
                {showAllEligible ? "Mostrar resumo" : `Ver todas as ${elegiveis.length} picks`}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <PublishDialog prognostico={previewFor} canal={canal} onClose={() => setPreviewFor(null)} />

      <PublicadasRecentes prognosticos={prognosticos} loading={loadingPrognosticos} />
    </div>
  );
}

function PublishDialog({
  prognostico,
  canal,
  onClose,
}: {
  prognostico: Prognostico | null;
  canal: string;
  onClose: () => void;
}) {
  const publicar = usePublicarPrognostico();
  const { data: validacao } = useValidacaoByPrognostico(prognostico?.id);
  const [tip, setTip] = useState("");

  useEffect(() => {
    if (prognostico) {
      const parecer = validacao?.parecer_validacao?.trim() || validacao?.parecer_ia?.trim() || "";
      setTip(
        gerarTipTexto(prognostico, {
          parecer,
          justificativa: validacao?.justificativa,
          riscos: validacao?.riscos_identificados,
          comentarios: validacao?.comentarios_analista,
        }),
      );
    }
  }, [prognostico, validacao]);

  if (!prognostico) return null;

  const copy = async () => {
    await navigator.clipboard.writeText(tip);
    toast.success("TIP copiada para a área de transferência");
  };

  const send = async () => {
    await publicar.mutateAsync({
      id: prognostico.id,
      tip_texto: tip,
      canal_publicacao: canal,
    });
    toast.success("Pick publicada com sucesso");
    onClose();
  };

  return (
    <Dialog open={!!prognostico} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Publicar Pick — {prognostico.jogo}</DialogTitle>
          <DialogDescription className="flex items-center justify-between gap-2">
            <span>
              Edite a TIP final antes de copiar/publicar. Canal: <strong>{canal}</strong>
            </span>
            <DadosTecnicosViewer prognostico={prognostico} variant="button" />
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={tip}
          onChange={(e) => setTip(e.target.value)}
          rows={18}
          className="font-mono text-xs"
        />
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={copy}>
            <Copy className="h-4 w-4 mr-2" /> Copiar TIP
          </Button>
          <Button onClick={send} disabled={publicar.isPending}>
            <Send className="h-4 w-4 mr-2" /> Publicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PublicadasRecentes({
  prognosticos,
  loading,
}: {
  prognosticos: Prognostico[];
  loading: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const publicadas = prognosticos
    .filter(
      (p) =>
        Boolean(p.data_publicacao) &&
        (p.status_publicacao === "PUBLICADO" ||
          p.status_publicacao === "FINALIZADO" ||
          p.status_publicacao === "CANCELADO"),
    )
    .sort(
      (a, b) =>
        new Date(b.data_publicacao as string).getTime() -
        new Date(a.data_publicacao as string).getTime(),
    );
  const visiblePublicadas = showAll ? publicadas : publicadas.slice(0, 5);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border/80 pb-3">
        <PanelHeading
          title="Publicadas recentes"
          eyebrow="Atividade de saída"
          icon={Send}
          value={
            <span className="rounded border border-success/30 bg-success/8 px-2 py-1 font-mono text-xs text-success">
              {loading ? "—" : publicadas.length}
            </span>
          }
          className="mb-0"
        />
      </CardHeader>
      <CardContent className="p-0">
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Data Pub.</th>
                <th className="px-3 py-2 text-left">Jogo</th>
                <th className="px-3 py-2 text-left">Pick</th>
                <th className="px-3 py-2 text-left">Canal</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin text-success" />
                      Carregando atividade de publicação...
                    </span>
                  </td>
                </tr>
              )}
              {!loading && visiblePublicadas.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    Nenhuma publicação com data registrada neste recorte.
                  </td>
                </tr>
              )}
              {!loading &&
                visiblePublicadas.map((p) => (
                  <tr
                    key={p.id}
                    className="border-t border-border transition-colors hover:bg-success/[0.025]"
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      {p.data_publicacao
                        ? new Date(p.data_publicacao).toLocaleString("pt-BR", {
                            timeZone: "America/Sao_Paulo",
                          })
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-2">
                        <SportMark sport={p.esporte} />
                        {p.jogo}
                      </span>
                    </td>
                    <td className="px-3 py-2">{p.pick}</td>
                    <td className="px-3 py-2 text-muted-foreground">{p.canal_publicacao ?? "—"}</td>
                    <td className="px-3 py-2">
                      <PublicacaoBadge status={p.status_publicacao} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="divide-y divide-border sm:hidden">
          {loading && (
            <p className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin text-success" />
              Carregando atividade de publicação...
            </p>
          )}
          {!loading && visiblePublicadas.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Nenhuma publicação com data registrada neste recorte.
            </p>
          )}
          {!loading &&
            visiblePublicadas.map((p) => (
              <article key={p.id} className="flex gap-3 px-3 py-3">
                <SportMark sport={p.esporte} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-semibold">{p.jogo}</p>
                    <PublicacaoBadge status={p.status_publicacao} />
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {p.pick} · {p.canal_publicacao ?? "—"}
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                    {p.data_publicacao
                      ? new Date(p.data_publicacao).toLocaleString("pt-BR", {
                          timeZone: "America/Sao_Paulo",
                        })
                      : "—"}
                  </p>
                </div>
              </article>
            ))}
        </div>
        {publicadas.length > 5 && (
          <div className="border-t border-border/80 p-2 text-center">
            <Button variant="ghost" size="sm" onClick={() => setShowAll((value) => !value)}>
              {showAll ? (
                <ChevronUp className="mr-1.5 size-4" />
              ) : (
                <ChevronDown className="mr-1.5 size-4" />
              )}
              {showAll ? "Mostrar recentes" : `Ver todas as ${publicadas.length} publicações`}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
