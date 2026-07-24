-- Transactional Phase 6 smoke: rollout metadata, constraints and admin RLS.

do $$
begin
  if exists (
    select 1
    from (
      values
        ('rollout_stage'),
        ('rollout_variant'),
        ('rollout_reason')
    ) expected(column_name)
    where not exists (
      select 1
      from information_schema.columns actual
      where actual.table_schema = 'public'
        and actual.table_name = 'analises_ia'
        and actual.column_name = expected.column_name
    )
  ) then
    raise exception 'one or more Phase 6 rollout columns are missing';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'analises_ia'
      and policyname = 'Admins insert analises_ia'
      and cmd = 'INSERT'
  ) then
    raise exception 'admin-only insert policy is missing on analises_ia';
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
  parse_status,
  final_decision,
  rollout_stage,
  rollout_variant,
  rollout_reason
) values (
  'local',
  '1.1.0',
  'deterministic-arbiter-v1',
  'lovable-ai-gateway',
  'google/gemini-3.6-flash',
  'VALID',
  'PULAR',
  'canary',
  'structured',
  'canary_allowlist'
);

do $$
begin
  if not exists (
    select 1
    from public.analises_ia
    where rollout_stage = 'canary'
      and rollout_variant = 'structured'
      and rollout_reason = 'canary_allowlist'
  ) then
    raise exception 'Phase 6 rollout metadata did not round-trip';
  end if;
end
$$;

rollback;
