-- ADR-016: catálogo deportivo global (solo lectura para clientes) + conector de proveedor. Forward-only.
-- Reutiliza Fase 06 (tournaments/teams/rounds/matches/external_refs/official_results) y la maquinaria de lock de ADR-011:
-- no cambia match_status, no toca save_prediction ni las guardas H1–H6.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Catálogo global. Sin tenant_id: son datos deportivos públicos, no datos de un organizador. No se guardan logos (ADR-009/016).
-- ---------------------------------------------------------------------------------------------------------------
create table public.catalog_competitions (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider ~ '^[a-z][a-z0-9_]{1,39}$'),
  external_id text not null check (char_length(external_id) between 1 and 120),
  name text not null check (char_length(name) between 1 and 160),
  kind text not null default 'other' check (kind in ('league', 'cup', 'other')),
  country_name text check (char_length(country_name) <= 80),
  country_code text check (char_length(country_code) <= 12),
  sport_code text not null default 'football' references public.sports(code),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_id)
);
create table public.catalog_seasons (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.catalog_competitions(id) on delete restrict,
  year integer not null check (year between 1900 and 2200),
  starts_on date,
  ends_on date,
  is_current boolean not null default false,
  fixtures_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (competition_id, year)
);
create table public.catalog_teams (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider ~ '^[a-z][a-z0-9_]{1,39}$'),
  external_id text not null check (char_length(external_id) between 1 and 120),
  name text not null check (char_length(name) between 1 and 120),
  country_name text check (char_length(country_name) <= 80),
  is_national boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_id)
);
create table public.catalog_fixtures (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.catalog_seasons(id) on delete restrict,
  provider text not null check (provider ~ '^[a-z][a-z0-9_]{1,39}$'),
  external_id text not null check (char_length(external_id) between 1 and 120),
  round_label text not null check (char_length(round_label) between 1 and 120),
  home_team_id uuid not null references public.catalog_teams(id) on delete restrict,
  away_team_id uuid not null references public.catalog_teams(id) on delete restrict,
  starts_at timestamptz,
  provider_status text not null default 'NS' check (char_length(provider_status) <= 12),
  state text not null default 'scheduled' check (state in ('scheduled', 'live', 'final', 'postponed', 'cancelled', 'abandoned')),
  home_goals integer check (home_goals >= 0),
  away_goals integer check (away_goals >= 0),
  provider_updated_at timestamptz,
  last_changed_at timestamptz not null default now(),
  last_polled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_id),
  check (home_team_id <> away_team_id),
  check ((home_goals is null) = (away_goals is null)),
  check (state <> 'final' or home_goals is not null)
);
create index catalog_seasons_competition_idx on public.catalog_seasons (competition_id, year desc);
create index catalog_fixtures_round_idx on public.catalog_fixtures (season_id, round_label, starts_at);
create index catalog_fixtures_due_idx on public.catalog_fixtures (starts_at, last_polled_at) where state in ('scheduled', 'live', 'postponed');
create index catalog_fixtures_updated_idx on public.catalog_fixtures (updated_at);
create index catalog_teams_updated_idx on public.catalog_teams (updated_at);
create index catalog_competitions_updated_idx on public.catalog_competitions (updated_at);
create index catalog_competitions_name_idx on public.catalog_competitions (lower(name));

create function public.tg_catalog_touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := clock_timestamp(); return new; end $$;
create trigger catalog_competitions_touch before update on public.catalog_competitions for each row execute function public.tg_catalog_touch();
create trigger catalog_seasons_touch before update on public.catalog_seasons for each row execute function public.tg_catalog_touch();
create trigger catalog_teams_touch before update on public.catalog_teams for each row execute function public.tg_catalog_touch();
create trigger catalog_fixtures_touch before update on public.catalog_fixtures for each row execute function public.tg_catalog_touch();

