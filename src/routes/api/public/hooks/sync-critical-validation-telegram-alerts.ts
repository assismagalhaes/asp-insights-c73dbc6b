// Public cron endpoint — auto-materializes Critical Validation Telegram alerts
// for every user with a configured telegram_chat_id. Idempotent (unique key
// on (user_id, dedupe_hash) prevents duplicates). Intended to be scheduled
// every 15 minutes via pg_cron.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  buildCriticalValidationAlertDedupeHash,
  calculateCriticalValidationAlertTargetAt,
  parseEventStartAt,
} from "@/lib/validacao-critica/telegramMessage";

const DEFAULT_ALERT_MINUTES = 30;

export const Route = createFileRoute("/api/public/hooks/sync-critical-validation-telegram-alerts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey") ?? "";
        const expected =
          process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
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

        // Users with Telegram configured
        const { data: users, error: uerr } = await supabase
          .from("profiles")
          .select("user_id, telegram_chat_id")
          .not("telegram_chat_id", "is", null);
        if (uerr) {
          return new Response(JSON.stringify({ error: uerr.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const targets = (users ?? []).filter(
          (u) => !!u.telegram_chat_id && !!u.telegram_chat_id.trim(),
        );
        if (targets.length === 0) {
          return new Response(JSON.stringify({ ok: true, users: 0, created: 0 }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        // Pending prognosticos (shared across users in this admin-only setup)
        const { data: pendentes, error: perr } = await supabase
          .from("prognosticos")
          .select(
            "id,data,hora,esporte,liga,jogo,mandante,visitante,mercado,pick,odd_ofertada,odd_ajustada",
          )
          .eq("status_validacao", "PENDENTE")
          .eq("resultado", "PENDENTE");
        if (perr) {
          return new Response(JSON.stringify({ error: perr.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const now = Date.now();
        let created = 0;
        let skippedNoTime = 0;
        let skippedStarted = 0;

        for (const p of pendentes ?? []) {
          const eventStartAt = parseEventStartAt(p.data, p.hora as string | null);
          if (!eventStartAt) {
            skippedNoTime += 1;
            continue;
          }
          if (eventStartAt.getTime() <= now) {
            skippedStarted += 1;
            continue;
          }
          const targetAt = calculateCriticalValidationAlertTargetAt(
            eventStartAt,
            DEFAULT_ALERT_MINUTES,
          );
          const matchup = p.jogo || `${p.mandante ?? ""} vs ${p.visitante ?? ""}`;

          for (const u of targets) {
            const dedupe = buildCriticalValidationAlertDedupeHash({
              user_id: u.user_id,
              source_record_id: p.id,
              matchup,
              market: p.mercado,
              pick: p.pick,
              event_start_at_iso: eventStartAt.toISOString(),
              alert_minutes_before: DEFAULT_ALERT_MINUTES,
            });
            const { error: ierr, data: inserted } = await supabase
              .from("validacao_critica_telegram_alerts")
              .insert({
                user_id: u.user_id,
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
                alert_minutes_before: DEFAULT_ALERT_MINUTES,
                alert_enabled: true,
                dedupe_hash: dedupe,
              })
              .select("id");
            if (!ierr && inserted && inserted.length > 0) created += 1;
            // Silently ignore duplicates (unique violation 23505)
          }
        }

        return new Response(
          JSON.stringify({
            ok: true,
            users: targets.length,
            pendentes: pendentes?.length ?? 0,
            created,
            skipped_no_time: skippedNoTime,
            skipped_started: skippedStarted,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
