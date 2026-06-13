import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { StatusBadge, ResultBadge, PublicacaoBadge } from "@/components/status-badge";
import { usePrognosticos, useConfiguracao, useResultadosFinanceiros, ESPORTES_DEFAULT, MERCADOS_DEFAULT } from "@/lib/db";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { LeagueFilter } from "@/components/league-filter";
import { PeriodFilter } from "@/components/period-filter";
import { calculatePerformanceStats, rangeFromPeriodo, dateInRange, type PeriodoFiltro } from "@/lib/metrics";
import { formatBR, formatHora, shouldShowLinha } from "@/lib/date-br";
import { DadosTecnicosViewer } from "@/components/dados-tecnicos-viewer";
import { PaginationControls } from "@/components/pagination-controls";
import { useClientPagination } from "@/lib/pagination";

export const Route = createFileRoute("/_authenticated/historico")({
  head: () => ({ meta: [{ title: "Histórico — ASP Insights" }] }),
  component: Historico,
});

function Historico() {
  const { data: prognosticos = [] } = usePrognosticos();
  const { data: resultadosFinanceiros = [] } = useResultadosFinanceiros();
  const { data: cfg } = useConfiguracao();
  const esportes = cfg?.esportes_ativos ?? ESPORTES_DEFAULT;
  const mercados = cfg?.mercados_ativos ?? MERCADOS_DEFAULT;

  const [esporte, setEsporte] = useState("all");
  const [liga, setLiga] = useState("all");
  const [mercado, setMercado] = useState("all");
  const [status, setStatus] = useState("all");
  const [resultado, setResultado] = useState("all");
  const [publicacao, setPublicacao] = useState("all");
  const [data, setData] = useState("");
  const [periodo, setPeriodo] = useState<PeriodoFiltro>("tudo");
  const [customIni, setCustomIni] = useState("");
  const [customFim, setCustomFim] = useState("");

  const { ini, fim } = rangeFromPeriodo(periodo, customIni, customFim);

  const rows = useMemo(() => {
    return prognosticos.filter((p) => {
      if (!dateInRange(p.data, ini, fim)) return false;
      if (esporte !== "all" && p.esporte !== esporte) return false;
      if (liga !== "all" && p.liga !== liga) return false;
      if (mercado !== "all" && p.mercado !== mercado) return false;
      if (status !== "all" && p.status_validacao !== status) return false;
      if (resultado !== "all" && p.resultado !== resultado) return false;
      if (publicacao !== "all" && p.status_publicacao !== publicacao) return false;
      if (data && p.data !== data) return false;
      return true;
    });
  }, [prognosticos, ini, fim, esporte, liga, mercado, status, resultado, publicacao, data]);

  const stats = useMemo(
    () =>
      calculatePerformanceStats(resultadosFinanceiros, cfg, {
        ini: data || ini,
        fim: data || fim,
        esporte,
        liga,
        mercado,
        resultado: resultado as "GREEN" | "RED" | "PENDENTE" | "all",
        decisaoHumana: status as "CONFIRMA" | "PULAR" | "PENDENTE" | "all",
      }),
    [resultadosFinanceiros, cfg, ini, fim, esporte, liga, mercado, status, resultado, data],
  );

  const lucro = stats.lucroU;
  const pagination = useClientPagination(rows);
  const visibleRows = pagination.paginatedRows;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Histórico</h1>
        <p className="text-sm text-muted-foreground">
          Todos os prognósticos com filtros e resultados consolidados.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-3">
        <PeriodFilter
          periodo={periodo}
          onPeriodoChange={setPeriodo}
          customIni={customIni}
          customFim={customFim}
          onCustomIniChange={setCustomIni}
          onCustomFimChange={setCustomFim}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-7">
        <Input type="date" value={data} onChange={(e) => setData(e.target.value)} placeholder="Data exata" />
        <Select value={esporte} onValueChange={(v) => { setEsporte(v); setLiga("all"); }}>
          <SelectTrigger><SelectValue placeholder="Esporte" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os esportes</SelectItem>
            {esportes.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <LeagueFilter sport={esporte} value={liga} onChange={setLiga} />
        <Select value={mercado} onValueChange={setMercado}>
          <SelectTrigger><SelectValue placeholder="Mercado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os mercados</SelectItem>
            {mercados.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger><SelectValue placeholder="Validação" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as validações</SelectItem>
            <SelectItem value="CONFIRMA">CONFIRMA</SelectItem>
            <SelectItem value="PULAR">PULAR</SelectItem>
            <SelectItem value="PENDENTE">PENDENTE</SelectItem>
          </SelectContent>
        </Select>
        <Select value={publicacao} onValueChange={setPublicacao}>
          <SelectTrigger><SelectValue placeholder="Publicação" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as publicações</SelectItem>
            <SelectItem value="NAO_PUBLICADO">Não publicado</SelectItem>
            <SelectItem value="PUBLICADO">Publicado</SelectItem>
            <SelectItem value="FINALIZADO">Finalizado</SelectItem>
            <SelectItem value="CANCELADO">Cancelado</SelectItem>
          </SelectContent>
        </Select>
        <Select value={resultado} onValueChange={setResultado}>
          <SelectTrigger><SelectValue placeholder="Resultado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os resultados</SelectItem>
            <SelectItem value="GREEN">GREEN</SelectItem>
            <SelectItem value="RED">RED</SelectItem>
            <SelectItem value="PENDENTE">PENDENTE</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="GREEN" value={String(stats.greens)} tone="good" />
        <Stat label="RED" value={String(stats.reds)} tone="bad" />
        <Stat label="Resolvidos" value={String(stats.resolvidas)} />
        <Stat label="Lucro" value={`${lucro >= 0 ? "+" : ""}${lucro.toFixed(2)}u`} tone={lucro >= 0 ? "good" : "bad"} />
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Data</th>
                <th className="px-3 py-2 text-left">Hora</th>
                <th className="px-3 py-2 text-left">Esporte</th>
                <th className="px-3 py-2 text-left">Liga</th>
                <th className="px-3 py-2 text-left">Jogo</th>
                <th className="px-3 py-2 text-left">Placar</th>
                <th className="px-3 py-2 text-left">Mercado</th>
                <th className="px-3 py-2 text-left">Pick</th>
                <th className="px-3 py-2 text-left">Linha</th>
                <th className="px-3 py-2 text-right font-mono">Odd</th>
                <th className="px-3 py-2 text-right font-mono">Stake</th>
                <th className="px-3 py-2 text-left">Validação</th>
                <th className="px-3 py-2 text-left">Publicação</th>
                <th className="px-3 py-2 text-left">Resultado</th>
                <th className="px-3 py-2 text-right font-mono">Lucro</th>
                <th className="px-3 py-2 text-center">Dados</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((p) => (
                <tr key={p.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{formatBR(p.data)}</td>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{p.hora ? formatHora(p.hora) : "—"}</td>
                  <td className="px-3 py-2">{p.esporte}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.liga}</td>
                  <td className="px-3 py-2">{p.jogo}</td>
                  <td className="px-3 py-2 font-mono text-xs">{p.placar_final ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.mercado}</td>
                  <td className="px-3 py-2">{p.pick}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{shouldShowLinha(p.pick, p.linha) ? p.linha : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{p.odd_ofertada.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono">{p.stake.toFixed(1)}u</td>
                  <td className="px-3 py-2"><StatusBadge status={p.status_validacao} /></td>
                  <td className="px-3 py-2"><PublicacaoBadge status={p.status_publicacao} /></td>
                  <td className="px-3 py-2"><ResultBadge result={p.resultado} /></td>
                  <td className={`px-3 py-2 text-right font-mono ${(p.lucro_prejuizo ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>
                    {p.lucro_prejuizo != null ? `${p.lucro_prejuizo >= 0 ? "+" : ""}${p.lucro_prejuizo.toFixed(2)}u` : "-"}
                  </td>
                  <td className="px-3 py-2 text-center"><DadosTecnicosViewer prognostico={p} /></td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={15} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Nenhum prognóstico encontrado com os filtros aplicados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <PaginationControls
          page={pagination.page}
          pageSize={pagination.pageSize}
          totalPages={pagination.totalPages}
          totalRows={pagination.totalRows}
          onPageChange={pagination.setPage}
          onPageSizeChange={pagination.setPageSize}
        />
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={`mt-1 font-mono text-xl font-bold ${
          tone === "good" ? "text-success" : tone === "bad" ? "text-destructive" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
