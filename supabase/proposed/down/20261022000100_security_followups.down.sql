-- Recuperación de 20261022000100_security_followups (incluye eliminar maintenance_runs): restaura las definiciones/políticas/privilegios previos (20260912000100, 20261017000100,
-- 20261018000100, 20261019000100, 20260908000100). Las filas de fixture_sync_log ya purgadas NO se recuperan (son bitácora operativa).
set local lock_timeout = '5s';

-- F-04
drop policy if exists participants_select_scoped on public.participants;
create policy participants_select_member on public.participants for select to authenticated using (public.is_tenant_member(tenant_id));
grant select on public.participants, public.audit_log to anon;

-- F-03
drop trigger if exists fixture_sync_log_dedupe on public.fixture_sync_log;
drop function if exists public.tg_fixture_sync_log_dedupe();
drop function if exists public.purge_fixture_sync_log(interval, integer, boolean, interval);
drop index if exists public.fixture_sync_log_created_idx;
-- El historial de maintenance_runs se pierde con la tabla: exportarlo antes si debe conservarse (no contiene PII).
drop table if exists public.maintenance_runs;

-- F-02
revoke select on public.catalog_seasons from authenticated;
grant select on public.catalog_seasons to authenticated;
drop trigger if exists catalog_fixtures_touch on public.catalog_fixtures;
create trigger catalog_fixtures_touch before update on public.catalog_fixtures for each row execute function public.tg_catalog_touch();
drop trigger if exists catalog_seasons_touch on public.catalog_seasons;
create trigger catalog_seasons_touch before update on public.catalog_seasons for each row execute function public.tg_catalog_touch();
drop function if exists public.tg_catalog_touch_relevant();

-- F-01 (definiciones anteriores: bloqueo antes de autorizar)
create or replace function public.approve_participant(p_participant_id uuid) returns public.participants language plpgsql security definer set search_path = public, auth as $$
declare v_participant public.participants;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into v_participant from public.participants where id = p_participant_id for update;
  if not found then raise exception 'participant not found' using errcode = '22023'; end if;
  if not public.is_tenant_admin(v_participant.tenant_id) then raise exception 'not authorized' using errcode = '42501'; end if;
  update public.participants set approval_status = 'approved', updated_at = now() where id = p_participant_id returning * into v_participant;
  return v_participant;
end $$;

create or replace function public.set_participant_payment_status(p_participant_id uuid, p_status public.participant_payment_status) returns public.participants language plpgsql security definer set search_path = public, auth as $$
declare v_participant public.participants;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into v_participant from public.participants where id = p_participant_id for update;
  if not found then raise exception 'participant not found' using errcode = '22023'; end if;
  if not public.is_tenant_admin(v_participant.tenant_id) then raise exception 'not authorized' using errcode = '42501'; end if;
  update public.participants set payment_status = p_status, updated_at = now() where id = p_participant_id returning * into v_participant;
  return v_participant;
end $$;

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
    insert into public.official_results(tenant_id, match_id, home_score, away_score, revision, published_by, source)
      values (m.tenant_id, m.id, p_home_score, p_away_score, 1, v_uid, 'manual') returning * into r;
  else
    if p_expected_revision <> r.revision then raise exception 'revision conflict' using errcode = 'PT409'; end if;
    if (r.home_score, r.away_score) is distinct from (p_home_score, p_away_score) then
      update public.official_results set home_score = p_home_score, away_score = p_away_score, revision = r.revision + 1,
             published_by = v_uid, published_at = clock_timestamp(), source = 'manual'
       where id = r.id returning * into r;
    elsif r.source = 'provider' then
      -- Confirmación explícita de un marcador del proveedor: se fija como manual sin nueva revisión (no cambia puntos).
      update public.official_results set source = 'manual', published_by = v_uid where id = r.id returning * into r;
      insert into public.audit_log(tenant_id, actor_id, action, entity_type, entity_id, metadata)
        values (m.tenant_id, v_uid, 'official_results.confirm_manual', 'official_results', r.id, jsonb_build_object('match_id', m.id, 'revision', r.revision));
    end if;
  end if;
  if m.status <> 'final' then update public.matches set status = 'final', updated_at = now() where id = m.id; end if;
  perform public._recalculate_match_scoring(m.id);
  return r;
