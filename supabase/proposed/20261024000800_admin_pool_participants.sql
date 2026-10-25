-- PROPUESTA (2026-10-24): NO aplicada ni ejecutada. Mover a supabase/migrations/ solo tras correr supabase/tests/proposed/admin-pool-participants.sql en rollback.
-- UAT-01 (2026-10-24): el panel de administración no podía listar a los participantes. La vista pedía `participants` con el embed
-- `profiles(display_name)`; PostgREST lo rechaza (no hay FK de participants a profiles; la relación pasa por tenant_memberships)
-- y, aunque existiera, RLS de `profiles` solo deja leer el propio perfil. Forward-only; reversión en
-- supabase/proposed/down/20261024000800_admin_pool_participants.down.sql.
--
-- `admin_pool_participants(pool)` devuelve los participantes con su nombre visible SOLO a quien administra esa quiniela: owner/admin
-- del tenant o personal de la quiniela con capacidad `participants` o `finance` (mismo criterio que F-04/ADR-020). Sin correo ni otra
-- PII. «No existe» y «no autorizado» responden igual (F-01).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function public.admin_pool_participants(p_pool_id uuid)
returns table (id uuid, profile_id uuid, display_name text, approval_status public.participant_approval_status,
               payment_status public.participant_payment_status, withdrawn_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_tenant uuid;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select po.tenant_id into v_tenant from public.pools po where po.id = p_pool_id;
  if v_tenant is null or not (
       public.is_tenant_admin(v_tenant)
       or public._has_pool_capability(p_pool_id, 'participants', v_uid)
       or public._has_pool_capability(p_pool_id, 'finance', v_uid)) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    select pa.id, pa.profile_id, pr.display_name, pa.approval_status, pa.payment_status, pa.withdrawn_at, pa.created_at
      from public.participants pa
      join public.profiles pr on pr.id = pa.profile_id
     where pa.pool_id = p_pool_id and pa.tenant_id = v_tenant
     order by pa.created_at, pa.id;
end $$;
revoke all on function public.admin_pool_participants(uuid) from public, anon;
grant execute on function public.admin_pool_participants(uuid) to authenticated;
