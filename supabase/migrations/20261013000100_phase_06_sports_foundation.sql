-- Fase 06: base deportiva (ADR-009, ADR-010, ADR-011, ADR-012, ADR-015). Forward-only.
-- Catálogo de deportes, torneos/equipos con metadatos, inscripción equipo-torneo, referencias externas para futuras APIs,
-- escritura de calendario SOLO mediante RPC (sin DML directo de clientes) y publicación de resultados revisable e idempotente.
-- No toca el lock persistido ni las guardas de la migración 20261012000100: las RPC se apoyan en ellas.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Metadatos (ADR-009). Ningún campo se usa como autorización.
-- ---------------------------------------------------------------------------------------------------------------
create table public.sports (
  code text primary key check (code ~ '^[a-z][a-z_]{1,29}$'),
  name text not null check (char_length(name) between 1 and 60)
);
insert into public.sports(code, name) values
  ('football', 'Fútbol'), ('futsal', 'Futsal'), ('basketball', 'Baloncesto'), ('volleyball', 'Vóley'),
  ('baseball', 'Béisbol'), ('tennis', 'Tenis'), ('other', 'Otro');
alter table public.sports enable row level security;
create policy sports_select on public.sports for select to authenticated using (true);
revoke all on public.sports from anon, authenticated;
grant select on public.sports to authenticated;

alter table public.tournaments
  add column sport_code text not null default 'football' references public.sports(code),
  add column country_code text check (country_code ~ '^[A-Z]{2}$'),
  add column season_label text check (char_length(season_label) between 1 and 40),
  add column color text check (color ~ '^#[0-9A-Fa-f]{6}$');
create unique index tournaments_tenant_name_season_key on public.tournaments (tenant_id, lower(name), coalesce(season_label, ''));

alter table public.teams
  add column short_name text check (char_length(short_name) between 1 and 12),
  add column country_code text check (country_code ~ '^[A-Z]{2}$'),
  add column primary_color text check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  add column secondary_color text check (secondary_color ~ '^#[0-9A-Fa-f]{6}$');
comment on column public.teams.crest_asset_path is 'DEPRECATED (ADR-009): sin bucket, lifecycle ni licencia; la UI usa escudo generado por iniciales y colores. No exponer.';

-- Inscripción equipo-torneo: un equipo se reutiliza en varios torneos y los dos equipos de un partido deben estar inscritos.
create table public.tournament_teams (
  tenant_id uuid not null,
  tournament_id uuid not null,
  team_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tournament_id, team_id),
  foreign key (tournament_id, tenant_id) references public.tournaments(id, tenant_id) on delete restrict,
  foreign key (team_id, tenant_id) references public.teams(id, tenant_id) on delete restrict
);
create index tournament_teams_team_idx on public.tournament_teams (team_id);
insert into public.tournament_teams (tenant_id, tournament_id, team_id)
  select tenant_id, tournament_id, home_team_id from public.matches
  union select tenant_id, tournament_id, away_team_id from public.matches
  on conflict do nothing;

-- Referencias externas (compatibilidad con APIs deportivas): proveedor + id externo ↔ entidad interna, por tenant.
create type public.external_entity as enum ('tournament', 'team', 'match');
create table public.external_refs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  provider text not null check (provider ~ '^[a-z][a-z0-9_]{1,39}$'),
  entity_type public.external_entity not null,
  entity_id uuid not null,
  external_id text not null check (char_length(external_id) between 1 and 120),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, provider, entity_type, external_id),
  unique (tenant_id, provider, entity_type, entity_id)
);
create index external_refs_entity_idx on public.external_refs (tenant_id, entity_type, entity_id);

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Coherencia: equipos inscritos y ronda del mismo torneo (aplica también a service_role y propietario)
-- ---------------------------------------------------------------------------------------------------------------
create function public.tg_matches_enrolment_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.rounds r where r.id = new.round_id and r.tenant_id = new.tenant_id and r.tournament_id = new.tournament_id) then
    raise exception 'round does not belong to the tournament' using errcode = '23503';
  end if;
  if (select count(*) from public.tournament_teams tt
       where tt.tournament_id = new.tournament_id and tt.tenant_id = new.tenant_id
         and tt.team_id in (new.home_team_id, new.away_team_id)) <> 2 then
    raise exception 'both teams must be enrolled in the tournament' using errcode = '23503';
  end if;
  return new;