-- Control de importaciones y de cuota (solo service_role; sin acceso de clientes)
create table public.catalog_import_jobs (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider ~ '^[a-z][a-z0-9_]{1,39}$'),
  resource_key text not null check (char_length(resource_key) between 1 and 200),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'rate_limited')),
  requested_by uuid references public.profiles(id) on delete set null,
  requests_used integer not null default 0 check (requests_used >= 0),
  error_code text check (char_length(error_code) <= 60),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz
);
create unique index catalog_import_running_key on public.catalog_import_jobs (provider, resource_key) where status = 'running';
create index catalog_import_recent_idx on public.catalog_import_jobs (provider, resource_key, finished_at desc) where status = 'succeeded';
create table public.provider_usage (
  provider text not null,
  day date not null,
  requests integer not null default 0 check (requests >= 0),
  errors integer not null default 0 check (errors >= 0),
  rate_limited integer not null default 0 check (rate_limited >= 0),
  primary key (provider, day)
);

-- Estado del proveedor visible para el tenant + bitácora de sincronización (auditoría legible por administradores)
alter table public.matches add column provider_state text check (provider_state in ('postponed', 'cancelled', 'abandoned'));
alter table public.official_results alter column published_by drop not null;
alter table public.official_results add column source text not null default 'manual' check (source in ('manual', 'provider'));
alter table public.official_results add constraint official_results_source_actor check (source = 'provider' or published_by is not null);

create table public.fixture_sync_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  match_id uuid not null,
  kind text not null check (kind in ('rescheduled', 'state', 'result_applied', 'result_corrected', 'conflict_manual_result', 'ignored_regression')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (match_id, tenant_id) references public.matches(id, tenant_id) on delete cascade
);
create index fixture_sync_log_match_idx on public.fixture_sync_log (tenant_id, match_id, created_at desc);

-- ---------------------------------------------------------------------------------------------------------------
-- 2. RLS y privilegios
-- ---------------------------------------------------------------------------------------------------------------
alter table public.catalog_competitions enable row level security;
alter table public.catalog_seasons enable row level security;
alter table public.catalog_teams enable row level security;
alter table public.catalog_fixtures enable row level security;
alter table public.catalog_import_jobs enable row level security;
alter table public.provider_usage enable row level security;
alter table public.fixture_sync_log enable row level security;
create policy catalog_competitions_read on public.catalog_competitions for select to authenticated using (true);
create policy catalog_seasons_read on public.catalog_seasons for select to authenticated using (true);
create policy catalog_teams_read on public.catalog_teams for select to authenticated using (true);
create policy catalog_fixtures_read on public.catalog_fixtures for select to authenticated using (true);
create policy fixture_sync_log_admin on public.fixture_sync_log for select to authenticated using (public.is_tenant_admin(tenant_id));
revoke all on public.catalog_competitions, public.catalog_seasons, public.catalog_teams, public.catalog_fixtures,
  public.catalog_import_jobs, public.provider_usage, public.fixture_sync_log from anon, authenticated;
grant select on public.catalog_competitions, public.catalog_seasons, public.catalog_teams, public.catalog_fixtures to authenticated;
grant select on public.fixture_sync_log to authenticated;
-- La columna del lote de proveedor no se expone: el cliente no necesita saber cuándo se sondeó.
revoke select on public.catalog_fixtures from authenticated;
grant select (id, season_id, provider, external_id, round_label, home_team_id, away_team_id, starts_at, provider_status, state,
              home_goals, away_goals, provider_updated_at, updated_at) on public.catalog_fixtures to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Control de importación concurrente y cuota (solo service_role)
-- ---------------------------------------------------------------------------------------------------------------
create function public.catalog_begin_import(p_provider text, p_resource_key text, p_requested_by uuid default null,
  p_fresh_for interval default interval '6 hours', p_stale_after interval default interval '3 minutes')
