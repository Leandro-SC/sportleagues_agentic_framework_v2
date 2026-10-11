-- PROPUESTA — NO APLICADA. Ver ADR-015 y docs/operations/CLOUD-ONLY-TESTING-POLICY.md.
-- Orden: 3/3 (incompatibilidad administrador/participante, D17–D20, pool_staff definitivo). Requiere 1/3 y 2/3.
-- Forward-only. Solo para un proyecto Supabase Cloud DESCARTABLE hasta ser validada.
--
-- Regla (ADR-015 §2): quien tiene o tuvo (tras opened_at) capacidad administrativa sobre una quiniela no puede
-- inscribirse, emitir tickets, pronosticar ni figurar en su ranking. Se impone con triggers SECURITY DEFINER
-- (aplican a service_role y al propietario de tabla) y un bloqueo asesor por (quiniela, perfil) que serializa
-- inscripción/pronóstico con concesión de roles.
-- Modelo definitivo de permisos por quiniela (D17): pool_staff + capacidades + tenants.pool_admin_model. Tickets y
-- rankings solo dependen de (pool_id, participant_id) y de pool_admin_exclusions (persistida); pasar de 'tenant' a
-- 'pool' no reconstruye tickets ni rankings.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Modelo
-- ---------------------------------------------------------------------------------------------------------------
create type public.pool_admin_model as enum ('tenant', 'pool');
alter table public.tenants add column pool_admin_model public.pool_admin_model not null default 'tenant';

create type public.pool_staff_role as enum ('pool_owner', 'pool_manager', 'pool_finance');
create type public.pool_capability as enum ('schedule', 'results', 'participants', 'codes', 'rules', 'read_tickets', 'finance', 'refund', 'staff');

create table public.pool_staff_role_capabilities (
  role public.pool_staff_role not null,
  capability public.pool_capability not null,
  primary key (role, capability)
);
insert into public.pool_staff_role_capabilities(role, capability) values
  ('pool_owner', 'schedule'), ('pool_owner', 'results'), ('pool_owner', 'participants'), ('pool_owner', 'codes'), ('pool_owner', 'rules'),
  ('pool_owner', 'read_tickets'), ('pool_owner', 'finance'), ('pool_owner', 'refund'), ('pool_owner', 'staff'),
  ('pool_manager', 'schedule'), ('pool_manager', 'results'), ('pool_manager', 'participants'), ('pool_manager', 'codes'),
  ('pool_manager', 'rules'), ('pool_manager', 'read_tickets'),
  ('pool_finance', 'participants'), ('pool_finance', 'read_tickets'), ('pool_finance', 'finance');

create table public.pool_staff (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  pool_id uuid not null,
  profile_id uuid not null,
  role public.pool_staff_role not null,
  is_active boolean not null default true,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pool_id, profile_id),
  unique (id, tenant_id, pool_id),
  foreign key (pool_id, tenant_id) references public.pools(id, tenant_id) on delete restrict,
  foreign key (tenant_id, profile_id) references public.tenant_memberships(tenant_id, profile_id) on delete restrict,
  check (is_active or revoked_at is not null)
);
create index pool_staff_profile_idx on public.pool_staff (profile_id) where is_active;
create trigger pool_staff_set_updated_at before update on public.pool_staff
  for each row execute function public.set_updated_at();

create table public.pool_admin_exclusions (
  tenant_id uuid not null,
  pool_id uuid not null,
  profile_id uuid not null,                 -- sin FK a profiles: el historial sobrevive a la baja de la cuenta
  since timestamptz not null default clock_timestamp(),
  source text not null check (source in ('pool_opening_snapshot', 'tenant_role', 'pool_staff', 'platform_intervention', 'legacy_backfill')),
  primary key (pool_id, profile_id),
  foreign key (pool_id, tenant_id) references public.pools(id, tenant_id) on delete restrict
);