end $$;
create trigger matches_enrolment_guard before insert or update of tournament_id, round_id, home_team_id, away_team_id on public.matches
  for each row execute function public.tg_matches_enrolment_guard();

create function public.tg_tournament_teams_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'tournament enrolment is immutable; remove and enrol again' using errcode = '42501';
  end if;
  if exists (select 1 from public.matches m where m.tournament_id = old.tournament_id and old.team_id in (m.home_team_id, m.away_team_id)) then
    raise exception 'a team with matches cannot be removed from the tournament' using errcode = '23503';
  end if;
  return old;
end $$;
create trigger tournament_teams_guard before update or delete on public.tournament_teams
  for each row execute function public.tg_tournament_teams_guard();

create function public.tg_external_refs_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_ok boolean;
begin
  if tg_op = 'UPDATE' and (new.tenant_id is distinct from old.tenant_id or new.entity_type is distinct from old.entity_type
                           or new.entity_id is distinct from old.entity_id or new.provider is distinct from old.provider) then
    raise exception 'external reference identity is immutable' using errcode = '42501';
  end if;
  if new.entity_type = 'tournament' then
    v_ok := exists (select 1 from public.tournaments x where x.id = new.entity_id and x.tenant_id = new.tenant_id);
  elsif new.entity_type = 'team' then
    v_ok := exists (select 1 from public.teams x where x.id = new.entity_id and x.tenant_id = new.tenant_id);
  else
    v_ok := exists (select 1 from public.matches x where x.id = new.entity_id and x.tenant_id = new.tenant_id);
  end if;
  if not v_ok then
    raise exception 'entity does not belong to the tenant' using errcode = '23503';
  end if;
  return new;
end $$;
create trigger external_refs_guard before insert or update on public.external_refs
  for each row execute function public.tg_external_refs_guard();

revoke all on function public.tg_matches_enrolment_guard(), public.tg_tournament_teams_guard(), public.tg_external_refs_guard()
  from public, anon, authenticated;

-- Auditoría (lista blanca de columnas, ADR-015 R4)
drop trigger if exists audit_tournaments on public.tournaments;
create trigger audit_tournaments after insert or update or delete on public.tournaments
  for each row execute function public.tg_audit_row_change('name,sport_code,country_code,season_label,color');
create trigger audit_teams after insert or update or delete on public.teams
  for each row execute function public.tg_audit_row_change('name,short_name,country_code,primary_color,secondary_color');
create trigger audit_tournament_teams after insert or delete on public.tournament_teams
  for each row execute function public.tg_audit_row_change('tournament_id,team_id');
create trigger audit_external_refs after insert or update or delete on public.external_refs
  for each row execute function public.tg_audit_row_change('provider,entity_type,entity_id,external_id');

-- ---------------------------------------------------------------------------------------------------------------
-- 3. RLS y privilegios: lectura para miembros; toda escritura de calendario/catálogo pasa por RPC (ADR-011)
-- ---------------------------------------------------------------------------------------------------------------
alter table public.tournament_teams enable row level security;
create policy tournament_teams_select_member on public.tournament_teams for select to authenticated using (public.is_tenant_member(tenant_id));
alter table public.external_refs enable row level security;
create policy external_refs_select_admin on public.external_refs for select to authenticated using (public.is_tenant_admin(tenant_id));

drop policy if exists schedule_admin_write on public.tournaments;
drop policy if exists teams_admin_write on public.teams;
drop policy if exists rounds_admin_write on public.rounds;
drop policy if exists matches_admin_write on public.matches;
drop policy if exists pool_matches_admin_write on public.pool_matches;
revoke insert, update, delete, truncate, references, trigger on public.tournaments, public.teams, public.rounds from anon, authenticated;
revoke all on public.tournament_teams, public.external_refs from anon, authenticated;
grant select on public.tournament_teams, public.external_refs to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. RPC de catálogo y calendario (tenant derivado de la entidad; autorización = owner/admin activo del tenant)
-- ---------------------------------------------------------------------------------------------------------------
create function public.upsert_tournament(p_tenant_id uuid, p_tournament_id uuid, p_name text, p_sport_code text default 'football',
  p_country_code text default null, p_season_label text default null, p_color text default null)
