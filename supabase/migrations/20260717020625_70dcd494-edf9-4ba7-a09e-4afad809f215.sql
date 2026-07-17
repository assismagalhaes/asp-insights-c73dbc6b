-- 20260717020000_reduce_highlightly_bridge_nonce_contention.sql
create or replace function public.claim_highlightly_ingestion_bridge_nonce(
  p_nonce text,
  p_request_hash text,
  p_signed_at timestamptz,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed boolean := false;
  v_now timestamptz := clock_timestamp();
begin
  if p_nonce is null or p_nonce !~ '^[0-9a-f]{32}$' then
    raise exception 'invalid bridge nonce' using errcode = '22023';
  end if;
  if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid bridge request hash' using errcode = '22023';
  end if;
  if p_signed_at is null or abs(extract(epoch from (v_now - p_signed_at))) > 300 then
    raise exception 'bridge signature timestamp expired' using errcode = '22023';
  end if;
  if p_expires_at is null or p_expires_at <= v_now or p_expires_at > v_now + interval '15 minutes' then
    raise exception 'invalid bridge nonce expiry' using errcode = '22023';
  end if;

  insert into public.hl_ingestion_bridge_nonces (
    nonce, request_hash, signed_at, expires_at
  ) values (
    p_nonce, p_request_hash, p_signed_at, p_expires_at
  )
  on conflict (nonce) do nothing
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

create or replace function public.prune_highlightly_ingestion_bridge_nonces(
  p_before timestamptz default clock_timestamp(),
  p_limit integer default 5000
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer := 0;
begin
  if p_before is null then
    raise exception 'p_before must not be null' using errcode = '22023';
  end if;
  if p_limit < 1 or p_limit > 50000 then
    raise exception 'p_limit must be between 1 and 50000' using errcode = '22023';
  end if;

  delete from public.hl_ingestion_bridge_nonces as nonce_row
  where nonce_row.ctid in (
    select candidate.ctid
    from public.hl_ingestion_bridge_nonces as candidate
    where candidate.expires_at <= p_before
    order by candidate.expires_at
    limit p_limit
    for update skip locked
  );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.claim_highlightly_ingestion_bridge_nonce(text, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_highlightly_ingestion_bridge_nonce(text, text, timestamptz, timestamptz)
  to service_role;

revoke all on function public.prune_highlightly_ingestion_bridge_nonces(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.prune_highlightly_ingestion_bridge_nonces(timestamptz, integer)
  to service_role;

comment on function public.claim_highlightly_ingestion_bridge_nonce(text, text, timestamptz, timestamptz) is
  'Atomically claims one Highlightly bridge nonce without inline cleanup or broad delete locks.';
comment on function public.prune_highlightly_ingestion_bridge_nonces(timestamptz, integer) is
  'Deletes a bounded batch of expired Highlightly bridge nonces using SKIP LOCKED.';

notify pgrst, 'reload schema';

-- 20260717021000_create_highlightly_shadow_queue_prune_rpc.sql
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