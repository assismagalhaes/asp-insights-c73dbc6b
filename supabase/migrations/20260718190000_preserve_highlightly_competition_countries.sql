create or replace function public.preserve_sports_competition_country()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.country_id is not null and new.country_id is null then
    new.country_id := old.country_id;
  end if;
  return new;
end;
$$;

drop trigger if exists preserve_sports_competition_country
  on public.sports_competitions;
create trigger preserve_sports_competition_country
before update of country_id on public.sports_competitions
for each row
execute function public.preserve_sports_competition_country();

create or replace function public.preserve_highlightly_competition_payload_country()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.entity_type = 'competition'
     and old.provider_payload ? 'country'
     and not (new.provider_payload ? 'country') then
    new.provider_payload := jsonb_set(
      coalesce(new.provider_payload, '{}'::jsonb),
      '{country}',
      old.provider_payload -> 'country',
      true
    );
  end if;
  return new;
end;
$$;

drop trigger if exists preserve_highlightly_competition_payload_country
  on public.sports_provider_entities;
create trigger preserve_highlightly_competition_payload_country
before update of provider_payload on public.sports_provider_entities
for each row
execute function public.preserve_highlightly_competition_payload_country();

revoke all on function public.preserve_sports_competition_country()
  from public, anon, authenticated;
revoke all on function public.preserve_highlightly_competition_payload_country()
  from public, anon, authenticated;

comment on function public.preserve_sports_competition_country() is
  'Prevents sparse provider payloads from replacing an existing competition country_id with NULL.';
comment on function public.preserve_highlightly_competition_payload_country() is
  'Preserves the rich country object from Highlightly league catalog payloads during sparse competition mapping updates.';

notify pgrst, 'reload schema';
