// Public cron endpoint — called by pg_cron every 5 minutes.
// Scans due Critical Validation Telegram alerts and sends them via the
// Lovable Telegram connector gateway. Bypasses auth via /api/public/ prefix.
//
// Security:
//  - Uses the anon apikey header check (default Lovable pattern).
//  - Idempotent: alerts are marked sent immediately on success.
//  - Never touches bankroll, prognosticos or handoff.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  buildCriticalValidationTelegramMessage,
  shouldSendCriticalValidationAlert,
} from "@/lib/validacao-critica/telegramMessage";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";
const MAX_ATTEMPTS = 3;
const RETRY_MINUTES = 5;
const TELEGRAM_BOT_USERNAME = "asp_sentinel_bot";

function parseTelegramSendError(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { description?: string; error_code?: number };
    const description = parsed.description ?? raw;
    if (
      parsed.error_code === 403 &&
      /can't initiate conversation with a user/i.test(description)
    ) {
      return `O bot não pode iniciar conversa com o usuário. O usuário precisa abrir @${TELEGRAM_BOT_USERNAME} e enviar /start.`;
    }
    if (/chat not found|invalid_chat_id/i.test(description)) {
      return "chat_id não encontrado. Confirme se o ID numérico está correto e se o usuário enviou /start para o bot.";
    }
    return description;
  } catch {
    if (/can't initiate conversation with a user/i.test(raw)) {
      return `O bot não pode iniciar conversa com o usuário. O usuário precisa abrir @${TELEGRAM_BOT_USERNAME} e enviar /start.`;
    }
    return raw;
  }
}

async function sendTelegram(
  chatId: string,
  text: string,
): Promise<{ ok: true; message_id: string } | { ok: false; error: string }> {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const TELEGRAM_API_KEY = process.env.TELEGRAM_API_KEY;
  if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY) {
    return { ok: false, error: "TELEGRAM_NOT_CONFIGURED" };
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
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${parseTelegramSendError(body).slice(0, 300)}` };
  try {
    const parsed = JSON.parse(body) as {
      ok?: boolean;
      result?: { message_id?: number };
      description?: string;
    };
    if (!parsed.ok) return { ok: false, error: parsed.description ?? "telegram_not_ok" };
    return { ok: true, message_id: String(parsed.result?.message_id ?? "") };
  } catch {
    return { ok: false, error: "invalid_json_response" };
  }
}

export const Route = createFileRoute("/api/public/hooks/send-critical-validation-telegram-alerts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Minimal auth: require the Supabase anon key header (default pattern).
        const apikey = request.headers.get("apikey") ?? "";
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
        if (!expected || apikey !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
          return new Response(JSON.stringify({ error: "supabase_not_configured" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const now = new Date();
        const nowIso = now.toISOString();

        // Candidates: pending, enabled, target reached, not yet sent, game not started.
        const { data: candidates, error: cerr } = await supabase
          .from("validacao_critica_telegram_alerts")
          .select("*")
          .eq("status", "pending")
          .eq("alert_enabled", true)
          .lte("alert_target_at", nowIso)
          .gt("event_start_at", nowIso)
          .is("telegram_sent_at", null)
          .limit(200);

        if (cerr) {
          return new Response(JSON.stringify({ error: cerr.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const results: Array<{ id: string; status: string; error?: string }> = [];
        for (const a of candidates ?? []) {
          // Skip if a retry cooldown is set and not yet reached
          if (a.next_retry_at && new Date(a.next_retry_at).getTime() > now.getTime()) continue;

          const decision = shouldSendCriticalValidationAlert({
            status: a.status,
            alert_enabled: a.alert_enabled,
            event_start_at: a.event_start_at ? new Date(a.event_start_at) : null,
            alert_target_at: a.alert_target_at ? new Date(a.alert_target_at) : null,
            telegram_sent_at: a.telegram_sent_at ? new Date(a.telegram_sent_at) : null,
            now,
          });
          if (!decision.should) {
            if (decision.reason === "game_started") {
              await supabase
                .from("validacao_critica_telegram_alerts")
                .update({ status: "expired" })
                .eq("id", a.id);
              results.push({ id: a.id, status: "expired" });
            }
            continue;
          }

          // Re-check that the source prognostico is still pending
          if (a.source_table === "prognosticos" && a.source_record_id) {
            const { data: prog } = await supabase
              .from("prognosticos")
              .select("status_validacao,resultado")
              .eq("id", a.source_record_id)
              .maybeSingle();
            if (
              !prog ||
              prog.status_validacao !== "PENDENTE" ||
              prog.resultado !== "PENDENTE"
            ) {
              await supabase
                .from("validacao_critica_telegram_alerts")
                .update({ status: "skipped" })
                .eq("id", a.id);
              results.push({ id: a.id, status: "skipped" });
              continue;
            }
          }

          // Load user chat_id
          const { data: profile } = await supabase
            .from("profiles")
            .select("telegram_chat_id")
            .eq("user_id", a.user_id)
            .maybeSingle();
          const chatId = a.telegram_chat_id?.trim() || profile?.telegram_chat_id?.trim();
          if (!chatId) {
            await supabase
              .from("validacao_critica_telegram_alerts")
              .update({
                status: "failed",
                attempt_count: (a.attempt_count ?? 0) + 1,
                last_attempt_at: nowIso,
                telegram_error: "missing_chat_id",
              })
              .eq("id", a.id);
            results.push({ id: a.id, status: "failed", error: "missing_chat_id" });
            continue;
          }

          const text = buildCriticalValidationTelegramMessage({
            home_team: a.home_team,
            away_team: a.away_team,
            matchup: a.matchup,
            league: a.league,
            sport: a.sport,
            event_time: a.event_time,
            market: a.market,
            pick: a.pick,
            line: a.line,
            odd: a.odd,
            minutes_before: a.alert_minutes_before,
            is_late: decision.is_late,
          });

          const send = await sendTelegram(chatId, text);
          if (send.ok) {
            await supabase
              .from("validacao_critica_telegram_alerts")
              .update({
                status: "sent",
                telegram_chat_id: chatId,
                telegram_message_id: send.message_id,
                telegram_sent_at: nowIso,
                telegram_error: null,
                attempt_count: (a.attempt_count ?? 0) + 1,
                last_attempt_at: nowIso,
              })
              .eq("id", a.id);
            results.push({ id: a.id, status: "sent" });
          } else {
            const nextAttempt = (a.attempt_count ?? 0) + 1;
            const isTerminal = nextAttempt >= MAX_ATTEMPTS;
            await supabase
              .from("validacao_critica_telegram_alerts")
              .update({
                status: isTerminal ? "failed" : "pending",
                attempt_count: nextAttempt,
                last_attempt_at: nowIso,
                next_retry_at: isTerminal
                  ? null
                  : new Date(now.getTime() + RETRY_MINUTES * 60_000).toISOString(),
                telegram_error: send.error,
              })
              .eq("id", a.id);
            results.push({ id: a.id, status: isTerminal ? "failed" : "retry", error: send.error });
          }
        }

        return new Response(
          JSON.stringify({ ok: true, processed: results.length, results }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