create type public.legacy_conflict_status as enum ('open', 'regularized');
create table public.legacy_admin_conflicts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  pool_id uuid not null,
  profile_id uuid not null,
  participant_id uuid not null references public.participants(id) on delete restrict,
  detected_at timestamptz not null default now(),
  status public.legacy_conflict_status not null default 'open',
  resolution text check (resolution in ('participation_withdrawn')),
  resolved_by uuid,
  resolved_at timestamptz,
  note text,
  unique (participant_id),
  foreign key (pool_id, tenant_id) references public.pools(id, tenant_id) on delete restrict,
  check ((status = 'open') = (resolved_at is null))
);

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Funciones de decisión (internas; los clientes solo reciben has_pool_capability)
-- ---------------------------------------------------------------------------------------------------------------
create function public._lock_pool_profile(p_pool_id uuid, p_profile uuid) returns void
language sql security definer set search_path = ''
as $$ select pg_advisory_xact_lock(hashtextextended('sl:pool-profile:' || p_pool_id::text || ':' || p_profile::text, 0)) $$;

create function public._lock_pool_governance(p_pool_id uuid, p_profile uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.pools where id = p_pool_id for no key update;   -- orden único: fila de la quiniela → bloqueo asesor
  perform public._lock_pool_profile(p_pool_id, p_profile);
end $$;

create function public.is_pool_admin_capacity(p_pool_id uuid, p_profile uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  -- D17: owner/admin del tenant son capacidad administrativa SIEMPRE (sea cual sea pool_admin_model) mientras las RLS y RPC de
  -- Fases 03–05 sigan autorizando con is_tenant_admin. El modelo 'pool' solo cambia _has_pool_capability, no la exclusión.
  select exists (
           select 1
             from public.pools po
             join public.tenant_memberships tm on tm.tenant_id = po.tenant_id and tm.profile_id = p_profile and tm.is_active
            where po.id = p_pool_id and tm.role in ('owner', 'admin'))
      or exists (
           select 1 from public.pool_staff s
            where s.pool_id = p_pool_id and s.profile_id = p_profile and s.is_active)
$$;

create function public.is_pool_excluded(p_pool_id uuid, p_profile uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_pool_admin_capacity(p_pool_id, p_profile)
      or exists (select 1 from public.pool_admin_exclusions e where e.pool_id = p_pool_id and e.profile_id = p_profile)
$$;

create function public._has_pool_capability(p_pool_id uuid, p_capability public.pool_capability, p_profile uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_profile is not null and (
    exists (
      select 1
        from public.pools po
        join public.tenants t on t.id = po.tenant_id
        join public.tenant_memberships tm on tm.tenant_id = po.tenant_id and tm.profile_id = p_profile and tm.is_active
       where po.id = p_pool_id and t.pool_admin_model = 'tenant' and tm.role in ('owner', 'admin')
         and (tm.role = 'owner' or p_capability not in ('refund', 'staff')))
    or exists (
      select 1
        from public.pool_staff s
        join public.pool_staff_role_capabilities c on c.role = s.role
        join public.tenant_memberships tm on tm.tenant_id = s.tenant_id and tm.profile_id = s.profile_id and tm.is_active
       where s.pool_id = p_pool_id and s.profile_id = p_profile and s.is_active and c.capability = p_capability))
$$;

-- Versión para clientes: solo consulta SU propia capacidad (no permite sondear quién administra una quiniela).
create function public.has_pool_capability(p_pool_id uuid, p_capability public.pool_capability)
returns boolean language sql stable security definer set search_path = ''
as $$ select public._has_pool_capability(p_pool_id, p_capability, auth.uid()) $$;

create function public.participation_competes(p_participant_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.participants p
     where p.id = p_participant_id and p.withdrawn_at is null
       and not public.is_pool_excluded(p.pool_id, p.profile_id))
$$;

create function public.assert_pool_participation_allowed(p_pool_id uuid, p_profile uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public._lock_pool_profile(p_pool_id, p_profile);
  if public.is_pool_excluded(p_pool_id, p_profile) then
    raise exception 'administrators of a pool cannot participate in it' using errcode = '42501', hint = 'ADMIN_PARTICIPANT_INCOMPATIBLE';
  end if;
end $$;

create function public._record_pool_exclusion(p_pool_id uuid, p_profile uuid, p_source text) returns void
language sql security definer set search_path = ''
as $$
  insert into public.pool_admin_exclusions(tenant_id, pool_id, profile_id, source)
  select po.tenant_id, po.id, p_profile, p_source from public.pools po where po.id = p_pool_id
  on conflict (pool_id, profile_id) do nothing
$$;

-- Conflicto al conceder capacidad: participa y no se retiró, o se retiró pero el primer lock ya pasó.
create function public._assert_no_participation_conflict(p_pool_id uuid, p_profile uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_part public.participants;
begin
  select * into v_part from public.participants p where p.pool_id = p_pool_id and p.profile_id = p_profile;
  if not found then return; end if;
  if v_part.withdrawn_at is null then
    raise exception 'withdraw the participation before receiving administrative capacity' using errcode = '42501', hint = 'WITHDRAW_FIRST';
  end if;
  if public._first_lock_passed(p_pool_id) then
    raise exception 'a participant of an opened competition can never administer it' using errcode = '42501', hint = 'FIRST_LOCK_PASSED';
  end if;
end $$;

revoke all on function
  public._lock_pool_profile(uuid, uuid), public._lock_pool_governance(uuid, uuid), public.is_pool_admin_capacity(uuid, uuid), public.is_pool_excluded(uuid, uuid),
  public.assert_pool_participation_allowed(uuid, uuid), public._record_pool_exclusion(uuid, uuid, text),
  public._assert_no_participation_conflict(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public._has_pool_capability(uuid, public.pool_capability, uuid) from public, anon, authenticated;
revoke all on function public.has_pool_capability(uuid, public.pool_capability) from public, anon;
grant execute on function public.has_pool_capability(uuid, public.pool_capability) to authenticated, service_role;
-- participation_competes la usarán vistas/RPC de ranking (definer) y el servicio; no se expone a clientes (evita sondeos).
revoke all on function public.participation_competes(uuid) from public, anon, authenticated;
grant execute on function public.participation_competes(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Relleno del historial y detección de conflictos heredados (no se borra nada)
-- ---------------------------------------------------------------------------------------------------------------
insert into public.pool_admin_exclusions(tenant_id, pool_id, profile_id, source)
select po.tenant_id, po.id, x.profile_id, 'legacy_backfill'
  from public.pools po
  join lateral (
    select tm.profile_id
      from public.tenant_memberships tm
     where tm.tenant_id = po.tenant_id and tm.is_active and tm.role in ('owner', 'admin')
    ) x on true
 where po.opened_at is not null
on conflict (pool_id, profile_id) do nothing;

with detected as (
  insert into public.legacy_admin_conflicts(tenant_id, pool_id, profile_id, participant_id)
  select p.tenant_id, p.pool_id, p.profile_id, p.id
    from public.participants p
   where p.withdrawn_at is null and public.is_pool_admin_capacity(p.pool_id, p.profile_id)
  on conflict (participant_id) do nothing
  returning id, tenant_id, pool_id, profile_id)
insert into public.audit_log(tenant_id, action, entity_type, entity_id, metadata)
select d.tenant_id, 'legacy_admin_conflicts.detected', 'legacy_admin_conflicts', d.id,
       jsonb_build_object('pool_id', d.pool_id, 'profile_id', d.profile_id, 'source', 'migration')
  from detected d;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Triggers de inmutabilidad y de incompatibilidad
-- ---------------------------------------------------------------------------------------------------------------
create trigger pool_admin_exclusions_append_only before update or delete on public.pool_admin_exclusions
  for each row execute function public.tg_append_only();
create trigger pool_admin_exclusions_no_truncate before truncate on public.pool_admin_exclusions
  for each statement execute function public.tg_append_only();
create trigger legacy_admin_conflicts_no_delete before delete on public.legacy_admin_conflicts
  for each row execute function public.tg_append_only();
create trigger legacy_admin_conflicts_no_truncate before truncate on public.legacy_admin_conflicts
  for each statement execute function public.tg_append_only();

-- participants
create function public.tg_participants_guard_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.assert_pool_participation_allowed(new.pool_id, new.profile_id);
  return new;
end $$;
create trigger participants_guard_insert before insert on public.participants
  for each row execute function public.tg_participants_guard_insert();

create function public.tg_participants_guard_update() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id or new.pool_id is distinct from old.pool_id or new.profile_id is distinct from old.profile_id then
    raise exception 'participant identity is immutable' using errcode = '42501';
  end if;
  if old.withdrawn_at is not null and new.withdrawn_at is distinct from old.withdrawn_at then
    raise exception 'withdrawal is terminal' using errcode = '42501';
  end if;
  if old.withdrawn_at is null and new.withdrawn_at is not null
     and coalesce(current_setting('sl.withdrawal', true), 'off') <> 'on' then
    raise exception 'withdrawal only through the approved procedures' using errcode = '42501';
  end if;
  if new.approval_status = 'approved' and old.approval_status <> 'approved'
     and public.is_pool_excluded(new.pool_id, new.profile_id) then
    raise exception 'an excluded profile cannot be approved as participant' using errcode = '42501', hint = 'ADMIN_PARTICIPANT_INCOMPATIBLE';
  end if;
  return new;
end $$;
create trigger participants_guard_update before update on public.participants
  for each row execute function public.tg_participants_guard_update();

-- predictions (la unicidad y el lock ya los protege 1/3)
create function public.tg_predictions_guard_participant() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_profile uuid; v_withdrawn timestamptz;
begin
  select p.profile_id, p.withdrawn_at into v_profile, v_withdrawn from public.participants p where p.id = new.participant_id;
  if v_profile is null then return new; end if;
  perform public.assert_pool_participation_allowed(new.pool_id, v_profile);
  if v_withdrawn is not null then
    raise exception 'a withdrawn participation cannot register predictions' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger predictions_guard_participant before insert or update on public.predictions
  for each row execute function public.tg_predictions_guard_participant();

-- tenant_memberships: ganar owner/admin activo
create function public.tg_tenant_memberships_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare r record; v_gaining boolean;
begin
  if tg_op = 'UPDATE' and (new.tenant_id is distinct from old.tenant_id or new.profile_id is distinct from old.profile_id) then
    raise exception 'membership identity is immutable' using errcode = '42501';
  end if;
  v_gaining := new.is_active and new.role in ('owner', 'admin')
               and (tg_op = 'INSERT' or not (old.is_active and old.role in ('owner', 'admin')));
  if not v_gaining then return new; end if;
  for r in select po.id from public.pools po where po.tenant_id = new.tenant_id order by po.id loop
    perform public._lock_pool_governance(r.id, new.profile_id);
    perform public._assert_no_participation_conflict(r.id, new.profile_id);
  end loop;
  return new;
end $$;
create trigger tenant_memberships_guard before insert or update of role, is_active, tenant_id, profile_id on public.tenant_memberships
  for each row execute function public.tg_tenant_memberships_guard();

create function public.tg_tenant_memberships_exclude() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  if not (new.is_active and new.role in ('owner', 'admin')) then return null; end if;
  for r in select po.id from public.pools po where po.tenant_id = new.tenant_id and po.opened_at is not null order by po.id loop
    perform public._record_pool_exclusion(r.id, new.profile_id, 'tenant_role');
  end loop;
  return null;
end $$;
create trigger tenant_memberships_exclude after insert or update of role, is_active on public.tenant_memberships
  for each row execute function public.tg_tenant_memberships_exclude();

-- pool_staff: ganar capacidad
create function public.tg_pool_staff_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_gaining boolean;
begin
  if tg_op = 'UPDATE' and (new.tenant_id is distinct from old.tenant_id or new.pool_id is distinct from old.pool_id or new.profile_id is distinct from old.profile_id) then
    raise exception 'pool_staff identity is immutable' using errcode = '42501';
  end if;
  v_gaining := new.is_active and (tg_op = 'INSERT' or not old.is_active);
  if v_gaining then
    perform public._lock_pool_governance(new.pool_id, new.profile_id);
    perform public._assert_no_participation_conflict(new.pool_id, new.profile_id);
  end if;
  return new;
end $$;
create trigger pool_staff_guard before insert or update on public.pool_staff
  for each row execute function public.tg_pool_staff_guard();

create function public.tg_pool_staff_exclude() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.is_active and exists (select 1 from public.pools po where po.id = new.pool_id and po.opened_at is not null) then
    perform public._record_pool_exclusion(new.pool_id, new.profile_id, 'pool_staff');
  end if;
  return null;
end $$;
create trigger pool_staff_exclude after insert or update on public.pool_staff
  for each row execute function public.tg_pool_staff_exclude();

-- pools: instantánea de administradores al abrir
create function public.tg_pools_opening_snapshot() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.opened_at is not null and (tg_op = 'INSERT' or old.opened_at is null) then
    insert into public.pool_admin_exclusions(tenant_id, pool_id, profile_id, source)
    select new.tenant_id, new.id, x.profile_id, 'pool_opening_snapshot'
      from (
        select tm.profile_id
          from public.tenant_memberships tm
         where tm.tenant_id = new.tenant_id and tm.is_active and tm.role in ('owner', 'admin')
        union
        select s.profile_id from public.pool_staff s where s.pool_id = new.id and s.is_active) x
    on conflict (pool_id, profile_id) do nothing;
  end if;
  return null;
end $$;
create trigger pools_opening_snapshot after insert or update on public.pools
  for each row execute function public.tg_pools_opening_snapshot();

-- tenants: el modelo solo pasa de 'tenant' a 'pool' y sin dejar quinielas abiertas sin pool_owner
create function public.tg_tenants_guard_model() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.pool_admin_model is distinct from old.pool_admin_model then
    if not (old.pool_admin_model = 'tenant' and new.pool_admin_model = 'pool') then
      raise exception 'pool_admin_model can only move from tenant to pool' using errcode = '42501';
    end if;
    if exists (
      select 1 from public.pools po
       where po.tenant_id = new.id and po.opened_at is not null
         and not exists (select 1 from public.pool_staff s where s.pool_id = po.id and s.role = 'pool_owner' and s.is_active)) then
      raise exception 'every opened pool needs an active pool_owner before switching to pool-level administration' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger tenants_guard_model before update of pool_admin_model on public.tenants
  for each row execute function public.tg_tenants_guard_model();

revoke all on function
  public.tg_participants_guard_insert(), public.tg_participants_guard_update(), public.tg_predictions_guard_participant(),
  public.tg_tenant_memberships_guard(), public.tg_tenant_memberships_exclude(), public.tg_pool_staff_guard(),
  public.tg_pool_staff_exclude(), public.tg_pools_opening_snapshot(), public.tg_tenants_guard_model()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Auditoría de las tablas nuevas
-- ---------------------------------------------------------------------------------------------------------------
create trigger audit_pool_staff after insert or update or delete on public.pool_staff
  for each row execute function public.tg_audit_row_change('profile_id,role,is_active,revoked_at');
create trigger audit_pool_admin_exclusions after insert on public.pool_admin_exclusions
  for each row execute function public.tg_audit_row_change('profile_id,source');
create trigger audit_legacy_admin_conflicts after insert or update on public.legacy_admin_conflicts
  for each row execute function public.tg_audit_row_change('profile_id,status,resolution');
create trigger audit_tenants_pool_admin_model after update of pool_admin_model on public.tenants
  for each row execute function public.tg_audit_row_change('pool_admin_model');

-- ---------------------------------------------------------------------------------------------------------------
-- 6. RLS y privilegios de las tablas nuevas (lectura acotada; escritura solo por RPC/triggers)
-- ---------------------------------------------------------------------------------------------------------------
alter table public.pool_staff enable row level security;
alter table public.pool_admin_exclusions enable row level security;
alter table public.legacy_admin_conflicts enable row level security;
alter table public.pool_staff_role_capabilities enable row level security;

create policy pool_staff_select on public.pool_staff for select to authenticated
  using (public.is_tenant_admin(tenant_id) or profile_id = auth.uid());
create policy pool_admin_exclusions_select on public.pool_admin_exclusions for select to authenticated
  using (public.is_tenant_admin(tenant_id) or profile_id = auth.uid());
create policy legacy_admin_conflicts_select on public.legacy_admin_conflicts for select to authenticated
  using (public.is_tenant_admin(tenant_id) or profile_id = auth.uid());
create policy pool_staff_role_capabilities_select on public.pool_staff_role_capabilities for select to authenticated
  using (true);

revoke all on public.pool_staff, public.pool_admin_exclusions, public.legacy_admin_conflicts, public.pool_staff_role_capabilities from anon, authenticated;
grant select on public.pool_staff, public.pool_admin_exclusions, public.legacy_admin_conflicts, public.pool_staff_role_capabilities to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. RPC de gobernanza (única vía de escritura). Orden de bloqueo: fila de la quiniela → bloqueo asesor (pool, perfil).
-- ---------------------------------------------------------------------------------------------------------------
create function public._assert_pool_keeps_manager(p_pool_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
       select 1
         from public.pools po
         join public.tenants t on t.id = po.tenant_id
         join public.tenant_memberships tm on tm.tenant_id = po.tenant_id and tm.is_active and tm.role = 'owner'
        where po.id = p_pool_id and t.pool_admin_model = 'tenant')
     and not exists (select 1 from public.pool_staff s where s.pool_id = p_pool_id and s.role = 'pool_owner' and s.is_active) then
    raise exception 'a pool must keep at least one administrator able to manage staff' using errcode = '42501';
  end if;
end $$;
revoke all on function public._assert_pool_keeps_manager(uuid) from public, anon, authenticated;

create function public.assign_pool_staff(p_pool_id uuid, p_profile_id uuid, p_role public.pool_staff_role)
returns public.pool_staff language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_tenant uuid; v_row public.pool_staff;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select tenant_id into v_tenant from public.pools where id = p_pool_id for no key update;
  if v_tenant is null then raise exception 'pool not found' using errcode = '22023'; end if;
  if not public._has_pool_capability(p_pool_id, 'staff', v_actor) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tenant_memberships tm where tm.tenant_id = v_tenant and tm.profile_id = p_profile_id and tm.is_active) then
    raise exception 'the profile must be an active member of the tenant' using errcode = '22023';
  end if;
  insert into public.pool_staff(tenant_id, pool_id, profile_id, role, granted_by)
  values (v_tenant, p_pool_id, p_profile_id, p_role, v_actor)
  on conflict (pool_id, profile_id) do update
     set role = excluded.role, is_active = true, revoked_at = null, granted_by = v_actor, granted_at = clock_timestamp()
  returning * into v_row;
  perform public._assert_pool_keeps_manager(p_pool_id);
  return v_row;
end $$;

create function public.revoke_pool_staff(p_pool_id uuid, p_profile_id uuid)
returns public.pool_staff language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_row public.pool_staff;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  perform 1 from public.pools where id = p_pool_id for no key update;
  if not found then raise exception 'pool not found' using errcode = '22023'; end if;
  if not (public._has_pool_capability(p_pool_id, 'staff', v_actor) or v_actor = p_profile_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.pool_staff set is_active = false, revoked_at = clock_timestamp()
   where pool_id = p_pool_id and profile_id = p_profile_id and is_active
   returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.pool_staff where pool_id = p_pool_id and profile_id = p_profile_id;
    return v_row;   -- idempotente
  end if;
  perform public._assert_pool_keeps_manager(p_pool_id);
  return v_row;
end $$;

create function public.transfer_pool_administration(p_pool_id uuid, p_from uuid, p_to uuid)
returns public.pool_staff language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_tenant uuid; v_row public.pool_staff; v_has_results boolean;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select tenant_id into v_tenant from public.pools where id = p_pool_id for no key update;
  if v_tenant is null or not (v_actor = p_from or public._has_pool_capability(p_pool_id, 'staff', v_actor)) then
    raise exception 'not authorized' using errcode = '42501';   -- misma respuesta para quiniela inexistente y ajena
  end if;
  if p_from = p_to then raise exception 'source and destination must differ' using errcode = '22023'; end if;
  if not exists (select 1 from public.pool_staff s where s.pool_id = p_pool_id and s.profile_id = p_from and s.role = 'pool_owner' and s.is_active) then
    raise exception 'the source must be an active pool_owner' using errcode = '22023';
  end if;
  select exists (
    select 1 from public.pool_matches pm join public.official_results r on r.match_id = pm.match_id
     where pm.pool_id = p_pool_id) into v_has_results;
  if v_has_results and not (
       v_actor <> p_from and exists (
         select 1 from public.tenant_memberships tm where tm.tenant_id = v_tenant and tm.profile_id = v_actor and tm.is_active and tm.role = 'owner')) then
    raise exception 'after the first official result only another tenant owner may transfer administration' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tenant_memberships tm where tm.tenant_id = v_tenant and tm.profile_id = p_to and tm.is_active) then
    raise exception 'the destination must be an active member of the tenant' using errcode = '22023';
  end if;
  insert into public.pool_staff(tenant_id, pool_id, profile_id, role, granted_by)
  values (v_tenant, p_pool_id, p_to, 'pool_owner', v_actor)
  on conflict (pool_id, profile_id) do update
     set role = 'pool_owner', is_active = true, revoked_at = null, granted_by = v_actor, granted_at = clock_timestamp()
  returning * into v_row;
  update public.pool_staff set is_active = false, revoked_at = clock_timestamp() where pool_id = p_pool_id and profile_id = p_from and is_active;
  perform public._assert_pool_keeps_manager(p_pool_id);
  insert into public.audit_log(tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_tenant, (select p.id from public.profiles p where p.id = v_actor), 'pool.transfer_administration', 'pools', p_pool_id,
          jsonb_build_object('from', p_from, 'to', p_to));
  return v_row;
end $$;

create function public.withdraw_participation(p_pool_id uuid)
returns public.participants language plpgsql security definer set search_path = ''
as $$
declare v_user uuid := auth.uid(); r public.participants;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  perform public._lock_pool_governance(p_pool_id, v_user);
  select * into r from public.participants p where p.pool_id = p_pool_id and p.profile_id = v_user for update;
  if not found then raise exception 'not a participant of this pool' using errcode = '22023'; end if;
  if r.withdrawn_at is not null then return r; end if;   -- idempotente
  if public._first_lock_passed(p_pool_id) then
    raise exception 'the withdrawal window closed at the first lock' using errcode = '42501', hint = 'FIRST_LOCK_PASSED';
  end if;
  perform set_config('sl.withdrawal', 'on', true);
  update public.participants set withdrawn_at = clock_timestamp(), withdrawn_by = v_user where id = r.id returning * into r;
  perform set_config('sl.withdrawal', 'off', true);
  return r;   -- predicciones y puntos se conservan; no puntúan ni figuran (participation_competes)
end $$;

create function public.register_platform_intervention(p_pool_id uuid, p_kind text, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_tenant uuid;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not public.is_platform_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 or p_kind is null or char_length(btrim(p_kind)) = 0 then
    raise exception 'kind and a reason of at least 10 characters are required' using errcode = '22023';
  end if;
  select tenant_id into v_tenant from public.pools where id = p_pool_id;
  if v_tenant is null then raise exception 'pool not found' using errcode = '22023'; end if;
  perform public._lock_pool_governance(p_pool_id, v_actor);
  if exists (select 1 from public.participants p where p.pool_id = p_pool_id and p.profile_id = v_actor) then
    raise exception 'a platform administrator who participates in a pool cannot intervene in it' using errcode = '42501';
  end if;
  perform public._record_pool_exclusion(p_pool_id, v_actor, 'platform_intervention');
  insert into public.audit_log(tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_tenant, (select p.id from public.profiles p where p.id = v_actor), 'platform.intervention', 'pools', p_pool_id,
          jsonb_build_object('kind', left(p_kind, 60), 'reason', left(p_reason, 500), 'actor', v_actor));
end $$;

create function public.regularize_legacy_conflict(p_conflict_id uuid, p_note text)
returns public.legacy_admin_conflicts language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); c public.legacy_admin_conflicts;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_note is null or char_length(btrim(p_note)) < 10 then
    raise exception 'a note of at least 10 characters is required' using errcode = '22023';
  end if;
  select * into c from public.legacy_admin_conflicts where id = p_conflict_id for update;
  if not found then raise exception 'conflict not found' using errcode = '22023'; end if;
  if c.status = 'regularized' then return c; end if;   -- idempotente
  if v_actor = c.profile_id then raise exception 'the conflicted profile cannot regularize its own conflict' using errcode = '42501'; end if;
  if not public._has_pool_capability(c.pool_id, 'staff', v_actor) then
    if public.is_platform_admin() then
      perform public.register_platform_intervention(c.pool_id, 'regularize_legacy_conflict', p_note);
    else
      raise exception 'not authorized' using errcode = '42501';
    end if;
  end if;
  perform public._lock_pool_governance(c.pool_id, c.profile_id);
  perform set_config('sl.withdrawal', 'on', true);
  update public.participants set withdrawn_at = coalesce(withdrawn_at, clock_timestamp()), withdrawn_by = v_actor where id = c.participant_id;
  perform set_config('sl.withdrawal', 'off', true);
  update public.legacy_admin_conflicts
     set status = 'regularized', resolution = 'participation_withdrawn', resolved_by = v_actor, resolved_at = clock_timestamp(), note = left(p_note, 500)
   where id = c.id returning * into c;
  return c;
end $$;

revoke all on function
  public.assign_pool_staff(uuid, uuid, public.pool_staff_role), public.revoke_pool_staff(uuid, uuid),
  public.transfer_pool_administration(uuid, uuid, uuid), public.withdraw_participation(uuid),
  public.register_platform_intervention(uuid, text, text), public.regularize_legacy_conflict(uuid, text)
  from public, anon;
grant execute on function
  public.assign_pool_staff(uuid, uuid, public.pool_staff_role), public.revoke_pool_staff(uuid, uuid),
  public.transfer_pool_administration(uuid, uuid, uuid), public.withdraw_participation(uuid),
  public.register_platform_intervention(uuid, text, text), public.regularize_legacy_conflict(uuid, text)
  to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 8. join_pool definitivo (2/3 + guarda de filas existentes + conteo sin retirados/excluidos). ACL conservada por CREATE OR REPLACE.
-- ---------------------------------------------------------------------------------------------------------------
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
    -- ADR-015: una fila existente no es salvoconducto (participación retirada o perfil excluido por incompatibilidad).
    if public.is_pool_excluded(v_code.pool_id, v_user) then
      raise exception 'administrators of a pool cannot participate in it' using errcode = '42501', hint = 'ADMIN_PARTICIPANT_INCOMPATIBLE';
    end if;
    if v_participant.withdrawn_at is not null then
      raise exception 'a withdrawn participation cannot be resumed' using errcode = '42501', hint = 'WITHDRAWN';
    end if;
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
      and not public.is_pool_excluded(pool_id, profile_id)
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
