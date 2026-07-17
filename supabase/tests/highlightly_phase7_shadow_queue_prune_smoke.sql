begin;

do $$
begin
  if to_regprocedure('public.cancel_highlightly_redundant_shadow_jobs(text,text[],text)') is null then
    raise exception 'shadow queue prune RPC is missing';
  end if;
  if has_function_privilege('anon', 'public.cancel_highlightly_redundant_shadow_jobs(text,text[],text)', 'EXECUTE') then
    raise exception 'anon must not execute shadow queue prune';
  end if;
  if has_function_privilege('authenticated', 'public.cancel_highlightly_redundant_shadow_jobs(text,text[],text)', 'EXECUTE') then
    raise exception 'authenticated must not execute shadow queue prune';
  end if;
  if not has_function_privilege('service_role', 'public.cancel_highlightly_redundant_shadow_jobs(text,text[],text)', 'EXECUTE') then
    raise exception 'service_role must execute shadow queue prune';
  end if;
end;
$$;

do $$
declare
  v_scope text := 'phase7-smoke-prune';
  v_endpoint text := 'football.HighlightsController_getHighlights';
  v_cancelled integer;
  v_job public.hl_ingestion_jobs;
begin
  update public.sports_providers set enabled = false where code = 'highlightly';
  v_job := public.enqueue_highlightly_ingestion_job(
    v_endpoint,
    'football',
    'highlights',
    v_scope || ':job',
    jsonb_build_object('_shadow_scope', v_scope),
    '{}'::jsonb,
    1,
    clock_timestamp(),
    5,
    null
  );
  v_cancelled := public.cancel_highlightly_redundant_shadow_jobs(
    v_scope,
    array[v_endpoint],
    'phase7 smoke'
  );
  if v_cancelled <> 1 then
    raise exception 'expected one cancelled shadow job, got %', v_cancelled;
  end if;
  if not exists (
    select 1 from public.hl_ingestion_jobs where id = v_job.id and status = 'cancelled'
  ) then
    raise exception 'shadow job was not cancelled';
  end if;

  begin
    perform public.cancel_highlightly_redundant_shadow_jobs(
      v_scope,
      array['football.FootballStatisticsController_getStatistics'],
      'must fail'
    );
    raise exception 'non-allowlisted endpoint was accepted';
  exception
    when sqlstate '22023' then null;
  end;
end;
$$;

rollback;
