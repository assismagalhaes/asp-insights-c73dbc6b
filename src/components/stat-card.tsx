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
  sparkline?: number[];
  meta?: string;
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
  sparkline,
  meta,
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
      {meta ? <p className="mt-1 text-[10px] text-muted-foreground">{meta}</p> : null}
      {sparkline && sparkline.length > 1 ? (
        <svg
          aria-hidden="true"
          className="mt-3 h-8 w-full overflow-visible text-[var(--stat-accent)]"
          viewBox="0 0 100 28"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id={`spark-${label.replace(/\W+/g, "-")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d={`${sparklinePath(sparkline)} L 100 28 L 0 28 Z`}
            fill={`url(#spark-${label.replace(/\W+/g, "-")})`}
          />
          <path
            d={sparklinePath(sparkline)}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : null}
    </section>
  );
}

function sparklinePath(values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 25 - ((value - min) / range) * 22;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}
