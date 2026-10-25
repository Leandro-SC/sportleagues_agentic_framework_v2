-- Recuperación de 20261018000100. Restaura publish_official_result a la versión de 20261013000300. La versión de catalog_propagate_fixtures
-- con control de modo/Premium se CONSERVA a propósito (es la más restrictiva y compatible). Los datos del catálogo se eliminan; los equipos ya
-- copiados a tenants (teams/external_refs) permanecen intactos.
set local lock_timeout = '5s';
create or replace function public.publish_official_result(p_match_id uuid, p_home_score integer, p_away_score integer, p_expected_revision integer)
returns public.official_results language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); m public.matches; r public.official_results;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_home_score is null or p_away_score is null or p_home_score < 0 or p_away_score < 0 then
    raise exception 'scores must be non-negative' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then raise exception 'expected revision is required' using errcode = '22023'; end if;
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'match not found' using errcode = '22023'; end if;
  if not public.is_tenant_admin(m.tenant_id) then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into r from public.official_results where match_id = m.id for update;
  if not found then
    if p_expected_revision <> 0 then raise exception 'revision conflict' using errcode = 'PT409'; end if;
    if m.starts_at > clock_timestamp() then raise exception 'the match has not started' using errcode = '22023'; end if;
    insert into public.official_results(tenant_id, match_id, home_score, away_score, revision, published_by)
      values (m.tenant_id, m.id, p_home_score, p_away_score, 1, v_uid) returning * into r;
  else
    if p_expected_revision <> r.revision then raise exception 'revision conflict' using errcode = 'PT409'; end if;
    if (r.home_score, r.away_score) is distinct from (p_home_score, p_away_score) then
      update public.official_results set home_score = p_home_score, away_score = p_away_score, revision = r.revision + 1,
             published_by = v_uid, published_at = clock_timestamp()
       where id = r.id returning * into r;
    end if;   -- mismo marcador: repetición idempotente, sin nueva revisión
  end if;
  if m.status <> 'final' then update public.matches set status = 'final', updated_at = now() where id = m.id; end if;
  perform public._recalculate_match_scoring(m.id);
  return r;
end $$;

drop trigger if exists audit_tournaments on public.tournaments;
create trigger audit_tournaments after insert or update or delete on public.tournaments
  for each row execute function public.tg_audit_row_change('name,sport_code,country_code,season_label,color');
drop function if exists public.set_tournament_results_mode(uuid, text);
drop function if exists public.tenant_can_use_auto_results(uuid);
drop function if exists public._auto_results_allowed(uuid);
drop function if exists public.import_catalog_teams(uuid, uuid[]);
drop function if exists public._link_catalog_team(uuid, public.catalog_teams);
drop function if exists public.catalog_seed_load(jsonb);
drop function if exists public.search_catalog_competitions(text, text, text, integer, integer);
drop function if exists public.search_catalog_teams(text, text, text, uuid, integer, integer);
alter table public.tournaments drop column if exists results_mode;
drop table if exists public.platform_feature_flags;
alter table public.teams drop column if exists kind;
drop table if exists public.catalog_competition_teams, public.catalog_countries, public.catalog_sources;
alter table public.catalog_competitions drop column if exists scope, drop column if exists search_name;
alter table public.catalog_teams drop column if exists kind, drop column if exists country_code, drop column if exists official_name, drop column if exists search_name;
drop function if exists public.tg_catalog_search_name() cascade;
drop function if exists public.catalog_normalize(text);
