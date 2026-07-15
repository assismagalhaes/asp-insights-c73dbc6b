-- Highlightly Phase 1: provider catalog and canonical sports entities.
-- The provider-specific identifiers live in sports_provider_entities so that
-- ASP Insights can add other data providers without replacing canonical IDs.

CREATE TABLE IF NOT EXISTS public.sports_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  base_url text,
  contract_version text,
  enabled boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sports_providers_code_format CHECK (code ~ '^[a-z0-9_]+$')
);

CREATE TABLE IF NOT EXISTS public.sports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sports_code_format CHECK (code ~ '^[a-z0-9_]+$')
);

CREATE TABLE IF NOT EXISTS public.sports_countries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text,
  name text NOT NULL,
  flag_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sports_countries_code
  ON public.sports_countries (upper(code))
  WHERE code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sports_countries_name
  ON public.sports_countries (lower(name));

CREATE TABLE IF NOT EXISTS public.sports_competitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id uuid NOT NULL REFERENCES public.sports(id) ON DELETE RESTRICT,
  country_id uuid REFERENCES public.sports_countries(id) ON DELETE SET NULL,
  name text NOT NULL,
  short_name text,
  competition_type text,
  logo_url text,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sports_competitions_sport
  ON public.sports_competitions (sport_id, is_active, name);
CREATE INDEX IF NOT EXISTS idx_sports_competitions_country
  ON public.sports_competitions (country_id)
  WHERE country_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.sports_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.sports_competitions(id) ON DELETE CASCADE,
  label text NOT NULL,
  start_date date,
  end_date date,
  is_current boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sports_seasons_date_order CHECK (
    start_date IS NULL OR end_date IS NULL OR start_date <= end_date
  ),
  CONSTRAINT sports_seasons_competition_label_unique UNIQUE (competition_id, label)
);

CREATE INDEX IF NOT EXISTS idx_sports_seasons_current
  ON public.sports_seasons (competition_id, is_current, start_date DESC);

CREATE TABLE IF NOT EXISTS public.sports_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id uuid NOT NULL REFERENCES public.sports(id) ON DELETE RESTRICT,
  country_id uuid REFERENCES public.sports_countries(id) ON DELETE SET NULL,
  name text NOT NULL,
  display_name text,
  abbreviation text,
  team_type text,
  logo_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sports_teams_sport_name
  ON public.sports_teams (sport_id, name);
CREATE INDEX IF NOT EXISTS idx_sports_teams_country
  ON public.sports_teams (country_id)
  WHERE country_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.sports_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id uuid NOT NULL REFERENCES public.sports(id) ON DELETE RESTRICT,
  current_team_id uuid REFERENCES public.sports_teams(id) ON DELETE SET NULL,
  name text NOT NULL,
  display_name text,
  first_name text,
  last_name text,
  position text,
  nationality text,
  birth_date date,
  image_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sports_players_sport_name
  ON public.sports_players (sport_id, name);
CREATE INDEX IF NOT EXISTS idx_sports_players_current_team
  ON public.sports_players (current_team_id)
  WHERE current_team_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.sports_bookmakers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  normalized_name text NOT NULL UNIQUE,
  logo_url text,
  is_preferred boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sports_bookmakers_normalized_name_format
    CHECK (normalized_name ~ '^[a-z0-9][a-z0-9._-]*$')
);

CREATE INDEX IF NOT EXISTS idx_sports_bookmakers_preferred
  ON public.sports_bookmakers (is_preferred, is_active, normalized_name);

CREATE TABLE IF NOT EXISTS public.sports_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id uuid NOT NULL REFERENCES public.sports(id) ON DELETE RESTRICT,
  competition_id uuid REFERENCES public.sports_competitions(id) ON DELETE SET NULL,
  season_id uuid REFERENCES public.sports_seasons(id) ON DELETE SET NULL,
  kickoff_at timestamptz,
  status text NOT NULL DEFAULT 'scheduled',
  provider_status text,
  round_name text,
  venue_name text,
  venue_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  score_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  state_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sports_matches_status_check CHECK (
    status IN ('scheduled', 'live', 'paused', 'postponed', 'cancelled', 'finished', 'unknown')
  )
);

