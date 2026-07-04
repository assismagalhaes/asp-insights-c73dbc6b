
CREATE TABLE IF NOT EXISTS public.mlb_team_standings_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  season INTEGER NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT,
  rank INTEGER,
  team_name TEXT NOT NULL,
  team_key TEXT NOT NULL,
  wins INTEGER, losses INTEGER, win_pct NUMERIC,
  streak_result TEXT, streak_count INTEGER,
  runs_per_game NUMERIC, runs_allowed_per_game NUMERIC, run_diff_per_game NUMERIC,
  sos NUMERIC, srs NUMERIC,
  pyth_wins NUMERIC, pyth_losses NUMERIC, pyth_win_pct NUMERIC, luck NUMERIC,
  v_east_wins INTEGER, v_east_losses INTEGER,
  v_cent_wins INTEGER, v_cent_losses INTEGER,
  v_west_wins INTEGER, v_west_losses INTEGER,
  interleague_wins INTEGER, interleague_losses INTEGER,
  home_wins INTEGER, home_losses INTEGER, home_win_pct NUMERIC,
  road_wins INTEGER, road_losses INTEGER, road_win_pct NUMERIC,
  extra_innings_wins INTEGER, extra_innings_losses INTEGER,
  one_run_wins INTEGER, one_run_losses INTEGER,
  vs_rhp_wins INTEGER, vs_rhp_losses INTEGER,
  vs_lhp_wins INTEGER, vs_lhp_losses INTEGER,
  vs_500_plus_wins INTEGER, vs_500_plus_losses INTEGER,
  vs_500_minus_wins INTEGER, vs_500_minus_losses INTEGER,
  last10_wins INTEGER, last10_losses INTEGER,
  last20_wins INTEGER, last20_losses INTEGER,
  last30_wins INTEGER, last30_losses INTEGER,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mlb_team_standings_snapshots_unique UNIQUE (snapshot_date, season, team_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mlb_team_standings_snapshots TO authenticated;
GRANT ALL ON public.mlb_team_standings_snapshots TO service_role;
ALTER TABLE public.mlb_team_standings_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage mlb standings" ON public.mlb_team_standings_snapshots;
CREATE POLICY "Admins manage mlb standings" ON public.mlb_team_standings_snapshots FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
DROP TRIGGER IF EXISTS mlb_standings_touch ON public.mlb_team_standings_snapshots;
CREATE TRIGGER mlb_standings_touch BEFORE UPDATE ON public.mlb_team_standings_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX IF NOT EXISTS mlb_standings_snapshot_date_idx ON public.mlb_team_standings_snapshots (snapshot_date DESC, season DESC);

CREATE TABLE IF NOT EXISTS public.mlb_league_average_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  season INTEGER NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT,
  runs_per_game_average NUMERIC,
  runs_allowed_per_game_average NUMERIC,
  home_record_average TEXT,
  road_record_average TEXT,
  last10_average TEXT,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mlb_league_average_snapshots_unique UNIQUE (snapshot_date, season)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mlb_league_average_snapshots TO authenticated;
GRANT ALL ON public.mlb_league_average_snapshots TO service_role;
ALTER TABLE public.mlb_league_average_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage mlb league averages" ON public.mlb_league_average_snapshots;
CREATE POLICY "Admins manage mlb league averages" ON public.mlb_league_average_snapshots FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
DROP TRIGGER IF EXISTS mlb_league_avg_touch ON public.mlb_league_average_snapshots;
CREATE TRIGGER mlb_league_avg_touch BEFORE UPDATE ON public.mlb_league_average_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
