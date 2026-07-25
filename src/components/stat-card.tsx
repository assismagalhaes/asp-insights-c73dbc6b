import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string;
  delta?: string;
  trend?: "up" | "down" | "neutral";
  icon?: LucideIcon;
  /** Pinta o VALOR principal (não só o delta). Padrão: segue trend. */
  tone?: "up" | "down" | "neutral" | "off";
  accent?: "blue" | "green" | "amber" | "violet" | "cyan" | "red";
}

const toneClass = {
  up: "text-success",
  down: "text-destructive",
  neutral: "text-muted-foreground",
  off: "",
} as const;

const iconToneClass = {
  up: "border-success/30 bg-success/10 text-success",
  down: "border-destructive/30 bg-destructive/10 text-destructive",
  neutral: "border-border/80 bg-background/40 text-muted-foreground",
  off: "border-border/80 bg-background/40 text-muted-foreground",
} as const;

const borderToneClass = {
  up: "hover:border-success/45",
  down: "hover:border-destructive/45",
  neutral: "hover:border-primary/35",
  off: "hover:border-primary/35",
} as const;

const accentClass = {
  blue: "border-primary/35 bg-[linear-gradient(145deg,color-mix(in_oklab,var(--color-primary)_9%,var(--color-card)),var(--color-card)_70%)] [--stat-accent:var(--color-primary)]",
  green:
    "border-success/35 bg-[linear-gradient(145deg,color-mix(in_oklab,var(--color-success)_9%,var(--color-card)),var(--color-card)_70%)] [--stat-accent:var(--color-success)]",
  amber:
    "border-warning/35 bg-[linear-gradient(145deg,color-mix(in_oklab,var(--color-warning)_8%,var(--color-card)),var(--color-card)_70%)] [--stat-accent:var(--color-warning)]",
  violet:
    "border-ai/35 bg-[linear-gradient(145deg,color-mix(in_oklab,var(--color-ai)_9%,var(--color-card)),var(--color-card)_70%)] [--stat-accent:var(--color-ai)]",
  cyan: "border-info/35 bg-[linear-gradient(145deg,color-mix(in_oklab,var(--color-info)_9%,var(--color-card)),var(--color-card)_70%)] [--stat-accent:var(--color-info)]",
  red: "border-destructive/35 bg-[linear-gradient(145deg,color-mix(in_oklab,var(--color-destructive)_9%,var(--color-card)),var(--color-card)_70%)] [--stat-accent:var(--color-destructive)]",
} as const;

export function StatCard({
  label,
  value,
  delta,
  trend = "neutral",
  icon: Icon,
  tone,
  accent,
}: StatCardProps) {
  const effectiveTone = tone ?? (trend === "up" ? "up" : trend === "down" ? "down" : "off");
  return (
    <section
      aria-label={label}
      className={cn(
        "group relative overflow-hidden rounded-lg border border-border/90 bg-card p-4 shadow-[0_14px_32px_rgb(0_0_0/0.12)] transition-[border-color,transform,box-shadow] before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-[linear-gradient(90deg,transparent,var(--stat-accent,transparent),transparent)] motion-safe:hover:-translate-y-0.5 hover:shadow-[0_18px_38px_rgb(0_0_0/0.18)]",
        borderToneClass[effectiveTone],
        accent && accentClass[accent],
      )}
    >
      <div className="flex items-start justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
          {label}
        </span>
        {Icon ? (
          <span
            className={cn(
              "flex size-9 items-center justify-center rounded-md border",
              iconToneClass[effectiveTone],
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
          </span>
        ) : null}
      </div>
      <div
        className={cn(
          "mt-2 font-mono text-2xl font-bold tracking-[-0.035em] tabular-nums",
          toneClass[effectiveTone],
        )}
      >
        {value}
      </div>
      {delta ? (
        <div
          className={cn(
            "mt-1 text-xs font-medium",
            trend === "up" && "text-success",
            trend === "down" && "text-destructive",
            trend === "neutral" && "text-muted-foreground",
          )}
        >
          {delta}
        </div>
      ) : null}
    </section>
  );
}