end $$;

create or replace function public.set_tournament_results_mode(p_tournament_id uuid, p_mode text) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_mode not in ('manual', 'automatic') then raise exception 'invalid results mode' using errcode = '22023'; end if;
  select tenant_id into v_tenant from public.tournaments where id = p_tournament_id for update;
  if v_tenant is null then raise exception 'tournament not found' using errcode = '22023'; end if;
  if not public.is_tenant_admin(v_tenant) then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_mode = 'automatic' and not public._auto_results_allowed(v_tenant) then
    raise exception 'automatic results require a premium plan that is not available yet' using errcode = '42501';
  end if;
  update public.tournaments set results_mode = p_mode, updated_at = now() where id = p_tournament_id;
  return p_mode;
end $$;

create or replace function public.import_catalog_teams(p_tournament_id uuid, p_team_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid; ct public.catalog_teams; v_team uuid; v_new integer := 0; v_existing integer := 0; v_before integer;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select tenant_id into v_tenant from public.tournaments where id = p_tournament_id for update;
  if v_tenant is null then raise exception 'tournament not found' using errcode = '22023'; end if;
  if not public.is_tenant_admin(v_tenant) then raise exception 'not authorized' using errcode = '42501'; end if;
  if coalesce(array_length(p_team_ids, 1), 0) = 0 then raise exception 'no teams selected' using errcode = '22023'; end if;
  if array_length(p_team_ids, 1) > 60 then raise exception 'at most 60 teams per import' using errcode = '22023'; end if;
  for ct in select * from public.catalog_teams where id = any (p_team_ids) order by name, id loop
    select count(*) into v_before from public.teams where tenant_id = v_tenant;
    v_team := public._link_catalog_team(v_tenant, ct);
    if exists (select 1 from public.tournament_teams where tournament_id = p_tournament_id and team_id = v_team) then v_existing := v_existing + 1;
    else
      insert into public.tournament_teams(tenant_id, tournament_id, team_id) values (v_tenant, p_tournament_id, v_team);
      v_new := v_new + 1;
    end if;
  end loop;
  insert into public.audit_log(tenant_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_tenant, auth.uid(), 'sports.catalog_teams_imported', 'tournament', p_tournament_id, jsonb_build_object('enrolled', v_new, 'already_enrolled', v_existing));
  return jsonb_build_object('enrolled', v_new, 'already_enrolled', v_existing,
                            'requested', array_length(p_team_ids, 1), 'found', (select count(*) from public.catalog_teams where id = any (p_team_ids)));
end $$;

create or replace function public.import_catalog_round(p_tournament_id uuid, p_season_id uuid, p_round_label text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid; v_provider text; v_round uuid; v_sort integer; v_label text; v_n integer;
  f record; v_team uuid; v_match uuid; v_teams integer := 0; v_teams_new integer := 0; v_matches integer := 0; v_existing integer := 0; v_tbd integer := 0;
  v_home uuid; v_away uuid; t record;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select tenant_id into v_tenant from public.tournaments where id = p_tournament_id for update;
  if v_tenant is null then raise exception 'tournament not found' using errcode = '22023'; end if;
  if not public.is_tenant_admin(v_tenant) then raise exception 'not authorized' using errcode = '42501'; end if;
  select c.provider into v_provider from public.catalog_seasons s join public.catalog_competitions c on c.id = s.competition_id where s.id = p_season_id;
  if v_provider is null then raise exception 'season not found' using errcode = '22023'; end if;
  if not exists (select 1 from public.catalog_fixtures where season_id = p_season_id and round_label = p_round_label) then
    raise exception 'catalog round has not been imported' using errcode = '22023';
  end if;

  v_label := coalesce(substring(p_round_label from '^Regular Season - ([0-9]+)$'), null);
  v_label := case when v_label is not null then 'Jornada ' || v_label else p_round_label end;
  select id into v_round from public.rounds where tournament_id = p_tournament_id and tenant_id = v_tenant and name = v_label;
  if v_round is null then
    v_n := nullif(substring(p_round_label from '([0-9]+)$'), '')::int;
    if v_n is null or exists (select 1 from public.rounds where tournament_id = p_tournament_id and sort_order = v_n) then
      select coalesce(max(sort_order), -1) + 1 into v_sort from public.rounds where tournament_id = p_tournament_id;
    else v_sort := v_n; end if;
    insert into public.rounds(tenant_id, tournament_id, name, sort_order) values (v_tenant, p_tournament_id, v_label, v_sort) returning id into v_round;
  end if;

  for t in
    select distinct ct.id as catalog_id, ct.external_id, ct.name, ct.is_national from public.catalog_fixtures cf
      join public.catalog_teams ct on ct.id in (cf.home_team_id, cf.away_team_id)
     where cf.season_id = p_season_id and cf.round_label = p_round_label
  loop
    select entity_id into v_team from public.external_refs where tenant_id = v_tenant and provider = v_provider and entity_type = 'team' and external_id = t.external_id;
    if v_team is null then
      select id into v_team from public.teams where tenant_id = v_tenant and lower(name) = lower(t.name)
        and not exists (select 1 from public.external_refs er where er.tenant_id = v_tenant and er.provider = v_provider and er.entity_type = 'team' and er.entity_id = public.teams.id);
      if v_team is null then
        insert into public.teams(tenant_id, name) values (v_tenant, t.name) returning id into v_team;
        v_teams_new := v_teams_new + 1;
      end if;
      insert into public.external_refs(tenant_id, provider, entity_type, entity_id, external_id, last_synced_at)
        values (v_tenant, v_provider, 'team', v_team, t.external_id, clock_timestamp());
    end if;
    insert into public.tournament_teams(tenant_id, tournament_id, team_id) values (v_tenant, p_tournament_id, v_team) on conflict do nothing;
    v_teams := v_teams + 1;
  end loop;

  for f in
    select cf.*, h.external_id as h_ext, a.external_id as a_ext from public.catalog_fixtures cf
      join public.catalog_teams h on h.id = cf.home_team_id join public.catalog_teams a on a.id = cf.away_team_id
     where cf.season_id = p_season_id and cf.round_label = p_round_label order by cf.starts_at nulls last, cf.external_id
  loop
    if exists (select 1 from public.external_refs where tenant_id = v_tenant and provider = v_provider and entity_type = 'match' and external_id = f.external_id) then
      v_existing := v_existing + 1; continue;
    end if;
    if f.starts_at is null then v_tbd := v_tbd + 1; continue; end if;
    select entity_id into v_home from public.external_refs where tenant_id = v_tenant and provider = v_provider and entity_type = 'team' and external_id = f.h_ext;
    select entity_id into v_away from public.external_refs where tenant_id = v_tenant and provider = v_provider and entity_type = 'team' and external_id = f.a_ext;
    insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at, provider_state)
      values (v_tenant, p_tournament_id, v_round, v_home, v_away, f.starts_at,
              case when f.state in ('postponed', 'cancelled', 'abandoned') then f.state end)
      returning id into v_match;
    insert into public.external_refs(tenant_id, provider, entity_type, entity_id, external_id, last_synced_at)
      values (v_tenant, v_provider, 'match', v_match, f.external_id, clock_timestamp());
    v_matches := v_matches + 1;
  end loop;

  insert into public.audit_log(tenant_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_tenant, auth.uid(), 'sports.round_imported', 'tournament', p_tournament_id,
            jsonb_build_object('provider', v_provider, 'season_id', p_season_id, 'round', p_round_label, 'matches_created', v_matches, 'teams_created', v_teams_new));
  return jsonb_build_object('round_id', v_round, 'matches_created', v_matches, 'matches_existing', v_existing, 'matches_tbd', v_tbd,
                            'teams_linked', v_teams, 'teams_created', v_teams_new);
end $$;
