CREATE TABLE IF NOT EXISTS public.mlb_team_standings_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  season integer NOT NULL,
  source text NOT NULL DEFAULT 'baseball_reference',
  source_url text,
  rank integer,
  team_name text NOT NULL,
  team_key text NOT NULL,
  wins integer,
  losses integer,
  win_pct numeric,
  streak_result text,
  streak_count integer,
  runs_per_game numeric,
  runs_allowed_per_game numeric,
  run_diff_per_game numeric,
  sos numeric,
  srs numeric,
  pyth_wins integer,
  pyth_losses integer,
  pyth_win_pct numeric,
  luck integer,
  v_east_wins integer,
  v_east_losses integer,
  v_cent_wins integer,
  v_cent_losses integer,
  v_west_wins integer,
  v_west_losses integer,
  interleague_wins integer,
  interleague_losses integer,
  home_wins integer,
  home_losses integer,
  home_win_pct numeric,
  road_wins integer,
  road_losses integer,
  road_win_pct numeric,
  extra_innings_wins integer,
  extra_innings_losses integer,
  one_run_wins integer,
  one_run_losses integer,
  vs_rhp_wins integer,
  vs_rhp_losses integer,
  vs_lhp_wins integer,
  vs_lhp_losses integer,
  vs_500_plus_wins integer,
  vs_500_plus_losses integer,
  vs_500_minus_wins integer,
  vs_500_minus_losses integer,
  last10_wins integer,
  last10_losses integer,
  last20_wins integer,
  last20_losses integer,
  last30_wins integer,
  last30_losses integer,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(snapshot_date, season, team_key)
);

CREATE TABLE IF NOT EXISTS public.mlb_league_average_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  season integer NOT NULL,
  source text NOT NULL DEFAULT 'baseball_reference',
  source_url text,
  runs_per_game_average numeric,
  runs_allowed_per_game_average numeric,
  home_record_average text,
  road_record_average text,
  last10_average text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(snapshot_date, season)
);

ALTER TABLE public.mlb_team_standings_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mlb_league_average_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage mlb_team_standings_snapshots" ON public.mlb_team_standings_snapshots;
CREATE POLICY "admins manage mlb_team_standings_snapshots" ON public.mlb_team_standings_snapshots
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admins manage mlb_league_average_snapshots" ON public.mlb_league_average_snapshots;
CREATE POLICY "admins manage mlb_league_average_snapshots" ON public.mlb_league_average_snapshots
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS touch_mlb_team_standings_snapshots_updated_at ON public.mlb_team_standings_snapshots;
CREATE TRIGGER touch_mlb_team_standings_snapshots_updated_at
BEFORE UPDATE ON public.mlb_team_standings_snapshots
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS touch_mlb_league_average_snapshots_updated_at ON public.mlb_league_average_snapshots;
CREATE TRIGGER touch_mlb_league_average_snapshots_updated_at
BEFORE UPDATE ON public.mlb_league_average_snapshots
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_mlb_standings_snapshot_date ON public.mlb_team_standings_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_mlb_standings_season ON public.mlb_team_standings_snapshots(season);
CREATE INDEX IF NOT EXISTS idx_mlb_standings_team_key ON public.mlb_team_standings_snapshots(team_key);
CREATE INDEX IF NOT EXISTS idx_mlb_standings_updated_at ON public.mlb_team_standings_snapshots(updated_at);
CREATE INDEX IF NOT EXISTS idx_mlb_average_snapshot_date ON public.mlb_league_average_snapshots(snapshot_date);
