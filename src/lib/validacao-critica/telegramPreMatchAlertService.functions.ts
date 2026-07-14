// Server functions for Critical Validation pre-match Telegram alerts.
// Scope: Validação Crítica only. Does not alter other application modules.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/auth-middleware-public";
import {
  buildCriticalValidationAlertDedupeHash,
  buildCriticalValidationTelegramMessage,
  calculateCriticalValidationAlertTargetAt,
  parseEventStartAt,
} from "./telegramMessage";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";
const TELEGRAM_BOT_USERNAME = "asp_sentinel_bot";

function parseTelegramSendError(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { description?: string; error_code?: number };
    const description = parsed.description ?? raw;
    if (parsed.error_code === 403 && /can't initiate conversation with a user/i.test(description)) {
      return `O bot não pode iniciar conversa com você. Abra @${TELEGRAM_BOT_USERNAME} no Telegram, envie /start e depois clique em Testar novamente.`;
    }
    if (/chat not found|invalid_chat_id/i.test(description)) {
      return "chat_id não encontrado. Confirme se você colou o ID numérico correto e enviou /start para o bot do projeto.";
    }
    return description;
  } catch {
    if (/can't initiate conversation with a user/i.test(raw)) {
      return `O bot não pode iniciar conversa com você. Abra @${TELEGRAM_BOT_USERNAME} no Telegram, envie /start e depois clique em Testar novamente.`;
    }
    return raw;
  }
}

