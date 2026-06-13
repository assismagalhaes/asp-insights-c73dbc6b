import { cn } from "@/lib/utils";

export type Status =
  | "PENDENTE"
  | "CONFIRMA"
  | "CONFIRMA_CAUTELA"
  | "PASS"
  | "AGUARDAR_NOTICIA"
  | "PULAR";
export type Result = "PENDENTE" | "GREEN" | "RED" | "PUSH";

const statusStyles: Record<string, string> = {
  CONFIRMA: "bg-success/15 text-success border-success/30",
  CONFIRMA_CAUTELA: "bg-warning/15 text-warning border-warning/40",
  PASS: "bg-destructive/15 text-destructive border-destructive/30",
  PULAR: "bg-destructive/15 text-destructive border-destructive/30",
  AGUARDAR_NOTICIA: "bg-primary/10 text-primary border-primary/30",
  PENDENTE: "bg-muted text-muted-foreground border-border",
};

const statusLabels: Record<string, string> = {
  CONFIRMA: "CONFIRMA",
  CONFIRMA_CAUTELA: "CONFIRMA C/ CAUTELA",
  PASS: "PASS",
  PULAR: "PASS",
  AGUARDAR_NOTICIA: "AGUARDAR NOTÍCIA",
  PENDENTE: "PENDENTE",
};

const resultStyles: Record<string, string> = {
  GREEN: "bg-success/15 text-success border-success/30",
  RED: "bg-destructive/15 text-destructive border-destructive/30",
  PENDENTE: "bg-accent/30 text-muted-foreground border-border",
};

const publicacaoStyles: Record<string, string> = {
  NAO_PUBLICADO: "bg-muted text-muted-foreground border-border",
  PUBLICADO: "bg-primary/15 text-primary border-primary/30",
  FINALIZADO: "bg-success/15 text-success border-success/30",
  CANCELADO: "bg-destructive/15 text-destructive border-destructive/30",
};

const publicacaoLabels: Record<string, string> = {
  NAO_PUBLICADO: "Não publicado",
  PUBLICADO: "Publicado",
  FINALIZADO: "Finalizado",
  CANCELADO: "Cancelado",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        statusStyles[status] ?? statusStyles.PENDENTE,
      )}
    >
      {statusLabels[status] ?? status}
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

export function PublicacaoBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        publicacaoStyles[status] ?? publicacaoStyles.NAO_PUBLICADO,
      )}
    >
      {publicacaoLabels[status] ?? status}
    </span>
  );
}
