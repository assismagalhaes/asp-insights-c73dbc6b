-- Highlightly Phase 2: provider-agnostic sports facts used by Football first.

CREATE TABLE IF NOT EXISTS public.sports_match_team_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.sports_matches(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.sports_teams(id) ON DELETE RESTRICT,
  metric_definition_id uuid NOT NULL REFERENCES public.hl_metric_definitions(id) ON DELETE RESTRICT,
  period_key text NOT NULL DEFAULT '',
  split_key text NOT NULL DEFAULT '',
  numeric_value numeric,
  text_value text,
  boolean_value boolean,
  json_value jsonb,
  source_raw_object_id uuid REFERENCES public.hl_raw_objects(id) ON DELETE SET NULL,
  collected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sports_match_team_stats_one_value CHECK (
    num_nonnulls(numeric_value, text_value, boolean_value, json_value) = 1
  ),
  CONSTRAINT sports_match_team_stats_unique
    UNIQUE (match_id, team_id, metric_definition_id, period_key, split_key)
);

CREATE INDEX IF NOT EXISTS idx_sports_match_team_stats_team
  ON public.sports_match_team_stats (team_id, match_id);
CREATE INDEX IF NOT EXISTS idx_sports_match_team_stats_metric
  ON public.sports_match_team_stats (metric_definition_id, match_id);
CREATE INDEX IF NOT EXISTS idx_sports_match_team_stats_raw
  ON public.sports_match_team_stats (source_raw_object_id)
  WHERE source_raw_object_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.sports_team_season_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.sports_teams(id) ON DELETE CASCADE,
  competition_id uuid REFERENCES public.sports_competitions(id) ON DELETE SET NULL,
  season_id uuid REFERENCES public.sports_seasons(id) ON DELETE SET NULL,
  metric_definition_id uuid NOT NULL REFERENCES public.hl_metric_definitions(id) ON DELETE RESTRICT,
  scope_key text NOT NULL,
  split_key text NOT NULL DEFAULT 'total',
  period_key text NOT NULL DEFAULT '',
  window_from date,
  window_to date,
  numeric_value numeric,
  text_value text,
  boolean_value boolean,
  json_value jsonb,
  source_raw_object_id uuid REFERENCES public.hl_raw_objects(id) ON DELETE SET NULL,
  collected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sports_team_season_stats_one_value CHECK (
    num_nonnulls(numeric_value, text_value, boolean_value, json_value) = 1
  ),
  CONSTRAINT sports_team_season_stats_window_order CHECK (
    window_from IS NULL OR window_to IS NULL OR window_from <= window_to
  ),
  CONSTRAINT sports_team_season_stats_unique
    UNIQUE NULLS NOT DISTINCT (
      team_id, competition_id, season_id, metric_definition_id, scope_key, split_key, period_key
    )
);

CREATE INDEX IF NOT EXISTS idx_sports_team_season_stats_competition
  ON public.sports_team_season_stats (competition_id, season_id, team_id)
  WHERE competition_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sports_team_season_stats_season
  ON public.sports_team_season_stats (season_id, team_id)
  WHERE season_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sports_team_season_stats_metric
  ON public.sports_team_season_stats (metric_definition_id, team_id);
CREATE INDEX IF NOT EXISTS idx_sports_team_season_stats_raw
  ON public.sports_team_season_stats (source_raw_object_id)
  WHERE source_raw_object_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.sports_player_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.sports_players(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.sports_teams(id) ON DELETE SET NULL,
  competition_id uuid REFERENCES public.sports_competitions(id) ON DELETE SET NULL,
  season_id uuid REFERENCES public.sports_seasons(id) ON DELETE SET NULL,
  metric_definition_id uuid NOT NULL REFERENCES public.hl_metric_definitions(id) ON DELETE RESTRICT,
  scope_key text NOT NULL,
  split_key text NOT NULL DEFAULT 'total',
  period_key text NOT NULL DEFAULT '',
  numeric_value numeric,
  text_value text,
  boolean_value boolean,
  json_value jsonb,
  source_raw_object_id uuid REFERENCES public.hl_raw_objects(id) ON DELETE SET NULL,
  collected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sports_player_stats_one_value CHECK (
    num_nonnulls(numeric_value, text_value, boolean_value, json_value) = 1
  ),
  CONSTRAINT sports_player_stats_unique
    UNIQUE NULLS NOT DISTINCT (
      player_id, team_id, competition_id, season_id,
      metric_definition_id, scope_key, split_key, period_key
    )
);

