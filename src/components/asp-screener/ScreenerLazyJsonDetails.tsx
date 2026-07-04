import type { ReactNode } from "react";
import { memo, useMemo, useState } from "react";

export const ScreenerLazyJsonDetails = memo(function ScreenerLazyJsonDetails({
  value,
  summary,
  className,
  summaryClassName,
  preClassName,
}: {
  value: unknown;
  summary: ReactNode;
  className?: string;
  summaryClassName?: string;
  preClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const jsonText = useMemo(() => (open ? JSON.stringify(value, null, 2) : ""), [open, value]);

  return (
    <details className={className} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className={summaryClassName}>{summary}</summary>
      {open ? <pre className={preClassName}>{jsonText}</pre> : null}
    </details>
  );
});
