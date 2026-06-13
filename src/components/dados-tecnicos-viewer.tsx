import { useState } from "react";
import { Brain, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getDadosTecnicos,
  getEdgeEfetivo,
  getOddEfetiva,
  useAnalisesIaByPrognostico,
  usePrognosticoDetail,
  useValidacaoByPrognostico,
  type AnaliseIa,
  type Prognostico,
} from "@/lib/db";
import { lucroUnidades } from "@/lib/metrics";
import { cn } from "@/lib/utils";

interface Props {
  prognostico: Prognostico;
  variant?: "icon" | "button";
  className?: string;
}

export function DadosTecnicosViewer({ prognostico, variant = "icon", className }: Props) {
  const [open, setOpen] = useState(false);
  const { data: detalhe } = usePrognosticoDetail(open ? prognostico.id : null);
  const { data: validacao } = useValidacaoByPrognostico(open ? prognostico.id : null);
  const { data: analises = [] } = useAnalisesIaByPrognostico(open ? prognostico.id : null);
  const p = detalhe ?? prognostico;
  const fallback = validacao?.parecer_ia
    ? ({
        modo_ia: validacao.modo_ia,
        parecer_ia: validacao.parecer_ia,
        decisao_sugerida: validacao.decisao_ia_sugerida as "CONFIRMA" | "PULAR" | null,
        stake_sugerida: validacao.stake_ia_sugerida,
        created_at: validacao.data_analise_ia || validacao.created_at,
        prompt_versao: validacao.prompt_versao,
        fontes_consultadas: validacao.fontes_consultadas,
        buscas_realizadas: validacao.buscas_realizadas,
      } as Partial<AnaliseIa>)
    : null;
  const local = analises.find((a) => a.modo_ia === "local") ?? (fallback?.modo_ia === "local" ? fallback : undefined);
  const online = analises.find((a) => a.modo_ia === "online") ?? (fallback?.modo_ia === "online" ? fallback : undefined);
  const contexto = [getDadosTecnicos(p), validacao?.contexto_adicional].filter(Boolean).join("\n\n");
  const oddEfetiva = getOddEfetiva(p);
  const edgeEfetivo = getEdgeEfetivo(p);
  const lucroU = p.resultado !== "PENDENTE" ? lucroUnidades(p) : null;

  return (
    <>
      <Button
        size={variant === "icon" ? "icon" : "sm"}
        variant="ghost"
        onClick={() => setOpen(true)}
        title="Ver Análise Completa"
        className={cn(className)}
      >
        <Brain className="h-4 w-4 text-primary" />
        {variant === "button" && <span className="ml-1 text-xs">Ver Análise Completa</span>}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Ver Análise Completa</DialogTitle>
            <DialogDescription>
              {p.jogo} - {p.mercado} / {p.pick}
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="contexto">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="contexto">Contexto</TabsTrigger>
              <TabsTrigger value="local">IA Local</TabsTrigger>
              <TabsTrigger value="online">IA Online</TabsTrigger>
              <TabsTrigger value="decisao">Decisão</TabsTrigger>
            </TabsList>

            <TabsContent value="contexto" className="mt-3 space-y-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <KV label="Mercado" value={p.mercado} />
                <KV label="Pick" value={p.pick} />
                <KV label="Linha" value={p.linha || "-"} />
                <KV label="Odd original" value={p.odd_ofertada.toFixed(2)} />
                <KV label="Odd ajustada" value={p.odd_ajustada?.toFixed(2) || "-"} />
                <KV label="Odd de valor" value={p.odd_valor.toFixed(2)} />
                <KV label="Probabilidade" value={`${p.probabilidade_final.toFixed(2)}%`} />
                <KV label="Edge" value={`${edgeEfetivo.toFixed(2)}%`} />
              </div>
              <Section title="Contexto da Análise" text={contexto || "Nenhum contexto informado."} />
            </TabsContent>

            <TabsContent value="local" className="mt-3">
              <AnaliseIaBlock analise={local} empty="Nenhuma análise local realizada." />
            </TabsContent>

            <TabsContent value="online" className="mt-3">
              <AnaliseIaBlock analise={online} empty="Nenhuma análise online realizada." online />
            </TabsContent>

            <TabsContent value="decisao" className="mt-3 space-y-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <KV label="Decisão humana" value={validacao?.decisao || p.status_validacao} />
                <KV label="Stake final" value={validacao?.stake_confirmada != null ? `${validacao.stake_confirmada}u` : "-"} />
                <KV label="Resultado" value={p.resultado} />
                <KV label="Placar" value={p.placar_final || "-"} />
                <KV label="Lucro/prejuízo R$" value={p.lucro_prejuizo != null ? p.lucro_prejuizo.toFixed(2) : "-"} />
                <KV label="Lucro/prejuízo u" value={lucroU != null ? `${lucroU >= 0 ? "+" : ""}${lucroU.toFixed(2)}u` : "-"} />
                <KV label="Odd usada" value={oddEfetiva.toFixed(2)} />
              </div>
              <Section title="Parecer final da validação" text={validacao?.parecer_validacao || "Nenhum parecer final salvo."} />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AnaliseIaBlock({ analise, empty, online }: { analise?: Partial<AnaliseIa>; empty: string; online?: boolean }) {
  if (!analise) {
    return <div className="rounded border border-border bg-muted/30 p-4 text-sm text-muted-foreground">{empty}</div>;
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <KV label="Decisão sugerida" value={analise.decisao_sugerida || "-"} />
        <KV label="Stake sugerida" value={analise.stake_sugerida != null ? `${analise.stake_sugerida}u` : "-"} />
        <KV label="Data/hora" value={analise.created_at ? new Date(analise.created_at).toLocaleString() : "-"} />
        <KV label="Prompt" value={analise.prompt_versao || "-"} />
      </div>
      {online && analise.alertas_online && analise.alertas_online.length > 0 && (
        <div className="rounded border border-warning/40 bg-warning/10 p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-warning">Alertas online</div>
          <ul className="mt-1 space-y-0.5 text-xs">
            {analise.alertas_online.map((a, i) => <li key={i}>- {a}</li>)}
          </ul>
        </div>
      )}
      <Section title="Parecer da IA" text={analise.parecer_ia || "Nenhum parecer salvo."} />
      {online && (
        <div className="grid gap-3 md:grid-cols-2">
          <List title="Buscas realizadas" items={(analise.buscas_realizadas ?? []).map((q) => ({ label: q }))} />
          <List
            title="Fontes consultadas"
            items={(analise.fontes_consultadas ?? []).map((f) => ({ label: f.titulo, href: f.url }))}
          />
        </div>
      )}
    </div>
  );
}

function Section({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
      <pre className="max-h-[44vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 font-mono text-xs">
        {text}
      </pre>
    </div>
  );
}

function List({ title, items }: { title: string; items: Array<{ label: string; href?: string }> }) {
  return (
    <div className="rounded border border-border bg-background/60 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
      {items.length ? (
        <ul className="mt-1 space-y-1 text-xs">
          {items.map((item, i) => (
            <li key={i}>
              {item.href ? (
                <a href={item.href} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-primary hover:underline">
                  <ExternalLink className="h-3 w-3" />
                  {item.label}
                </a>
              ) : (
                <span className="text-muted-foreground">- {item.label}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">Nenhum item salvo.</p>
      )}
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background/60 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 break-words text-sm font-medium">{value}</div>
    </div>
  );
}