returns public.tournaments language plpgsql security definer set search_path = ''
as $$
declare v_row public.tournaments;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_tournament_id is not null then
    select tenant_id into p_tenant_id from public.tournaments where id = p_tournament_id for update;
    if p_tenant_id is null then raise exception 'tournament not found' using errcode = '22023'; end if;
  end if;
  if p_tenant_id is null or not public.is_tenant_admin(p_tenant_id) then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_tournament_id is null then
    insert into public.tournaments(tenant_id, name, sport_code, country_code, season_label, color)
      values (p_tenant_id, btrim(p_name), coalesce(p_sport_code, 'football'), p_country_code, nullif(btrim(p_season_label), ''), p_color)
      returning * into v_row;
  else
    update public.tournaments set name = btrim(p_name), sport_code = coalesce(p_sport_code, sport_code), country_code = p_country_code,
           season_label = nullif(btrim(p_season_label), ''), color = p_color, updated_at = now()
     where id = p_tournament_id returning * into v_row;
  end if;
  return v_row;
end $$;

create function public.upsert_team(p_tenant_id uuid, p_team_id uuid, p_name text, p_short_name text default null,
  p_country_code text default null, p_primary_color text default null, p_secondary_color text default null)
returns public.teams language plpgsql security definer set search_path = ''
as $$
declare v_row public.teams;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_team_id is not null then
    select tenant_id into p_tenant_id from public.teams where id = p_team_id for update;
    if p_tenant_id is null then raise exception 'team not found' using errcode = '22023'; end if;
  end if;
  if p_tenant_id is null or not public.is_tenant_admin(p_tenant_id) then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_team_id is null then
    insert into public.teams(tenant_id, name, short_name, country_code, primary_color, secondary_color)
      values (p_tenant_id, btrim(p_name), nullif(btrim(p_short_name), ''), p_country_code, p_primary_color, p_secondary_color)
      returning * into v_row;
  else
    update public.teams set name = btrim(p_name), short_name = nullif(btrim(p_short_name), ''), country_code = p_country_code,
           primary_color = p_primary_color, secondary_color = p_secondary_color, updated_at = now()
     where id = p_team_id returning * into v_row;
  end if;
  return v_row;
end $$;

create function public.set_tournament_team(p_tournament_id uuid, p_team_id uuid, p_enrolled boolean)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select tenant_id into v_tenant from public.tournaments where id = p_tournament_id for share;
  if v_tenant is null then raise exception 'tournament not found' using errcode = '22023'; end if;
  if not public.is_tenant_admin(v_tenant) then raise exception 'not authorized' using errcode = '42501'; end if;
  if not exists (select 1 from public.teams where id = p_team_id and tenant_id = v_tenant) then
    raise exception 'team not found' using errcode = '22023';
  end if;
  if p_enrolled then
    insert into public.tournament_teams(tenant_id, tournament_id, team_id) values (v_tenant, p_tournament_id, p_team_id) on conflict do nothing;
  else
    delete from public.tournament_teams where tournament_id = p_tournament_id and team_id = p_team_id;
  end if;
  return p_enrolled;
end $$;

create function public.upsert_round(p_tournament_id uuid, p_round_id uuid, p_name text, p_sort_order integer)
returns public.rounds language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid; v_row public.rounds;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select tenant_id into v_tenant from public.tournaments where id = p_tournament_id for share;
  if v_tenant is null then raise exception 'tournament not found' using errcode = '22023'; end if;
  if not public.is_tenant_admin(v_tenant) then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_round_id is null then
    insert into public.rounds(tenant_id, tournament_id, name, sort_order)
      values (v_tenant, p_tournament_id, btrim(p_name), p_sort_order) returning * into v_row;
  else
    update public.rounds set name = btrim(p_name), sort_order = p_sort_order, updated_at = now()
     where id = p_round_id and tournament_id = p_tournament_id and tenant_id = v_tenant returning * into v_row;
    if not found then raise exception 'round not found' using errcode = '22023'; end if;
  end if;
  return v_row;
end $$;

