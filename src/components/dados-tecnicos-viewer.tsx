import { useState } from "react";
import { Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getDadosTecnicos, getEdgeEfetivo, getOddEfetiva, useValidacaoByPrognostico, type Prognostico } from "@/lib/db";
import { cn } from "@/lib/utils";

interface Props {
  prognostico: Pick<
    Prognostico,
    | "id"
    | "dados_tecnicos"
    | "observacoes"
    | "jogo"
    | "mercado"
    | "pick"
    | "linha"
    | "odd_ofertada"
    | "odd_ajustada"
    | "odd_valor"
    | "probabilidade_final"
    | "edge"
    | "edge_ajustado"
    | "stake"
    | "status_validacao"
    | "resultado"
    | "lucro_prejuizo"
  >;
  variant?: "icon" | "button";
  className?: string;
}

export function DadosTecnicosViewer({ prognostico, variant = "icon", className }: Props) {
  const [open, setOpen] = useState(false);
  const { data: validacao } = useValidacaoByPrognostico(open ? prognostico.id : null);
  const dados = getDadosTecnicos(prognostico);
  const oddEfetiva = getOddEfetiva(prognostico);
  const edgeEfetivo = getEdgeEfetivo(prognostico);

  return (
    <>
      <Button
        size={variant === "icon" ? "icon" : "sm"}
        variant="ghost"
        onClick={() => setOpen(true)}
        title="Ver contexto da análise"
        className={cn(className)}
      >
        <Brain className={cn("h-4 w-4", "text-primary")} />
        {variant === "button" && <span className="ml-1 text-xs">Contexto</span>}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Contexto da Análise</DialogTitle>
            <DialogDescription>
              {prognostico.jogo} — {prognostico.mercado} / {prognostico.pick}
            </DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="dados" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="dados">Dados técnicos</TabsTrigger>
              <TabsTrigger value="ia">IA</TabsTrigger>
              <TabsTrigger value="decisao">Decisão</TabsTrigger>
            </TabsList>
            <TabsContent value="dados" className="mt-3 space-y-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Info label="Linha" value={prognostico.linha || "—"} />
                <Info label="Odd usada" value={oddEfetiva.toFixed(2)} />
                <Info label="Odd valor" value={prognostico.odd_valor.toFixed(2)} />
                <Info label="Edge usado" value={`${edgeEfetivo.toFixed(2)}%`} />
              </div>
              <pre className="max-h-[48vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 font-mono text-xs">
                {dados || "Nenhum dado técnico ou observação antiga registrada."}
              </pre>
            </TabsContent>
            <TabsContent value="ia" className="mt-3 space-y-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <Info label="Modo IA" value={validacao?.modo_ia || "—"} />
                <Info label="Decisão IA" value={validacao?.decisao_ia_sugerida || "—"} />
                <Info label="Stake IA" value={validacao?.stake_ia_sugerida != null ? `${validacao.stake_ia_sugerida}u` : "—"} />
              </div>
              <pre className="max-h-[34vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 font-mono text-xs">
                {validacao?.parecer_ia?.trim() || "Nenhuma análise de IA registrada."}
              </pre>
              <div className="grid gap-2 md:grid-cols-2">
                <ListBlock title="Buscas realizadas" items={validacao?.buscas_realizadas ?? []} />
                <div className="rounded-md border border-border bg-muted/20 p-3">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Fontes consultadas</div>
                  {validacao?.fontes_consultadas?.length ? (
                    <ul className="space-y-1 text-xs">
                      {validacao.fontes_consultadas.map((fonte, index) => (
                        <li key={`${fonte.url}-${index}`}>
                          <a href={fonte.url} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
                            {fonte.titulo || fonte.url}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-xs text-muted-foreground">Nenhuma fonte registrada.</div>
                  )}
                </div>
              </div>
            </TabsContent>
            <TabsContent value="decisao" className="mt-3 space-y-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Info label="Decisão humana" value={validacao?.decisao || prognostico.status_validacao || "—"} />
                <Info label="Stake final" value={validacao?.stake_confirmada != null ? `${validacao.stake_confirmada}u` : `${prognostico.stake}u`} />
                <Info label="Resultado" value={prognostico.resultado || "—"} />
                <Info label="Lucro/Prejuízo" value={prognostico.lucro_prejuizo != null ? `${prognostico.lucro_prejuizo.toFixed(2)}u` : "—"} />
              </div>
              <pre className="max-h-[42vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 font-mono text-xs">
                {validacao?.parecer_validacao?.trim() || "Nenhum parecer final registrado."}
              </pre>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 break-words text-sm font-medium">{value}</div>
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
      {items.length ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {items.map((item, index) => <li key={`${item}-${index}`}>• {item}</li>)}
        </ul>
      ) : (
        <div className="text-xs text-muted-foreground">Nenhum registro.</div>
      )}
    </div>
  );
}
