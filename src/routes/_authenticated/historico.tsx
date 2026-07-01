import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { StatusBadge, ResultBadge } from "@/components/status-badge";
import { usePrognosticos, useConfiguracao, ESPORTES_DEFAULT, MERCADOS_DEFAULT, type Prognostico } from "@/lib/db";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LeagueFilter } from "@/components/league-filter";
import { PeriodFilter } from "@/components/period-filter";
import { rangeFromPeriodo, dateInRange, lucroUnidadesAnalitico, stakeAnalitica, type PeriodoFiltro } from "@/lib/metrics";
import { formatBR, formatHora, shouldShowLinha, todayBR } from "@/lib/date-br";
import { DadosTecnicosViewer } from "@/components/dados-tecnicos-viewer";

export const Route = createFileRoute("/_authenticated/historico")({
  head: () => ({ meta: [{ title: "Histórico - ASP Insights" }] }),
  component: Historico,
});

function Historico() {
  const { data: prognosticos = [] } = usePrognosticos();
  const { data: cfg } = useConfiguracao();
  const esportes = cfg?.esportes_ativos ?? ESPORTES_DEFAULT;
  const mercados = cfg?.mercados_ativos ?? MERCADOS_DEFAULT;

  const [esporte, setEsporte] = useState("all");
  const [liga, setLiga] = useState("all");
  const [mercado, setMercado] = useState("all");
  const [status, setStatus] = useState("all");
  const [resultado, setResultado] = useState("all");
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
      return true;
    });
  }, [prognosticos, ini, fim, esporte, liga, mercado, status, resultado]);

  const wins = rows.filter((r) => r.resultado === "GREEN").length;
  const losses = rows.filter((r) => r.resultado === "RED").length;
  const lucro = rows.reduce((s, p) => s + lucroUnidadesAnalitico(p), 0);
  const exportFilename = `asp_insights_resultados_${todayBR()}.csv`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Histórico</h1>
          <p className="text-sm text-muted-foreground">
            Todos os prognósticos com filtros e resultados consolidados.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={!rows.length}
          onClick={() => downloadCsv(exportFilename, toHistoricoCsv(rows))}
          title="Baixa os resultados conforme os filtros atuais da tela."
        >
          <Download className="h-4 w-4" />
          Baixar CSV
        </Button>
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

      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="Wins" value={String(wins)} tone="good" />
        <Stat label="Losses" value={String(losses)} tone="bad" />
        <Stat label="Lucro" value={`${lucro >= 0 ?"+" : ""}${lucro.toFixed(2)}u`} tone={lucro >= 0 ?"good" : "bad"} />
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
                <th className="px-3 py-2 text-left">Resultado</th>
                <th className="px-3 py-2 text-right font-mono">Lucro</th>
                <th className="px-3 py-2 text-center">Dados</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{formatBR(p.data)}</td>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{p.hora ? formatHora(p.hora) : "-"}</td>
                  <td className="px-3 py-2">{p.esporte}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.liga}</td>
                  <td className="px-3 py-2">{p.jogo}</td>
                  <td className="px-3 py-2 font-mono text-xs">{p.placar_final ?? "-"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.mercado}</td>
                  <td className="px-3 py-2">{p.pick}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{shouldShowLinha(p.pick, p.linha) ? p.linha : "-"}</td>
                  <td className="px-3 py-2 text-right font-mono">{p.odd_ofertada.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono">{stakeAnalitica(p).toFixed(1)}u</td>
                  <td className="px-3 py-2"><StatusBadge status={p.status_validacao} /></td>
                  <td className="px-3 py-2"><ResultBadge result={p.resultado} /></td>
                  <td className={`px-3 py-2 text-right font-mono ${lucroUnidadesAnalitico(p) >= 0 ?"text-success" : "text-destructive"}`}>
                    {`${lucroUnidadesAnalitico(p) >= 0 ?"+" : ""}${lucroUnidadesAnalitico(p).toFixed(2)}u`}
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
      </div>
    </div>
  );
}

function toHistoricoCsv(rows: Prognostico[]): string {
  const headers: Array<{ label: string; value: (row: Prognostico) => unknown }> = [
    { label: "prognostico_id", value: (p) => p.id },
    { label: "data", value: (p) => p.data },
    { label: "hora", value: (p) => p.hora },
    { label: "esporte", value: (p) => p.esporte },
    { label: "liga", value: (p) => p.liga },
    { label: "jogo", value: (p) => p.jogo },
    { label: "mandante", value: (p) => p.mandante },
    { label: "visitante", value: (p) => p.visitante },
    { label: "placar_final", value: (p) => p.placar_final },
    { label: "mercado", value: (p) => p.mercado },
    { label: "pick", value: (p) => p.pick },
    { label: "linha", value: (p) => p.linha },
    { label: "odd_ofertada", value: (p) => p.odd_ofertada },
    { label: "odd_ajustada", value: (p) => p.odd_ajustada },
    { label: "odd_valor", value: (p) => p.odd_valor },
    { label: "probabilidade_final", value: (p) => p.probabilidade_final },
    { label: "edge", value: (p) => p.edge },
    { label: "edge_ajustado", value: (p) => p.edge_ajustado },
    { label: "stake", value: (p) => stakeAnalitica(p) },
    { label: "status_validacao", value: (p) => p.status_validacao },
    { label: "resultado", value: (p) => p.resultado },
    { label: "lucro_prejuizo", value: (p) => lucroUnidadesAnalitico(p) },
    { label: "origem_modelo", value: (p) => p.origem_modelo },
    { label: "job_id_coleta", value: (p) => p.job_id_coleta },
    { label: "created_at", value: (p) => p.created_at },
    { label: "updated_at", value: (p) => p.updated_at },
    { label: "dados_tecnicos", value: (p) => p.contexto_modelo || p.dados_tecnicos || p.observacoes },
  ];

  return [
    headers.map((header) => header.label).join(","),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(header.value(row))).join(",")),
  ].join("\n");
}

function escapeCsvValue(value: unknown): string {
  if (value == null) return "";
  return `"${String(value).replace(/"/g, '""').replace(/\r?\n/g, "\n")}"`;
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={`mt-1 font-mono text-xl font-bold ${
          tone === "good" ?"text-success" : tone === "bad" ?"text-destructive" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