create function public.reorder_rounds(p_tournament_id uuid, p_round_ids uuid[])
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid; v_count integer;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select tenant_id into v_tenant from public.tournaments where id = p_tournament_id for share;
  if v_tenant is null then raise exception 'tournament not found' using errcode = '22023'; end if;
  if not public.is_tenant_admin(v_tenant) then raise exception 'not authorized' using errcode = '42501'; end if;
  select count(*) into v_count from public.rounds where tournament_id = p_tournament_id;
  if coalesce(array_length(p_round_ids, 1), 0) <> v_count
     or (select count(distinct x) from unnest(p_round_ids) x) <> v_count
     or exists (select 1 from unnest(p_round_ids) x where not exists (select 1 from public.rounds r where r.id = x and r.tournament_id = p_tournament_id)) then
    raise exception 'the list must contain every round of the tournament exactly once' using errcode = '22023';
  end if;
  update public.rounds set sort_order = sort_order + 1000000 where tournament_id = p_tournament_id;   -- evita colisiones del índice único
  update public.rounds r set sort_order = o.ord - 1, updated_at = now()
    from unnest(p_round_ids) with ordinality as o(id, ord) where r.id = o.id;
  return v_count;
end $$;

create function public.upsert_match(p_tournament_id uuid, p_match_id uuid, p_round_id uuid, p_home_team_id uuid, p_away_team_id uuid, p_starts_at timestamptz)
returns public.matches language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid; v_old public.matches; v_row public.matches;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select tenant_id into v_tenant from public.tournaments where id = p_tournament_id for share;
  if v_tenant is null then raise exception 'tournament not found' using errcode = '22023'; end if;
  if not public.is_tenant_admin(v_tenant) then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_starts_at is null then raise exception 'starts_at is required' using errcode = '22023'; end if;
  if p_home_team_id = p_away_team_id then raise exception 'a team cannot play itself' using errcode = '23514'; end if;
  if p_match_id is null then
    insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at)
      values (v_tenant, p_tournament_id, p_round_id, p_home_team_id, p_away_team_id, p_starts_at) returning * into v_row;
    return v_row;
  end if;
  select * into v_old from public.matches where id = p_match_id and tournament_id = p_tournament_id and tenant_id = v_tenant for update;
  if not found then raise exception 'match not found' using errcode = '22023'; end if;
  if v_old.status <> 'scheduled' then raise exception 'only scheduled matches can be edited' using errcode = '42501'; end if;
  if p_starts_at is distinct from v_old.starts_at
     and exists (select 1 from public.pool_matches pm where pm.match_id = p_match_id and pm.lock_at <= clock_timestamp()) then
    raise exception 'schedule is frozen: a pool lock has been reached' using errcode = '42501';   -- ADR-011 §3
  end if;
  update public.matches set round_id = p_round_id, home_team_id = p_home_team_id, away_team_id = p_away_team_id,
         starts_at = p_starts_at, updated_at = now()
   where id = p_match_id returning * into v_row;
  return v_row;
end $$;

