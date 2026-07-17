begin;

do $$
begin
  if to_regprocedure('public.claim_highlightly_ingestion_bridge_nonce(text,text,timestamptz,timestamptz)') is null then
    raise exception 'nonce claim RPC is missing';
  end if;
  if to_regprocedure('public.prune_highlightly_ingestion_bridge_nonces(timestamptz,integer)') is null then
    raise exception 'bounded nonce prune RPC is missing';
  end if;
  if has_function_privilege('anon', 'public.prune_highlightly_ingestion_bridge_nonces(timestamptz,integer)', 'EXECUTE') then
    raise exception 'anon must not execute nonce prune';
  end if;
  if has_function_privilege('authenticated', 'public.prune_highlightly_ingestion_bridge_nonces(timestamptz,integer)', 'EXECUTE') then
    raise exception 'authenticated must not execute nonce prune';
  end if;
  if not has_function_privilege('service_role', 'public.prune_highlightly_ingestion_bridge_nonces(timestamptz,integer)', 'EXECUTE') then
    raise exception 'service_role must execute nonce prune';
  end if;
end;
$$;

do $$
declare
  v_now timestamptz := clock_timestamp();
  v_old_nonce text := 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  v_new_nonce text := 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  v_hash text := repeat('c', 64);
  v_deleted integer;
begin
  insert into public.hl_ingestion_bridge_nonces(nonce, request_hash, signed_at, expires_at)
  values (v_old_nonce, v_hash, v_now - interval '20 minutes', v_now - interval '10 minutes')
  on conflict (nonce) do update set expires_at = excluded.expires_at;

  if not public.claim_highlightly_ingestion_bridge_nonce(
    v_new_nonce, v_hash, v_now, v_now + interval '10 minutes'
  ) then
    raise exception 'fresh nonce must be claimed';
  end if;
  if public.claim_highlightly_ingestion_bridge_nonce(
    v_new_nonce, v_hash, v_now, v_now + interval '10 minutes'
  ) then
    raise exception 'nonce replay must be rejected';
  end if;
  if not exists (
    select 1 from public.hl_ingestion_bridge_nonces where nonce = v_old_nonce
  ) then
    raise exception 'claim RPC must not perform inline expired-row cleanup';
  end if;

  v_deleted := public.prune_highlightly_ingestion_bridge_nonces(v_now, 100);
  if v_deleted < 1 then
    raise exception 'bounded nonce prune must delete expired rows';
  end if;
end;
$$;

rollback;
