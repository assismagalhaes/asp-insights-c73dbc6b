-- Provider-independent, permanent odds history for backtests.
-- One row represents the market consensus observed at one collection instant.

create table if not exists public.odds_market_snapshots (
  id uuid primary key default gen_random_uuid(),
  coleta_id uuid not null references public.coletas_odds(id) on delete cascade,
  source text not null,
  source_event_id text null,
  sport text null,
  league text null,
  event_name text not null,
  home_team text null,
  away_team text null,
  event_start_at timestamptz null,
  captured_at timestamptz not null,
  lead_minutes integer null,
  timing_bucket text not null,
  eligible_pre_match boolean not null,
  market text not null,
  period text not null default 'full_time',
  line text not null default '',
  selection text not null,
  median_odd numeric not null check (median_odd > 1),
  mean_odd numeric null check (mean_odd is null or mean_odd > 1),
  min_odd numeric null check (min_odd is null or min_odd > 1),
  max_odd numeric null check (max_odd is null or max_odd > 1),
  best_odd numeric null check (best_odd is null or best_odd > 1),
  best_bookmaker text null,
  odd_stddev numeric null check (odd_stddev is null or odd_stddev >= 0),
  bookmaker_count integer not null default 0 check (bookmaker_count >= 0),
  odds_available integer not null default 0 check (odds_available >= 0),
  implied_probability_mean numeric null,
  implied_probability_median numeric null,
  market_margin_mean numeric null,
  market_margin_median numeric null,
  source_ref jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint odds_market_snapshots_timing_bucket_check check (
    timing_bucket in ('D2_PLUS', 'D1', 'H6_24', 'H3_6', 'H1_3', 'H0_1', 'POS_INICIO', 'UNKNOWN')
  ),
  constraint odds_market_snapshots_timing_consistency_check check (
    (eligible_pre_match and timing_bucket not in ('POS_INICIO', 'UNKNOWN'))
    or (not eligible_pre_match and timing_bucket in ('POS_INICIO', 'UNKNOWN'))
  )
);

create unique index if not exists uq_odds_market_snapshots_observation
  on public.odds_market_snapshots (
    coleta_id,
    coalesce(source_event_id, ''),
    event_name,
    captured_at,
    market,
    period,
    line,
    selection
  );

create index if not exists idx_odds_market_snapshots_event
  on public.odds_market_snapshots (source, source_event_id, captured_at desc);
create index if not exists idx_odds_market_snapshots_backtest
  on public.odds_market_snapshots (sport, league, event_start_at, timing_bucket)
  where eligible_pre_match;
create index if not exists idx_odds_market_snapshots_collection
  on public.odds_market_snapshots (coleta_id);

alter table public.odds_market_snapshots enable row level security;

revoke all on table public.odds_market_snapshots from anon;
grant select, insert, update, delete on table public.odds_market_snapshots to authenticated;
grant all on table public.odds_market_snapshots to service_role;

drop policy if exists "admins manage odds market snapshots" on public.odds_market_snapshots;
create policy "admins manage odds market snapshots"
on public.odds_market_snapshots
for all
to authenticated
using ((select public.has_role(auth.uid(), 'admin')))
with check ((select public.has_role(auth.uid(), 'admin')));

create or replace view public.odds_backtest_snapshots
with (security_invoker = true)
as
select *
from public.odds_market_snapshots
where eligible_pre_match;

revoke all on table public.odds_backtest_snapshots from anon;
grant select on table public.odds_backtest_snapshots to authenticated, service_role;

comment on table public.odds_market_snapshots is
  'Permanent provider-independent consensus snapshots used for reproducible odds backtests.';
comment on column public.odds_market_snapshots.timing_bucket is
  'Collection lead-time bucket; POS_INICIO and UNKNOWN are excluded from prematch backtests.';
comment on view public.odds_backtest_snapshots is
  'RLS-aware prematch-only projection of permanent consolidated odds snapshots.';
