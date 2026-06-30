import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  MlbLeagueAverageSnapshot,
  MlbOddsRow,
  MlbStandingsSnapshot,
  MlbTeamStanding,
} from "@/types/mlbStandings";
import { getMlbStandingsSnapshot, validateMlbStandings } from "@/lib/mlb/standings";

type LooseSupabase = Pick<SupabaseClient, "from">;

function table(db: LooseSupabase, name: string) {
  return (db as unknown as { from: (tableName: string) => any }).from(name);
}

export async function fetchMlbOddsRowsForDate(db: LooseSupabase, snapshotDate: string): Promise<MlbOddsRow[]> {
  const { data, error } = await table(db, "odds_jogos")
    .select("data,hora,mandante,visitante,mercado,pick,linha,odd,bookmaker,fonte,esporte,liga")
    .eq("data", snapshotDate)
    .eq("esporte", "Baseball")
    .limit(5000);
  if (error) throw error;
  return (data ?? [])
    .filter((row: Record<string, unknown>) => !row.liga || /mlb/i.test(String(row.liga)))
    .map((row: Record<string, unknown>) => ({
      data: nullableText(row.data),
      hora: nullableText(row.hora),
      mandante: nullableText(row.mandante) ?? "",
      visitante: nullableText(row.visitante) ?? "",
      mercado: nullableText(row.mercado) ?? "",
      pick: nullableText(row.pick) ?? "",
      linha: nullableText(row.linha),
      odd: Number(row.odd ?? 0),
      bookmaker: nullableText(row.bookmaker),
      fonte: nullableText(row.fonte),
    }));
}

export async function readMlbStandingsSnapshot(
  db: LooseSupabase,
  params: { snapshotDate?: string | null; season?: number | null; oddsRows?: MlbOddsRow[] },
): Promise<MlbStandingsSnapshot | null> {
  let snapshotDate = params.snapshotDate ?? null;
  let season = params.season ?? null;

  if (!snapshotDate || !season) {
    const { data: latest, error: latestError } = await table(db, "mlb_team_standings_snapshots")
      .select("snapshot_date,season")
      .order("snapshot_date", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw latestError;
    if (!latest) return null;
    snapshotDate = latest.snapshot_date;
    season = latest.season;
  }

  if (!snapshotDate || !season) return null;
  const resolvedSnapshotDate = snapshotDate;
  const resolvedSeason = season;

  const { data, error } = await table(db, "mlb_team_standings_snapshots")
    .select("*")
    .eq("snapshot_date", resolvedSnapshotDate)
    .eq("season", resolvedSeason)
    .order("rank", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as Array<MlbTeamStanding & { updated_at?: string; created_at?: string }>;
  if (!rows.length) return null;

  const { data: averageRows, error: averageError } = await table(db, "mlb_league_average_snapshots")
    .select("*")
    .eq("snapshot_date", resolvedSnapshotDate)
    .eq("season", resolvedSeason)
    .limit(1);
  if (averageError) throw averageError;

  const first = rows[0];
  return getMlbStandingsSnapshot(rows.map(stripDbDates), {
    snapshotDate: resolvedSnapshotDate,
    season: resolvedSeason,
    source: first.source,
    sourceUrl: first.source_url,
    importedAt: first.updated_at ?? first.created_at ?? null,
    leagueAverage: (averageRows?.[0] as MlbLeagueAverageSnapshot | undefined) ?? null,
    oddsRows: params.oddsRows,
  });
}

export async function saveMlbStandingsSnapshot(
  db: LooseSupabase,
  snapshot: Omit<MlbStandingsSnapshot, "validation" | "imported_at"> & { teams: MlbTeamStanding[] },
  oddsRows: MlbOddsRow[] = [],
): Promise<MlbStandingsSnapshot> {
  const validation = validateMlbStandings(snapshot.teams, oddsRows);
  if (!validation.valid) {
    throw new Error(`Snapshot MLB invalido: ${validation.errors.join(" ")}`);
  }

  const rows = snapshot.teams.map((team) => ({ ...team, updated_at: new Date().toISOString() }));
  const { error } = await table(db, "mlb_team_standings_snapshots")
    .upsert(rows, { onConflict: "snapshot_date,season,team_key" });
  if (error) throw error;

  if (snapshot.league_average) {
    const { error: averageError } = await table(db, "mlb_league_average_snapshots")
      .upsert({ ...snapshot.league_average, updated_at: new Date().toISOString() }, { onConflict: "snapshot_date,season" });
    if (averageError) throw averageError;
  }

  const saved = await readMlbStandingsSnapshot(db, {
    snapshotDate: snapshot.snapshot_date,
    season: snapshot.season,
    oddsRows,
  });
  if (!saved) throw new Error("Snapshot salvo, mas nao foi possivel recarregar os dados.");
  return saved;
}

function stripDbDates(row: MlbTeamStanding & { updated_at?: string; created_at?: string }) {
  const { updated_at: _updatedAt, created_at: _createdAt, ...team } = row;
  return team;
}

function nullableText(value: unknown): string | null {
  if (value == null || value === "") return null;
  return String(value);
}
