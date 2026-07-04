import { memo } from "react";

export const ScreenerMetricCard = memo(function ScreenerMetricCard({
  label,
  value,
}: {
  label: string;
  value: unknown;
}) {
  return (
    <div className="rounded-md border bg-background/50 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold">{String(value ?? "-")}</div>
    </div>
  );
});
