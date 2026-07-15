begin;

do $$
begin
  if to_regclass('public.hl_ingestion_bridge_nonces') is null then
    raise exception 'hl_ingestion_bridge_nonces is missing';
  end if;
  if to_regprocedure('public.claim_highlightly_ingestion_bridge_nonce(text,text,timestamptz,timestamptz)') is null then
    raise exception 'claim_highlightly_ingestion_bridge_nonce is missing';
  end if;
  if has_function_privilege(
    'anon',
    'public.claim_highlightly_ingestion_bridge_nonce(text,text,timestamptz,timestamptz)',
    'EXECUTE'
  ) then
    raise exception 'anon must not execute the nonce claim RPC';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.claim_highlightly_ingestion_bridge_nonce(text,text,timestamptz,timestamptz)',
    'EXECUTE'
  ) then
    raise exception 'authenticated must not execute the nonce claim RPC';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.claim_highlightly_ingestion_bridge_nonce(text,text,timestamptz,timestamptz)',
    'EXECUTE'
  ) then
    raise exception 'service_role must execute the nonce claim RPC';
  end if;
end;
$$;

do $$
declare
  v_nonce text := '0123456789abcdef0123456789abcdef';
  v_hash text := repeat('a', 64);
begin
  if not public.claim_highlightly_ingestion_bridge_nonce(
    v_nonce,
    v_hash,
    clock_timestamp(),
    clock_timestamp() + interval '10 minutes'
  ) then
    raise exception 'first nonce claim must succeed';
  end if;
  if public.claim_highlightly_ingestion_bridge_nonce(
    v_nonce,
    v_hash,
    clock_timestamp(),
    clock_timestamp() + interval '10 minutes'
  ) then
    raise exception 'replayed nonce claim must fail';
  end if;
end;
$$;

rollback;
