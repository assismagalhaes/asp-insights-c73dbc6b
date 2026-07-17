create or replace function public.cancel_highlightly_redundant_shadow_jobs(
  p_scope text,
  p_endpoint_keys text[],
  p_reason text default 'Cancelled by approved reduced fan-out profile'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed constant text[] := array[
    'football.FootballLastFiveGamesController_getLastFiveGames',
    'football.FootballHead2HeadController_getHead2HeadData',
    'football.HighlightsController_getHighlights',
    'football.PlayersController_getPlayerSummaryById',
    'football.PlayersController_getPlayerStatisticsById',
    'baseball.BaseballLastFiveGamesController_getLastFiveGames',
    'baseball.BaseballHead2HeadController_getHead2HeadData',
    'baseball.HighlightsController_getHighlights',
    'baseball.BaseballPlayersController_getPlayerSummaryById',
    'baseball.BaseballPlayersController_getPlayerStatisticsById',
    'basketball.BasketballLastFiveGamesController_getLastFiveGames',
    'basketball.BasketballHead2HeadController_getHead2HeadData',
    'basketball.HighlightsController_getHighlights'
  ];
  v_cancelled integer := 0;
begin
  if p_scope is null or p_scope !~ '^phase7-[a-zA-Z0-9][a-zA-Z0-9-]{0,119}$' then
    raise exception 'invalid Phase 7 shadow scope' using errcode = '22023';
  end if;
  if p_endpoint_keys is null or cardinality(p_endpoint_keys) = 0 then
    raise exception 'at least one endpoint key is required' using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(p_endpoint_keys) as requested(endpoint_key)
    where requested.endpoint_key <> all(v_allowed)
  ) then
    raise exception 'endpoint key is not eligible for reduced fan-out pruning' using errcode = '22023';
  end if;
  if coalesce((
    select provider.enabled
    from public.sports_providers as provider
    where provider.code = 'highlightly'
  ), true) then
    raise exception 'Highlightly provider must be disabled before queue pruning' using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.hl_ingestion_jobs as running_job
    where running_job.shadow_scope = p_scope
      and running_job.status = 'running'
  ) then
    raise exception 'a shadow job is running in the requested scope' using errcode = '55000';
  end if;

  update public.hl_ingestion_jobs as job
  set
    status = 'cancelled',
    worker_id = null,
    locked_at = null,
    lock_expires_at = null,
    finished_at = clock_timestamp(),
    last_error = left(coalesce(nullif(btrim(p_reason), ''), 'Cancelled by approved reduced fan-out profile'), 2000),
    updated_at = clock_timestamp()
  where job.shadow_scope = p_scope
    and job.status in ('pending', 'retry')
    and job.endpoint_key = any(p_endpoint_keys);

  get diagnostics v_cancelled = row_count;
  return v_cancelled;
end;
$$;

revoke all on function public.cancel_highlightly_redundant_shadow_jobs(text, text[], text)
  from public, anon, authenticated;
grant execute on function public.cancel_highlightly_redundant_shadow_jobs(text, text[], text)
  to service_role;

comment on function public.cancel_highlightly_redundant_shadow_jobs(text, text[], text) is
  'Cancels only allowlisted redundant jobs in one exact Phase 7 scope while Highlightly is disabled.';

notify pgrst, 'reload schema';
