import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLigas, type Liga } from "@/lib/db";

interface Props {
  sport: string; // "all" ou nome do esporte
  value: string; // "all" ou nome da liga
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
}

export function LeagueFilter({ sport, value, onChange, className, placeholder = "Liga" }: Props) {
  const { data: ligas = [] } = useLigas();
  const filtradas = useMemo<Liga[]>(() => {
    const arr = sport && sport !== "all"
      ? ligas.filter((l: Liga) => l.esporte === sport)
      : ligas;
    return [...arr].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [ligas, sport]);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todas as ligas</SelectItem>
        {filtradas.map((l) => (
          <SelectItem key={l.id} value={l.nome}>{l.nome}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
