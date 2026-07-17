do $$
begin
  if to_regclass('public.odds_market_snapshots') is null then
    raise exception 'odds_market_snapshots table is missing';
  end if;
  if to_regclass('public.odds_backtest_snapshots') is null then
    raise exception 'odds_backtest_snapshots view is missing';
  end if;
  if not coalesce((
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'odds_market_snapshots'
  ), false) then
    raise exception 'RLS must be enabled on odds_market_snapshots';
  end if;
  if has_table_privilege('anon', 'public.odds_market_snapshots', 'SELECT') then
    raise exception 'anon must not read odds_market_snapshots';
  end if;
  if not has_table_privilege('authenticated', 'public.odds_market_snapshots', 'SELECT') then
    raise exception 'authenticated must be granted table access before RLS evaluation';
  end if;
end
$$;
