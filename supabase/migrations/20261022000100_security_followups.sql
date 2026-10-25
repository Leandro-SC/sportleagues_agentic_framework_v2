-- Seguimiento de seguridad (agente Security, 2026-10-12). PROPUESTA: no aplicada. Forward-only; reversión en down/20261022000100_security_followups.down.sql.
-- Informe: reports/security/security-review-20261012.md. Cambia SOLO lo indicado; no toca locks de pronósticos, scoring, tickets ni H1–H6.
--
--  F-01 (baja)  Autorizar ANTES de bloquear filas en las RPC de catálogo/resultados/pago y unificar el error (sin oráculo de existencia).
--  F-02 (baja)  `updated_at` del catálogo solo cambia cuando cambian datos relevantes (no en cada sondeo); `fixtures_synced_at` deja de ser legible.
--  F-03 (baja)  Retención de `fixture_sync_log`: `purge_fixture_sync_log` (solo service_role, con dry-run) + registro append-only `maintenance_runs`
--               + deduplicación de entradas repetitivas. Los conflictos con resultados manuales se conservan ≥ 365 días.
--  F-04 (media) Finanzas privadas: `participants` (incluye `payment_status`) solo es legible por el propio participante, administradores del tenant
--               y personal de ESA quiniela con capacidad `finance`; antes cualquier miembro del tenant leía los pagos de todos. anon sin SELECT.
--
-- AGENTS.md §12: F-04 cambia autorización de lectura (reduce, no amplía). Requiere aprobación humana y una nota en ADR-014/ADR-015 antes de aplicar.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------------------------------------------
-- F-01. Autorización antes del bloqueo; «no existe» y «no autorizado» son indistinguibles (42501 'not authorized').
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.import_catalog_round(p_tournament_id uuid, p_season_id uuid, p_round_label text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid; v_provider text; v_round uuid; v_sort integer; v_label text; v_n integer;
  f record; v_team uuid; v_match uuid; v_teams integer := 0; v_teams_new integer := 0; v_matches integer := 0; v_existing integer := 0; v_tbd integer := 0;
  v_home uuid; v_away uuid; t record;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select tenant_id into v_tenant from public.tournaments where id = p_tournament_id;                 -- lectura sin bloqueo
  if v_tenant is null or not public.is_tenant_admin(v_tenant) then raise exception 'not authorized' using errcode = '42501'; end if;
  perform 1 from public.tournaments where id = p_tournament_id and tenant_id = v_tenant for update;   -- el bloqueo solo tras autorizar
  if not found then raise exception 'tournament not found' using errcode = '22023'; end if;
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

create or replace function public.import_catalog_teams(p_tournament_id uuid, p_team_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid; ct public.catalog_teams; v_team uuid; v_new integer := 0; v_existing integer := 0; v_before integer;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select tenant_id into v_tenant from public.tournaments where id = p_tournament_id;                 -- lectura sin bloqueo
  if v_tenant is null or not public.is_tenant_admin(v_tenant) then raise exception 'not authorized' using errcode = '42501'; end if;
  perform 1 from public.tournaments where id = p_tournament_id and tenant_id = v_tenant for update;   -- el bloqueo solo tras autorizar
  if not found then raise exception 'tournament not found' using errcode = '22023'; end if;
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

create or replace function public.set_tournament_results_mode(p_tournament_id uuid, p_mode text) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_mode not in ('manual', 'automatic') then raise exception 'invalid results mode' using errcode = '22023'; end if;
  select tenant_id into v_tenant from public.tournaments where id = p_tournament_id;                 -- lectura sin bloqueo
  if v_tenant is null or not public.is_tenant_admin(v_tenant) then raise exception 'not authorized' using errcode = '42501'; end if;
  perform 1 from public.tournaments where id = p_tournament_id and tenant_id = v_tenant for update;   -- el bloqueo solo tras autorizar
  if not found then raise exception 'tournament not found' using errcode = '22023'; end if;
  if p_mode = 'automatic' and not public._auto_results_allowed(v_tenant) then
    raise exception 'automatic results require a premium plan that is not available yet' using errcode = '42501';
  end if;
  update public.tournaments set results_mode = p_mode, updated_at = now() where id = p_tournament_id;
  return p_mode;
end $$;

create or replace function public.publish_official_result(p_match_id uuid, p_home_score integer, p_away_score integer, p_expected_revision integer)
returns public.official_results language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_tenant uuid; m public.matches; r public.official_results;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_home_score is null or p_away_score is null or p_home_score < 0 or p_away_score < 0 then
    raise exception 'scores must be non-negative' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then raise exception 'expected revision is required' using errcode = '22023'; end if;
  select tenant_id into v_tenant from public.matches where id = p_match_id;                           -- lectura sin bloqueo
  if v_tenant is null or not public.is_tenant_admin(v_tenant) then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into m from public.matches where id = p_match_id and tenant_id = v_tenant for update;      -- el bloqueo solo tras autorizar
  if not found then raise exception 'match not found' using errcode = '22023'; end if;
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

-- Finanzas: el estado de pago es privado del administrador. Misma regla (autorizar, luego bloquear) y mismo error para «no existe» y «no es tuyo».
create or replace function public.set_participant_payment_status(p_participant_id uuid, p_status public.participant_payment_status)
returns public.participants language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid; v_participant public.participants;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select tenant_id into v_tenant from public.participants where id = p_participant_id;               -- lectura sin bloqueo
  if v_tenant is null or not public.is_tenant_admin(v_tenant) then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into v_participant from public.participants where id = p_participant_id and tenant_id = v_tenant for update;
  if not found then raise exception 'participant not found' using errcode = '22023'; end if;
  update public.participants set payment_status = p_status, updated_at = now() where id = p_participant_id returning * into v_participant;
  return v_participant;
end $$;

create or replace function public.approve_participant(p_participant_id uuid) returns public.participants
language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid; v_participant public.participants;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select tenant_id into v_tenant from public.participants where id = p_participant_id;               -- lectura sin bloqueo
  if v_tenant is null or not public.is_tenant_admin(v_tenant) then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into v_participant from public.participants where id = p_participant_id and tenant_id = v_tenant for update;
  if not found then raise exception 'participant not found' using errcode = '22023'; end if;
  update public.participants set approval_status = 'approved', updated_at = now() where id = p_participant_id returning * into v_participant;
  return v_participant;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- F-02. `updated_at` del catálogo: solo avanza si cambia un dato relevante (no por last_polled_at / last_changed_at / fixtures_synced_at).
-- ---------------------------------------------------------------------------------------------------------------
create function public.tg_catalog_touch_relevant() returns trigger language plpgsql set search_path = ''
as $$
begin
  -- TG_ARGV: columnas operativas que NO cuentan como cambio de contenido.
  if (to_jsonb(new) - 'updated_at' - tg_argv) is not distinct from (to_jsonb(old) - 'updated_at' - tg_argv) then
    new.updated_at := old.updated_at;
  else
    new.updated_at := clock_timestamp();
  end if;
  return new;
end $$;
revoke all on function public.tg_catalog_touch_relevant() from public, anon, authenticated;

drop trigger if exists catalog_fixtures_touch on public.catalog_fixtures;
create trigger catalog_fixtures_touch before update on public.catalog_fixtures
  for each row execute function public.tg_catalog_touch_relevant('last_polled_at', 'last_changed_at');
drop trigger if exists catalog_seasons_touch on public.catalog_seasons;
create trigger catalog_seasons_touch before update on public.catalog_seasons
  for each row execute function public.tg_catalog_touch_relevant('fixtures_synced_at');

-- La cadencia de sondeo de una temporada (qué partidos sigue algún tenant) tampoco es información del cliente: sin lectura de la columna operativa.
revoke select on public.catalog_seasons from authenticated;
grant select (id, competition_id, year, starts_on, ends_on, is_current, created_at, updated_at) on public.catalog_seasons to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- F-03. Retención de fixture_sync_log
-- ---------------------------------------------------------------------------------------------------------------
create index fixture_sync_log_created_idx on public.fixture_sync_log (created_at);

-- Registro de mantenimiento: append-only (sin UPDATE/DELETE/TRUNCATE, como audit_log), RLS activa sin políticas y SIN grants a anon/authenticated.
-- Solo guarda parámetros técnicos (sin PII). Cada ejecución de una tarea de mantenimiento, también la de prueba (dry_run), inserta una fila.
create table public.maintenance_runs (
  id uuid primary key default gen_random_uuid(),
  task text not null check (char_length(task) between 1 and 80),
  dry_run boolean not null,
  params jsonb not null default '{}'::jsonb,
  affected integer not null default 0 check (affected >= 0),
  error text check (char_length(error) <= 40),          -- SQLSTATE si la tarea falló; null si terminó bien
  ran_at timestamptz not null default clock_timestamp()
);
create index maintenance_runs_task_idx on public.maintenance_runs (task, ran_at desc);
alter table public.maintenance_runs enable row level security;
revoke all on public.maintenance_runs from anon, authenticated;
create trigger maintenance_runs_no_update_delete before update or delete on public.maintenance_runs
  for each row execute function public.tg_append_only();
create trigger maintenance_runs_no_truncate before truncate on public.maintenance_runs
  for each statement execute function public.tg_append_only();

-- POLÍTICA DE RETENCIÓN DE fixture_sync_log (exacta):
--   · Se BORRA una fila si created_at < now() - p_keep (por defecto 180 días; mínimo exigible 30) y NO es de tipo 'conflict_manual_result'.
--   · Las filas 'conflict_manual_result' (el proveedor discrepó de un resultado manual: evidencia de auditoría/incidentes) se borran SOLO si
--     created_at < now() - greatest(p_keep, p_keep_conflicts), con p_keep_conflicts por defecto 365 días y mínimo exigible 365.
--   · Se procesa un lote por llamada (p_max_rows, 1..100000, por defecto 10000, de las más antiguas); repetir hasta que `deleted` sea 0.
--   · p_dry_run = true cuenta lo que se borraría (hasta el tamaño del lote) y NO borra.
--   · Solo service_role. La guarda y la validación de parámetros LANZAN (42501 / 22023). Un fallo interno se captura: se registra la fila en
--     maintenance_runs con el SQLSTATE y se devuelve {ok:false, error:'<sqlstate>'} (relanzarlo revertiría el propio registro).
--   · No se programa aquí: la ejecución periódica requiere autorización aparte.
drop function if exists public.purge_fixture_sync_log(interval, integer);
create function public.purge_fixture_sync_log(p_keep interval default interval '180 days', p_max_rows integer default 10000,
  p_dry_run boolean default false, p_keep_conflicts interval default interval '365 days')
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_n integer := 0; v_cutoff timestamptz; v_conflict_cutoff timestamptz; v_params jsonb; v_state text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role required' using errcode = '42501'; end if;
  if p_keep is null or p_keep < interval '30 days' then raise exception 'retention must be at least 30 days' using errcode = '22023'; end if;
  if p_keep_conflicts is null or p_keep_conflicts < interval '365 days' then raise exception 'conflict retention must be at least 365 days' using errcode = '22023'; end if;
  if p_max_rows is null or p_max_rows < 1 or p_max_rows > 100000 then raise exception 'invalid batch size' using errcode = '22023'; end if;
  if p_dry_run is null then raise exception 'dry run flag is required' using errcode = '22023'; end if;
  v_cutoff := clock_timestamp() - p_keep;
  v_conflict_cutoff := clock_timestamp() - greatest(p_keep, p_keep_conflicts);
  v_params := jsonb_build_object('keep_days', extract(day from p_keep)::int, 'conflict_keep_days', extract(day from greatest(p_keep, p_keep_conflicts))::int, 'max_rows', p_max_rows);
  begin
    if p_dry_run then
      select count(*) into v_n from (
        select 1 from public.fixture_sync_log
         where created_at < v_cutoff and (kind <> 'conflict_manual_result' or created_at < v_conflict_cutoff)
         order by created_at limit p_max_rows) x;
    else
      with doomed as (
        select id from public.fixture_sync_log
         where created_at < v_cutoff and (kind <> 'conflict_manual_result' or created_at < v_conflict_cutoff)
         order by created_at limit p_max_rows for update skip locked)
      delete from public.fixture_sync_log l using doomed d where l.id = d.id;
      get diagnostics v_n = row_count;
    end if;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    insert into public.maintenance_runs(task, dry_run, params, affected, error) values ('purge_fixture_sync_log', p_dry_run, v_params, 0, v_state);
    return jsonb_build_object('ok', false, 'error', v_state);
  end;
  insert into public.maintenance_runs(task, dry_run, params, affected) values ('purge_fixture_sync_log', p_dry_run, v_params, v_n);
  return jsonb_build_object('ok', true, 'dry_run', p_dry_run, case when p_dry_run then 'would_delete' else 'deleted' end, v_n,
                            'cutoff', v_cutoff, 'kept_days', (v_params->>'keep_days')::int, 'conflict_kept_days', (v_params->>'conflict_keep_days')::int, 'batch', p_max_rows);
end $$;
revoke all on function public.purge_fixture_sync_log(interval, integer, boolean, interval) from public, anon, authenticated;
grant execute on function public.purge_fixture_sync_log(interval, integer, boolean, interval) to service_role;

-- Las entradas que el sondeo repite en cada ciclo (`ignored_regression`, `conflict_manual_result`) no se duplican dentro de 24 h con el mismo detalle.
create function public.tg_fixture_sync_log_dedupe() returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.kind in ('ignored_regression', 'conflict_manual_result') and exists (
       select 1 from public.fixture_sync_log l
        where l.tenant_id = new.tenant_id and l.match_id = new.match_id and l.kind = new.kind and l.detail = new.detail
          and l.created_at > new.created_at - interval '24 hours') then
    return null;
  end if;
  return new;
end $$;
revoke all on function public.tg_fixture_sync_log_dedupe() from public, anon, authenticated;
create trigger fixture_sync_log_dedupe before insert on public.fixture_sync_log
  for each row execute function public.tg_fixture_sync_log_dedupe();

-- ---------------------------------------------------------------------------------------------------------------
-- F-04. Finanzas privadas: lectura de participants (payment_status) acotada. Escrituras ya solo por RPC (sin I/U/D para clientes).
-- ---------------------------------------------------------------------------------------------------------------
drop policy if exists participants_select_member on public.participants;
create policy participants_select_scoped on public.participants for select to authenticated using (
  profile_id = auth.uid()
  or public.is_tenant_admin(tenant_id)
  or public.has_pool_capability(pool_id, 'finance'::public.pool_capability));   -- ADR-014 D8: finanzas = capacidad `finance` de ESA quiniela

revoke select on public.participants, public.audit_log from anon;
