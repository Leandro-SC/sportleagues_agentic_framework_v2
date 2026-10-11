-- PROPUESTA — NO APLICADA. Ver ADR-015 y docs/operations/CLOUD-ONLY-TESTING-POLICY.md.
-- Orden: 1/3 (H1, H2, H8). Forward-only. Solo para un proyecto Supabase Cloud DESCARTABLE hasta ser validada (clase C);
-- mover a supabase/migrations/ únicamente tras aprobación explícita. No usa datos ni secretos.
--
-- Qué corrige:
--   H1  El lock deja de ser una expresión mutable (starts_at - lock_offset): se persiste en pool_matches.lock_at y,
--       una vez alcanzado, es inmutable. Editar horarios, offset o estados ya no puede reabrir ni adelantar el lock.
--   H2  Borrados destructivos (cascada) de partidos, vínculos, participantes, predicciones y resultados quedan bloqueados.
--   H8  Identidad inmutable (tenant/pool/match/participante) y coherencia de relaciones.
--   Compat. con sincronización deportiva legítima: matches.status solo avanza (scheduled→live→final); un partido que pasa a
--   live/final bloquea sus pools; un cambio de horario sobre un lock ya alcanzado no lo reabre; el sincronizador
--   (service_role) puede adelantar un lock mediante la bandera de transacción sl.fixture_sync.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Columnas aditivas y relleno
-- ---------------------------------------------------------------------------------------------------------------
alter table public.pools add column opened_at timestamptz;
update public.pools set opened_at = created_at where status <> 'draft' and opened_at is null;

alter table public.pool_matches add column lock_at timestamptz;
update public.pool_matches pm
   set lock_at = m.starts_at - p.lock_offset
  from public.matches m, public.pools p
 where m.id = pm.match_id and m.tenant_id = pm.tenant_id
   and p.id = pm.pool_id and p.tenant_id = pm.tenant_id;
alter table public.pool_matches alter column lock_at set not null;
create index pool_matches_pool_lock_idx on public.pool_matches (pool_id, lock_at);
create index pool_matches_match_id_idx on public.pool_matches (match_id);
create index predictions_pool_match_id_idx on public.predictions (pool_match_id);

alter table public.participants add column withdrawn_at timestamptz;
alter table public.participants add column withdrawn_by uuid;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Ayudas internas (sin EXECUTE para clientes; las usan triggers SECURITY DEFINER del propietario)
-- ---------------------------------------------------------------------------------------------------------------
create function public._lock_maint_on() returns boolean
language sql stable set search_path = ''
as $$ select coalesce(current_setting('sl.lock_maint', true), 'off') = 'on' $$;

create function public._fixture_sync_on() returns boolean
language sql stable set search_path = ''
as $$ select coalesce(current_setting('sl.fixture_sync', true), 'off') = 'on' $$;

create function public._first_lock_passed(p_pool_id uuid) returns boolean
language sql security definer set search_path = ''   -- VOLATILE a propósito: usa clock_timestamp()
as $$ select exists (select 1 from public.pool_matches pm where pm.pool_id = p_pool_id and pm.lock_at <= clock_timestamp()) $$;