returns table (outcome text, job_id uuid) language plpgsql security definer set search_path = ''
as $$
declare v_running public.catalog_import_jobs; v_recent public.catalog_import_jobs; v_new uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_provider || ':' || p_resource_key, 0));
  select * into v_running from public.catalog_import_jobs where provider = p_provider and resource_key = p_resource_key and status = 'running';
  if found then
    if v_running.started_at > clock_timestamp() - p_stale_after then
      return query select 'in_progress'::text, v_running.id; return;
    end if;
    update public.catalog_import_jobs set status = 'failed', error_code = 'STALE', finished_at = clock_timestamp() where id = v_running.id;
  end if;
  select * into v_recent from public.catalog_import_jobs
   where provider = p_provider and resource_key = p_resource_key and status = 'succeeded' and finished_at > clock_timestamp() - p_fresh_for
   order by finished_at desc limit 1;
  if found then return query select 'fresh'::text, v_recent.id; return; end if;
  insert into public.catalog_import_jobs(provider, resource_key, requested_by) values (p_provider, p_resource_key, p_requested_by) returning id into v_new;
  return query select 'started'::text, v_new;
end $$;

create function public.catalog_finish_import(p_job_id uuid, p_status text, p_error_code text default null, p_requests integer default 0)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role required' using errcode = '42501'; end if;
  if p_status not in ('succeeded', 'failed', 'rate_limited') then raise exception 'invalid status' using errcode = '22023'; end if;
  update public.catalog_import_jobs
     set status = p_status, error_code = left(p_error_code, 60), requests_used = greatest(p_requests, 0), finished_at = clock_timestamp()
   where id = p_job_id and status = 'running';
end $$;

-- Reserva atómica de solicitudes del día UTC. Devuelve las que quedan tras reservar, o -1 si NO hay cuota (no se reserva nada).
create function public.provider_consume(p_provider text, p_daily_limit integer, p_n integer default 1)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_used integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role required' using errcode = '42501'; end if;
  if p_n < 1 or p_daily_limit < 1 then raise exception 'invalid quota request' using errcode = '22023'; end if;
  insert into public.provider_usage(provider, day, requests) values (p_provider, (now() at time zone 'utc')::date, 0) on conflict do nothing;
  update public.provider_usage set requests = requests + p_n
   where provider = p_provider and day = (now() at time zone 'utc')::date and requests + p_n <= p_daily_limit
   returning requests into v_used;
  if v_used is null then return -1; end if;
  return p_daily_limit - v_used;
end $$;

create function public.provider_record_outcome(p_provider text, p_error boolean default false, p_rate_limited boolean default false)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role required' using errcode = '42501'; end if;
  insert into public.provider_usage(provider, day, errors, rate_limited)
    values (p_provider, (now() at time zone 'utc')::date, case when p_error then 1 else 0 end, case when p_rate_limited then 1 else 0 end)
  on conflict (provider, day) do update
     set errors = public.provider_usage.errors + excluded.errors, rate_limited = public.provider_usage.rate_limited + excluded.rate_limited;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Escritura del catálogo (solo service_role; idempotente por (provider, external_id))
