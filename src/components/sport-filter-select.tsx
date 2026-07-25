import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

function sportVisual(sport: string) {
  const normalized = sport.toLocaleLowerCase("pt-BR");
  if (normalized.includes("baseball") || normalized.includes("beisebol")) {
    return { symbol: "⚾", className: "bg-red-500/10 text-red-400" };
  }
  if (normalized.includes("basket") || normalized.includes("basquete")) {
    return { symbol: "🏀", className: "bg-orange-500/10 text-orange-400" };
  }
  if (normalized.includes("american football") || normalized.includes("futebol americano")) {
    return { symbol: "🏈", className: "bg-amber-500/10 text-amber-400" };
  }
  if (normalized.includes("hockey") || normalized.includes("hóquei")) {
    return { symbol: "🏒", className: "bg-cyan-500/10 text-cyan-400" };
  }
  if (normalized.includes("futebol") || normalized === "football") {
    return { symbol: "⚽", className: "bg-emerald-500/10 text-emerald-400" };
  }
  if (normalized.includes("tennis") || normalized.includes("tênis")) {
    return { symbol: "🎾", className: "bg-lime-500/10 text-lime-400" };
  }
  if (normalized.includes("volley") || normalized.includes("vôlei")) {
    return { symbol: "🏐", className: "bg-violet-500/10 text-violet-400" };
  }
  return { symbol: "◆", className: "bg-primary/10 text-primary" };
}

export function SportMark({ sport, size = "sm" }: { sport: string; size?: "sm" | "md" }) {
  const visual = sportVisual(sport);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md",
        size === "sm" ? "size-5 text-xs" : "size-7 text-sm",
        visual.className,
      )}
    >
      {visual.symbol}
    </span>
  );
}

export function SportFilterSelect({
  value,
  onValueChange,
  options,
  allValue = "all",
  allLabel = "Todos os esportes",
  id,
  className,
  placeholder = "Esporte",
  ariaLabel = "Esporte",
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: string[];
  allValue?: string;
  allLabel?: string;
  id?: string;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const selectedLabel = value === allValue ? allLabel : value;

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger id={id} className={className} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder}>
          <span className="flex min-w-0 items-center gap-2">
            <SportMark sport={value === allValue ? "all" : value} />
            <span className="truncate">{selectedLabel}</span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={allValue} textValue={allLabel}>
            <span className="flex items-center gap-2">
              <SportMark sport="all" />
              {allLabel}
            </span>
          </SelectItem>
          {options
            .filter((option) => option !== allValue)
            .map((option) => (
              <SelectItem key={option} value={option} textValue={option}>
                <span className="flex items-center gap-2">
                  <SportMark sport={option} />
                  {option}
                </span>
              </SelectItem>
            ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
