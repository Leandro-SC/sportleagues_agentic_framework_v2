-- ADR-016 (revisión): catálogo central precargado + resultados híbridos. Forward-only. Cambios compatibles:
--  · catálogo global: países, selecciones, participación equipo↔temporada, procedencia/licencia (catalog_sources), búsqueda paginada;
--  · importación de EQUIPOS del catálogo al torneo del tenant (copia tenant-owned + external_refs; sin modelos paralelos);
--  · modo de resultados por torneo: 'manual' (todos) | 'automatic' (Premium futuro, interruptor de plataforma APAGADO + plan pro, verificado en BD);
--  · un resultado confirmado/corregido a mano pasa a source='manual' y el proveedor jamás lo sobrescribe en silencio.
-- No altera locks, scoring, tickets ni H1–H6.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Procedencia/licencia, países y metadatos de búsqueda
-- ---------------------------------------------------------------------------------------------------------------
create table public.catalog_sources (
  source text primary key check (source ~ '^[a-z][a-z0-9_]{1,39}$'),
  name text not null,
  license text not null,
  license_url text,
  attribution text,
  version text,
  loaded_at timestamptz not null default now()
);
create table public.catalog_countries (
  code text primary key check (code ~ '^[A-Z]{2}(-[A-Z]{3})?$'),
  name_en text not null check (char_length(name_en) between 1 and 120),
  name_es text not null check (char_length(name_es) between 1 and 120),
  confederation text check (confederation in ('UEFA', 'CONMEBOL', 'CONCACAF', 'AFC', 'CAF', 'OFC')),
  search_name text not null default '',
  updated_at timestamptz not null default now()
);

create function public.catalog_normalize(p_text text) returns text language sql immutable parallel safe set search_path = ''
as $$ select btrim(regexp_replace(translate(lower(coalesce(p_text, '')), 'áàâäãåāéèêëēíìîïīóòôöõøōúùûüūñçšžłđ', 'aaaaaaaeeeeeiiiiiooooooouuuuuncszld'), '[^a-z0-9]+', ' ', 'g')) $$;

alter table public.catalog_teams
  add column kind text not null default 'club' check (kind in ('club', 'national')),
  add column country_code text check (country_code ~ '^[A-Z]{2}(-[A-Z]{3})?$'),
  add column official_name text check (char_length(official_name) <= 160),
  add column search_name text not null default '';
alter table public.catalog_competitions
  add column scope text not null default 'domestic' check (scope in ('domestic', 'continental', 'world')),
  add column search_name text not null default '';

create function public.tg_catalog_search_name() returns trigger language plpgsql set search_path = ''
as $$
begin
  if coalesce(new.search_name, '') = '' then new.search_name := public.catalog_normalize(new.name); end if;
  return new;
end $$;
create trigger catalog_teams_search_name before insert or update on public.catalog_teams for each row execute function public.tg_catalog_search_name();
create trigger catalog_competitions_search_name before insert or update on public.catalog_competitions for each row execute function public.tg_catalog_search_name();
create trigger catalog_countries_search_name before insert or update on public.catalog_countries for each row execute function public.tg_catalog_search_name();

create table public.catalog_competition_teams (
  season_id uuid not null references public.catalog_seasons(id) on delete cascade,
  team_id uuid not null references public.catalog_teams(id) on delete cascade,
  primary key (season_id, team_id)
);
create index catalog_competition_teams_team_idx on public.catalog_competition_teams (team_id);
create index catalog_teams_search_trgm on public.catalog_teams using gin (search_name extensions.gin_trgm_ops);
create index catalog_competitions_search_trgm on public.catalog_competitions using gin (search_name extensions.gin_trgm_ops);
create index catalog_teams_kind_country_idx on public.catalog_teams (kind, country_code);

