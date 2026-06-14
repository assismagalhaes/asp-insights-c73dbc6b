import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PERIODOS_OPCOES, type PeriodoFiltro } from "@/lib/metrics";
import { formatBR, parseBrazilianDate } from "@/lib/date-br";
import { cn } from "@/lib/utils";

interface Props {
  periodo: PeriodoFiltro;
  onPeriodoChange: (p: PeriodoFiltro) => void;
  customIni: string;
  customFim: string;
  onCustomIniChange: (v: string) => void;
  onCustomFimChange: (v: string) => void;
  className?: string;
}

function isoToDate(iso: string | null | undefined): Date | undefined {
  if (!iso) return undefined;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

function dateToIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(formatBR(value));

  // Sync display when external value changes
  if (formatBR(value) !== text && !open) {
    // safe: only updates on render mismatch and not while popover open
    queueMicrotask(() => setText(formatBR(value)));
  }

  return (
    <div className="flex flex-col">
      <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <div className="flex">
        <Input
          value={text}
          placeholder="DD/MM/AAAA"
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const iso = parseBrazilianDate(text);
            if (iso) {
              onChange(iso);
              setText(formatBR(iso));
            } else if (!text) {
              onChange("");
            } else {
              setText(formatBR(value));
            }
          }}
          className="h-9 w-32 rounded-r-none font-mono text-sm"
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 rounded-l-none border-l-0"
            >
              <CalendarIcon className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              selected={isoToDate(value)}
              onSelect={(d) => {
                if (d) {
                  const iso = dateToIso(d);
                  onChange(iso);
                  setText(formatBR(iso));
                  setOpen(false);
                }
              }}
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
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
      <div className="flex flex-col">
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
      <DateField
        label="De"
        value={customIni}
        onChange={(v) => {
          onCustomIniChange(v);
          if (v) onPeriodoChange("custom");
        }}
      />
      <DateField
        label="Até"
        value={customFim}
        onChange={(v) => {
          onCustomFimChange(v);
          if (v) onPeriodoChange("custom");
        }}
      />
    </div>
  );
}

