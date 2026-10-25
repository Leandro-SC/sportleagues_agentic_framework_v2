-- Eliminación de cuenta desde la app (ADR-026, 2026-10-24). Forward-only; reversión en
-- supabase/proposed/down/20261024000400_account_deletion.down.sql.
--
-- Requisito de Google Play para apps con registro y derecho del titular de los datos. Se aplica la «baja lógica primero» del borrador
-- D22: no se borran en cascada resultados, puntos, auditoría ni pagos manuales; se anonimiza la persona y se cierra el acceso.
--   1. `account_deletion_blockers()` (el propio usuario): motivos que impiden borrar ya (administra una organización o una quiniela).
--   2. `anonymize_account(profile)` (solo service_role, la llama la Edge Function `delete-account`): perfil «Usuario eliminado»,
--      membresías inactivas, avisos borrados y un registro en audit_log por organización, sin PII.
--   3. La Edge Function borra la identidad de Auth en modo suave (email y teléfono anonimizados, sesiones revocadas).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.profiles add column deleted_at timestamptz;

create function public._account_deletion_blockers(p_profile uuid) returns text[]
language sql stable security definer set search_path = ''
as $$
  select array_remove(array[
    case when exists (select 1 from public.tenant_memberships m where m.profile_id = p_profile and m.is_active and m.role in ('owner', 'admin'))
         then 'ADMINISTERS_ORGANIZATION' end,
    case when exists (select 1 from public.pool_staff s where s.profile_id = p_profile and s.is_active)
         then 'ADMINISTERS_POOL' end
  ], null)
$$;
revoke all on function public._account_deletion_blockers(uuid) from public, anon, authenticated;

create function public.account_deletion_blockers() returns text[]
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  return public._account_deletion_blockers(auth.uid());
end $$;
revoke all on function public.account_deletion_blockers() from public, anon;
grant execute on function public.account_deletion_blockers() to authenticated;

create function public.anonymize_account(p_profile uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_blockers text[]; t record;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_profile is null or not exists (select 1 from public.profiles where id = p_profile) then
    raise exception 'profile not found' using errcode = '22023';
  end if;
  v_blockers := public._account_deletion_blockers(p_profile);
  if cardinality(v_blockers) > 0 then
    raise exception 'account has administrative roles' using errcode = '42501', hint = array_to_string(v_blockers, ',');
  end if;
  -- Registro sin PII en cada organización a la que pertenecía (audit_log exige tenant).
  for t in select distinct m.tenant_id from public.tenant_memberships m where m.profile_id = p_profile loop
    insert into public.audit_log(tenant_id, actor_id, action, entity_type, entity_id, metadata)
    values (t.tenant_id, null, 'account.deleted', 'profiles', p_profile, jsonb_build_object('reason', 'user_request'));
  end loop;
  update public.tenant_memberships set is_active = false, updated_at = now() where profile_id = p_profile and is_active;
  delete from public.notifications where profile_id = p_profile;
  update public.profiles set display_name = 'Usuario eliminado', deleted_at = coalesce(deleted_at, clock_timestamp()), updated_at = now() where id = p_profile;
end $$;
revoke all on function public.anonymize_account(uuid) from public, anon, authenticated;
grant execute on function public.anonymize_account(uuid) to service_role;
