-- ROLLBACK de 1/3 (lock persistido e integridad de horarios). NO EJECUTAR en QA. Solo en el proyecto descartable.
-- Restaura save_prediction y can_read_prediction de la Fase 03 y elimina triggers/columnas añadidos. Las filas de
-- participants.withdrawn_* se pierden: confirmar con sl.allow_destructive_rollback = on.
set local lock_timeout = '5s';
do $$
begin
  if coalesce(current_setting('sl.allow_destructive_rollback', true), 'off') <> 'on' then
    raise exception 'rollback re-opens H1/H2; set sl.allow_destructive_rollback=on to confirm';
  end if;
end $$;

do $$
begin
  if to_regclass('public.pool_staff') is not null or exists (select 1 from pg_trigger where tgname = 'audit_pools') then
    raise exception 'roll back 3/3 and 2/3 first';
  end if;
end $$;

drop function if exists public.apply_fixture_update(uuid, timestamptz, public.match_status);

drop trigger if exists official_results_guard_write on public.official_results;
drop trigger if exists official_results_guard_delete on public.official_results;
drop trigger if exists predictions_guard_insert on public.predictions;
drop trigger if exists predictions_guard_delete on public.predictions;
drop trigger if exists predictions_guard_update on public.predictions;
drop trigger if exists participants_guard_delete on public.participants;
drop trigger if exists matches_guard_delete on public.matches;
drop trigger if exists matches_after_update on public.matches;
drop trigger if exists matches_guard_update on public.matches;
drop trigger if exists pool_matches_guard_delete on public.pool_matches;
drop trigger if exists pool_matches_guard_update on public.pool_matches;
drop trigger if exists pool_matches_set_lock on public.pool_matches;
drop trigger if exists pools_guard_delete on public.pools;
drop trigger if exists pools_after_offset on public.pools;
drop trigger if exists pools_guard on public.pools;

create or replace function public.can_read_prediction(p_tenant_id uuid, p_participant_id uuid, p_pool_match_id uuid) returns boolean language sql stable security definer set search_path = public, auth as $$ select exists (select 1 from public.participants p where p.id = p_participant_id and p.tenant_id = p_tenant_id and p.profile_id = auth.uid()) or exists (select 1 from public.participants viewer join public.pool_matches pm on pm.pool_id = viewer.pool_id and pm.tenant_id = viewer.tenant_id join public.matches m on m.id = pm.match_id and m.tenant_id = pm.tenant_id join public.pools pool on pool.id = pm.pool_id and pool.tenant_id = pm.tenant_id where viewer.tenant_id = p_tenant_id and viewer.profile_id = auth.uid() and viewer.approval_status = 'approved' and pm.id = p_pool_match_id and now() >= m.starts_at - pool.lock_offset) $$;
create or replace function public.save_prediction(p_pool_id uuid, p_match_id uuid, p_home_score integer, p_away_score integer) returns public.predictions language plpgsql security definer set search_path = public, auth as $$ declare v_prediction public.predictions; v_user uuid := auth.uid(); begin if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if; if p_home_score < 0 or p_away_score < 0 then raise exception 'scores must be non-negative' using errcode = '22023'; end if; with target as (select pm.id as pool_match_id, pm.tenant_id, pm.pool_id, p.id as participant_id, m.starts_at, pool.lock_offset from public.pool_matches pm join public.matches m on m.id = pm.match_id and m.tenant_id = pm.tenant_id join public.pools pool on pool.id = pm.pool_id and pool.tenant_id = pm.tenant_id join public.participants p on p.pool_id = pm.pool_id and p.tenant_id = pm.tenant_id where pm.pool_id = p_pool_id and pm.match_id = p_match_id and p.profile_id = v_user and p.approval_status = 'approved' and pool.status = 'open' and m.status = 'scheduled') insert into public.predictions(tenant_id, pool_id, pool_match_id, participant_id, home_score, away_score) select tenant_id, pool_id, pool_match_id, participant_id, p_home_score, p_away_score from target where now() < starts_at - lock_offset on conflict (participant_id, pool_match_id) do update set home_score = excluded.home_score, away_score = excluded.away_score, updated_at = now() returning * into v_prediction; if not found then raise exception 'prediction is unavailable, unauthorized, or locked' using errcode = '42501'; end if; return v_prediction; end $$;

drop function if exists public.tg_official_results_guard_write();
drop function if exists public.tg_predictions_guard_delete();
drop function if exists public.tg_official_results_guard_delete();
drop function if exists public.tg_predictions_guard();
drop function if exists public.tg_participants_guard_delete();
drop function if exists public.tg_matches_guard_delete();
drop function if exists public.tg_matches_after_update();
drop function if exists public.tg_matches_guard_update();
drop function if exists public.tg_pool_matches_guard_delete();
drop function if exists public.tg_pool_matches_guard_update();
drop function if exists public.tg_pool_matches_set_lock();
drop function if exists public.tg_pools_guard_delete();
drop function if exists public.tg_pools_after_offset();
drop function if exists public.tg_pools_guard();
drop function if exists public._first_lock_passed(uuid);

drop index if exists public.pool_matches_pool_lock_idx;
drop index if exists public.pool_matches_match_id_idx;
drop index if exists public.predictions_pool_match_id_idx;
alter table public.participants drop column if exists withdrawn_by;
alter table public.participants drop column if exists withdrawn_at;
alter table public.pool_matches drop column if exists lock_at;
alter table public.pools drop column if exists opened_at;
