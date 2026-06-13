import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { PERIODOS_OPCOES, type PeriodoFiltro } from "@/lib/metrics";

interface Props {
  periodo: PeriodoFiltro;
  onPeriodoChange: (p: PeriodoFiltro) => void;
  customIni: string;
  customFim: string;
  onCustomIniChange: (v: string) => void;
  onCustomFimChange: (v: string) => void;
  className?: string;
}

export function PeriodFilter({
  periodo,
  onPeriodoChange,
  customIni,
  customFim,
  onCustomIniChange,
  onCustomFimChange,
  className,
}: Props) {
  return (
    <div className={`flex flex-wrap items-end gap-3 ${className ?? ""}`}>
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">
          Período
        </label>
        <Select value={periodo} onValueChange={(v) => onPeriodoChange(v as PeriodoFiltro)}>
          <SelectTrigger className="h-9 w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODOS_OPCOES.map((p) => (
              <SelectItem key={p.v} value={p.v}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {periodo === "custom" && (
        <>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">
              De
            </label>
            <Input
              type="date"
              value={customIni}
              onChange={(e) => onCustomIniChange(e.target.value)}
              className="h-9 w-40"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">
              Até
            </label>
            <Input
              type="date"
              value={customFim}
              onChange={(e) => onCustomFimChange(e.target.value)}
              className="h-9 w-40"
            />
          </div>
        </>
      )}
    </div>
  );
}
