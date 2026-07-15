do $$
declare
  v_nonce text := 'abcdef0123456789abcdef0123456789';
  v_hash text := repeat('b', 64);
  v_first boolean;
  v_second boolean;
begin
  v_first := public.claim_highlightly_ingestion_bridge_nonce(v_nonce, v_hash, clock_timestamp(), clock_timestamp() + interval '10 minutes');
  v_second := public.claim_highlightly_ingestion_bridge_nonce(v_nonce, v_hash, clock_timestamp(), clock_timestamp() + interval '10 minutes');
  if not v_first then raise exception 'first claim must succeed'; end if;
  if v_second then raise exception 'replay must fail'; end if;
  delete from public.hl_ingestion_bridge_nonces where nonce = v_nonce;
end;
$$;