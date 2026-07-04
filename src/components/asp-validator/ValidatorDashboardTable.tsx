import type { GroupRow } from "@/lib/asp-validator/dashboard";
import { signed } from "@/lib/asp-validator/formatters";

export function ValidatorDashboardMetric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "good" | "bad" | "neutral";
}) {
  const color =
    tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-red-300" : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-muted/15 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}

export function ValidatorGroupTable({ title, rows }: { title: string; rows: GroupRow[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="border-b border-border bg-muted/20 px-3 py-2 text-sm font-semibold">
        {title}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-muted/10 text-muted-foreground">
            <tr>
              {[
                "Grupo",
                "Total",
                "G",
                "R",
                "P/V",
                "WR",
                "Lucro u",
                "Lucro R$",
                "ROI",
                "Odd med.",
                "Prob. med.",
              ].map((header) => (
                <th key={header} className="px-3 py-2 text-left font-medium">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.label} className="border-t border-border">
                  <td className="px-3 py-2 font-semibold">{row.label}</td>
                  <td className="px-3 py-2">{row.total}</td>
                  <td className="px-3 py-2 text-emerald-300">{row.green}</td>
                  <td className="px-3 py-2 text-red-300">{row.red}</td>
                  <td className="px-3 py-2">{row.pushVoid}</td>
                  <td className="px-3 py-2">{row.winRate.toFixed(1)}%</td>
                  <td
                    className={`px-3 py-2 ${row.profitUnits >= 0 ? "text-emerald-300" : "text-red-300"}`}
                  >
                    {signed(row.profitUnits)}u
                  </td>
                  <td
                    className={`px-3 py-2 ${row.profitBrl >= 0 ? "text-emerald-300" : "text-red-300"}`}
                  >
                    {row.profitBrl >= 0 ? "+" : "-"}R$ {Math.abs(row.profitBrl).toFixed(2)}
                  </td>
                  <td className="px-3 py-2">{signed(row.roi)}%</td>
                  <td className="px-3 py-2">{row.averageOdd ? row.averageOdd.toFixed(2) : "-"}</td>
                  <td className="px-3 py-2">
                    {row.averageProbability ? `${row.averageProbability.toFixed(1)}%` : "-"}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-muted-foreground">
                  Nenhum dado para os filtros selecionados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
