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
    return {
      symbol: "⚾",
      className:
        "border-red-400/35 bg-[radial-gradient(circle_at_35%_30%,rgb(251_113_133/0.3),rgb(127_29_29/0.12))] text-red-300 shadow-[0_0_16px_rgb(248_113_113/0.22)]",
    };
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
  return {
    symbol: "✦",
    className:
      "border-cyan-400/30 bg-[conic-gradient(from_40deg,rgb(59_130_246/0.28),rgb(168_85_247/0.28),rgb(34_211_238/0.28),rgb(59_130_246/0.28))] text-cyan-200 shadow-[0_0_14px_rgb(59_130_246/0.2)]",
  };
}

export function SportMark({ sport, size = "sm" }: { sport: string; size?: "sm" | "md" }) {
  const visual = sportVisual(sport);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md border border-transparent",
        size === "sm" ? "size-6 text-sm" : "size-10 rounded-lg text-lg",
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