CREATE INDEX IF NOT EXISTS idx_sports_player_stats_team
  ON public.sports_player_stats (team_id, player_id)
  WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sports_player_stats_competition
  ON public.sports_player_stats (competition_id, season_id, player_id)
  WHERE competition_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sports_player_stats_season
  ON public.sports_player_stats (season_id, player_id)
  WHERE season_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sports_player_stats_metric
  ON public.sports_player_stats (metric_definition_id, player_id);
CREATE INDEX IF NOT EXISTS idx_sports_player_stats_raw
  ON public.sports_player_stats (source_raw_object_id)
  WHERE source_raw_object_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.sports_player_box_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.sports_matches(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.sports_players(id) ON DELETE RESTRICT,
  team_id uuid NOT NULL REFERENCES public.sports_teams(id) ON DELETE RESTRICT,
  metric_definition_id uuid NOT NULL REFERENCES public.hl_metric_definitions(id) ON DELETE RESTRICT,
  period_key text NOT NULL DEFAULT '',
  numeric_value numeric,
  text_value text,
  boolean_value boolean,
  json_value jsonb,
  source_raw_object_id uuid REFERENCES public.hl_raw_objects(id) ON DELETE SET NULL,
  collected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sports_player_box_scores_one_value CHECK (
    num_nonnulls(numeric_value, text_value, boolean_value, json_value) = 1
  ),
  CONSTRAINT sports_player_box_scores_unique
    UNIQUE (match_id, player_id, metric_definition_id, period_key)
);

CREATE INDEX IF NOT EXISTS idx_sports_player_box_scores_player
  ON public.sports_player_box_scores (player_id, match_id);
CREATE INDEX IF NOT EXISTS idx_sports_player_box_scores_team
  ON public.sports_player_box_scores (team_id, match_id);
CREATE INDEX IF NOT EXISTS idx_sports_player_box_scores_metric
  ON public.sports_player_box_scores (metric_definition_id, match_id);
