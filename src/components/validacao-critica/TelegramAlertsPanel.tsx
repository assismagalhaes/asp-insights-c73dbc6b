import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Send, Bell, BellOff, Loader2, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  getUserTelegramChatId,
  setUserTelegramChatId,
  listCriticalAlertsForUser,
  updateCriticalAlertPrefs,
  sendCriticalAlertTest,
  syncCriticalAlertsForUser,
} from "@/lib/validacao-critica/telegramPreMatchAlertService.functions";

type AlertRow = {
  id: string;
  matchup: string | null;
  sport: string | null;
  league: string | null;
  event_date: string | null;
  event_time: string | null;
  event_start_at: string | null;
  alert_target_at: string | null;
  market: string | null;
  pick: string | null;
  odd: number | null;
  status: string;
  alert_enabled: boolean;
  alert_minutes_before: number;
  telegram_sent_at: string | null;
  telegram_error: string | null;
  last_attempt_at: string | null;
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

function statusBadge(status: string): { label: string; className: string } {
  switch (status) {
    case "pending":
      return { label: "Aguardando", className: "bg-muted text-muted-foreground" };
    case "sent":
      return { label: "Enviado", className: "bg-success/15 text-success" };
    case "failed":
      return { label: "Falhou", className: "bg-destructive/15 text-destructive" };
    case "skipped":
      return { label: "Ignorado", className: "bg-muted text-muted-foreground" };
    case "expired":
      return { label: "Expirado", className: "bg-warning/15 text-warning" };
    case "cancelled":
      return { label: "Cancelado", className: "bg-muted text-muted-foreground" };
    default:
      return { label: status, className: "bg-muted text-muted-foreground" };
  }
}

export function TelegramAlertsPanel() {
  const callGetChat = useServerFn(getUserTelegramChatId);
  const callSetChat = useServerFn(setUserTelegramChatId);
  const callList = useServerFn(listCriticalAlertsForUser);
  const callUpdate = useServerFn(updateCriticalAlertPrefs);
  const callTest = useServerFn(sendCriticalAlertTest);
  const callSync = useServerFn(syncCriticalAlertsForUser);

  const [chatId, setChatId] = useState<string>("");
  const [chatIdSaved, setChatIdSaved] = useState<string>("");
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingChat, setSavingChat] = useState(false);
  const [testingId, setTestingId] = useState<string | "profile" | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [chat, list] = await Promise.all([
        callGetChat(),
        callList(),
      ]);
      setChatId(chat.chat_id ?? "");
      setChatIdSaved(chat.chat_id ?? "");
      setAlerts((list as unknown as AlertRow[]) ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Falha ao carregar alertas: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doSync = async () => {
    setLoading(true);
    try {
      const r = await callSync({ data: {} } as never);
      toast.success(
        `Sincronizado: ${r.created} novo(s) alerta(s). ${r.skipped_no_time > 0 ? `${r.skipped_no_time} sem horário confiável.` : ""}`,
      );
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Falha ao sincronizar: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const saveChat = async () => {
    setSavingChat(true);
    try {
      const r = await callSetChat({ data: { chat_id: chatId.trim() || null } });
      setChatIdSaved(r.chat_id ?? "");
      toast.success("Chat Telegram salvo.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Falha ao salvar chat_id: ${msg}`);
    } finally {
      setSavingChat(false);
    }
  };

  const toggleEnabled = async (a: AlertRow) => {
    try {
      await callUpdate({ data: { alert_id: a.id, enabled: !a.alert_enabled } });
      setAlerts((prev) =>
        prev.map((x) => (x.id === a.id ? { ...x, alert_enabled: !a.alert_enabled } : x)),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Falha: ${msg}`);
    }
  };

  const changeMinutes = async (a: AlertRow, minutes: number) => {
    try {
      await callUpdate({ data: { alert_id: a.id, minutes_before: minutes } });
      await load();
      toast.success(`Antecedência: ${minutes} min.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Falha: ${msg}`);
    }
  };

  const sendTest = async (alertId: string | null) => {
    setTestingId(alertId ?? "profile");
    try {
      await callTest({ data: { alert_id: alertId } });
      toast.success("Mensagem de teste enviada.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Falha no envio: ${msg}`);
    } finally {
      setTestingId(null);
    }
  };

  const chatIdDirty = chatId.trim() !== (chatIdSaved ?? "").trim();

  return (
    <section className="border border-border rounded-lg bg-card p-4 space-y-4">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Bell className="h-4 w-4" /> Alerta Telegram Pré-Jogo
          </h3>
          <p className="text-xs text-muted-foreground">
            Aviso 30 minutos antes de cada confronto pendente na Validação Crítica.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={doSync} disabled={loading}>
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            <span className="ml-1">Sincronizar pendentes</span>
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 items-end">
        <div>
          <Label htmlFor="tg-chat-id" className="text-xs">
            Seu chat_id do Telegram
          </Label>
          <Input
            id="tg-chat-id"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder="Ex.: 123456789"
            className="h-8"
          />
        </div>
        <Button size="sm" onClick={saveChat} disabled={savingChat || !chatIdDirty}>
          {savingChat ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          <span className="ml-1">Salvar</span>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => sendTest(null)}
          disabled={testingId === "profile" || !chatIdSaved}
        >
          {testingId === "profile" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Send className="h-3 w-3" />
          )}
          <span className="ml-1">Testar</span>
        </Button>
      </div>

      {alerts.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhum alerta criado ainda. Clique em "Sincronizar pendentes" para gerar alertas para
          os prognósticos pendentes com data e horário definidos.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-left py-2 pr-2">Jogo</th>
                <th className="text-left py-2 pr-2">Liga</th>
                <th className="text-left py-2 pr-2">Início</th>
                <th className="text-left py-2 pr-2">Mercado / Pick</th>
                <th className="text-left py-2 pr-2">Alerta em</th>
                <th className="text-left py-2 pr-2">Antec.</th>
                <th className="text-left py-2 pr-2">Status</th>
                <th className="text-right py-2 pl-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => {
                const badge = statusBadge(a.status);
                return (
                  <tr key={a.id} className="border-b border-border/50 align-top">
                    <td className="py-2 pr-2">{a.matchup || "-"}</td>
                    <td className="py-2 pr-2">{a.league || "-"}</td>
                    <td className="py-2 pr-2 whitespace-nowrap">
                      {fmtDateTime(a.event_start_at)}
                    </td>
                    <td className="py-2 pr-2">
                      <div>{a.market || "-"}</div>
                      <div className="text-muted-foreground">
                        {a.pick || "-"}
                        {a.odd != null ? ` @ ${Number(a.odd).toFixed(2)}` : ""}
                      </div>
                    </td>
                    <td className="py-2 pr-2 whitespace-nowrap">
                      {fmtDateTime(a.alert_target_at)}
                    </td>
                    <td className="py-2 pr-2">
                      <Select
                        value={String(a.alert_minutes_before)}
                        onValueChange={(v) => changeMinutes(a, Number(v))}
                      >
                        <SelectTrigger className="h-7 w-[70px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="15">15</SelectItem>
                          <SelectItem value="30">30</SelectItem>
                          <SelectItem value="45">45</SelectItem>
                          <SelectItem value="60">60</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-2 pr-2">
                      <span
                        className={cn(
                          "inline-block px-2 py-0.5 rounded text-[10px] font-medium",
                          badge.className,
                        )}
                      >
                        {badge.label}
                      </span>
                      {a.telegram_error && (
                        <div className="text-[10px] text-destructive mt-1">{a.telegram_error}</div>
                      )}
                      {a.telegram_sent_at && (
                        <div className="text-[10px] text-muted-foreground mt-1">
                          {fmtDateTime(a.telegram_sent_at)}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pl-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          onClick={() => toggleEnabled(a)}
                          title={a.alert_enabled ? "Desativar alerta" : "Ativar alerta"}
                        >
                          {a.alert_enabled ? (
                            <Bell className="h-3 w-3" />
                          ) : (
                            <BellOff className="h-3 w-3 text-muted-foreground" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          onClick={() => sendTest(a.id)}
                          disabled={testingId === a.id || !chatIdSaved}
                          title="Enviar teste agora"
                        >
                          {testingId === a.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Send className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
