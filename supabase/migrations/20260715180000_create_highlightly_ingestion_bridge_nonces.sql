-- One-time nonces for the HMAC-authenticated Highlightly ingestion bridge.
-- The shared HMAC secret is an environment secret and is never stored in Postgres.

create table if not exists public.hl_ingestion_bridge_nonces (
  nonce text primary key,
  request_hash text not null,
  signed_at timestamptz not null,
  expires_at timestamptz not null,
  used_at timestamptz not null default clock_timestamp(),
  constraint hl_ingestion_bridge_nonces_nonce_format
    check (nonce ~ '^[0-9a-f]{32}$'),
  constraint hl_ingestion_bridge_nonces_hash_format
    check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint hl_ingestion_bridge_nonces_expiry_order
    check (expires_at > signed_at)
);

create index if not exists hl_ingestion_bridge_nonces_expires_at_idx
  on public.hl_ingestion_bridge_nonces (expires_at);

alter table public.hl_ingestion_bridge_nonces enable row level security;

revoke all on table public.hl_ingestion_bridge_nonces from public, anon, authenticated;

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

  delete from public.hl_ingestion_bridge_nonces where expires_at <= v_now;

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

revoke all on function public.claim_highlightly_ingestion_bridge_nonce(text, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_highlightly_ingestion_bridge_nonce(text, text, timestamptz, timestamptz)
  to service_role;

comment on table public.hl_ingestion_bridge_nonces is
  'Short-lived, one-time nonces preventing replay of HMAC-signed Highlightly bridge requests.';
comment on function public.claim_highlightly_ingestion_bridge_nonce(text, text, timestamptz, timestamptz) is
  'Atomically claims a short-lived Highlightly bridge nonce. Returns false for a replay.';
