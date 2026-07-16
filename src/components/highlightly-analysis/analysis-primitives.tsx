import type { ComponentProps } from "react";
import { AlertTriangle, DatabaseZap } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function TeamMark({
  name,
  src,
  className,
}: {
  name: string;
  src?: string | null;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-[10px] font-bold text-muted-foreground",
        className,
      )}
      aria-hidden="true"
    >
      {src ? <img src={src} alt="" className="size-full object-contain p-1" /> : initials || "?"}
    </span>
  );
}

export function AnalysisError({
  title = "Não foi possível carregar os dados",
  message,
}: {
  title?: string;
  message: string;
}) {
  return (
    <Alert variant="destructive" className="m-4">
      <AlertTriangle />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export function AnalysisEmpty({
  title,
  description,
  className,
}: {
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-48 flex-col items-center justify-center gap-3 px-6 text-center",
        className,
      )}
    >
      <DatabaseZap className="size-8 text-muted-foreground" aria-hidden="true" />
      <div className="flex max-w-md flex-col gap-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export function MatchListSkeleton() {
  return (
    <div className="flex flex-col gap-px" aria-label="Carregando partidas">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="flex h-[70px] items-center gap-3 border-b border-border px-3">
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-8 w-20" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <Skeleton className="h-5 w-12" />
        </div>
      ))}
    </div>
  );
}

export function SectionLabel(props: ComponentProps<"h3">) {
  return (
    <h3
      {...props}
      className={cn(
        "text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground",
        props.className,
      )}
    />
  );
}
