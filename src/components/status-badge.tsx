import { cn } from "@/lib/utils";
import type { Status, Result } from "@/lib/mock-data";

const statusStyles: Record<Status, string> = {
  CONFIRMA: "bg-success/15 text-success border-success/30",
  "CONFIRMA COM CAUTELA": "bg-warning/15 text-warning border-warning/30",
  "AGUARDAR NOTÍCIA": "bg-caution/15 text-caution border-caution/30",
  PASS: "bg-destructive/15 text-destructive border-destructive/30",
  PENDENTE: "bg-muted text-muted-foreground border-border",
};

const resultStyles: Record<Result, string> = {
  GREEN: "bg-success/15 text-success border-success/30",
  RED: "bg-destructive/15 text-destructive border-destructive/30",
  PUSH: "bg-muted text-muted-foreground border-border",
  PENDENTE: "bg-accent/30 text-muted-foreground border-border",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        statusStyles[status],
      )}
    >
      {status}
    </span>
  );
}

export function ResultBadge({ result }: { result: Result }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        resultStyles[result],
      )}
    >
      {result}
    </span>
  );
}
