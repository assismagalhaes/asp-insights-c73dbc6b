import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/auth-middleware-public";
import {
  fetchMlbDetailedStandings,
  getMlbStandingsSnapshot,
  MLB_STANDINGS_SOURCE_URL,
  parseMlbStandingsCsv,
  parseMlbStandingsHtml,
} from "@/lib/mlb/standings";
import { todayBR } from "@/lib/date-br";
import {
  fetchMlbOddsRowsForDate,
  readMlbStandingsSnapshot,
  saveMlbStandingsSnapshot,
} from "@/lib/mlbStandingsService";
import type { MlbStandingsSnapshot } from "@/types/mlbStandings";

const SnapshotInputObjectSchema = z.object({
  snapshotDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  season: z.number().int().min(2000).max(2100).optional(),
  forceRefresh: z.boolean().optional().default(false),
});

const SnapshotInputSchema = SnapshotInputObjectSchema.transform((data) => {
  const today = todayBR();
  return {
    snapshotDate: data.snapshotDate ?? today,
    season: data.season ?? Number(today.slice(0, 4)),
    forceRefresh: data.forceRefresh,
  };
});

const CsvInputSchema = SnapshotInputObjectSchema.extend({
  csv: z.string().min(20, "Cole o CSV da tabela MLB Detailed Standings."),
}).transform((data) => {
  const today = todayBR();
  return {
    snapshotDate: data.snapshotDate ?? today,
    season: data.season ?? Number(today.slice(0, 4)),
    forceRefresh: data.forceRefresh,
    csv: data.csv,
  };
});

export const getMlbStandingsSnapshotFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SnapshotInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const oddsRows = await fetchMlbOddsRowsForDate(context.supabase, data.snapshotDate);
    const snapshot = await readMlbStandingsSnapshot(context.supabase, {
      snapshotDate: data.snapshotDate,
      season: data.season,
      oddsRows,
    });
    return {
      snapshot: snapshot as MlbStandingsSnapshot | null,
      oddsRowsCount: oddsRows.length,
      fromCache: Boolean(snapshot),
    };
  });

export const refreshMlbStandingsFromBaseballReference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SnapshotInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const oddsRows = await fetchMlbOddsRowsForDate(context.supabase, data.snapshotDate);
    if (!data.forceRefresh) {
      const existing = await readMlbStandingsSnapshot(context.supabase, {
        snapshotDate: data.snapshotDate,
        season: data.season,
        oddsRows,
      });
      if (existing) return { snapshot: existing, oddsRowsCount: oddsRows.length, fromCache: true };
    }

    try {
      const html = await fetchMlbDetailedStandings();
      const parsed = parseMlbStandingsHtml(html, {
        snapshotDate: data.snapshotDate,
        season: data.season,
        source: "baseball_reference",
      });
      const snapshot = getMlbStandingsSnapshot(parsed.teams, {
        snapshotDate: data.snapshotDate,
        season: data.season,
        source: "baseball_reference",
        sourceUrl: MLB_STANDINGS_SOURCE_URL,
        leagueAverage: parsed.league_average,
        oddsRows,
      });
      const saved = await saveMlbStandingsSnapshot(context.supabase, snapshot, oddsRows);
      return { snapshot: saved, oddsRowsCount: oddsRows.length, fromCache: false };
    } catch (error) {
      console.error("[MLB Standings] Falha ao raspar Baseball-Reference", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message} Cole o CSV manual para concluir a Etapa 02.`);
    }
  });

export const processManualMlbStandingsCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CsvInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const oddsRows = await fetchMlbOddsRowsForDate(context.supabase, data.snapshotDate);
    const parsed = parseMlbStandingsCsv(data.csv, {
      snapshotDate: data.snapshotDate,
      season: data.season,
      source: "csv_manual",
    });
    const snapshot = getMlbStandingsSnapshot(parsed.teams, {
      snapshotDate: data.snapshotDate,
      season: data.season,
      source: "csv_manual",
      sourceUrl: MLB_STANDINGS_SOURCE_URL,
      leagueAverage: parsed.league_average,
      oddsRows,
    });
    const saved = await saveMlbStandingsSnapshot(context.supabase, snapshot, oddsRows);
    return { snapshot: saved, oddsRowsCount: oddsRows.length, fromCache: false };
  });