revoke all on function public._lock_maint_on(), public._fixture_sync_on(), public._first_lock_passed(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. pools: opened_at inmutable y no falsificable; el offset ya no puede mover un lock alcanzado
-- ---------------------------------------------------------------------------------------------------------------
create function public.tg_pools_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'pool tenant is immutable' using errcode = '42501';
    end if;
    if old.opened_at is not null and new.opened_at is distinct from old.opened_at then
      raise exception 'pool opened_at is immutable' using errcode = '42501';
    end if;
    if old.opened_at is null then new.opened_at := null; end if;   -- el cliente no fija opened_at
  else
    new.opened_at := null;
  end if;
  if new.status in ('open', 'paused') and new.opened_at is null then
    new.opened_at := clock_timestamp();
  end if;
  return new;
end $$;
create trigger pools_guard before insert or update on public.pools
  for each row execute function public.tg_pools_guard();

create function public.tg_pools_after_offset() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare r record; v_new timestamptz;
begin
  if new.lock_offset is not distinct from old.lock_offset then return null; end if;
  perform set_config('sl.lock_maint', 'on', true);
  for r in
    select pm.id, m.starts_at
      from public.pool_matches pm
      join public.matches m on m.id = pm.match_id and m.tenant_id = pm.tenant_id
     where pm.pool_id = new.id and pm.lock_at > clock_timestamp()
     order by pm.id
       for update of pm
  loop
    v_new := r.starts_at - new.lock_offset;
    if v_new <= clock_timestamp() then
      raise exception 'lock_offset change would lock or reveal a match immediately' using errcode = '42501';
    end if;
    update public.pool_matches set lock_at = v_new where id = r.id and lock_at is distinct from v_new;
  end loop;
  perform set_config('sl.lock_maint', 'off', true);
  return null;
end $$;
create trigger pools_after_offset after update of lock_offset on public.pools
  for each row execute function public.tg_pools_after_offset();

create function public.tg_pools_guard_delete() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.opened_at is not null or exists (select 1 from public.participants p where p.pool_id = old.id) then
    raise exception 'an opened pool or a pool with participants cannot be deleted; archive it' using errcode = '42501';
  end if;
  return old;
end $$;
create trigger pools_guard_delete before delete on public.pools
  for each row execute function public.tg_pools_guard_delete();

-- ---------------------------------------------------------------------------------------------------------------
-- 4. pool_matches: lock_at derivado por el sistema; identidad inmutable; borrado solo sin predicciones ni lock alcanzado
-- ---------------------------------------------------------------------------------------------------------------
create function public.tg_pool_matches_set_lock() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_starts timestamptz; v_status text; v_offset interval;
begin
  select m.starts_at, m.status::text into v_starts, v_status from public.matches m where m.id = new.match_id and m.tenant_id = new.tenant_id;
  select p.lock_offset into v_offset from public.pools p where p.id = new.pool_id and p.tenant_id = new.tenant_id;
  if v_starts is null or v_offset is null then
    raise exception 'pool_match references are invalid' using errcode = '23503';
  end if;
  new.lock_at := v_starts - v_offset;
  if v_status <> 'scheduled' then new.lock_at := least(new.lock_at, clock_timestamp()); end if;
  return new;
end $$;
create trigger pool_matches_set_lock before insert on public.pool_matches
  for each row execute function public.tg_pool_matches_set_lock();

create function public.tg_pool_matches_guard_update() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id or new.pool_id is distinct from old.pool_id or new.match_id is distinct from old.match_id then
    raise exception 'pool_match identity is immutable' using errcode = '42501';
  end if;
  if new.lock_at is distinct from old.lock_at then
    if not public._lock_maint_on() then
      raise exception 'lock_at is maintained by the system' using errcode = '42501';
    end if;
    if new.lock_at > old.lock_at and old.lock_at <= clock_timestamp() then
      raise exception 'a reached lock cannot be reopened' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger pool_matches_guard_update before update on public.pool_matches
  for each row execute function public.tg_pool_matches_guard_update();

create function public.tg_pool_matches_guard_delete() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_opened timestamptz;
begin
  if exists (select 1 from public.predictions pr where pr.pool_match_id = old.id) then
    raise exception 'a match with predictions cannot be removed from a pool' using errcode = '42501';
  end if;
  select p.opened_at into v_opened from public.pools p where p.id = old.pool_id;
  if v_opened is not null and old.lock_at <= clock_timestamp() then
    raise exception 'a locked match cannot be removed from an opened pool' using errcode = '42501';
  end if;
  return old;
end $$;
create trigger pool_matches_guard_delete before delete on public.pool_matches
  for each row execute function public.tg_pool_matches_guard_delete();

-- ---------------------------------------------------------------------------------------------------------------
-- 5. matches: estado monótono, identidad y equipos protegidos, el horario nunca reabre un lock
-- ---------------------------------------------------------------------------------------------------------------
create function public.tg_matches_guard_update() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_old int; v_new int;
begin
  if (new.tenant_id is distinct from old.tenant_id
      or new.tournament_id is distinct from old.tournament_id
      or new.round_id is distinct from old.round_id)
     and exists (select 1 from public.pool_matches pm where pm.match_id = old.id) then
    raise exception 'tenant, tournament and round of a pool match are immutable' using errcode = '42501';
  end if;
  v_old := case old.status when 'scheduled' then 1 when 'live' then 2 else 3 end;
  v_new := case new.status when 'scheduled' then 1 when 'live' then 2 else 3 end;
  if v_new < v_old then
    raise exception 'match status cannot regress' using errcode = '42501';
  end if;
  if (new.home_team_id is distinct from old.home_team_id or new.away_team_id is distinct from old.away_team_id)
     and exists (
       select 1 from public.pool_matches pm
        where pm.match_id = old.id
          and (pm.lock_at <= clock_timestamp()
               or exists (select 1 from public.predictions pr where pr.pool_match_id = pm.id))) then
    raise exception 'teams of a locked or predicted match are immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger matches_guard_update before update on public.matches
  for each row execute function public.tg_matches_guard_update();

create function public.tg_matches_after_update() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare r record; v_new timestamptz;
begin
  perform set_config('sl.lock_maint', 'on', true);
  if new.status <> 'scheduled' and old.status = 'scheduled' then
    update public.pool_matches pm
       set lock_at = clock_timestamp()
     where pm.match_id = new.id and pm.lock_at > clock_timestamp();
  end if;
  if new.starts_at is distinct from old.starts_at then
    for r in
      select pm.id, p.lock_offset
        from public.pool_matches pm
        join public.pools p on p.id = pm.pool_id and p.tenant_id = pm.tenant_id
       where pm.match_id = new.id and pm.lock_at > clock_timestamp()
       order by pm.id
         for update of pm
    loop
      v_new := new.starts_at - r.lock_offset;
      if v_new <= clock_timestamp() then
        if public._fixture_sync_on() then
          v_new := clock_timestamp();   -- el partido se adelantó: se bloquea ahora, sin revelar nada antes
        else
          raise exception 'schedule change would lock or reveal the match immediately' using errcode = '42501';
        end if;
      end if;
      update public.pool_matches set lock_at = v_new where id = r.id and lock_at is distinct from v_new;
    end loop;
  end if;
  perform set_config('sl.lock_maint', 'off', true);
  return null;
end $$;
create trigger matches_after_update after update of starts_at, status on public.matches
  for each row execute function public.tg_matches_after_update();

create function public.tg_matches_guard_delete() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.pool_matches pm where pm.match_id = old.id)
     or exists (select 1 from public.official_results r where r.match_id = old.id) then
    raise exception 'a match used by pools or with official results cannot be deleted' using errcode = '42501';
  end if;
  return old;
