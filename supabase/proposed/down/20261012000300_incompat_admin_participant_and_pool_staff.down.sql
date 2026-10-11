-- ROLLBACK de 3/3 (incompatibilidad administrador/participante). NO EJECUTAR en QA. Solo en el proyecto descartable.
-- Protección: destruye historial de gobernanza (pool_staff, exclusiones, conflictos). Exportar antes y fijar
--   select set_config('sl.allow_destructive_rollback', 'on', true);
-- en la misma transacción para confirmar. Sin la bandera, el script aborta si hay historial más allá del relleno inicial.
set local lock_timeout = '5s';
do $$
begin
  if coalesce(current_setting('sl.allow_destructive_rollback', true), 'off') <> 'on'
     and (exists (select 1 from public.pool_staff)
          or exists (select 1 from public.legacy_admin_conflicts where status = 'regularized')
          or exists (select 1 from public.pool_admin_exclusions where source <> 'legacy_backfill')) then
    raise exception 'rollback would destroy governance history; export it and set sl.allow_destructive_rollback=on';
  end if;
end $$;

drop trigger if exists audit_tenants_pool_admin_model on public.tenants;
drop trigger if exists tenants_guard_model on public.tenants;
drop trigger if exists tenant_memberships_guard on public.tenant_memberships;
drop trigger if exists tenant_memberships_exclude on public.tenant_memberships;
drop trigger if exists pools_opening_snapshot on public.pools;
drop trigger if exists participants_guard_insert on public.participants;
drop trigger if exists participants_guard_update on public.participants;
drop trigger if exists predictions_guard_participant on public.predictions;

drop function if exists public.regularize_legacy_conflict(uuid, text);
drop function if exists public.register_platform_intervention(uuid, text, text);
drop function if exists public.withdraw_participation(uuid);
drop function if exists public.transfer_pool_administration(uuid, uuid, uuid);
drop function if exists public.revoke_pool_staff(uuid, uuid);
drop function if exists public.assign_pool_staff(uuid, uuid, public.pool_staff_role);
drop function if exists public._assert_pool_keeps_manager(uuid);

drop table if exists public.legacy_admin_conflicts;
drop table if exists public.pool_admin_exclusions;
drop table if exists public.pool_staff;
drop table if exists public.pool_staff_role_capabilities;

drop function if exists public.tg_tenants_guard_model();
drop function if exists public.tg_pools_opening_snapshot();
drop function if exists public.tg_pool_staff_exclude();
drop function if exists public.tg_pool_staff_guard();
drop function if exists public.tg_tenant_memberships_exclude();
drop function if exists public.tg_tenant_memberships_guard();
drop function if exists public.tg_predictions_guard_participant();
drop function if exists public.tg_participants_guard_update();
drop function if exists public.tg_participants_guard_insert();
drop function if exists public.participation_competes(uuid);
drop function if exists public.has_pool_capability(uuid, public.pool_capability);
drop function if exists public._has_pool_capability(uuid, public.pool_capability, uuid);
drop function if exists public._lock_pool_governance(uuid, uuid);
drop function if exists public._assert_no_participation_conflict(uuid, uuid);
drop function if exists public._record_pool_exclusion(uuid, uuid, text);
drop function if exists public.assert_pool_participation_allowed(uuid, uuid);
drop function if exists public.is_pool_excluded(uuid, uuid);
drop function if exists public.is_pool_admin_capacity(uuid, uuid);
drop function if exists public._lock_pool_profile(uuid, uuid);

alter table public.tenants drop column if exists pool_admin_model;
drop type if exists public.legacy_conflict_status;
drop type if exists public.pool_capability;
drop type if exists public.pool_staff_role;
drop type if exists public.pool_admin_model;

-- Restaura join_pool de 2/3 (sin la guarda de filas existentes).
create or replace function public.join_pool(p_code text)
returns public.participants
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_code public.pool_join_codes;
  v_participant public.participants;
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select * into v_code
  from public.pool_join_codes
  where code = upper(p_code)
    and is_enabled
    and (expires_at is null or expires_at > now())
  for update;

  if not found then
    raise exception 'join code is invalid or expired' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.pools
    where id = v_code.pool_id
      and tenant_id = v_code.tenant_id
      and status = 'open'
  ) then
    raise exception 'pool is not open' using errcode = '22023';
  end if;

  insert into public.tenant_memberships(tenant_id, profile_id, role)
  values (v_code.tenant_id, v_user, 'member')
  on conflict (tenant_id, profile_id) do nothing;

  select * into v_participant
  from public.participants
  where tenant_id = v_code.tenant_id
    and pool_id = v_code.pool_id
    and profile_id = v_user;

  if found then
    return v_participant;
  end if;

  -- R6: serializar el conteo del límite Free por quiniela (varios códigos activos no lo evaden).
  perform 1 from public.pools where id = v_code.pool_id and tenant_id = v_code.tenant_id for no key update;

  if exists (
    select 1
    from public.tenant_entitlements e
    where e.tenant_id = v_code.tenant_id
      and e.plan_code = 'free'
  ) and (
    select count(*)
    from public.participants
    where tenant_id = v_code.tenant_id
      and pool_id = v_code.pool_id
      and withdrawn_at is null
  ) >= 10 then
    raise exception 'free participant limit reached' using errcode = '22023';
  end if;

  insert into public.participants(
    tenant_id,
    pool_id,
    profile_id,
    approval_status,
    payment_status
  )
  select
    v_code.tenant_id,
    v_code.pool_id,
    v_user,
    case
      when p.requires_approval then 'pending'::public.participant_approval_status
      else 'approved'::public.participant_approval_status
    end,
    'invited'::public.participant_payment_status
  from public.pools p
  where p.id = v_code.pool_id
    and p.tenant_id = v_code.tenant_id
  returning * into v_participant;

  return v_participant;
end;
$$;
