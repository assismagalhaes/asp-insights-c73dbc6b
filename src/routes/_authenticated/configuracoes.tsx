import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BadgeDollarSign,
  HardDrive,
  Landmark,
  Loader2,
  Save,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trophy,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { AmbientBackdrop, PageIntro, PanelHeading } from "@/components/command-center";
import { SportMark } from "@/components/sport-filter-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TelegramAlertsPanel } from "@/components/validacao-critica/TelegramAlertsPanel";
import { supabase } from "@/lib/supabase-public";
import {
  ESPORTES_DEFAULT,
  MERCADOS_DEFAULT,
  useConfiguracao,
  useUpdateConfiguracao,
} from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({ meta: [{ title: "Configurações — ASP Insights" }] }),
  component: Configuracoes,
});

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
});

const STORAGE_SMOKE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function sameSelection(current: string[], saved: string[]) {
  return [...current].sort().join("|") === [...saved].sort().join("|");
}

function Configuracoes() {
  const { data: cfg } = useConfiguracao();
  const update = useUpdateConfiguracao();

  const [nome, setNome] = useState("ASP Insights - AI Sports Predictions");
  const [unidade, setUnidade] = useState(10);
  const [bancaInicial, setBancaInicial] = useState(1000);
  const [esportesAtivos, setEsportesAtivos] = useState<Record<string, boolean>>({});
  const [mercadosAtivos, setMercadosAtivos] = useState<Record<string, boolean>>({});
  const [storageSmoke, setStorageSmoke] = useState<{
    status: "idle" | "running" | "passed" | "failed";
    message: string;
  }>({ status: "idle", message: "Ainda não executado." });

  useEffect(() => {
    if (!cfg) return;
    setNome(cfg.nome_plataforma);
    setUnidade(cfg.valor_unidade_padrao);
    setBancaInicial(cfg.banca_inicial);
    setEsportesAtivos(
      Object.fromEntries(
        ESPORTES_DEFAULT.map((esporte) => [esporte, cfg.esportes_ativos.includes(esporte)]),
      ),
    );
    setMercadosAtivos(
      Object.fromEntries(
        MERCADOS_DEFAULT.map((mercado) => [mercado, cfg.mercados_ativos.includes(mercado)]),
      ),
    );
  }, [cfg]);

  const activeSports = useMemo(
    () => Object.values(esportesAtivos).filter(Boolean).length,
    [esportesAtivos],
  );
  const activeMarkets = useMemo(
    () => Object.values(mercadosAtivos).filter(Boolean).length,
    [mercadosAtivos],
  );

  const isDirty = useMemo(() => {
    if (!cfg) return false;
    const selectedSports = Object.entries(esportesAtivos)
      .filter(([, active]) => active)
      .map(([sport]) => sport);
    const selectedMarkets = Object.entries(mercadosAtivos)
      .filter(([, active]) => active)
      .map(([market]) => market);

    return (
      nome !== cfg.nome_plataforma ||
      unidade !== cfg.valor_unidade_padrao ||
      bancaInicial !== cfg.banca_inicial ||
      !sameSelection(selectedSports, cfg.esportes_ativos) ||
      !sameSelection(selectedMarkets, cfg.mercados_ativos)
    );
  }, [bancaInicial, cfg, esportesAtivos, mercadosAtivos, nome, unidade]);

  const salvar = async () => {
    if (!cfg) return;
    if (!nome.trim()) {
      toast.error("Informe o nome da plataforma.");
      return;
    }
    if (
      !Number.isFinite(unidade) ||
      unidade < 0 ||
      !Number.isFinite(bancaInicial) ||
      bancaInicial < 0
    ) {
      toast.error("Unidade e banca inicial devem ser valores válidos e não negativos.");
      return;
    }

    try {
      await update.mutateAsync({
        id: cfg.id,
        nome_plataforma: nome.trim(),
        valor_unidade_padrao: unidade,
        banca_inicial: bancaInicial,
        esportes_ativos: Object.entries(esportesAtivos)
          .filter(([, active]) => active)
          .map(([sport]) => sport),
        mercados_ativos: Object.entries(mercadosAtivos)
          .filter(([, active]) => active)
          .map(([market]) => market),
      });
      toast.success("Configurações salvas");
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const testarStorage = async () => {
    setStorageSmoke({ status: "running", message: "Executando upload autenticado..." });

    const bucket = "asp-validator-uploads";
    let path: string | null = null;
    let uploaded = false;

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !user) throw userError ?? new Error("Sessão autenticada não encontrada.");

      path = `${user.id}/codex-smoke/${crypto.randomUUID()}.png`;
      const expected = Uint8Array.from(atob(STORAGE_SMOKE_PNG_BASE64), (char) =>
        char.charCodeAt(0),
      );
      const file = new Blob([expected], { type: "image/png" });

      const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, {
        contentType: "image/png",
        upsert: false,
      });
      if (uploadError) throw uploadError;
      uploaded = true;

      setStorageSmoke({ status: "running", message: "Upload concluído; validando download..." });
      const { data: downloaded, error: downloadError } = await supabase.storage
        .from(bucket)
        .download(path);
      if (downloadError) throw downloadError;
      const actual = new Uint8Array(await downloaded.arrayBuffer());
      if (
        actual.length !== expected.length ||
        actual.some((byte, index) => byte !== expected[index])
      ) {
        throw new Error("O conteúdo baixado não corresponde ao conteúdo enviado.");
      }

      setStorageSmoke({ status: "running", message: "Conteúdo validado; removendo temporário..." });
      const { error: removeError } = await supabase.storage.from(bucket).remove([path]);
      if (removeError) throw removeError;
      uploaded = false;

      setStorageSmoke({
        status: "passed",
        message: "Upload, download, integridade e exclusão concluídos sem resíduos.",
      });
      toast.success("Storage autenticado validado");
    } catch (error) {
      let cleanupMessage = "";
      if (uploaded && path) {
        const { error: cleanupError } = await supabase.storage.from(bucket).remove([path]);
        cleanupMessage = cleanupError
          ? ` A limpeza também falhou: ${cleanupError.message}`
          : " O arquivo temporário foi removido na limpeza de segurança.";
      }
      const message = `${error instanceof Error ? error.message : "Falha desconhecida."}${cleanupMessage}`;
      setStorageSmoke({ status: "failed", message });
      toast.error("Falha no teste de Storage", { description: message });
    }
  };

  return (
    <div className="command-surface page-stack">
      <AmbientBackdrop />
      <PageIntro
        title="Configurações"
        description="Parâmetros gerais da plataforma e governança operacional."
        icon={Settings2}
        status={isDirty ? "Alterações não salvas" : "Configuração sincronizada"}
        actions={
          <Button onClick={salvar} disabled={!cfg || update.isPending || !isDirty}>
            <Save aria-hidden="true" className="size-4" />
            {update.isPending ? "Salvando..." : "Salvar alterações"}
          </Button>
        }
      />

      <section
        className="filter-surface grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Resumo da configuração"
      >
        <SummaryItem
          icon={Trophy}
          label="Esportes ativos"
          value={`${activeSports}/${ESPORTES_DEFAULT.length}`}
          tone="primary"
        />
        <SummaryItem
          icon={SlidersHorizontal}
          label="Mercados ativos"
          value={`${activeMarkets}/${MERCADOS_DEFAULT.length}`}
          tone="ai"
        />
        <SummaryItem
          icon={BadgeDollarSign}
          label="Unidade padrão"
          value={moneyFormatter.format(Number.isFinite(unidade) ? unidade : 0)}
          tone="success"
        />
        <SummaryItem
          icon={Landmark}
          label="Banca inicial"
          value={moneyFormatter.format(Number.isFinite(bancaInicial) ? bancaInicial : 0)}
          tone="warning"
        />
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(19rem,0.72fr)_minmax(0,1.55fr)]">
        <section className="surface-panel xl:sticky xl:top-20">
          <PanelHeading
            title="Identidade e parâmetros"
            icon={Activity}
            value={
              <span className="rounded border border-primary/20 bg-primary/5 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-primary">
                Geral
              </span>
            }
          />

          <div className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="platform-name">Nome da plataforma</Label>
              <Input
                id="platform-name"
                value={nome}
                onChange={(event) => setNome(event.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label>Logotipo da plataforma</Label>
              <div className="relative overflow-hidden rounded-lg border border-border bg-background/45 p-4">
                <div
                  aria-hidden="true"
                  className="absolute -right-8 -top-12 size-32 rounded-full bg-primary/10 blur-2xl"
                />
                <div className="relative flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="flex size-14 items-center justify-center rounded-lg border border-primary/35 bg-primary/10 text-primary shadow-[0_0_24px_color-mix(in_oklab,var(--color-primary)_25%,transparent)]">
                      <Activity className="size-7" />
                    </span>
                    <div>
                      <p className="font-semibold">ASP Insights</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">Identidade operacional</p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => toast.info("Upload de logo estará disponível em breve.")}
                  >
                    <Upload aria-hidden="true" className="size-3.5" />
                    Trocar logotipo
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <div className="grid gap-2">
                <Label htmlFor="default-unit">Valor padrão da unidade (R$)</Label>
                <Input
                  id="default-unit"
                  type="number"
                  min="0"
                  step="0.01"
                  value={unidade}
                  onChange={(event) => setUnidade(Number(event.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Unidade monetária usada na análise e exibição.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="initial-bankroll">Banca inicial (R$)</Label>
                <Input
                  id="initial-bankroll"
                  type="number"
                  min="0"
                  step="0.01"
                  value={bancaInicial}
                  onChange={(event) => setBancaInicial(Number(event.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Saldo inicial considerado na gestão de bankroll.
                </p>
              </div>
            </div>

            <Button
              className="w-full"
              onClick={salvar}
              disabled={!cfg || update.isPending || !isDirty}
            >
              <Save aria-hidden="true" className="size-4" />
              {update.isPending ? "Salvando..." : "Salvar alterações"}
            </Button>
          </div>
        </section>

        <section className="data-surface">
          <div className="border-b border-border px-4 py-3">
            <PanelHeading
              className="mb-0"
              title="Governança operacional"
              icon={ShieldCheck}
              value={
                <span className="hidden text-xs text-muted-foreground sm:block">
                  Selecione o que fica disponível no fluxo
                </span>
              }
            />
          </div>

          <div className="grid gap-5 p-4">
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="section-title">Esportes ativos</h3>
                <span className="numeric-value text-xs text-muted-foreground">
                  {activeSports} habilitados
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
                {ESPORTES_DEFAULT.map((sport) => {
                  const active = !!esportesAtivos[sport];
                  return (
                    <div
                      key={sport}
                      className={cn(
                        "group relative overflow-hidden rounded-lg border p-3 transition-colors",
                        active
                          ? "border-primary/35 bg-primary/[0.06]"
                          : "border-border bg-background/35",
                      )}
                    >
                      <div
                        aria-hidden="true"
                        className={cn(
                          "absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent transition-opacity",
                          active ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <SportMark sport={sport} size="md" />
                          <span className="truncate text-sm font-medium">{sport}</span>
                        </div>
                        <Switch
                          aria-label={`${active ? "Desativar" : "Ativar"} ${sport}`}
                          checked={active}
                          onCheckedChange={(checked) =>
                            setEsportesAtivos((current) => ({ ...current, [sport]: checked }))
                          }
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="h-px bg-border" />

            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="section-title">Mercados ativos</h3>
                <span className="numeric-value text-xs text-muted-foreground">
                  {activeMarkets} habilitados
                </span>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {MERCADOS_DEFAULT.map((market, index) => {
                  const active = !!mercadosAtivos[market];
                  return (
                    <div
                      key={market}
                      className={cn(
                        "flex min-h-11 items-center justify-between gap-3 rounded border px-3 py-2 transition-colors",
                        active
                          ? "border-primary/25 bg-primary/[0.045]"
                          : "border-border/80 bg-background/30",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          aria-hidden="true"
                          className={cn(
                            "numeric-value flex size-6 shrink-0 items-center justify-center rounded border text-[10px]",
                            active
                              ? "border-primary/30 bg-primary/10 text-primary"
                              : "border-border text-muted-foreground",
                          )}
                        >
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="truncate text-sm">{market}</span>
                      </div>
                      <Switch
                        aria-label={`${active ? "Desativar" : "Ativar"} ${market}`}
                        checked={active}
                        onCheckedChange={(checked) =>
                          setMercadosAtivos((current) => ({ ...current, [market]: checked }))
                        }
                      />
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Mercados desativados deixam de aparecer nos fluxos dependentes desta configuração.
              </p>
            </div>
          </div>
        </section>
      </div>

      <section className="data-surface p-4">
        <PanelHeading
          title="Diagnóstico do Storage"
          icon={HardDrive}
          value={
            <span
              className={cn(
                "rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider",
                storageSmoke.status === "passed"
                  ? "border-success/30 bg-success/10 text-success"
                  : storageSmoke.status === "failed"
                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                    : "border-border bg-background/40 text-muted-foreground",
              )}
            >
              {storageSmoke.status === "idle"
                ? "Não executado"
                : storageSmoke.status === "running"
                  ? "Executando"
                  : storageSmoke.status === "passed"
                    ? "Aprovado"
                    : "Falhou"}
            </span>
          }
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">Bucket privado asp-validator-uploads</p>
            <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
              {storageSmoke.message}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={testarStorage}
            disabled={storageSmoke.status === "running"}
          >
            {storageSmoke.status === "running" ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <HardDrive aria-hidden="true" className="size-4" />
            )}
            Testar Storage
          </Button>
        </div>
      </section>

      <TelegramAlertsPanel className="data-surface" />
    </div>
  );
}

function SummaryItem({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Trophy;
  label: string;
  value: string;
  tone: "primary" | "ai" | "success" | "warning";
}) {
  const toneClasses = {
    primary: "border-primary/30 bg-primary/10 text-primary",
    ai: "border-ai/30 bg-ai/10 text-ai",
    success: "border-success/30 bg-success/10 text-success",
    warning: "border-warning/30 bg-warning/10 text-warning",
  };

  return (
    <article className="flex min-w-0 items-center gap-3 rounded-md border border-border/70 bg-background/25 p-3">
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-md border",
          toneClasses[tone],
        )}
      >
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        <p className="numeric-value mt-0.5 truncate text-lg font-semibold">{value}</p>
      </div>
    </article>
  );
}
