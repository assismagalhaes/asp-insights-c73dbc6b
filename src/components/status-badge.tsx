import { cn } from "@/lib/utils";

export type Status =
  | "PENDENTE"
  | "CONFIRMA"
  | "CONFIRMA COM CAUTELA"
  | "AGUARDAR NOTÍCIA"
  | "PASS";
export type Result = "PENDENTE" | "GREEN" | "RED" | "PUSH";

const statusStyles: Record<string, string> = {
  CONFIRMA: "bg-success/15 text-success border-success/30",
  "CONFIRMA COM CAUTELA": "bg-warning/15 text-warning border-warning/30",
  "AGUARDAR NOTÍCIA": "bg-caution/15 text-caution border-caution/30",
  PASS: "bg-destructive/15 text-destructive border-destructive/30",
  PENDENTE: "bg-muted text-muted-foreground border-border",
};

const resultStyles: Record<string, string> = {
  GREEN: "bg-success/15 text-success border-success/30",
  RED: "bg-destructive/15 text-destructive border-destructive/30",
  PUSH: "bg-muted text-muted-foreground border-border",
  PENDENTE: "bg-accent/30 text-muted-foreground border-border",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        statusStyles[status] ?? statusStyles.PENDENTE,
      )}
    >
      {status}
    </span>
  );
}

export function ResultBadge({ result }: { result: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        resultStyles[result] ?? resultStyles.PENDENTE,
      )}
    >
      {result}
    </span>
  );
}