-- ---------------------------------------------------------------------------------------------------------------
create function public.catalog_upsert_competition(p_provider text, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; s jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role required' using errcode = '42501'; end if;
  insert into public.catalog_competitions(provider, external_id, name, kind, country_name, country_code)
    values (p_provider, p_payload->>'external_id', left(p_payload->>'name', 160),
            coalesce(nullif(p_payload->>'kind', ''), 'other'), left(p_payload->>'country_name', 80), left(p_payload->>'country_code', 12))
  on conflict (provider, external_id) do update
     set name = excluded.name, kind = excluded.kind, country_name = excluded.country_name, country_code = excluded.country_code
   where (public.catalog_competitions.name, public.catalog_competitions.kind, public.catalog_competitions.country_name, public.catalog_competitions.country_code)
         is distinct from (excluded.name, excluded.kind, excluded.country_name, excluded.country_code)
  returning id into v_id;
  if v_id is null then select id into v_id from public.catalog_competitions where provider = p_provider and external_id = p_payload->>'external_id'; end if;
  for s in select * from jsonb_array_elements(coalesce(p_payload->'seasons', '[]'::jsonb)) loop
    insert into public.catalog_seasons(competition_id, year, starts_on, ends_on, is_current)
      values (v_id, (s->>'year')::int, nullif(s->>'start', '')::date, nullif(s->>'end', '')::date, coalesce((s->>'current')::boolean, false))
    on conflict (competition_id, year) do update
       set starts_on = excluded.starts_on, ends_on = excluded.ends_on, is_current = excluded.is_current
     where (public.catalog_seasons.starts_on, public.catalog_seasons.ends_on, public.catalog_seasons.is_current)
           is distinct from (excluded.starts_on, excluded.ends_on, excluded.is_current);
  end loop;
  return v_id;
end $$;

-- p_fixtures: [{external_id, round, home:{external_id,name,national}, away:{...}, starts_at, provider_status, state, home_goals, away_goals, provider_updated_at}]
-- Devuelve los ids de fixtures NUEVOS o CAMBIADOS (horario, estado, marcador, jornada) para propagarlos solo cuando hay novedad.
create function public.catalog_upsert_fixtures(p_season_id uuid, p_provider text, p_fixtures jsonb)
returns uuid[] language plpgsql security definer set search_path = ''
as $$
declare f jsonb; v_home uuid; v_away uuid; v_id uuid; v_changed uuid[] := '{}'; v_old public.catalog_fixtures; v_new public.catalog_fixtures;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role required' using errcode = '42501'; end if;
  if not exists (select 1 from public.catalog_seasons where id = p_season_id) then raise exception 'season not found' using errcode = '22023'; end if;
  for f in select * from jsonb_array_elements(coalesce(p_fixtures, '[]'::jsonb)) loop
    insert into public.catalog_teams(provider, external_id, name, is_national)
      values (p_provider, f#>>'{home,external_id}', left(f#>>'{home,name}', 120), coalesce((f#>>'{home,national}')::boolean, false))
    on conflict (provider, external_id) do update set name = excluded.name
      where public.catalog_teams.name is distinct from excluded.name
    returning id into v_home;
    if v_home is null then select id into v_home from public.catalog_teams where provider = p_provider and external_id = f#>>'{home,external_id}'; end if;
    insert into public.catalog_teams(provider, external_id, name, is_national)
      values (p_provider, f#>>'{away,external_id}', left(f#>>'{away,name}', 120), coalesce((f#>>'{away,national}')::boolean, false))
    on conflict (provider, external_id) do update set name = excluded.name
      where public.catalog_teams.name is distinct from excluded.name
    returning id into v_away;
    if v_away is null then select id into v_away from public.catalog_teams where provider = p_provider and external_id = f#>>'{away,external_id}'; end if;

    select * into v_old from public.catalog_fixtures where provider = p_provider and external_id = f->>'external_id' for update;
    if not found then
      insert into public.catalog_fixtures(season_id, provider, external_id, round_label, home_team_id, away_team_id, starts_at, provider_status, state,
                                          home_goals, away_goals, provider_updated_at, last_polled_at)
        values (p_season_id, p_provider, f->>'external_id', left(f->>'round', 120), v_home, v_away, nullif(f->>'starts_at', '')::timestamptz,
                coalesce(f->>'provider_status', 'NS'), coalesce(f->>'state', 'scheduled'),
                nullif(f->>'home_goals', '')::int, nullif(f->>'away_goals', '')::int, nullif(f->>'provider_updated_at', '')::timestamptz, clock_timestamp())
      returning id into v_id;
      v_changed := v_changed || v_id;
    else
      update public.catalog_fixtures
         set round_label = left(f->>'round', 120), home_team_id = v_home, away_team_id = v_away,
             starts_at = nullif(f->>'starts_at', '')::timestamptz, provider_status = coalesce(f->>'provider_status', 'NS'),
             state = coalesce(f->>'state', 'scheduled'), home_goals = nullif(f->>'home_goals', '')::int, away_goals = nullif(f->>'away_goals', '')::int,
             provider_updated_at = nullif(f->>'provider_updated_at', '')::timestamptz, last_polled_at = clock_timestamp()
       where id = v_old.id returning * into v_new;
      if (v_old.starts_at, v_old.state, v_old.home_goals, v_old.away_goals, v_old.round_label, v_old.home_team_id, v_old.away_team_id)
         is distinct from (v_new.starts_at, v_new.state, v_new.home_goals, v_new.away_goals, v_new.round_label, v_new.home_team_id, v_new.away_team_id) then
        update public.catalog_fixtures set last_changed_at = clock_timestamp() where id = v_old.id;
        v_changed := v_changed || v_old.id;
      end if;
    end if;
  end loop;
  update public.catalog_seasons set fixtures_synced_at = clock_timestamp() where id = p_season_id;
  return v_changed;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Importación al tenant (administrador del torneo). Reutiliza teams/rounds/matches/external_refs; no crea modelos paralelos.
-- ---------------------------------------------------------------------------------------------------------------
create function public.import_catalog_round(p_tournament_id uuid, p_season_id uuid, p_round_label text)
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

  -- Equipos: vínculo por external_refs; si existe un equipo manual con el mismo nombre se reutiliza (sin duplicar).
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
    if f.starts_at is null then v_tbd := v_tbd + 1; continue; end if;      -- sin fecha confirmada: no se crea partido ficticio
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

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Propagación a los tenants (solo service_role). Respeta ADR-011 (locks) y ADR-012 (revisiones idempotentes).
-- ---------------------------------------------------------------------------------------------------------------
create function public._provider_result(p_match public.matches, p_home integer, p_away integer) returns text
language plpgsql security definer set search_path = ''
as $$
declare r public.official_results;
begin
  select * into r from public.official_results where match_id = p_match.id for update;
  if not found then
    insert into public.official_results(tenant_id, match_id, home_score, away_score, revision, published_by, source)
      values (p_match.tenant_id, p_match.id, p_home, p_away, 1, null, 'provider');
    if p_match.status <> 'final' then update public.matches set status = 'final', updated_at = now() where id = p_match.id; end if;
    perform public._recalculate_match_scoring(p_match.id);
    insert into public.fixture_sync_log(tenant_id, match_id, kind, detail) values (p_match.tenant_id, p_match.id, 'result_applied', jsonb_build_object('home', p_home, 'away', p_away, 'revision', 1));
    return 'applied';
  end if;
  if (r.home_score, r.away_score) is not distinct from (p_home, p_away) then
    if p_match.status <> 'final' then update public.matches set status = 'final', updated_at = now() where id = p_match.id; end if;
    return 'unchanged';
  end if;
  if r.source = 'manual' then
    insert into public.fixture_sync_log(tenant_id, match_id, kind, detail)
      values (p_match.tenant_id, p_match.id, 'conflict_manual_result', jsonb_build_object('provider_home', p_home, 'provider_away', p_away, 'manual_home', r.home_score, 'manual_away', r.away_score));
    return 'conflict';
  end if;
  update public.official_results set home_score = p_home, away_score = p_away, revision = r.revision + 1, published_at = clock_timestamp() where id = r.id;
  perform public._recalculate_match_scoring(p_match.id);
  insert into public.fixture_sync_log(tenant_id, match_id, kind, detail)
    values (p_match.tenant_id, p_match.id, 'result_corrected', jsonb_build_object('home', p_home, 'away', p_away, 'revision', r.revision + 1, 'previous_home', r.home_score, 'previous_away', r.away_score));
  return 'corrected';
end $$;

create function public.catalog_propagate_fixtures(p_fixture_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare cf public.catalog_fixtures; m public.matches; v_ref record; c jsonb := jsonb_build_object('matches', 0, 'rescheduled', 0, 'state', 0, 'results', 0, 'corrections', 0, 'conflicts', 0, 'ignored', 0);
  v_res text; v_new_state public.match_status; v_new_pstate text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role required' using errcode = '42501'; end if;
  for cf in select * from public.catalog_fixtures where id = any (p_fixture_ids) order by id loop
    for v_ref in select er.entity_id from public.external_refs er where er.provider = cf.provider and er.entity_type = 'match' and er.external_id = cf.external_id order by er.entity_id loop
      select * into m from public.matches where id = v_ref.entity_id for update;
      if not found then continue; end if;
      c := jsonb_set(c, '{matches}', to_jsonb((c->>'matches')::int + 1));

      -- Horario: ADR-011 (adelantar bloquea ahora; un lock alcanzado no se reabre). Solo partidos aún programados.
      if cf.starts_at is not null and cf.starts_at is distinct from m.starts_at and m.status = 'scheduled' then
        perform public.apply_fixture_update(m.id, cf.starts_at, null);
        insert into public.fixture_sync_log(tenant_id, match_id, kind, detail)
          values (m.tenant_id, m.id, 'rescheduled', jsonb_build_object('from', m.starts_at, 'to', cf.starts_at));
        c := jsonb_set(c, '{rescheduled}', to_jsonb((c->>'rescheduled')::int + 1));
        select * into m from public.matches where id = m.id;
      end if;

      v_new_pstate := case when cf.state in ('postponed', 'cancelled', 'abandoned') then cf.state end;
      if v_new_pstate is distinct from m.provider_state then
        update public.matches set provider_state = v_new_pstate, updated_at = now() where id = m.id;
        insert into public.fixture_sync_log(tenant_id, match_id, kind, detail)
          values (m.tenant_id, m.id, 'state', jsonb_build_object('provider_state', v_new_pstate, 'provider_status', cf.provider_status));
        c := jsonb_set(c, '{state}', to_jsonb((c->>'state')::int + 1));
      end if;

      if cf.state = 'live' and m.status = 'scheduled' then
        perform public.apply_fixture_update(m.id, null, 'live');
      elsif cf.state = 'scheduled' and m.status <> 'scheduled' then
        insert into public.fixture_sync_log(tenant_id, match_id, kind, detail)
          values (m.tenant_id, m.id, 'ignored_regression', jsonb_build_object('provider_state', cf.state, 'local_status', m.status));
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

-- Fixtures vigentes que algún tenant usa y que conviene sondear ahora (tiers: en juego/inminente, próximas 24 h, resto, recién terminados).
create function public.catalog_fixtures_due(p_provider text, p_limit integer default 60)
returns table (external_id text, season_id uuid) language sql stable security definer set search_path = ''
as $$
  select cf.external_id, cf.season_id
    from public.catalog_fixtures cf
   where cf.provider = p_provider
     and auth.role() = 'service_role'
     and exists (select 1 from public.external_refs er where er.provider = cf.provider and er.entity_type = 'match' and er.external_id = cf.external_id)
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

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Grants (mínimo privilegio)
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function
  public.catalog_begin_import(text, text, uuid, interval, interval), public.catalog_finish_import(uuid, text, text, integer),
  public.provider_consume(text, integer, integer), public.provider_record_outcome(text, boolean, boolean),
  public.catalog_upsert_competition(text, jsonb), public.catalog_upsert_fixtures(uuid, text, jsonb),
  public.catalog_propagate_fixtures(uuid[]), public.catalog_fixtures_due(text, integer), public._provider_result(public.matches, integer, integer),
  public.tg_catalog_touch(), public.import_catalog_round(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function
  public.catalog_begin_import(text, text, uuid, interval, interval), public.catalog_finish_import(uuid, text, text, integer),
  public.provider_consume(text, integer, integer), public.provider_record_outcome(text, boolean, boolean),
  public.catalog_upsert_competition(text, jsonb), public.catalog_upsert_fixtures(uuid, text, jsonb),
  public.catalog_propagate_fixtures(uuid[]), public.catalog_fixtures_due(text, integer)
  to service_role;
grant execute on function public.import_catalog_round(uuid, uuid, text) to authenticated;

-- Auditoría de la tabla de resultados ya existente: sin cambios. Las importaciones quedan en audit_log (sports.round_imported).
