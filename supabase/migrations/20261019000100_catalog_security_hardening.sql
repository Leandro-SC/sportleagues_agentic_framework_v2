-- Endurecimiento tras revisión de seguridad independiente de 20261017000100/20261018000100 (ADR-016). Forward-only. Sin cambios de contrato.
--  · catalog_fixtures_due solo sondea partidos de torneos automáticos con Premium habilitado (evita que tenants gratuitos consuman la cuota compartida);
--  · un resultado/estado final o en juego del proveedor no se acepta antes de la hora de inicio del partido (dato erróneo irreversible);
--  · confirmar como manual un marcador de proveedor queda auditado; búsqueda con tope de longitud; search_name se recalcula al renombrar;
--  · la importación de equipos no aborta por nombres homónimos del catálogo.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.catalog_fixtures_due(p_provider text, p_limit integer default 60)
returns table (external_id text, season_id uuid) language sql stable security definer set search_path = ''
as $$
  select cf.external_id, cf.season_id
    from public.catalog_fixtures cf
   where cf.provider = p_provider
     and auth.role() = 'service_role'
     and exists (select 1 from public.external_refs er
                  join public.matches mt on mt.id = er.entity_id and mt.tenant_id = er.tenant_id
                  join public.tournaments tn on tn.id = mt.tournament_id and tn.tenant_id = mt.tenant_id
                 where er.provider = cf.provider and er.entity_type = 'match' and er.external_id = cf.external_id
                   and tn.results_mode = 'automatic' and public._auto_results_allowed(mt.tenant_id))
     and (
          (cf.starts_at is not null and cf.starts_at between now() - interval '4 hours' and now() + interval '30 minutes'
             and (cf.last_polled_at is null or cf.last_polled_at < now() - interval '5 minutes'))
       or (cf.state in ('scheduled', 'postponed') and cf.starts_at between now() + interval '30 minutes' and now() + interval '24 hours'
             and (cf.last_polled_at is null or cf.last_polled_at < now() - interval '3 hours'))
       or (cf.state in ('scheduled', 'postponed') and (cf.starts_at is null or cf.starts_at > now() + interval '24 hours')
             and (cf.last_polled_at is null or cf.last_polled_at < now() - interval '12 hours'))
       or (cf.state = 'final' and cf.starts_at > now() - interval '3 days'
             and (cf.last_polled_at is null or cf.last_polled_at < now() - interval '12 hours'))
     )
   order by cf.starts_at nulls last
   limit least(greatest(p_limit, 1), 200)
$$;

