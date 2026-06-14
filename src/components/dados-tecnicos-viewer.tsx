import { useState } from "react";
import { Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getDadosTecnicos, type Prognostico } from "@/lib/db";
import { cn } from "@/lib/utils";

interface Props {
  prognostico: Pick<Prognostico, "dados_tecnicos" | "observacoes" | "jogo" | "mercado" | "pick">;
  variant?: "icon" | "button";
  className?: string;
}

export function DadosTecnicosViewer({ prognostico, variant = "icon", className }: Props) {
  const [open, setOpen] = useState(false);
  const dados = getDadosTecnicos(prognostico);
  const disabled = !dados;

  return (
    <>
      <Button
        size={variant === "icon" ? "icon" : "sm"}
        variant="ghost"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title={disabled ? "Sem contexto da análise" : "Ver contexto da análise"}
        className={cn(className)}
      >
        <Brain className={cn("h-4 w-4", !disabled && "text-primary")} />
        {variant === "button" && <span className="ml-1 text-xs">Contexto</span>}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Contexto da Análise</DialogTitle>
            <DialogDescription>
              {prognostico.jogo} — {prognostico.mercado} / {prognostico.pick}
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 font-mono text-xs">
            {dados || "Nenhum contexto informado."}
          </pre>
        </DialogContent>
      </Dialog>
    </>
  );
}
