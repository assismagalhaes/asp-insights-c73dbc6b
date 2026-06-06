import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string;
  delta?: string;
  trend?: "up" | "down" | "neutral";
  icon?: LucideIcon;
}

export function StatCard({ label, value, delta, trend = "neutral", icon: Icon }: StatCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40">
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </div>
      <div className="mt-2 font-mono text-2xl font-bold tracking-tight">{value}</div>
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
