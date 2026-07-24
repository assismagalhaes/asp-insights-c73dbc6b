do $$
declare
  policy_commands text[];
  policy_quals text;
  function_acl aclitem[];
begin
  if to_regclass('public.analises_ia') is null then
    raise exception 'analises_ia table is missing';
  end if;

  if not coalesce((
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'analises_ia'
  ), false) then
    raise exception 'RLS must be enabled on analises_ia';
  end if;
  if not coalesce((
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'feedback_ia_resultados'
  ), false) then
    raise exception 'RLS must be enabled on feedback_ia_resultados';
  end if;

  if has_table_privilege('anon', 'public.analises_ia', 'SELECT')
     or has_table_privilege('anon', 'public.analises_ia', 'INSERT')
     or has_table_privilege('anon', 'public.analises_ia', 'UPDATE')
     or has_table_privilege('anon', 'public.analises_ia', 'DELETE') then
    raise exception 'anon must not have privileges on analises_ia';
  end if;
  if has_table_privilege('anon', 'public.feedback_ia_resultados', 'SELECT')
     or has_table_privilege('anon', 'public.feedback_ia_resultados', 'INSERT')
     or has_table_privilege('anon', 'public.feedback_ia_resultados', 'UPDATE')
     or has_table_privilege('anon', 'public.feedback_ia_resultados', 'DELETE') then
    raise exception 'anon must not have privileges on feedback_ia_resultados';
  end if;

  if not has_table_privilege('authenticated', 'public.analises_ia', 'SELECT')
     or not has_table_privilege('authenticated', 'public.analises_ia', 'INSERT')
     or not has_table_privilege('authenticated', 'public.analises_ia', 'UPDATE')
     or not has_table_privilege('authenticated', 'public.analises_ia', 'DELETE') then
    raise exception 'authenticated needs table grants before admin RLS evaluation';
  end if;
  if not has_table_privilege('authenticated', 'public.feedback_ia_resultados', 'SELECT')
     or not has_table_privilege('authenticated', 'public.feedback_ia_resultados', 'INSERT')
     or not has_table_privilege('authenticated', 'public.feedback_ia_resultados', 'UPDATE')
     or not has_table_privilege('authenticated', 'public.feedback_ia_resultados', 'DELETE') then
    raise exception 'authenticated needs feedback table grants before admin RLS evaluation';
  end if;

  if not has_table_privilege('service_role', 'public.analises_ia', 'SELECT')
     or not has_table_privilege('service_role', 'public.analises_ia', 'INSERT')
     or not has_table_privilege('service_role', 'public.analises_ia', 'UPDATE')
     or not has_table_privilege('service_role', 'public.analises_ia', 'DELETE') then
    raise exception 'service_role must retain operational table privileges';
  end if;
  if not has_table_privilege('service_role', 'public.feedback_ia_resultados', 'SELECT')
     or not has_table_privilege('service_role', 'public.feedback_ia_resultados', 'INSERT')
     or not has_table_privilege('service_role', 'public.feedback_ia_resultados', 'UPDATE')
     or not has_table_privilege('service_role', 'public.feedback_ia_resultados', 'DELETE') then
    raise exception 'service_role must retain feedback table privileges';
  end if;

  select array_agg(cmd order by cmd), string_agg(coalesce(qual, '') || coalesce(with_check, ''), ' ')
  into policy_commands, policy_quals
  from pg_policies
  where schemaname = 'public'
    and tablename = 'analises_ia'
    and policyname like 'Admins % analises_ia';

  if policy_commands is distinct from array['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[] then
    raise exception 'analises_ia must have separate admin policies for CRUD: %', policy_commands;
  end if;
  if policy_quals not ilike '%has_role%'
     or policy_quals not ilike '%admin%' then
    raise exception 'authenticated non-admin access must be denied by has_role admin policies';
  end if;

  select array_agg(cmd order by cmd), string_agg(coalesce(qual, '') || coalesce(with_check, ''), ' ')
  into policy_commands, policy_quals
  from pg_policies
  where schemaname = 'public'
    and tablename = 'feedback_ia_resultados'
    and policyname like 'Admins % feedback_ia_resultados';

  if policy_commands is distinct from array['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[] then
    raise exception 'feedback_ia_resultados must have separate admin policies for CRUD: %', policy_commands;
  end if;
  if policy_quals not ilike '%has_role%'
     or policy_quals not ilike '%admin%' then
    raise exception 'feedback authenticated non-admin access must be denied by admin policies';
  end if;

  select p.proacl
  into function_acl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'sync_ai_learning_feedback'
    and p.pronargs = 0;

  if function_acl is null then
    raise exception 'sync_ai_learning_feedback must have an explicit ACL';
  end if;
  if has_function_privilege('anon', 'public.sync_ai_learning_feedback()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.sync_ai_learning_feedback()', 'EXECUTE') then
    raise exception 'sync_ai_learning_feedback must not be directly callable by API roles';
  end if;

  if exists (
    select 1
    from (
      values
        ('run_id'),
        ('schema_version'),
        ('arbiter_version'),
        ('provider'),
        ('model_id'),
        ('started_at'),
        ('finished_at'),
        ('latency_ms'),
        ('finish_reason'),
        ('input_tokens'),
        ('output_tokens'),
        ('total_tokens'),
        ('parse_status'),
        ('error_code'),
        ('model_decision'),
        ('final_decision'),
        ('blocking_codes'),
        ('repair_attempted'),
        ('search_count'),
        ('scrape_count'),
        ('source_count')
    ) expected(column_name)
    where not exists (
      select 1
      from information_schema.columns actual
      where actual.table_schema = 'public'
        and actual.table_name = 'analises_ia'
        and actual.column_name = expected.column_name
    )
  ) then
    raise exception 'one or more observability columns are missing';
  end if;
end
$$;

begin;

insert into public.analises_ia (
  modo_ia,
  schema_version,
  arbiter_version,
  provider,
  model_id,
  latency_ms,
  input_tokens,
  output_tokens,
  total_tokens,
  parse_status,
  final_decision,
  blocking_codes,
  repair_attempted,
  search_count,
  scrape_count,
  source_count
) values (
  'local',
  '1.1.0',
  'deterministic-arbiter-v1',
  'lovable-ai-gateway',
  'google/gemini-3.6-flash',
  100,
  10,
  5,
  15,
  'FAILED',
  'PULAR',
  array['PROVIDER_TIMEOUT'],
  false,
  0,
  0,
  0
);

do $$
begin
  if not exists (
    select 1
    from public.analises_ia
    where model_id = 'google/gemini-3.6-flash'
      and parse_status = 'FAILED'
      and final_decision = 'PULAR'
      and 'PROVIDER_TIMEOUT' = any(blocking_codes)
  ) then
    raise exception 'service-side observability insert did not round-trip';
  end if;
end
$$;

rollback;
