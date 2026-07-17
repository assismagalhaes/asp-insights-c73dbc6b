-- Highlightly Phase 8A: selected competition catalog for multi-league expansion.
-- Selection is declarative only. No scope is ingestion-enabled by this migration.

INSERT INTO public.sports (code, name, enabled, metadata)
VALUES
  ('american_football', 'American Football', true, '{"providerFamilies":["american-football"]}'::jsonb),
  ('hockey', 'Hockey', true, '{"providerFamilies":["nhl","hockey"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  enabled = EXCLUDED.enabled,
  metadata = public.sports.metadata || EXCLUDED.metadata,
  updated_at = now();

CREATE TABLE IF NOT EXISTS public.hl_competition_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.sports_providers(id) ON DELETE CASCADE,
  sport_id uuid NOT NULL REFERENCES public.sports(id) ON DELETE CASCADE,
  scope_key text NOT NULL,
  provider_family text NOT NULL,
  provider_competition_id text,
  provider_name text NOT NULL,
  canonical_name text NOT NULL,
  region_code text,
  gender text NOT NULL DEFAULT 'men',
  competition_level text NOT NULL DEFAULT 'professional',
  priority smallint NOT NULL DEFAULT 3,
  selected boolean NOT NULL DEFAULT true,
  ingestion_enabled boolean NOT NULL DEFAULT false,
  catalog_status text NOT NULL DEFAULT 'resolved',
  aliases text[] NOT NULL DEFAULT '{}'::text[],
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hl_competition_scopes_scope_key_format
    CHECK (scope_key ~ '^[a-z0-9][a-z0-9._-]*$'),
  CONSTRAINT hl_competition_scopes_provider_family_format
    CHECK (provider_family ~ '^[a-z0-9][a-z0-9-]*$'),
  CONSTRAINT hl_competition_scopes_gender_check
    CHECK (gender IN ('men', 'women', 'mixed')),
  CONSTRAINT hl_competition_scopes_level_check
    CHECK (competition_level IN ('professional', 'college', 'national_team', 'special')),
  CONSTRAINT hl_competition_scopes_priority_check
    CHECK (priority BETWEEN 1 AND 5),
  CONSTRAINT hl_competition_scopes_catalog_status_check
    CHECK (catalog_status IN ('resolved', 'planned', 'unavailable', 'retired')),
  CONSTRAINT hl_competition_scopes_ingestion_gate_check
    CHECK (NOT ingestion_enabled OR (selected AND catalog_status = 'resolved')),
  CONSTRAINT hl_competition_scopes_unique UNIQUE (provider_id, scope_key)
);

CREATE INDEX IF NOT EXISTS idx_hl_competition_scopes_scheduler
  ON public.hl_competition_scopes (provider_family, priority, canonical_name)
  WHERE selected AND ingestion_enabled;

CREATE INDEX IF NOT EXISTS idx_hl_competition_scopes_catalog
  ON public.hl_competition_scopes (sport_id, selected, priority, canonical_name);

DROP TRIGGER IF EXISTS trg_hl_competition_scopes_touch_updated_at
  ON public.hl_competition_scopes;
CREATE TRIGGER trg_hl_competition_scopes_touch_updated_at
  BEFORE UPDATE ON public.hl_competition_scopes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.hl_competition_scopes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hl_competition_scopes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.hl_competition_scopes TO authenticated;
GRANT ALL ON TABLE public.hl_competition_scopes TO service_role;

DROP POLICY IF EXISTS admin_read_hl_competition_scopes
  ON public.hl_competition_scopes;
CREATE POLICY admin_read_hl_competition_scopes
  ON public.hl_competition_scopes
  FOR SELECT
  TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

CREATE OR REPLACE VIEW public.hl_selected_competition_scopes_v
WITH (security_invoker = true)
AS
SELECT
  scope.id,
  sport.code AS sport,
  sport.name AS sport_name,
  scope.scope_key,
  scope.provider_family,
  scope.provider_competition_id,
  scope.provider_name,
  scope.canonical_name,
  scope.region_code,
  scope.gender,
  scope.competition_level,
  scope.priority,
  scope.ingestion_enabled,
  scope.catalog_status,
  scope.aliases,
  scope.capabilities,
  scope.metadata