end $$;
create trigger matches_guard_delete before delete on public.matches
  for each row execute function public.tg_matches_guard_delete();

-- ---------------------------------------------------------------------------------------------------------------
-- 6. participants / predictions / official_results: sin borrado destructivo; predicción bloqueada = inmutable
-- ---------------------------------------------------------------------------------------------------------------
create function public.tg_participants_guard_delete() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.predictions pr where pr.participant_id = old.id)
     or exists (select 1 from public.pools po where po.id = old.pool_id and po.opened_at is not null) then
    raise exception 'a participant of an opened pool, or with predictions, cannot be deleted; withdraw instead' using errcode = '42501';
  end if;
  return old;
end $$;
create trigger participants_guard_delete before delete on public.participants
  for each row execute function public.tg_participants_guard_delete();

create function public.tg_predictions_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_lock timestamptz;
begin
  if tg_op = 'DELETE' then
    raise exception 'predictions cannot be deleted' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE'
     and (new.tenant_id is distinct from old.tenant_id or new.pool_id is distinct from old.pool_id
          or new.pool_match_id is distinct from old.pool_match_id or new.participant_id is distinct from old.participant_id) then
    raise exception 'prediction identity is immutable' using errcode = '42501';
  end if;
  -- FOR SHARE: espera a un cambio de lock en curso (sync/trigger) y lee su valor confirmado; mismo orden de bloqueo que save_prediction.
  select pm.lock_at into v_lock from public.pool_matches pm where pm.id = new.pool_match_id for share;
  if v_lock is not null and v_lock <= clock_timestamp() then
    raise exception 'prediction is locked' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger predictions_guard_insert before insert on public.predictions
  for each row execute function public.tg_predictions_guard();
create trigger predictions_guard_update before update on public.predictions
  for each row execute function public.tg_predictions_guard();
create function public.tg_predictions_guard_delete() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  raise exception 'predictions cannot be deleted' using errcode = '42501';
end $$;
create trigger predictions_guard_delete before delete on public.predictions
  for each row execute function public.tg_predictions_guard_delete();

create function public.tg_official_results_guard_delete() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  raise exception 'official results are revised (ADR-012), never deleted' using errcode = '42501';
end $$;
create trigger official_results_guard_delete before delete on public.official_results
  for each row execute function public.tg_official_results_guard_delete();

-- Identidad inmutable y revisión monótona: cambiar el marcador exige subir revision en 1; sin cambio de marcador no se toca revision.
create function public.tg_official_results_guard_write() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.revision <> 1 then
      raise exception 'the first official result is revision 1' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.match_id is distinct from old.match_id or new.tenant_id is distinct from old.tenant_id then
    raise exception 'official result identity is immutable' using errcode = '42501';
  end if;
  if (new.home_score, new.away_score) is distinct from (old.home_score, old.away_score) then
    if new.revision <> old.revision + 1 then
      raise exception 'a corrected result must increment revision by one' using errcode = '42501';
    end if;
  elsif new.revision is distinct from old.revision then
    raise exception 'revision cannot change without a score change' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger official_results_guard_write before insert or update on public.official_results
  for each row execute function public.tg_official_results_guard_write();

