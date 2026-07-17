-- Keep the HMAC nonce claim transaction minimal. Expired-row cleanup is an
-- explicit bounded maintenance operation so concurrent ingestion requests do
-- not serialize behind an unbounded DELETE.

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
    nonce,
    request_hash,
    signed_at,
    expires_at
  )
  values (
    p_nonce,
    p_request_hash,
    p_signed_at,
    p_expires_at
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