CREATE INDEX IF NOT EXISTS idx_sports_player_box_scores_raw
  ON public.sports_player_box_scores (source_raw_object_id)
  WHERE source_raw_object_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.sports_lineups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.sports_matches(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.sports_teams(id) ON DELETE RESTRICT,
  version_key text NOT NULL,
  formation text,
  coach_name text,
  is_confirmed boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  source_raw_object_id uuid REFERENCES public.hl_raw_objects(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sports_lineups_unique UNIQUE (match_id, team_id, version_key)
);

CREATE INDEX IF NOT EXISTS idx_sports_lineups_team
  ON public.sports_lineups (team_id, match_id);
CREATE INDEX IF NOT EXISTS idx_sports_lineups_match_latest
  ON public.sports_lineups (match_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sports_lineups_raw
  ON public.sports_lineups (source_raw_object_id)
  WHERE source_raw_object_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.sports_lineup_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lineup_id uuid NOT NULL REFERENCES public.sports_lineups(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.sports_players(id) ON DELETE RESTRICT,
  role text NOT NULL DEFAULT 'unknown',
  position text,
  shirt_number integer,
  formation_row smallint,
  formation_order smallint,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sports_lineup_players_role_check CHECK (
    role IN ('starter', 'substitute', 'unavailable', 'unknown')
  ),
  CONSTRAINT sports_lineup_players_shirt_check CHECK (shirt_number IS NULL OR shirt_number >= 0),
  CONSTRAINT sports_lineup_players_unique UNIQUE (lineup_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_sports_lineup_players_player
  ON public.sports_lineup_players (player_id, lineup_id);

CREATE TABLE IF NOT EXISTS public.sports_match_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.sports_matches(id) ON DELETE CASCADE,
  sequence_key text NOT NULL,
  event_type text NOT NULL,
  period_key text NOT NULL DEFAULT '',
  clock_display text,
  elapsed_seconds integer,
  team_id uuid REFERENCES public.sports_teams(id) ON DELETE SET NULL,
  player_id uuid REFERENCES public.sports_players(id) ON DELETE SET NULL,
  related_player_id uuid REFERENCES public.sports_players(id) ON DELETE SET NULL,
  score_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_raw_object_id uuid REFERENCES public.hl_raw_objects(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz,
  collected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sports_match_events_elapsed_check CHECK (elapsed_seconds IS NULL OR elapsed_seconds >= 0),
  CONSTRAINT sports_match_events_unique UNIQUE (match_id, sequence_key)
);

CREATE INDEX IF NOT EXISTS idx_sports_match_events_timeline
  ON public.sports_match_events (match_id, elapsed_seconds, sequence_key);
CREATE INDEX IF NOT EXISTS idx_sports_match_events_team
  ON public.sports_match_events (team_id, match_id)
  WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sports_match_events_player
  ON public.sports_match_events (player_id, match_id)
  WHERE player_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sports_match_events_related_player
  ON public.sports_match_events (related_player_id, match_id)
  WHERE related_player_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sports_match_events_raw
  ON public.sports_match_events (source_raw_object_id)
  WHERE source_raw_object_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.sports_standings_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.sports_competitions(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES public.sports_seasons(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.sports_teams(id) ON DELETE RESTRICT,
  group_key text NOT NULL DEFAULT '',
  snapshot_at timestamptz NOT NULL,
  rank integer NOT NULL,
  points numeric NOT NULL DEFAULT 0,
  played integer,
  wins integer,
  draws integer,
  losses integer,
  scored integer,
  conceded integer,
  goal_difference integer,
  form text,
  split_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_raw_object_id uuid REFERENCES public.hl_raw_objects(id) ON DELETE SET NULL,
  quality_status text NOT NULL DEFAULT 'valid',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sports_standings_snapshots_rank_check CHECK (rank > 0),
  CONSTRAINT sports_standings_snapshots_counts_check CHECK (
    (played IS NULL OR played >= 0)
    AND (wins IS NULL OR wins >= 0)
    AND (draws IS NULL OR draws >= 0)
    AND (losses IS NULL OR losses >= 0)
  ),
  CONSTRAINT sports_standings_snapshots_quality_check CHECK (
    quality_status IN ('valid', 'quarantined', 'rejected')
  ),
  CONSTRAINT sports_standings_snapshots_unique
    UNIQUE (competition_id, season_id, group_key, snapshot_at, team_id)
);

CREATE INDEX IF NOT EXISTS idx_sports_standings_latest
  ON public.sports_standings_snapshots (competition_id, season_id, group_key, snapshot_at DESC, rank);
CREATE INDEX IF NOT EXISTS idx_sports_standings_team
  ON public.sports_standings_snapshots (team_id, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_sports_standings_raw
  ON public.sports_standings_snapshots (source_raw_object_id)
  WHERE source_raw_object_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sports_standings_quarantine
  ON public.sports_standings_snapshots (created_at DESC)
  WHERE quality_status <> 'valid';

CREATE TABLE IF NOT EXISTS public.sports_highlights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.sports_providers(id) ON DELETE CASCADE,
  sport_id uuid NOT NULL REFERENCES public.sports(id) ON DELETE CASCADE,
  match_id uuid REFERENCES public.sports_matches(id) ON DELETE SET NULL,
  external_id text NOT NULL,
  highlight_type text,
  title text NOT NULL,
  description text,
  source_name text,
  channel_name text,
  category text,
  preview_url text,
  content_url text NOT NULL,
  embed_url text,
  geo_restrictions jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_raw_object_id uuid REFERENCES public.hl_raw_objects(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sports_highlights_provider_external_unique UNIQUE (provider_id, sport_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_sports_highlights_match
  ON public.sports_highlights (match_id, created_at DESC)
  WHERE match_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sports_highlights_sport
  ON public.sports_highlights (sport_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sports_highlights_raw
  ON public.sports_highlights (source_raw_object_id)
  WHERE source_raw_object_id IS NOT NULL;

DO $phase2$
DECLARE
  target_table text;
  tables text[] := ARRAY[
    'sports_match_team_stats', 'sports_team_season_stats', 'sports_player_stats',
    'sports_player_box_scores', 'sports_lineups', 'sports_lineup_players',
    'sports_match_events', 'sports_standings_snapshots', 'sports_highlights'
  ];
BEGIN
  FOREACH target_table IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', target_table);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', target_table);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', target_table);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = target_table
        AND policyname = 'admin_read_' || target_table
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.has_role((SELECT auth.uid()), ''admin''::public.app_role)))',
        'admin_read_' || target_table,
        target_table
      );
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = target_table AND column_name = 'updated_at'
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || target_table || '_touch_updated_at', target_table);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
        'trg_' || target_table || '_touch_updated_at', target_table
      );
    END IF;
  END LOOP;
END
$phase2$;

NOTIFY pgrst, 'reload schema';
