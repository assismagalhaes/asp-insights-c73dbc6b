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
}

const toneClass = {
  up: "text-success",
  down: "text-destructive",
  neutral: "text-muted-foreground",
  off: "",
} as const;

const iconToneClass = {
  up: "text-success/70",
  down: "text-destructive/70",
  neutral: "text-muted-foreground",
  off: "text-muted-foreground",
} as const;

const borderToneClass = {
  up: "border-success/30 hover:border-success/60",
  down: "border-destructive/30 hover:border-destructive/60",
  neutral: "border-border hover:border-primary/40",
  off: "border-border hover:border-primary/40",
} as const;

export function StatCard({
  label,
  value,
  delta,
  trend = "neutral",
  icon: Icon,
  tone,
}: StatCardProps) {
  const effectiveTone = tone ?? (trend === "up" ? "up" : trend === "down" ? "down" : "off");
  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-4 transition-colors",
        borderToneClass[effectiveTone],
      )}
    >
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {Icon && <Icon className={cn("h-4 w-4", iconToneClass[effectiveTone])} />}
      </div>
      <div
        className={cn(
          "mt-2 font-mono text-2xl font-bold tracking-tight",
          toneClass[effectiveTone],
        )}
      >
        {value}
      </div>
      {delta && (
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
      )}
    </div>
  );
}
