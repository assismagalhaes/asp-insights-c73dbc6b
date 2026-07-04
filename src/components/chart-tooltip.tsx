import type { TooltipProps } from "recharts";
import { TOOLTIP_STYLE, TOOLTIP_LABEL_STYLE, signColor, COLOR_NEUTRAL } from "@/lib/chart-colors";

type FormatterFn = (
  value: number,
  name: string,
  dataKey: string,
) => {
  label: string;
  display: string;
  /** Override de cor. Se omitir, usa signColor(value). */
  color?: string;
};

interface Props extends Omit<TooltipProps<number, string>, "formatter"> {
  /** Formata o label do header (ex. data). */
  headerFormatter?: (label: string) => string;
  /** Formata cada métrica do payload. */
  formatter?: FormatterFn;
}

export function ChartTooltip({ active, payload, label, headerFormatter, formatter }: Props) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div style={TOOLTIP_STYLE}>
      {label != null && (
        <div style={TOOLTIP_LABEL_STYLE}>
          {headerFormatter ? headerFormatter(String(label)) : String(label)}
        </div>
      )}
      <div className="space-y-0.5">
        {payload.map((entry, i) => {
          const raw = typeof entry.value === "number" ? entry.value : Number(entry.value);
          const dk = String(entry.dataKey ?? "");
          const meta = formatter
            ? formatter(raw, String(entry.name ?? dk), dk)
            : {
                label: String(entry.name ?? dk),
                display: String(entry.value),
                color: signColor(raw),
              };
          return (
            <div key={i} className="flex items-center justify-between gap-4 font-mono text-xs">
              <span style={{ color: COLOR_NEUTRAL }}>{meta.label}</span>
              <span style={{ color: meta.color ?? signColor(raw), fontWeight: 600 }}>
                {meta.display}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