async function sendTelegramMessage(
  chatId: string,
  text: string,
): Promise<{ ok: true; message_id: string } | { ok: false; error: string; status: number }> {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const TELEGRAM_API_KEY = process.env.TELEGRAM_API_KEY;
  if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY) {
    return { ok: false, error: "TELEGRAM_NOT_CONFIGURED", status: 0 };
  }
  const res = await fetch(`${GATEWAY_URL}/sendMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TELEGRAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  const body = await res.text();
  if (!res.ok)
    return { ok: false, error: parseTelegramSendError(body).slice(0, 500), status: res.status };
  try {
    const parsed = JSON.parse(body) as {
      ok?: boolean;
      result?: { message_id?: number };
      description?: string;
    };
    if (!parsed.ok)
      return { ok: false, error: parsed.description ?? "telegram_not_ok", status: res.status };
    return { ok: true, message_id: String(parsed.result?.message_id ?? "") };
  } catch {
    return { ok: false, error: "invalid_json_response", status: res.status };
  }
}

// -----------------------------------------------------------------------------
// User profile: telegram_chat_id
// -----------------------------------------------------------------------------

export const getUserTelegramChatId = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("telegram_chat_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { chat_id: data?.telegram_chat_id ?? null };
  });

export const setUserTelegramChatId = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: { chat_id: string | null }) =>
    z.object({ chat_id: z.string().trim().max(64).nullable() }).parse(v),
  )
  .handler(async ({ data, context }) => {
    const chat_id = data.chat_id?.trim() || null;
    const { error } = await context.supabase
      .from("profiles")
      .update({ telegram_chat_id: chat_id })
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { chat_id };
  });

// -----------------------------------------------------------------------------
// Sync pending prognosticos -> ensure alerts exist
// -----------------------------------------------------------------------------

export const syncCriticalAlertsForUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Read this user's pending prognosticos (Validação Crítica pendente)
    const { data: pendentes, error: perr } = await context.supabase
      .from("prognosticos")
      .select(
        "id,data,hora,esporte,liga,jogo,mandante,visitante,mercado,pick,odd_ofertada,odd_ajustada",
      )
      .eq("status_validacao", "PENDENTE")
      .eq("resultado", "PENDENTE");
    if (perr) throw new Error(perr.message);

    const now = Date.now();
    let created = 0;
    let skippedNoTime = 0;

    for (const p of pendentes ?? []) {
      const eventStartAt = parseEventStartAt(p.data, p.hora as string | null);
      if (!eventStartAt) {
        skippedNoTime += 1;
        continue;
      }
      // If game already started, don't create
      if (eventStartAt.getTime() <= now) continue;

      const alertMinutes = 30;
      const targetAt = calculateCriticalValidationAlertTargetAt(eventStartAt, alertMinutes);
      const matchup = p.jogo || `${p.mandante ?? ""} vs ${p.visitante ?? ""}`;
      const dedupe = buildCriticalValidationAlertDedupeHash({
        user_id: context.userId,
        source_record_id: p.id,
        matchup,
        market: p.mercado,
        pick: p.pick,
        event_start_at_iso: eventStartAt.toISOString(),
        alert_minutes_before: alertMinutes,
      });

      // Only insert; ignore duplicates via unique(user_id, dedupe_hash)
      const { error: ierr, data: inserted } = await context.supabase
        .from("validacao_critica_telegram_alerts")
        .insert({
          user_id: context.userId,
          critical_validation_id: null,
          source_table: "prognosticos",
          source_record_id: p.id,
          sport: p.esporte,
          league: p.liga,
          event_date: p.data,
          event_time: (p.hora as string | null)?.slice(0, 5) ?? null,
          event_start_at: eventStartAt.toISOString(),
          alert_target_at: targetAt.toISOString(),
          home_team: p.mandante,
          away_team: p.visitante,
          matchup,
          market: p.mercado,
          pick: p.pick,
          line: null,
          odd: p.odd_ajustada ?? p.odd_ofertada,
          status: "pending",
          alert_minutes_before: alertMinutes,
          alert_enabled: true,
          dedupe_hash: dedupe,
        })
        .select("id");
      if (!ierr && inserted) created += 1;
      // Ignore duplicate errors silently (unique violation code 23505)
    }

    return { created, skipped_no_time: skippedNoTime, total_pendentes: pendentes?.length ?? 0 };
  });

// -----------------------------------------------------------------------------
// List alerts (own)
// -----------------------------------------------------------------------------

export const listCriticalAlertsForUser = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("validacao_critica_telegram_alerts")
      .select("*")
      .eq("user_id", context.userId)
      .order("event_start_at", { ascending: true, nullsFirst: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// -----------------------------------------------------------------------------
// Update prefs (enable/disable, minutes)
// -----------------------------------------------------------------------------

export const updateCriticalAlertPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: { alert_id: string; enabled?: boolean; minutes_before?: number }) =>
    z
      .object({
        alert_id: z.string().uuid(),
        enabled: z.boolean().optional(),
        minutes_before: z.number().int().min(5).max(240).optional(),
      })
      .parse(v),
  )
  .handler(async ({ data, context }) => {
    const patch: {
      alert_enabled?: boolean;
      alert_minutes_before?: number;
      alert_target_at?: string;
      status?: string;
      telegram_error?: string | null;
    } = {};
    if (data.enabled !== undefined) patch.alert_enabled = data.enabled;
    if (data.minutes_before !== undefined) {
      patch.alert_minutes_before = data.minutes_before;
      const { data: row, error: rerr } = await context.supabase
        .from("validacao_critica_telegram_alerts")
        .select("event_start_at,status")
        .eq("id", data.alert_id)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (rerr) throw new Error(rerr.message);
      if (row?.event_start_at) {
        const target = new Date(
          new Date(row.event_start_at).getTime() - data.minutes_before * 60_000,
        );
        patch.alert_target_at = target.toISOString();
      }
      if (row?.status && ["expired", "failed"].includes(row.status)) {
        patch.status = "pending";
        patch.telegram_error = null;
      }
    }

    const { error } = await context.supabase
      .from("validacao_critica_telegram_alerts")
      .update(patch)
      .eq("id", data.alert_id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -----------------------------------------------------------------------------
// Test send (send NOW to user's chat, does not touch alert state persistently)
// -----------------------------------------------------------------------------

export const sendCriticalAlertTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: { alert_id?: string | null }) =>
    z.object({ alert_id: z.string().uuid().nullable().optional() }).parse(v),
  )
  .handler(async ({ data, context }) => {
    const { data: profile, error: perr } = await context.supabase
      .from("profiles")
      .select("telegram_chat_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (perr) throw new Error(perr.message);
    const chatId = profile?.telegram_chat_id?.trim();
    if (!chatId) throw new Error("Telegram chat_id não configurado no seu perfil.");

    let text: string;
    if (data.alert_id) {
      const { data: alert, error: aerr } = await context.supabase
        .from("validacao_critica_telegram_alerts")
        .select("*")
        .eq("id", data.alert_id)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (aerr) throw new Error(aerr.message);
      if (!alert) throw new Error("Alerta não encontrado.");
      text = buildCriticalValidationTelegramMessage({
        home_team: alert.home_team,
        away_team: alert.away_team,
        matchup: alert.matchup,
        league: alert.league,
        sport: alert.sport,
        event_time: alert.event_time,
        market: alert.market,
        pick: alert.pick,
        line: alert.line,
        odd: alert.odd,
        minutes_before: alert.alert_minutes_before,
      });
      text = `<i>[TESTE]</i>\n${text}`;
    } else {
      text = `🚨 <b>ASP Insights</b>\n\nTeste de conexão Telegram — Validação Crítica.\n\nSe você recebeu esta mensagem, seu chat_id está configurado corretamente.`;
    }

    const res = await sendTelegramMessage(chatId, text);
    if (!res.ok) throw new Error(`Falha ao enviar: ${res.error}`);
    return { ok: true, message_id: res.message_id };
  });

// -----------------------------------------------------------------------------
// Cancel / re-enable
// -----------------------------------------------------------------------------

export const cancelCriticalAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: { alert_id: string }) => z.object({ alert_id: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("validacao_critica_telegram_alerts")
      .update({ status: "cancelled", alert_enabled: false })
      .eq("id", data.alert_id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
