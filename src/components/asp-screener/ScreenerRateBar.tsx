import { memo } from "react";
import { formatRate } from "@/lib/asp-screener/screener-formatters";

export const ScreenerRateBar = memo(function ScreenerRateBar({ value }: { value: number }) {
  const width = `${Math.max(0, Math.min(100, value))}%`;
  return (
    <div className="min-w-32">
      <div className="mb-1 font-mono text-xs">{formatRate(value)}</div>
      <div className="h-2 overflow-hidden rounded bg-muted">
        <div className="h-full bg-primary" style={{ width }} />
      </div>
    </div>
  );
});
