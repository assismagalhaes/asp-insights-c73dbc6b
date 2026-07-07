// Pure helpers (isomorphic) for Critical Validation Telegram pre-match alerts.
// Kept separate from the *.functions.ts module so both client (UI) and server
// (cron route + server fns) can share formatting/dedupe logic.

import { createHash } from "crypto";

export interface CriticalAlertMessageInput {
  home_team: string | null;
  away_team: string | null;
  matchup: string | null;
  league: string | null;
  sport: string | null;
  event_time: string | null;
  market: string | null;
  pick: string | null;
  line: string | null;
  odd: number | null;
  minutes_before: number;
  is_late?: boolean;
}

const BASEBALL_CHECKLIST = [
  "• Starting pitchers confirmados",
  "• Lineups oficiais",
  "• Scratches",
  "• Uso recente do bullpen",
  "• Catcher/rotação",
  "• Park factor e clima/vento",
  "• Movimentação de odds",
];

const DEFAULT_CHECKLIST = [
  "• Confirmar escalações/lineups/starters",
  "• Verificar ausências, scratches ou mudanças recentes",
  "• Conferir movimentação de odds",
  "• Revisar clima e contexto do confronto",
  "• Reavaliar se o edge ainda permanece válido",
];

function isBaseball(sport: string | null | undefined, league: string | null | undefined): boolean {
  const s = `${sport ?? ""} ${league ?? ""}`.toLowerCase();
  return /baseball|mlb/.test(s);
}

export function buildCriticalValidationTelegramMessage(input: CriticalAlertMessageInput): string {
  const matchup =
    input.matchup ||
    (input.home_team && input.away_team ? `${input.home_team} x ${input.away_team}` : "-");
  const league = input.league || "-";
  const time = input.event_time || "-";
  const market = input.market || "-";
  const pick = input.pick || "-";
  const line = input.line ? ` ${input.line}` : "";
  const odd = input.odd != null ? Number(input.odd).toFixed(2) : "-";
  const minutes = input.minutes_before;

  const checklist = isBaseball(input.sport, input.league) ? BASEBALL_CHECKLIST : DEFAULT_CHECKLIST;
  const checklistLabel = isBaseball(input.sport, input.league) ? "Checklist MLB:" : "Checklist final:";

  const header = `🚨 <b>ASP Insights — Revisão Crítica Pré-Jogo</b>`;
  const late = input.is_late ? "\n⚠️ <i>Alerta tardio: confronto próximo do início.</i>" : "";

  return [
    header,
    "",
    `Faltam aproximadamente <b>${minutes} minutos</b> para:`,
    "",
    `🏟️ Jogo: <b>${escapeHtml(matchup)}</b>`,
    `🏆 Liga: ${escapeHtml(league)}`,
    `🕒 Início: ${escapeHtml(time)}`,
    `📌 Mercado: ${escapeHtml(market)}`,
    `🎯 Pick pendente: ${escapeHtml(pick + line)}`,
    `📈 Odd: ${odd}`,
    "",
    `Status: pendente na Validação Crítica.`,
    "",
    `${checklistLabel}`,
    ...checklist,
    "",
    `Ação recomendada:`,
    `Abrir a Validação Crítica e concluir a revisão antes do início.` + late,
  ].join("\n");
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Combine data (YYYY-MM-DD) + hora (HH:MM[:SS]) as Brazil time (-03:00)
export function parseEventStartAt(
  data: string | null | undefined,
  hora: string | null | undefined,
): Date | null {
  if (!data || !hora) return null;
  const cleanHora = hora.length === 5 ? `${hora}:00` : hora;
  const iso = `${data}T${cleanHora}-03:00`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function calculateCriticalValidationAlertTargetAt(
  eventStartAt: Date,
  minutesBefore: number,
): Date {
  return new Date(eventStartAt.getTime() - minutesBefore * 60_000);
}

export interface DedupeInput {
  user_id: string;
  source_record_id: string | null;
  matchup: string | null;
  market: string | null;
  pick: string | null;
  event_start_at_iso: string | null;
  alert_minutes_before: number;
}

export function buildCriticalValidationAlertDedupeHash(input: DedupeInput): string {
  const raw = [
    input.user_id,
    input.source_record_id ?? "",
    (input.matchup ?? "").trim().toLowerCase(),
    (input.market ?? "").trim().toLowerCase(),
    (input.pick ?? "").trim().toLowerCase(),
    input.event_start_at_iso ?? "",
    String(input.alert_minutes_before),
  ].join("|");
  return createHash("sha256").update(raw).digest("hex");
}

export interface ShouldSendInput {
  status: string;
  alert_enabled: boolean;
  event_start_at: Date | null;
  alert_target_at: Date | null;
  telegram_sent_at: Date | null;
  now?: Date;
}

export function shouldSendCriticalValidationAlert(input: ShouldSendInput): {
  should: boolean;
  reason?: string;
  is_late?: boolean;
} {
  const now = input.now ?? new Date();
  if (!input.alert_enabled) return { should: false, reason: "disabled" };
  if (input.status !== "pending") return { should: false, reason: `status_${input.status}` };
  if (input.telegram_sent_at) return { should: false, reason: "already_sent" };
  if (!input.event_start_at || !input.alert_target_at)
    return { should: false, reason: "missing_time" };
  if (input.event_start_at.getTime() <= now.getTime())
    return { should: false, reason: "game_started" };
  if (input.alert_target_at.getTime() > now.getTime())
    return { should: false, reason: "too_early" };

  const msUntilStart = input.event_start_at.getTime() - now.getTime();
  const is_late = msUntilStart < 10 * 60_000;
  return { should: true, is_late };
}