create function public.delete_match(p_match_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select tenant_id into v_tenant from public.matches where id = p_match_id for update;
  if v_tenant is null then raise exception 'match not found' using errcode = '22023'; end if;
  if not public.is_tenant_admin(v_tenant) then raise exception 'not authorized' using errcode = '42501'; end if;
  delete from public.matches where id = p_match_id;   -- tg_matches_guard_delete bloquea partidos usados por quinielas o con resultado
  return true;
end $$;

create function public.set_pool_match(p_pool_id uuid, p_match_id uuid, p_included boolean)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid; v_status public.pool_status; v_offset interval; m public.matches;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select tenant_id, status, lock_offset into v_tenant, v_status, v_offset from public.pools where id = p_pool_id for share;
  if v_tenant is null then raise exception 'pool not found' using errcode = '22023'; end if;
  if not public.is_tenant_admin(v_tenant) then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into m from public.matches where id = p_match_id and tenant_id = v_tenant for share;
  if not found then raise exception 'match not found' using errcode = '22023'; end if;
  if p_included then
    if v_status = 'archived' then raise exception 'an archived pool cannot change its fixture' using errcode = '42501'; end if;
    if m.status <> 'scheduled' or m.starts_at - v_offset <= clock_timestamp() then
      raise exception 'the lock of this match has already been reached' using errcode = '42501';
    end if;
    insert into public.pool_matches(tenant_id, pool_id, match_id) values (v_tenant, p_pool_id, p_match_id) on conflict (pool_id, match_id) do nothing;
  else
    delete from public.pool_matches where pool_id = p_pool_id and match_id = p_match_id;   -- guardas de 20261012000100
  end if;
  return p_included;
end $$;

create function public.set_external_ref(p_tenant_id uuid, p_provider text, p_entity_type public.external_entity, p_entity_id uuid, p_external_id text)
returns public.external_refs language plpgsql security definer set search_path = ''
as $$
declare v_row public.external_refs;
begin
  if auth.role() is distinct from 'service_role' then
    if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
    if p_tenant_id is null or not public.is_tenant_admin(p_tenant_id) then raise exception 'not authorized' using errcode = '42501'; end if;
  end if;
  insert into public.external_refs(tenant_id, provider, entity_type, entity_id, external_id, last_synced_at)
    values (p_tenant_id, lower(p_provider), p_entity_type, p_entity_id, p_external_id, case when auth.role() = 'service_role' then clock_timestamp() end)
  on conflict (tenant_id, provider, entity_type, entity_id) do update
     set external_id = excluded.external_id, last_synced_at = coalesce(excluded.last_synced_at, public.external_refs.last_synced_at)
  returning * into v_row;
  return v_row;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Resultado oficial revisable y recálculo idempotente (ADR-012)
-- ---------------------------------------------------------------------------------------------------------------
create function public._recalculate_match_scoring(p_match_id uuid) returns integer
language plpgsql security definer set search_path = ''
as $$
declare r public.official_results; v_inserted integer;
begin
  select * into r from public.official_results where match_id = p_match_id;
  if not found then return 0; end if;
  -- Clave única (predicción, revisión, versión de regla): repetir el recálculo nunca duplica puntos. El historial de revisiones
  -- anteriores se conserva; la lectura (Fase 08) toma la revisión/versión más reciente por predicción.
  insert into public.scoring_events(tenant_id, prediction_id, result_revision, rule_version, points)
  select pr.tenant_id, pr.id, r.revision, ru.version,
         case when pr.home_score = r.home_score and pr.away_score = r.away_score then ru.exact_points
              when sign(pr.home_score - pr.away_score) = sign(r.home_score - r.away_score) then ru.outcome_points
              else 0 end
    from public.pool_matches pm
    join public.predictions pr on pr.pool_match_id = pm.id and pr.tenant_id = pm.tenant_id
    join public.pool_rules ru on ru.pool_id = pm.pool_id and ru.tenant_id = pm.tenant_id and ru.is_current
   where pm.match_id = p_match_id
  on conflict (prediction_id, result_revision, rule_version) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end $$;
revoke all on function public._recalculate_match_scoring(uuid) from public, anon, authenticated;

create function public.publish_official_result(p_match_id uuid, p_home_score integer, p_away_score integer, p_expected_revision integer)
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
    if p_expected_revision <> 0 then raise exception 'revision conflict' using errcode = '40001'; end if;
    if m.starts_at > clock_timestamp() then raise exception 'the match has not started' using errcode = '22023'; end if;
    insert into public.official_results(tenant_id, match_id, home_score, away_score, revision, published_by)
      values (m.tenant_id, m.id, p_home_score, p_away_score, 1, v_uid) returning * into r;
  else
    if p_expected_revision <> r.revision then raise exception 'revision conflict' using errcode = '40001'; end if;
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

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Grants de las RPC (mínimo privilegio; cada una autoriza internamente además)
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function
  public.upsert_tournament(uuid, uuid, text, text, text, text, text),
  public.upsert_team(uuid, uuid, text, text, text, text, text),
  public.set_tournament_team(uuid, uuid, boolean),
  public.upsert_round(uuid, uuid, text, integer),
  public.reorder_rounds(uuid, uuid[]),
  public.upsert_match(uuid, uuid, uuid, uuid, uuid, timestamptz),
  public.delete_match(uuid),
  public.set_pool_match(uuid, uuid, boolean),
  public.set_external_ref(uuid, text, public.external_entity, uuid, text),
  public.publish_official_result(uuid, integer, integer, integer)
  from public, anon;
grant execute on function
  public.upsert_tournament(uuid, uuid, text, text, text, text, text),
  public.upsert_team(uuid, uuid, text, text, text, text, text),
  public.set_tournament_team(uuid, uuid, boolean),
  public.upsert_round(uuid, uuid, text, integer),
  public.reorder_rounds(uuid, uuid[]),
  public.upsert_match(uuid, uuid, uuid, uuid, uuid, timestamptz),
  public.delete_match(uuid),
  public.set_pool_match(uuid, uuid, boolean),
  public.set_external_ref(uuid, text, public.external_entity, uuid, text),
  public.publish_official_result(uuid, integer, integer, integer)
  to authenticated;
grant execute on function public.set_external_ref(uuid, text, public.external_entity, uuid, text) to service_role;
