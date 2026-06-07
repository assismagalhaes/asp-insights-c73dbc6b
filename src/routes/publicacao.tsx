import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Megaphone, Copy, Ban, Send, CheckSquare, Square, Eye } from "lucide-react";
import {
  usePrognosticos,
  useConfiguracao,
  usePublicarPrognostico,
  useCancelarPrognostico,
  useValidacaoByPrognostico,
  gerarTipTexto,
  type Prognostico,
} from "@/lib/db";
import { StatusBadge, PublicacaoBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/publicacao")({
  head: () => ({ meta: [{ title: "Publicação — ASP Insights" }] }),
  component: PublicacaoPage,
});

function PublicacaoPage() {
  const { data: prognosticos = [] } = usePrognosticos();
  const { data: cfg } = useConfiguracao();
  const publicar = usePublicarPrognostico();
  const cancelar = useCancelarPrognostico();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewFor, setPreviewFor] = useState<Prognostico | null>(null);
  const [canal, setCanal] = useState("Telegram");

  const elegiveis = useMemo(
    () =>
      prognosticos.filter(
        (p) =>
          p.status_publicacao === "NAO_PUBLICADO" &&
          (p.status_validacao === "CONFIRMA" ||
            p.status_validacao === "CONFIRMA COM CAUTELA" ||
            p.status_validacao === "AGUARDAR NOTÍCIA"),
      ),
    [prognosticos],
  );

  const podePublicar = (p: Prognostico) =>
    p.status_validacao === "CONFIRMA" || p.status_validacao === "CONFIRMA COM CAUTELA";

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const publicarLote = async () => {
    const alvos = elegiveis.filter((p) => selected.has(p.id) && podePublicar(p));
    if (!alvos.length) {
      toast.error("Nenhum prognóstico elegível selecionado.");
      return;
    }
    for (const p of alvos) {
      await publicar.mutateAsync({
        id: p.id,
        tip_texto: gerarTipTexto(p),
        canal_publicacao: canal,
      });
    }
    toast.success(`${alvos.length} pick(s) publicada(s)`);
    setSelected(new Set());
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Publicação</h1>
          <p className="text-sm text-muted-foreground">
            Transforme prognósticos validados em picks oficiais.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Canal</Label>
            <Input value={canal} onChange={(e) => setCanal(e.target.value)} className="h-9 w-40" />
          </div>
          <Button onClick={publicarLote} disabled={selected.size === 0 || publicar.isPending}>
            <Send className="h-4 w-4 mr-2" /> Publicar em Lote ({selected.size})
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Prognósticos validados pendentes</CardTitle>
          <CardDescription>
            Apenas <strong>CONFIRMA</strong> e <strong>CONFIRMA COM CAUTELA</strong> podem ser publicados
            automaticamente. <strong>AGUARDAR NOTÍCIA</strong> requer confirmação manual.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 w-8"></th>
                  <th className="px-3 py-2 text-left">Data</th>
                  <th className="px-3 py-2 text-left">Esporte</th>
                  <th className="px-3 py-2 text-left">Jogo</th>
                  <th className="px-3 py-2 text-left">Pick</th>
                  <th className="px-3 py-2 text-right font-mono">Odd</th>
                  <th className="px-3 py-2 text-right font-mono">Stake</th>
                  <th className="px-3 py-2 text-left">Validação</th>
                  <th className="px-3 py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {elegiveis.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      Nenhum prognóstico aguardando publicação.
                    </td>
                  </tr>
                )}
                {elegiveis.map((p) => {
                  const isAguardar = p.status_validacao === "AGUARDAR NOTÍCIA";
                  const canSelect = podePublicar(p);
                  return (
                    <tr key={p.id} className="border-t border-border hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <button
                          disabled={!canSelect}
                          onClick={() => toggle(p.id)}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                        >
                          {selected.has(p.id) ? (
                            <CheckSquare className="h-4 w-4 text-primary" />
                          ) : (
                            <Square className="h-4 w-4" />
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{p.data}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{p.esporte}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{p.jogo}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{p.pick}</td>
                      <td className="px-3 py-2 text-right font-mono">{p.odd_ofertada.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono">{p.stake.toFixed(1)}u</td>
                      <td className="px-3 py-2"><StatusBadge status={p.status_validacao} /></td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setPreviewFor(p)}
                            title="Pré-visualizar TIP"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => cancelar.mutate(p.id)}
                            title="Cancelar pick"
                          >
                            <Ban className="h-4 w-4 text-destructive" />
                          </Button>
                          {isAguardar ? (
                            <Button size="sm" variant="outline" onClick={() => setPreviewFor(p)}>
                              Revisar
                            </Button>
                          ) : (
                            <Button size="sm" onClick={() => setPreviewFor(p)}>
                              <Megaphone className="h-4 w-4 mr-1" /> Publicar
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <PublishDialog
        prognostico={previewFor}
        canal={canal}
        onClose={() => setPreviewFor(null)}
      />

      <PublicadasRecentes prognosticos={prognosticos} />
    </div>
  );
}

function PublishDialog({
  prognostico,
  canal,
  onClose,
}: {
  prognostico: Prognostico | null;
  canal: string;
  onClose: () => void;
}) {
  const publicar = usePublicarPrognostico();
  const { data: validacao } = useValidacaoByPrognostico(prognostico?.id);
  const [tip, setTip] = useState("");

  useEffect(() => {
    if (prognostico) {
      setTip(
        gerarTipTexto(prognostico, {
          justificativa: validacao?.justificativa,
          riscos: validacao?.riscos_identificados,
        }),
      );
    }
  }, [prognostico, validacao]);

  if (!prognostico) return null;

  const copy = async () => {
    await navigator.clipboard.writeText(tip);
    toast.success("TIP copiada");
  };

  const send = async () => {
    await publicar.mutateAsync({
      id: prognostico.id,
      tip_texto: tip,
      canal_publicacao: canal,
    });
    toast.success("Pick publicada");
    onClose();
  };

  return (
    <Dialog open={!!prognostico} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Publicar Pick — {prognostico.jogo}</DialogTitle>
          <DialogDescription>
            Edite a TIP final antes de copiar/publicar. Canal: <strong>{canal}</strong>
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={tip}
          onChange={(e) => setTip(e.target.value)}
          rows={18}
          className="font-mono text-xs"
        />
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={copy}>
            <Copy className="h-4 w-4 mr-2" /> Copiar TIP
          </Button>
          <Button onClick={send} disabled={publicar.isPending}>
            <Send className="h-4 w-4 mr-2" /> Publicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PublicadasRecentes({ prognosticos }: { prognosticos: Prognostico[] }) {
  const publicadas = prognosticos
    .filter((p) => p.status_publicacao === "PUBLICADO" || p.status_publicacao === "FINALIZADO" || p.status_publicacao === "CANCELADO")
    .slice(0, 20);

  if (!publicadas.length) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Histórico de publicações</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Data Pub.</th>
                <th className="px-3 py-2 text-left">Jogo</th>
                <th className="px-3 py-2 text-left">Pick</th>
                <th className="px-3 py-2 text-left">Canal</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {publicadas.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">
                    {p.data_publicacao ? new Date(p.data_publicacao).toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2">{p.jogo}</td>
                  <td className="px-3 py-2">{p.pick}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.canal_publicacao ?? "—"}</td>
                  <td className="px-3 py-2"><PublicacaoBadge status={p.status_publicacao} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
