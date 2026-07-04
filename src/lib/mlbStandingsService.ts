import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  MlbLeagueAverageSnapshot,
  MlbOddsRow,
  MlbStandingsSnapshot,
  MlbTeamStanding,
} from "@/types/mlbStandings";
import { getMlbStandingsSnapshot, validateMlbStandings } from "@/lib/mlb/standings";

type LooseSupabase = Pick<SupabaseClient, "from">;

const MLB_ODDS_ROWS_LIMIT = 5000;

function table(db: LooseSupabase, name: string) {
  return (db as unknown as { from: (tableName: string) => any }).from(name);
}

export async function fetchMlbOddsRowsForDate(
  db: LooseSupabase,
  snapshotDate: string,
): Promise<MlbOddsRow[]> {
  const { data, error } = await table(db, "odds_jogos")
    .select(
      "data,hora,mandante,visitante,mercado,pick,linha,odd,odd_media,odd_mediana,odd_minima,odd_maxima,odd_melhor,bookmaker_melhor,casas_count,odds_disponiveis,probabilidade_implicita_media,probabilidade_implicita_mediana,margem_mercado_media,margem_mercado_mediana,bookmaker,fonte,esporte,liga",
    )
    .eq("data", snapshotDate)
    .limit(MLB_ODDS_ROWS_LIMIT);
  if (error) throw error;
  return (data ?? [])
    .filter(
      (row: Record<string, unknown>) =>
        isBaseballSport(nullableText(row.esporte)) && isMlbLeague(nullableText(row.liga)),
    )
    .map((row: Record<string, unknown>) => ({
      data: nullableText(row.data),
      hora: nullableText(row.hora),
      mandante: nullableText(row.mandante) ?? "",
      visitante: nullableText(row.visitante) ?? "",
      mercado: nullableText(row.mercado) ?? "",
      pick: nullableText(row.pick) ?? "",
      linha: nullableText(row.linha),
      odd: Number(row.odd ?? 0),
      odd_media: nullableNumber(row.odd_media),
      odd_mediana: nullableNumber(row.odd_mediana),
      odd_minima: nullableNumber(row.odd_minima),
      odd_maxima: nullableNumber(row.odd_maxima),
      odd_melhor: nullableNumber(row.odd_melhor),
      bookmaker_melhor: nullableText(row.bookmaker_melhor),
      casas_count: nullableNumber(row.casas_count),
      odds_disponiveis: nullableNumber(row.odds_disponiveis),
      probabilidade_implicita_media: nullableNumber(row.probabilidade_implicita_media),
      probabilidade_implicita_mediana: nullableNumber(row.probabilidade_implicita_mediana),
      margem_mercado_media: nullableNumber(row.margem_mercado_media),
      margem_mercado_mediana: nullableNumber(row.margem_mercado_mediana),
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
  const rows = (data ?? []) as Array<
    MlbTeamStanding & { updated_at?: string; created_at?: string }
  >;
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
  const { error } = await table(db, "mlb_team_standings_snapshots").upsert(rows, {
    onConflict: "snapshot_date,season,team_key",
  });
  if (error) throw error;

  if (snapshot.league_average) {
    const { error: averageError } = await table(db, "mlb_league_average_snapshots").upsert(
      { ...snapshot.league_average, updated_at: new Date().toISOString() },
      { onConflict: "snapshot_date,season" },
    );
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

function nullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isBaseballSport(value: string | null | undefined) {
  const normalized = normalizeText(value);
  return /baseball|beisebol|mlb/.test(normalized);
}

function isMlbLeague(value: string | null | undefined) {
  const normalized = normalizeText(value);
  return !normalized || /mlb|major league baseball/.test(normalized);
}
