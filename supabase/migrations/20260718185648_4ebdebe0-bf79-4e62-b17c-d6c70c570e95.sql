begin;

do $$
declare
  v_sport_id uuid := '71000000-0000-4000-8000-000000000001';
  v_country_a uuid := '71000000-0000-4000-8000-000000000002';
  v_country_b uuid := '71000000-0000-4000-8000-000000000003';
  v_competition_id uuid := '71000000-0000-4000-8000-000000000004';
  v_mapping_id uuid := '71000000-0000-4000-8000-000000000005';
  v_provider_id uuid;
  v_country_id uuid;
  v_payload jsonb;
begin
  if to_regprocedure('public.preserve_sports_competition_country()') is null then
    raise exception 'competition country preservation trigger function is missing';
  end if;
  if to_regprocedure('public.preserve_highlightly_competition_payload_country()') is null then
    raise exception 'competition payload preservation trigger function is missing';
  end if;

  select id into v_provider_id from public.sports_providers where code = 'highlightly';

  insert into public.sports (id, code, name)
  values (v_sport_id, 'country_guard_smoke', 'Country guard smoke');
  insert into public.sports_countries (id, code, name) values
    (v_country_a, 'XGA', 'Guard country A'),
    (v_country_b, 'XGB', 'Guard country B');
  insert into public.sports_competitions (id, sport_id, country_id, name)
  values (v_competition_id, v_sport_id, v_country_a, 'Guard league');

  update public.sports_competitions set country_id = null where id = v_competition_id;
  select country_id into v_country_id from public.sports_competitions where id = v_competition_id;
  if v_country_id is distinct from v_country_a then
    raise exception 'country_id regressed to null';
  end if;

  update public.sports_competitions set country_id = v_country_b where id = v_competition_id;
  select country_id into v_country_id from public.sports_competitions where id = v_competition_id;
  if v_country_id is distinct from v_country_b then
    raise exception 'explicit non-null country correction was blocked';
  end if;

  insert into public.sports_provider_entities (
    id, provider_id, sport_id, entity_type, external_id, canonical_id, provider_payload
  ) values (
    v_mapping_id, v_provider_id, v_sport_id, 'competition', 'guard-league', v_competition_id,
    '{"id":"guard-league","name":"Guard league","country":{"code":"XGB","name":"Guard country B"}}'::jsonb
  );
  update public.sports_provider_entities
  set provider_payload = '{"id":"guard-league","name":"Guard league"}'::jsonb
  where id = v_mapping_id;
  select provider_payload into v_payload from public.sports_provider_entities where id = v_mapping_id;
  if v_payload #>> '{country,code}' is distinct from 'XGB' then
    raise exception 'provider payload country was lost';
  end if;

  if has_function_privilege('anon', 'public.preserve_sports_competition_country()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.preserve_sports_competition_country()', 'EXECUTE') then
    raise exception 'competition country trigger function must not be executable by clients';
  end if;
  if has_function_privilege('anon', 'public.preserve_highlightly_competition_payload_country()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.preserve_highlightly_competition_payload_country()', 'EXECUTE') then
    raise exception 'competition payload trigger function must not be executable by clients';
  end if;
end;
$$;

rollback;