revoke all on function
  public.tg_pools_guard(), public.tg_pools_after_offset(), public.tg_pools_guard_delete(),
  public.tg_pool_matches_set_lock(), public.tg_pool_matches_guard_update(), public.tg_pool_matches_guard_delete(),
  public.tg_matches_guard_update(), public.tg_matches_after_update(), public.tg_matches_guard_delete(),
  public.tg_participants_guard_delete(), public.tg_predictions_guard(), public.tg_predictions_guard_delete(), public.tg_official_results_guard_delete(), public.tg_official_results_guard_write()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Lectura y escritura de pronósticos con el lock persistido (misma firma; ACL conservada por CREATE OR REPLACE)
--    Lectura y escritura usan clock_timestamp(); la escritura toma además FOR SHARE sobre pool_matches (espera cambios de lock
--    en curso). Revelar exige clock >= lock_at y escribir exige clock < lock_at con la fila bloqueada: no hay ventana en la que
--    se revele un pronóstico aún editable (la comprobación del trigger usa el mismo reloj).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.can_read_prediction(p_tenant_id uuid, p_participant_id uuid, p_pool_match_id uuid)
returns boolean language sql security definer set search_path = public, auth   -- VOLATILE: clock_timestamp()
as $$
  select exists (
           select 1 from public.participants p
            where p.id = p_participant_id and p.tenant_id = p_tenant_id and p.profile_id = auth.uid())
      or exists (
           select 1
             from public.participants viewer
             join public.pool_matches pm on pm.pool_id = viewer.pool_id and pm.tenant_id = viewer.tenant_id
            where viewer.tenant_id = p_tenant_id and viewer.profile_id = auth.uid()
              and viewer.approval_status = 'approved' and viewer.withdrawn_at is null
              and pm.id = p_pool_match_id and clock_timestamp() >= pm.lock_at)
$$;

create or replace function public.save_prediction(p_pool_id uuid, p_match_id uuid, p_home_score integer, p_away_score integer)
returns public.predictions language plpgsql security definer set search_path = public, auth
as $$
declare v_prediction public.predictions; v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_home_score < 0 or p_away_score < 0 then raise exception 'scores must be non-negative' using errcode = '22023'; end if;
  with target as (
    select pm.id as pool_match_id, pm.tenant_id, pm.pool_id, p.id as participant_id, pm.lock_at
      from public.pool_matches pm
      join public.matches m on m.id = pm.match_id and m.tenant_id = pm.tenant_id
      join public.pools pool on pool.id = pm.pool_id and pool.tenant_id = pm.tenant_id
      join public.participants p on p.pool_id = pm.pool_id and p.tenant_id = pm.tenant_id
     where pm.pool_id = p_pool_id and pm.match_id = p_match_id and p.profile_id = v_user
       and p.approval_status = 'approved' and p.withdrawn_at is null
       and pool.status = 'open' and m.status = 'scheduled'
       for share of pm)
  insert into public.predictions(tenant_id, pool_id, pool_match_id, participant_id, home_score, away_score)
  select tenant_id, pool_id, pool_match_id, participant_id, p_home_score, p_away_score from target
   where clock_timestamp() < lock_at
  on conflict (participant_id, pool_match_id) do update
     set home_score = excluded.home_score, away_score = excluded.away_score, updated_at = now()
  returning * into v_prediction;
  if not found then raise exception 'prediction is unavailable, unauthorized, or locked' using errcode = '42501'; end if;
  return v_prediction;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 8. Entrada para el sincronizador deportivo (solo service_role; llamado por una Edge Function de servidor)
--    Aplica horario/estado con la misma validación de los triggers y la bandera de sincronización: un adelanto bloquea
--    ahora; jamás reabre. Los resultados oficiales siguen el flujo de ADR-012 (publish_official_result, Fase 06).
-- ---------------------------------------------------------------------------------------------------------------
create function public.apply_fixture_update(p_match_id uuid, p_starts_at timestamptz default null, p_status public.match_status default null)
returns public.matches language plpgsql security definer set search_path = ''
as $$
declare v_match public.matches;
begin
  perform set_config('sl.fixture_sync', 'on', true);
  update public.matches
     set starts_at = coalesce(p_starts_at, starts_at), status = coalesce(p_status, status)
   where id = p_match_id
   returning * into v_match;
  perform set_config('sl.fixture_sync', 'off', true);
  if v_match.id is null then raise exception 'match not found' using errcode = '22023'; end if;
  return v_match;
end $$;
revoke all on function public.apply_fixture_update(uuid, timestamptz, public.match_status) from public, anon, authenticated;
grant execute on function public.apply_fixture_update(uuid, timestamptz, public.match_status) to service_role;
