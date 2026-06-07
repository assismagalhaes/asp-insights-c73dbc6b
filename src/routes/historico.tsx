import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { StatusBadge, ResultBadge } from "@/components/status-badge";
import { usePrognosticos, useConfiguracao, ESPORTES_DEFAULT, MERCADOS_DEFAULT } from "@/lib/db";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/historico")({
  head: () => ({ meta: [{ title: "Histórico — ASP Insights" }] }),
  component: Historico,
});

function Historico() {
  const { data: prognosticos = [] } = usePrognosticos();
  const { data: cfg } = useConfiguracao();
  const esportes = cfg?.esportes_ativos ?? ESPORTES_DEFAULT;
  const mercados = cfg?.mercados_ativos ?? MERCADOS_DEFAULT;

  const [esporte, setEsporte] = useState("all");
  const [mercado, setMercado] = useState("all");
  const [status, setStatus] = useState("all");
  const [resultado, setResultado] = useState("all");
  const [data, setData] = useState("");

  const rows = useMemo(() => {
    return prognosticos.filter((p) => {
      if (esporte !== "all" && p.esporte !== esporte) return false;
      if (mercado !== "all" && p.mercado !== mercado) return false;
      if (status !== "all" && p.status_validacao !== status) return false;
      if (resultado !== "all" && p.resultado !== resultado) return false;
      if (data && p.data !== data) return false;
      return true;
    });
  }, [prognosticos, esporte, mercado, status, resultado, data]);

  const wins = rows.filter((r) => r.resultado === "GREEN").length;
  const losses = rows.filter((r) => r.resultado === "RED").length;
  const pushes = rows.filter((r) => r.resultado === "PUSH").length;
  const lucro = rows.reduce((s, p) => s + (p.lucro_prejuizo ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Histórico</h1>
        <p className="text-sm text-muted-foreground">
          Todos os prognósticos com filtros e resultados consolidados.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        <Select value={esporte} onValueChange={setEsporte}>
          <SelectTrigger><SelectValue placeholder="Esporte" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os esportes</SelectItem>
            {esportes.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={mercado} onValueChange={setMercado}>
          <SelectTrigger><SelectValue placeholder="Mercado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os mercados</SelectItem>
            {mercados.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="CONFIRMA">CONFIRMA</SelectItem>
            <SelectItem value="CONFIRMA COM CAUTELA">CONFIRMA COM CAUTELA</SelectItem>
            <SelectItem value="AGUARDAR NOTÍCIA">AGUARDAR NOTÍCIA</SelectItem>
            <SelectItem value="PASS">PASS</SelectItem>
            <SelectItem value="PENDENTE">PENDENTE</SelectItem>
          </SelectContent>
        </Select>
        <Select value={resultado} onValueChange={setResultado}>
          <SelectTrigger><SelectValue placeholder="Resultado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os resultados</SelectItem>
            <SelectItem value="GREEN">GREEN</SelectItem>
            <SelectItem value="RED">RED</SelectItem>
            <SelectItem value="PUSH">PUSH</SelectItem>
            <SelectItem value="PENDENTE">PENDENTE</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Wins" value={String(wins)} tone="good" />
        <Stat label="Losses" value={String(losses)} tone="bad" />
        <Stat label="Push" value={String(pushes)} />
        <Stat label="Lucro" value={`${lucro >= 0 ? "+" : ""}${lucro.toFixed(2)}u`} tone={lucro >= 0 ? "good" : "bad"} />
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Data</th>
                <th className="px-3 py-2 text-left">Esporte</th>
                <th className="px-3 py-2 text-left">Jogo</th>
                <th className="px-3 py-2 text-left">Mercado</th>
                <th className="px-3 py-2 text-left">Pick</th>
                <th className="px-3 py-2 text-right font-mono">Odd</th>
                <th className="px-3 py-2 text-right font-mono">Stake</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Resultado</th>
                <th className="px-3 py-2 text-right font-mono">Lucro</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-xs">{p.data}</td>
                  <td className="px-3 py-2">{p.esporte}</td>
                  <td className="px-3 py-2">{p.jogo}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.mercado}</td>
                  <td className="px-3 py-2">{p.pick}</td>
                  <td className="px-3 py-2 text-right font-mono">{p.odd_ofertada.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono">{p.stake.toFixed(1)}u</td>
                  <td className="px-3 py-2"><StatusBadge status={p.status_validacao} /></td>
                  <td className="px-3 py-2"><ResultBadge result={p.resultado} /></td>
                  <td className={`px-3 py-2 text-right font-mono ${(p.lucro_prejuizo ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>
                    {p.lucro_prejuizo != null ? `${p.lucro_prejuizo >= 0 ? "+" : ""}${p.lucro_prejuizo.toFixed(2)}u` : "-"}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-sm text-muted-foreground">
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