CREATE INDEX IF NOT EXISTS idx_sports_matches_schedule
  ON public.sports_matches (sport_id, kickoff_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_sports_matches_competition_schedule
  ON public.sports_matches (competition_id, kickoff_at DESC)
  WHERE competition_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sports_matches_active
  ON public.sports_matches (kickoff_at, sport_id)
  WHERE status IN ('scheduled', 'live', 'paused');
CREATE INDEX IF NOT EXISTS idx_sports_matches_season
  ON public.sports_matches (season_id)
  WHERE season_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.sports_match_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.sports_matches(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.sports_teams(id) ON DELETE RESTRICT,
  role text NOT NULL,
  score_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sports_match_participants_role_check CHECK (role IN ('home', 'away')),
  CONSTRAINT sports_match_participants_match_role_unique UNIQUE (match_id, role),
  CONSTRAINT sports_match_participants_match_team_unique UNIQUE (match_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_sports_match_participants_team
  ON public.sports_match_participants (team_id, match_id);

CREATE TABLE IF NOT EXISTS public.sports_match_period_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.sports_matches(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.sports_teams(id) ON DELETE RESTRICT,
  period_key text NOT NULL,
  period_order smallint NOT NULL,
  score integer NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sports_match_period_scores_period_order_check CHECK (period_order >= 0),
  CONSTRAINT sports_match_period_scores_score_check CHECK (score >= 0),
  CONSTRAINT sports_match_period_scores_unique UNIQUE (match_id, team_id, period_key)
);

CREATE INDEX IF NOT EXISTS idx_sports_match_period_scores_team
  ON public.sports_match_period_scores (team_id, match_id);

CREATE TABLE IF NOT EXISTS public.sports_provider_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.sports_providers(id) ON DELETE CASCADE,
  sport_id uuid NOT NULL REFERENCES public.sports(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  external_id text NOT NULL,
  canonical_id uuid NOT NULL,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sports_provider_entities_type_check CHECK (
    entity_type IN ('country', 'competition', 'season', 'team', 'player', 'bookmaker', 'match')
  ),
  CONSTRAINT sports_provider_entities_external_unique
    UNIQUE (provider_id, sport_id, entity_type, external_id)
);

CREATE INDEX IF NOT EXISTS idx_sports_provider_entities_canonical
  ON public.sports_provider_entities (entity_type, canonical_id);
CREATE INDEX IF NOT EXISTS idx_sports_provider_entities_sport
  ON public.sports_provider_entities (sport_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_sports_provider_entities_last_seen
  ON public.sports_provider_entities (provider_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS public.hl_metric_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.sports_providers(id) ON DELETE CASCADE,
  sport_id uuid NOT NULL REFERENCES public.sports(id) ON DELETE CASCADE,
  resource text NOT NULL,
  group_name text NOT NULL DEFAULT '',
  provider_key text NOT NULL,
  canonical_key text NOT NULL,
  display_name text NOT NULL,
  value_type text NOT NULL,
  unit text,
  aggregation text,
  direction text NOT NULL DEFAULT 'neutral',
  status text NOT NULL DEFAULT 'observed',
  description text,
  observed_count bigint NOT NULL DEFAULT 0,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hl_metric_definitions_value_type_check CHECK (
    value_type IN ('integer', 'decimal', 'percentage', 'duration', 'boolean', 'text', 'json')
  ),
  CONSTRAINT hl_metric_definitions_direction_check CHECK (
    direction IN ('higher', 'lower', 'neutral')
  ),
  CONSTRAINT hl_metric_definitions_status_check CHECK (
    status IN ('observed', 'mapped', 'needs_review', 'ignored')
  ),
  CONSTRAINT hl_metric_definitions_observed_count_check CHECK (observed_count >= 0),
  CONSTRAINT hl_metric_definitions_provider_key_unique
    UNIQUE (provider_id, sport_id, resource, group_name, provider_key)
);

CREATE INDEX IF NOT EXISTS idx_hl_metric_definitions_canonical
  ON public.hl_metric_definitions (sport_id, resource, canonical_key);

INSERT INTO public.sports_providers (code, name, base_url, contract_version, enabled)
VALUES ('highlightly', 'Highlightly', 'https://sports.highlightly.net', '6.13.2', false)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  base_url = EXCLUDED.base_url,
  contract_version = EXCLUDED.contract_version,
  updated_at = now();

INSERT INTO public.sports (code, name, enabled)
VALUES
  ('football', 'Football', true),
  ('baseball', 'Baseball', true),
  ('basketball', 'Basketball', true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  enabled = EXCLUDED.enabled,
  updated_at = now();

INSERT INTO public.sports_bookmakers (name, normalized_name, is_preferred)
VALUES
  ('1xBet', '1xbet', true),
  ('bet365', 'bet365', true),
  ('Unibet', 'unibet', true),
  ('Novibet', 'novibet', true),
  ('Parimatch', 'parimatch', true),
  ('Ladbrokes', 'ladbrokes', true),
  ('William Hill', 'william-hill', true),
  ('Stake.com', 'stake.com', true),
  ('Betsson', 'betsson', true),
  ('Betway', 'betway', true),
  ('Betano', 'betano', true)
ON CONFLICT (normalized_name) DO UPDATE SET
  name = EXCLUDED.name,
  is_preferred = EXCLUDED.is_preferred,
  updated_at = now();

DO $phase1$
DECLARE
  table_name text;
  tables text[] := ARRAY[
    'sports_providers', 'sports', 'sports_countries', 'sports_competitions',
    'sports_seasons', 'sports_teams', 'sports_players', 'sports_bookmakers',
    'sports_matches', 'sports_match_participants', 'sports_match_period_scores', 'sports_provider_entities',
    'hl_metric_definitions'
  ];
BEGIN
  FOREACH table_name IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || table_name || '_touch_updated_at', table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
      'trg_' || table_name || '_touch_updated_at', table_name
    );

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', table_name);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', table_name);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', table_name);

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = table_name
        AND policyname = 'admin_read_' || table_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.has_role((SELECT auth.uid()), ''admin''::public.app_role)))',
        'admin_read_' || table_name,
        table_name
      );
    END IF;
  END LOOP;
END
$phase1$;

NOTIFY pgrst, 'reload schema';