FROM public.hl_competition_scopes AS scope
JOIN public.sports AS sport ON sport.id = scope.sport_id
WHERE scope.selected;

REVOKE ALL ON public.hl_selected_competition_scopes_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.hl_selected_competition_scopes_v TO authenticated, service_role;

WITH seed(
  sport_code, scope_key, provider_family, provider_competition_id, provider_name,
  canonical_name, region_code, gender, competition_level, priority, aliases,
  capabilities, metadata
) AS (
  VALUES
    -- Baseball: the provider exposes MLB and NCAA as league filters. The College
    -- World Series is an NCAA phase and therefore shares provider_name=NCAA.
    ('baseball', 'mlb', 'baseball', NULL, 'MLB', 'MLB', 'US', 'men', 'professional', 1,
      ARRAY['Major League Baseball'],
      '{"matches":true,"odds":true,"standings":true,"lineups":true,"boxScores":true,"players":true}'::jsonb,
      '{"selectionMode":"league","seasonTypes":["preseason","regular_season","postseason"],"includes":["American League","National League","Spring Training","MLB Playoffs","World Series","All-Star Game"]}'::jsonb),
    ('baseball', 'ncaa-division-i', 'baseball', NULL, 'NCAA', 'NCAA Division I', 'US', 'men', 'college', 2,
      ARRAY['NCAA Baseball','College Baseball'],
      '{"matches":true,"odds":true,"standings":true,"lineups":true,"boxScores":true,"players":true}'::jsonb,
      '{"selectionMode":"league"}'::jsonb),
    ('baseball', 'college-world-series', 'baseball', NULL, 'NCAA', 'College World Series', 'US', 'men', 'college', 2,
      ARRAY['CWS','NCAA College World Series'],
      '{"matches":true,"odds":true,"standings":true,"lineups":true,"boxScores":true,"players":true}'::jsonb,
      '{"selectionMode":"league_and_stage","stage":"College World Series"}'::jsonb),

    -- Basketball / United States.
    ('basketball', 'wnba', 'basketball', '11847', 'NBA Women', 'WNBA', 'US', 'women', 'professional', 1,
      ARRAY['WNBA','NBA Women'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2026}'::jsonb),
    ('basketball', 'nba', 'basketball', '10996', 'NBA', 'NBA', 'US', 'men', 'professional', 1,
      ARRAY['National Basketball Association'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2025}'::jsonb),
    ('basketball', 'nba-cup', 'basketball', '359906', 'NBA Cup', 'NBA Cup', 'US', 'men', 'professional', 2,
      ARRAY['NBA In-Season Tournament'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2025}'::jsonb),
    ('basketball', 'nba-g-league', 'basketball', '17804', 'NBA G League', 'NBA G League', 'US', 'men', 'professional', 2,
      ARRAY['G League'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2025}'::jsonb),
    ('basketball', 'nba-summer-league-las-vegas', 'basketball', '15251', 'NBA Summer League Las Vegas', 'NBA Summer League', 'US', 'men', 'special', 3,
      ARRAY['Las Vegas Summer League'], '{"matches":true,"odds":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2026,"venue":"Las Vegas"}'::jsonb),
    ('basketball', 'nba-summer-league-sacramento', 'basketball', '18655', 'NBA Summer League Sacramento', 'NBA Summer League', 'US', 'men', 'special', 3,
      ARRAY['California Classic'], '{"matches":true,"odds":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2021,"venue":"Sacramento"}'::jsonb),
    ('basketball', 'nba-summer-league-salt-lake-city', 'basketball', '233958', 'NBA Summer League Salt Lake City', 'NBA Summer League', 'US', 'men', 'special', 3,
      ARRAY['Salt Lake City Summer League'], '{"matches":true,"odds":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2026,"venue":"Salt Lake City"}'::jsonb),
    ('basketball', 'ncaa', 'basketball', '99500', 'NCAA', 'NCAA', 'US', 'men', 'college', 2,
      ARRAY['NCAA Men','NCAAB'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2025}'::jsonb),
    ('basketball', 'ncaa-women', 'basketball', '360757', 'NCAA Women', 'NCAA Women', 'US', 'women', 'college', 2,
      ARRAY['NCAAW'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2025}'::jsonb),
    ('basketball', 'nit', 'basketball', '12698', 'NIT', 'NIT', 'US', 'men', 'college', 3,
      ARRAY['National Invitation Tournament'], '{"matches":true,"odds":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2026}'::jsonb),
    ('basketball', 'cbi', 'basketball', '13549', 'CBI', 'CBI', 'US', 'men', 'college', 3,
      ARRAY['College Basketball Invitational'], '{"matches":true,"odds":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2025}'::jsonb),
    ('basketball', 'big3', 'basketball', '152262', 'BIG3', 'BIG3', 'US', 'men', 'professional', 3,
      ARRAY['Big3'], '{"matches":true,"odds":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2026}'::jsonb),

    -- Basketball / Brazil and Europe-wide competitions.
    ('basketball', 'nbb', 'basketball', '22910', 'NBB', 'NBB', 'BR', 'men', 'professional', 1,
      ARRAY['Novo Basquete Brasil'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2025}'::jsonb),
    ('basketball', 'euroleague', 'basketball', '102904', 'Euroleague', 'EuroLeague', 'EU', 'men', 'professional', 1,
      ARRAY['Euroleague'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2025}'::jsonb),
    ('basketball', 'eurocup', 'basketball', '165878', 'EuroCup Basketball', 'EuroCup', 'EU', 'men', 'professional', 2,
      ARRAY['EuroCup Basketball'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2025}'::jsonb),
    ('basketball', 'basketball-champions-league', 'basketball', '172686', 'Champions League', 'Basketball Champions League', 'EU', 'men', 'professional', 2,
      ARRAY['BCL','Champions League'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2025}'::jsonb),
    ('basketball', 'fiba-europe-cup', 'basketball', '171835', 'FIBA Europe Cup', 'FIBA Europe Cup', 'EU', 'men', 'professional', 2,
      ARRAY[]::text[], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2025}'::jsonb),
    ('basketball', 'aba-league', 'basketball', '169282', 'ABA League', 'ABA League', 'EU', 'men', 'professional', 2,
      ARRAY[]::text[], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2025}'::jsonb),
    ('basketball', 'bnxt-league', 'basketball', '313952', 'BNXT League', 'BNXT League', 'EU', 'men', 'professional', 2,
      ARRAY[]::text[], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2025}'::jsonb),
    ('basketball', 'enbl', 'basketball', '314803', 'ENBL', 'ENBL', 'EU', 'men', 'professional', 2,
      ARRAY['European North Basketball League'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2025}'::jsonb),
    ('basketball', 'eurobasket', 'basketball', '168431', 'EuroBasket', 'EuroBasket', 'EU', 'men', 'national_team', 2,
      ARRAY['FIBA EuroBasket'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2029}'::jsonb),

    -- Basketball / selected national leagues.
    ('basketball', 'acb-spain', 'basketball', '100351', 'ACB', 'ACB', 'ES', 'men', 'professional', 1, ARRAY['Liga ACB'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2025}'::jsonb),
    ('basketball', 'lnb-france', 'basketball', '2486', 'LNB', 'LNB', 'FR', 'men', 'professional', 1, ARRAY['LNB Pro A'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2025}'::jsonb),
    ('basketball', 'bbl-germany', 'basketball', '34824', 'BBL', 'BBL', 'DE', 'men', 'professional', 1, ARRAY['Basketball Bundesliga'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2025}'::jsonb),
    ('basketball', 'lega-a-italy', 'basketball', '45036', 'Lega A', 'Lega A', 'IT', 'men', 'professional', 1, ARRAY['LBA'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2025}'::jsonb),
    ('basketball', 'basket-league-greece', 'basketball', '39079', 'Basket League', 'Basket League', 'GR', 'men', 'professional', 1, ARRAY['Greek Basket League'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2025}'::jsonb),
    ('basketball', 'super-ligi-turkey', 'basketball', '89288', 'Super Ligi', 'Super Ligi', 'TR', 'men', 'professional', 1, ARRAY['Basketbol Super Ligi','BSL'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2025}'::jsonb),
    ('basketball', 'nbl-australia', 'basketball', '1635', 'NBL', 'NBL', 'AU', 'men', 'professional', 1, ARRAY['Australian NBL'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2025}'::jsonb),
    ('basketball', 'cba-china', 'basketball', '27165', 'CBA', 'CBA', 'CN', 'men', 'professional', 1, ARRAY['Chinese Basketball Association'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2025}'::jsonb),
    ('basketball', 'b-league-japan', 'basketball', '48440', 'B League', 'B.League', 'JP', 'men', 'professional', 1, ARRAY['B League','B.League'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2025}'::jsonb),
    ('basketball', 'kbl-south-korea', 'basketball', '78225', 'KBL', 'KBL', 'KR', 'men', 'professional', 1, ARRAY['Korean Basketball League'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2025}'::jsonb),
    ('basketball', 'lkl-lithuania', 'basketball', '51844', 'LKL', 'LKL', 'LT', 'men', 'professional', 1, ARRAY['Lithuanian Basketball League'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2025}'::jsonb),
    ('basketball', 'liga-a-argentina', 'basketball', '16102', 'Liga A', 'Liga A', 'AR', 'men', 'professional', 1, ARRAY['Liga Nacional de Basquet'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2025}'::jsonb),
    ('basketball', 'cebl-canada', 'basketball', '189706', 'CEBL', 'CEBL', 'CA', 'men', 'professional', 1, ARRAY['Canadian Elite Basketball League'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2026}'::jsonb),

    -- Basketball / international national-team and continental competitions.
    ('basketball', 'fiba-world-cup', 'basketball', '239915', 'World Cup', 'FIBA World Cup', 'WORLD', 'men', 'national_team', 2, ARRAY['World Cup'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2027}'::jsonb),
    ('basketball', 'fiba-world-cup-women', 'basketball', '242468', 'FIBA World Cup Women', 'FIBA World Cup Women', 'WORLD', 'women', 'national_team', 2, ARRAY['Women World Cup'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2024}'::jsonb),
    ('basketball', 'olympic-games', 'basketball', '164176', 'Olympic Games', 'Olympic Games', 'WORLD', 'men', 'national_team', 2, ARRAY['Olympics Men'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2024}'::jsonb),
    ('basketball', 'olympic-games-women', 'basketball', '165027', 'Olympic Games Women', 'Olympic Games Women', 'WORLD', 'women', 'national_team', 2, ARRAY['Olympics Women'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2024}'::jsonb),
    ('basketball', 'fiba-americup', 'basketball', '240766', 'FIBA AmeriCup', 'FIBA AmeriCup', 'WORLD', 'men', 'national_team', 2, ARRAY['AmeriCup'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2023}'::jsonb),
    ('basketball', 'fiba-asia-cup', 'basketball', '256935', 'FIBA Asia Cup', 'FIBA Asia Cup', 'WORLD', 'men', 'national_team', 2, ARRAY['Asia Cup'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2023}'::jsonb),
    ('basketball', 'afrobasket', 'basketball', '276508', 'AfroBasket', 'AfroBasket', 'WORLD', 'men', 'national_team', 2, ARRAY['FIBA AfroBasket'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2024}'::jsonb),
    ('basketball', 'bal', 'basketball', '279912', 'BAL', 'BAL', 'WORLD', 'men', 'professional', 2, ARRAY['Basketball Africa League'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2026}'::jsonb),
    ('basketball', 'bcl-americas', 'basketball', '255233', 'BCL Americas', 'BCL Americas', 'WORLD', 'men', 'professional', 2, ARRAY['Basketball Champions League Americas'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2025}'::jsonb),
    ('basketball', 'liga-sudamericana', 'basketball', '353098', 'Liga Sudamericana', 'Liga Sudamericana', 'WORLD', 'men', 'professional', 2, ARRAY['South American Basketball League'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2023}'::jsonb),
    ('basketball', 'pan-american-games', 'basketball', '244170', 'Pan American Games', 'Pan American Games', 'WORLD', 'men', 'national_team', 3, ARRAY['Pan Am Games'], '{"matches":true,"odds":true,"standings":true,"matchStatistics":true}'::jsonb, '{"latestCatalogSeason":2023}'::jsonb),

    -- American Football: specialized NFL/NCAA contract.
    ('american_football', 'nfl', 'american-football', NULL, 'NFL', 'NFL', 'US', 'men', 'professional', 1,
      ARRAY['National Football League'], '{"matches":true,"odds":true,"standings":true,"lineups":true,"boxScores":true,"players":true,"events":true}'::jsonb,
      '{"selectionMode":"league","seasonTypes":["preseason","regular_season","postseason"]}'::jsonb),
    ('american_football', 'ncaa-fbs', 'american-football', NULL, 'NCAA', 'NCAA FBS', 'US', 'men', 'college', 2,
      ARRAY['NCAA Football','College Football','NCAAF'], '{"matches":true,"odds":true,"standings":true,"lineups":true,"boxScores":true,"players":true,"events":true}'::jsonb,
      '{"selectionMode":"league","division":"FBS"}'::jsonb),

    -- Hockey: NHL/NCAA use the deep specialized family; KHL/SHL use generic hockey.
    ('hockey', 'nhl', 'nhl', NULL, 'NHL', 'NHL', 'US', 'men', 'professional', 1,
      ARRAY['National Hockey League'], '{"matches":true,"odds":true,"standings":true,"lineups":true,"players":true,"events":true}'::jsonb,
      '{"selectionMode":"league","seasonTypes":["regular_season","postseason"]}'::jsonb),
    ('hockey', 'ncaa-hockey', 'nhl', NULL, 'NCAA', 'NCAA Hockey', 'US', 'men', 'college', 2,
      ARRAY['NCAAH','NCAA Division I Hockey'], '{"matches":true,"odds":true,"standings":true,"lineups":true,"players":true,"events":true}'::jsonb,
      '{"selectionMode":"league"}'::jsonb),
    ('hockey', 'khl', 'hockey', '30569', 'KHL', 'KHL', 'RU', 'men', 'professional', 1,
      ARRAY['Kontinental Hockey League'], '{"matches":true,"odds":true,"standings":true,"teamStatistics":true}'::jsonb,
      '{"latestCatalogSeason":2025}'::jsonb),
    ('hockey', 'shl', 'hockey', '40781', 'SHL', 'SHL', 'SE', 'men', 'professional', 1,
      ARRAY['Swedish Hockey League'], '{"matches":true,"odds":true,"standings":true,"teamStatistics":true}'::jsonb,
      '{"latestCatalogSeason":2025}'::jsonb)
)
INSERT INTO public.hl_competition_scopes (
  provider_id, sport_id, scope_key, provider_family, provider_competition_id,
  provider_name, canonical_name, region_code, gender, competition_level,
  priority, selected, ingestion_enabled, catalog_status, aliases, capabilities, metadata
)
SELECT
  provider.id,
  sport.id,
  seed.scope_key,
  seed.provider_family,
  seed.provider_competition_id,
  seed.provider_name,
  seed.canonical_name,
  seed.region_code,
  seed.gender,
  seed.competition_level,
  seed.priority,
  true,
  false,
  'resolved',
  seed.aliases,
  seed.capabilities,
  seed.metadata
FROM seed
JOIN public.sports_providers AS provider ON provider.code = 'highlightly'
JOIN public.sports AS sport ON sport.code = seed.sport_code
ON CONFLICT (provider_id, scope_key) DO UPDATE SET
  sport_id = EXCLUDED.sport_id,
  provider_family = EXCLUDED.provider_family,
  provider_competition_id = EXCLUDED.provider_competition_id,
  provider_name = EXCLUDED.provider_name,
  canonical_name = EXCLUDED.canonical_name,
  region_code = EXCLUDED.region_code,
  gender = EXCLUDED.gender,
  competition_level = EXCLUDED.competition_level,
  priority = EXCLUDED.priority,
  selected = true,
  ingestion_enabled = false,
  catalog_status = EXCLUDED.catalog_status,
  aliases = EXCLUDED.aliases,
  capabilities = EXCLUDED.capabilities,
  metadata = EXCLUDED.metadata,
  updated_at = now();

NOTIFY pgrst, 'reload schema';