create or replace function public.catalog_propagate_fixtures(p_fixture_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare cf public.catalog_fixtures; m public.matches; v_ref record; c jsonb := jsonb_build_object('matches', 0, 'rescheduled', 0, 'state', 0, 'results', 0, 'corrections', 0, 'conflicts', 0, 'ignored', 0, 'skipped_not_automatic', 0);
  v_res text; v_new_pstate text; v_mode text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role required' using errcode = '42501'; end if;
  for cf in select * from public.catalog_fixtures where id = any (p_fixture_ids) order by id loop
    for v_ref in select er.entity_id from public.external_refs er where er.provider = cf.provider and er.entity_type = 'match' and er.external_id = cf.external_id order by er.entity_id loop
      select * into m from public.matches where id = v_ref.entity_id for update;
      if not found then continue; end if;
      select results_mode into v_mode from public.tournaments where id = m.tournament_id and tenant_id = m.tenant_id;
      if v_mode is distinct from 'automatic' or not public._auto_results_allowed(m.tenant_id) then
        c := jsonb_set(c, '{skipped_not_automatic}', to_jsonb((c->>'skipped_not_automatic')::int + 1));
        continue;
      end if;
      c := jsonb_set(c, '{matches}', to_jsonb((c->>'matches')::int + 1));

      if cf.starts_at is not null and cf.starts_at is distinct from m.starts_at and m.status = 'scheduled' then
        perform public.apply_fixture_update(m.id, cf.starts_at, null);
        insert into public.fixture_sync_log(tenant_id, match_id, kind, detail) values (m.tenant_id, m.id, 'rescheduled', jsonb_build_object('from', m.starts_at, 'to', cf.starts_at));
        c := jsonb_set(c, '{rescheduled}', to_jsonb((c->>'rescheduled')::int + 1));
        select * into m from public.matches where id = m.id;
      end if;

      v_new_pstate := case when cf.state in ('postponed', 'cancelled', 'abandoned') then cf.state end;
      if v_new_pstate is distinct from m.provider_state then
        update public.matches set provider_state = v_new_pstate, updated_at = now() where id = m.id;
        insert into public.fixture_sync_log(tenant_id, match_id, kind, detail) values (m.tenant_id, m.id, 'state', jsonb_build_object('provider_state', v_new_pstate, 'provider_status', cf.provider_status));
        c := jsonb_set(c, '{state}', to_jsonb((c->>'state')::int + 1));
      end if;

      if cf.state in ('live', 'final') and m.starts_at > clock_timestamp() + (case when cf.state = 'live' then interval '5 minutes' else interval '0 seconds' end) then
        -- Dato imposible (en juego/finalizado antes de empezar): se ignora y se registra; jamás finaliza ni cierra un partido por error.
        insert into public.fixture_sync_log(tenant_id, match_id, kind, detail) values (m.tenant_id, m.id, 'ignored_regression', jsonb_build_object('reason', 'premature', 'provider_state', cf.state, 'starts_at', m.starts_at));
        c := jsonb_set(c, '{ignored}', to_jsonb((c->>'ignored')::int + 1));
      elsif cf.state = 'live' and m.status = 'scheduled' then
        perform public.apply_fixture_update(m.id, null, 'live');
      elsif cf.state = 'scheduled' and m.status <> 'scheduled' then
        insert into public.fixture_sync_log(tenant_id, match_id, kind, detail) values (m.tenant_id, m.id, 'ignored_regression', jsonb_build_object('provider_state', cf.state, 'local_status', m.status));
        c := jsonb_set(c, '{ignored}', to_jsonb((c->>'ignored')::int + 1));
      elsif cf.state = 'final' and cf.home_goals is not null then
        select * into m from public.matches where id = m.id;
        v_res := public._provider_result(m, cf.home_goals, cf.away_goals);
        if v_res = 'applied' then c := jsonb_set(c, '{results}', to_jsonb((c->>'results')::int + 1));
        elsif v_res = 'corrected' then c := jsonb_set(c, '{corrections}', to_jsonb((c->>'corrections')::int + 1));
        elsif v_res = 'conflict' then c := jsonb_set(c, '{conflicts}', to_jsonb((c->>'conflicts')::int + 1)); end if;
      end if;
    end loop;
  end loop;
  return c;
end $$;

create or replace function public.search_catalog_teams(p_query text default '', p_kind text default null, p_country text default null,
  p_competition_id uuid default null, p_limit integer default 30, p_offset integer default 0)
returns table (id uuid, name text, official_name text, kind text, country_code text, total bigint)
language sql stable security invoker set search_path = ''
as $$
  with q as (select public.catalog_normalize(left(p_query, 80)) as n),
  base as (
    select t.id, t.name, t.official_name, t.kind, t.country_code, t.search_name
      from public.catalog_teams t, q
     where (q.n = '' or t.search_name like '%' || q.n || '%')
       and (p_kind is null or t.kind = p_kind)
       and (p_country is null or t.country_code = upper(p_country))
       and (p_competition_id is null or exists (
             select 1 from public.catalog_competition_teams ct join public.catalog_seasons s on s.id = ct.season_id
              where ct.team_id = t.id and (s.competition_id = p_competition_id or s.id = p_competition_id)))
  )
  select b.id, b.name, b.official_name, b.kind, b.country_code, count(*) over () as total
    from base b, q
   order by (b.search_name = q.n) desc, (b.search_name like q.n || '%') desc, b.name, b.id
   limit least(greatest(coalesce(p_limit, 30), 1), 50) offset greatest(coalesce(p_offset, 0), 0)
$$;

create or replace function public.search_catalog_competitions(p_query text default '', p_country text default null, p_scope text default null,
  p_limit integer default 30, p_offset integer default 0)
returns table (id uuid, name text, kind text, scope text, country_code text, sport_code text, season_id uuid, season_year integer, team_count bigint, total bigint)
language sql stable security invoker set search_path = ''
as $$
  with q as (select public.catalog_normalize(left(p_query, 80)) as n),
  base as (
    select c.id, c.name, c.kind, c.scope, c.country_code, c.sport_code, c.search_name,
           cs.id as season_id, cs.year as season_year,
           (select count(*) from public.catalog_competition_teams ct where ct.season_id = cs.id) as team_count
      from q cross join public.catalog_competitions c
      left join lateral (select s.id, s.year from public.catalog_seasons s where s.competition_id = c.id order by s.is_current desc, s.year desc limit 1) cs on true
     where (q.n = '' or c.search_name like '%' || q.n || '%')
       and (p_country is null or c.country_code = upper(p_country))
       and (p_scope is null or c.scope = p_scope)
  )
  select b.id, b.name, b.kind, b.scope, b.country_code, b.sport_code, b.season_id, b.season_year, b.team_count, count(*) over () as total
    from base b, q
   order by (b.search_name like q.n || '%') desc, b.scope, b.name, b.id
   limit least(greatest(coalesce(p_limit, 30), 1), 50) offset greatest(coalesce(p_offset, 0), 0)
$$;

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


drop trigger if exists catalog_countries_search_name on public.catalog_countries;
create or replace function public.tg_catalog_search_name() returns trigger language plpgsql set search_path = ''
as $$
begin
  if coalesce(new.search_name, '') = '' then
    new.search_name := public.catalog_normalize(new.name);
  elsif tg_op = 'UPDATE' and new.name is distinct from old.name and new.search_name is not distinct from old.search_name then
    new.search_name := public.catalog_normalize(new.name);   -- renombre del proveedor: el índice de búsqueda no queda obsoleto
  end if;
  return new;
end $$;

create or replace function public._link_catalog_team(p_tenant uuid, ct public.catalog_teams) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_team uuid; v_name text;
begin
  select entity_id into v_team from public.external_refs where tenant_id = p_tenant and provider = ct.provider and entity_type = 'team' and external_id = ct.external_id;
  if v_team is not null then return v_team; end if;
  -- Un equipo manual con el mismo nombre se reutiliza (sin duplicar) y queda vinculado al catálogo.
  select t.id into v_team from public.teams t where t.tenant_id = p_tenant and lower(t.name) = lower(ct.name)
     and not exists (select 1 from public.external_refs er where er.tenant_id = p_tenant and er.provider = ct.provider and er.entity_type = 'team' and er.entity_id = t.id);
  if v_team is null then
    -- Otro equipo del catálogo con el mismo nombre ya existe en el tenant: se distingue por país (y, si hace falta, por id externo) en lugar de abortar.
    v_name := ct.name;
    if exists (select 1 from public.teams t where t.tenant_id = p_tenant and lower(t.name) = lower(v_name)) then v_name := left(ct.name, 100) || ' (' || coalesce(ct.country_code, ct.provider) || ')'; end if;
    if exists (select 1 from public.teams t where t.tenant_id = p_tenant and lower(t.name) = lower(v_name)) then v_name := left(ct.name, 90) || ' (' || left(ct.external_id, 20) || ')'; end if;
    insert into public.teams(tenant_id, name, country_code, kind) values (p_tenant, v_name, ct.country_code, ct.kind) returning id into v_team;
  end if;
  insert into public.external_refs(tenant_id, provider, entity_type, entity_id, external_id, last_synced_at)
    values (p_tenant, ct.provider, 'team', v_team, ct.external_id, clock_timestamp());
  return v_team;
end $$;


revoke all on function public.catalog_fixtures_due(text, integer), public.catalog_propagate_fixtures(uuid[]), public._link_catalog_team(uuid, public.catalog_teams),
  public.tg_catalog_search_name() from public, anon, authenticated;
grant execute on function public.catalog_fixtures_due(text, integer), public.catalog_propagate_fixtures(uuid[]) to service_role;
-- search_* y publish_official_result conservan sus grants (CREATE OR REPLACE no los modifica).