alter table public.catalog_sources enable row level security;
alter table public.catalog_countries enable row level security;
alter table public.catalog_competition_teams enable row level security;
create policy catalog_sources_read on public.catalog_sources for select to authenticated using (true);
create policy catalog_countries_read on public.catalog_countries for select to authenticated using (true);
create policy catalog_competition_teams_read on public.catalog_competition_teams for select to authenticated using (true);
revoke all on public.catalog_sources, public.catalog_countries, public.catalog_competition_teams from anon, authenticated;
grant select on public.catalog_sources, public.catalog_countries, public.catalog_competition_teams to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Búsqueda paginada (security invoker: lee bajo RLS; solo catálogo global)
-- ---------------------------------------------------------------------------------------------------------------
create function public.search_catalog_teams(p_query text default '', p_kind text default null, p_country text default null,
  p_competition_id uuid default null, p_limit integer default 30, p_offset integer default 0)
returns table (id uuid, name text, official_name text, kind text, country_code text, total bigint)
language sql stable security invoker set search_path = ''
as $$
  with q as (select public.catalog_normalize(p_query) as n),
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

create function public.search_catalog_competitions(p_query text default '', p_country text default null, p_scope text default null,
  p_limit integer default 30, p_offset integer default 0)
returns table (id uuid, name text, kind text, scope text, country_code text, sport_code text, season_id uuid, season_year integer, team_count bigint, total bigint)
language sql stable security invoker set search_path = ''
as $$
  with q as (select public.catalog_normalize(p_query) as n),
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

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Carga reproducible e idempotente del catálogo (postgres/service_role únicamente; nunca clientes)
-- ---------------------------------------------------------------------------------------------------------------
create function public.catalog_seed_load(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c jsonb; t jsonb; v_comp uuid; v_season uuid; v_team uuid; q text; v_team_n integer := 0; v_comp_n integer := 0; v_country_n integer := 0; v_link_n integer := 0;
  v_provider text; v_aliases text;
begin
  if auth.role() is distinct from 'service_role' and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'catalog loading requires service_role' using errcode = '42501';
  end if;
  v_provider := p_payload #>> '{source,key}';
  if v_provider is null or v_provider !~ '^[a-z][a-z0-9_]{1,39}$' then raise exception 'source.key is required' using errcode = '22023'; end if;
  insert into public.catalog_sources(source, name, license, license_url, attribution, version)
    values (v_provider, p_payload #>> '{source,name}', p_payload #>> '{source,license}', p_payload #>> '{source,license_url}', p_payload #>> '{source,attribution}', p_payload #>> '{source,version}')
  on conflict (source) do update set name = excluded.name, license = excluded.license, license_url = excluded.license_url,
      attribution = excluded.attribution, version = excluded.version, loaded_at = now();

  for c in select * from jsonb_array_elements(coalesce(p_payload->'countries', '[]'::jsonb)) loop
    insert into public.catalog_countries(code, name_en, name_es, confederation, search_name)
      values (c->>'code', c->>'name_en', c->>'name_es', nullif(c->>'confederation', ''), public.catalog_normalize((c->>'name_en') || ' ' || (c->>'name_es') || ' ' || (c->>'code')))
    on conflict (code) do update set name_en = excluded.name_en, name_es = excluded.name_es, confederation = excluded.confederation, search_name = excluded.search_name
      where (public.catalog_countries.name_en, public.catalog_countries.name_es, public.catalog_countries.confederation, public.catalog_countries.search_name)
            is distinct from (excluded.name_en, excluded.name_es, excluded.confederation, excluded.search_name);
    v_country_n := v_country_n + 1;
  end loop;

  for t in select * from jsonb_array_elements(coalesce(p_payload->'teams', '[]'::jsonb)) loop
    select string_agg(a, ' ') into v_aliases from jsonb_array_elements_text(coalesce(t->'aliases', '[]'::jsonb)) a;
    q := public.catalog_normalize(concat_ws(' ', t->>'name', t->>'official_name', v_aliases));
    insert into public.catalog_teams(provider, external_id, name, official_name, kind, country_code, is_national, search_name, country_name)
      values (v_provider, t->>'external_id', left(t->>'name', 120), left(nullif(t->>'official_name', ''), 160), coalesce(t->>'kind', 'club'), nullif(t->>'country_code', ''),
              coalesce(t->>'kind', 'club') = 'national', q, left(t->>'country_name', 80))
    on conflict (provider, external_id) do update
       set name = excluded.name, official_name = excluded.official_name, kind = excluded.kind, country_code = excluded.country_code,
           is_national = excluded.is_national, search_name = excluded.search_name, country_name = excluded.country_name
     where (public.catalog_teams.name, public.catalog_teams.official_name, public.catalog_teams.kind, public.catalog_teams.country_code, public.catalog_teams.search_name, public.catalog_teams.country_name)
           is distinct from (excluded.name, excluded.official_name, excluded.kind, excluded.country_code, excluded.search_name, excluded.country_name);
    v_team_n := v_team_n + 1;
  end loop;

  for c in select * from jsonb_array_elements(coalesce(p_payload->'competitions', '[]'::jsonb)) loop
    select string_agg(a, ' ') into v_aliases from jsonb_array_elements_text(coalesce(c->'aliases', '[]'::jsonb)) a;
    q := public.catalog_normalize(concat_ws(' ', c->>'name', v_aliases));
    insert into public.catalog_competitions(provider, external_id, name, kind, scope, country_code, country_name, sport_code, search_name)
      values (v_provider, c->>'external_id', left(c->>'name', 160), coalesce(c->>'kind', 'league'), coalesce(c->>'scope', 'domestic'), nullif(c->>'country_code', ''),
              left(c->>'country_name', 80), coalesce(c->>'sport', 'football'), q)
    on conflict (provider, external_id) do update
       set name = excluded.name, kind = excluded.kind, scope = excluded.scope, country_code = excluded.country_code, country_name = excluded.country_name, search_name = excluded.search_name
     where (public.catalog_competitions.name, public.catalog_competitions.kind, public.catalog_competitions.scope, public.catalog_competitions.country_code, public.catalog_competitions.country_name, public.catalog_competitions.search_name)
           is distinct from (excluded.name, excluded.kind, excluded.scope, excluded.country_code, excluded.country_name, excluded.search_name);
    select id into v_comp from public.catalog_competitions where provider = v_provider and external_id = c->>'external_id';
    v_comp_n := v_comp_n + 1;
    if c->'season' is not null and c->'season' <> 'null'::jsonb then
      insert into public.catalog_seasons(competition_id, year, starts_on, ends_on, is_current)
        values (v_comp, (c #>> '{season,year}')::int, nullif(c #>> '{season,start}', '')::date, nullif(c #>> '{season,end}', '')::date, coalesce((c #>> '{season,current}')::boolean, true))
      on conflict (competition_id, year) do update set starts_on = excluded.starts_on, ends_on = excluded.ends_on, is_current = excluded.is_current
        where (public.catalog_seasons.starts_on, public.catalog_seasons.ends_on, public.catalog_seasons.is_current) is distinct from (excluded.starts_on, excluded.ends_on, excluded.is_current);
      select id into v_season from public.catalog_seasons where competition_id = v_comp and year = (c #>> '{season,year}')::int;
      insert into public.catalog_competition_teams(season_id, team_id)
        select v_season, ct.id from jsonb_array_elements_text(coalesce(c->'team_ids', '[]'::jsonb)) x
          join public.catalog_teams ct on ct.provider = v_provider and ct.external_id = x
        on conflict do nothing;
      get diagnostics v_link_n = row_count;
    end if;
  end loop;
  return jsonb_build_object('countries', v_country_n, 'teams', v_team_n, 'competitions', v_comp_n);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Importación de equipos del catálogo al torneo del tenant
-- ---------------------------------------------------------------------------------------------------------------
alter table public.teams drop constraint if exists teams_country_code_check;
alter table public.teams add constraint teams_country_code_check check (country_code ~ '^[A-Z]{2}(-[A-Z]{3})?$');
alter table public.teams add column kind text not null default 'club' check (kind in ('club', 'national'));

create function public._link_catalog_team(p_tenant uuid, ct public.catalog_teams) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_team uuid;
begin
  select entity_id into v_team from public.external_refs where tenant_id = p_tenant and provider = ct.provider and entity_type = 'team' and external_id = ct.external_id;
  if v_team is not null then return v_team; end if;
  -- Un equipo manual con el mismo nombre se reutiliza (sin duplicar) y queda vinculado al catálogo.
  select t.id into v_team from public.teams t where t.tenant_id = p_tenant and lower(t.name) = lower(ct.name)
     and not exists (select 1 from public.external_refs er where er.tenant_id = p_tenant and er.provider = ct.provider and er.entity_type = 'team' and er.entity_id = t.id);
  if v_team is null then
    insert into public.teams(tenant_id, name, country_code, kind) values (p_tenant, ct.name, ct.country_code, ct.kind) returning id into v_team;
  end if;
  insert into public.external_refs(tenant_id, provider, entity_type, entity_id, external_id, last_synced_at)
    values (p_tenant, ct.provider, 'team', v_team, ct.external_id, clock_timestamp());
  return v_team;
end $$;

create function public.import_catalog_teams(p_tournament_id uuid, p_team_ids uuid[]) returns jsonb
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

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Resultados híbridos: modo por torneo; automático = Premium futuro, comprobado en la base de datos
-- ---------------------------------------------------------------------------------------------------------------
create table public.platform_feature_flags (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,59}$'),
  enabled boolean not null default false,
  note text,
  updated_at timestamptz not null default now()
);
insert into public.platform_feature_flags(key, enabled, note) values ('auto_results', false, 'Resultados automáticos de proveedor: Premium futuro. Apagado por defecto.');
alter table public.platform_feature_flags enable row level security;
create policy platform_feature_flags_read on public.platform_feature_flags for select to authenticated using (true);
revoke all on public.platform_feature_flags from anon, authenticated;
grant select on public.platform_feature_flags to authenticated;

create function public._auto_results_allowed(p_tenant uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select f.enabled from public.platform_feature_flags f where f.key = 'auto_results'), false)
     and exists (select 1 from public.tenant_entitlements e where e.tenant_id = p_tenant and e.plan_code = 'pro')
$$;
create function public.tenant_can_use_auto_results(p_tenant_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select public.is_tenant_member(p_tenant_id) and public._auto_results_allowed(p_tenant_id) $$;

alter table public.tournaments add column results_mode text not null default 'manual' check (results_mode in ('manual', 'automatic'));
drop trigger if exists audit_tournaments on public.tournaments;
create trigger audit_tournaments after insert or update or delete on public.tournaments
  for each row execute function public.tg_audit_row_change('name,sport_code,country_code,season_label,color,results_mode');

create function public.set_tournament_results_mode(p_tournament_id uuid, p_mode text) returns text
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

-- Un resultado publicado o confirmado por un administrador es 'manual': el proveedor no lo sobrescribe (se registra el conflicto).
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
    end if;
  end if;
  if m.status <> 'final' then update public.matches set status = 'final', updated_at = now() where id = m.id; end if;
  perform public._recalculate_match_scoring(m.id);
  return r;
end $$;

-- La propagación del proveedor solo actúa sobre partidos (a) vinculados por external_refs y (b) de torneos en modo automático
-- cuyo tenant sigue habilitado (interruptor + plan). Cualquier otro partido se administra manualmente.
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

      if cf.state = 'live' and m.status = 'scheduled' then
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

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function
  public.catalog_normalize(text), public.tg_catalog_search_name(), public.catalog_seed_load(jsonb), public._link_catalog_team(uuid, public.catalog_teams),
  public._auto_results_allowed(uuid), public.import_catalog_teams(uuid, uuid[]), public.set_tournament_results_mode(uuid, text), public.tenant_can_use_auto_results(uuid),
  public.search_catalog_teams(text, text, text, uuid, integer, integer), public.search_catalog_competitions(text, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.catalog_normalize(text) to authenticated;
grant execute on function public.search_catalog_teams(text, text, text, uuid, integer, integer), public.search_catalog_competitions(text, text, text, integer, integer),
  public.import_catalog_teams(uuid, uuid[]), public.set_tournament_results_mode(uuid, text), public.tenant_can_use_auto_results(uuid) to authenticated;
grant execute on function public.catalog_seed_load(jsonb) to service_role;
-- publish_official_result y catalog_propagate_fixtures conservan sus grants (CREATE OR REPLACE no los cambia).
