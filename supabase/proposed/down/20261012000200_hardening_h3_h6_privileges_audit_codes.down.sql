-- ROLLBACK de 2/3 (privilegios, auditoría, códigos, join_pool). NO EJECUTAR en QA. Solo en el proyecto descartable.
-- ATENCIÓN: NO restaura los privilegios inseguros anteriores (TRUNCATE/REFERENCES/TRIGGER, anon I/U/D, EXECUTE a anon/PUBLIC):
-- volver a ese estado es un retroceso de seguridad y requiere aprobación expresa; las sentencias están comentadas al final.
-- Quita la inmutabilidad de audit_log solo si se confirma con sl.allow_destructive_rollback = on.
set local lock_timeout = '5s';
do $$
begin
  if coalesce(current_setting('sl.allow_destructive_rollback', true), 'off') <> 'on' then
    raise exception 'rollback removes audit protections; set sl.allow_destructive_rollback=on to confirm';
  end if;
end $$;

do $$
begin
  if to_regclass('public.pool_staff') is not null then
    raise exception 'roll back 3/3 first (pool_staff still exists)';
  end if;
end $$;

drop trigger if exists audit_official_results on public.official_results;
drop trigger if exists audit_tenant_memberships on public.tenant_memberships;
drop trigger if exists audit_tournaments on public.tournaments;
drop trigger if exists audit_rounds on public.rounds;
drop trigger if exists audit_pool_matches on public.pool_matches;
drop trigger if exists audit_matches on public.matches;
drop trigger if exists audit_participants on public.participants;
drop trigger if exists audit_pool_join_codes on public.pool_join_codes;
drop trigger if exists audit_pool_rules on public.pool_rules;
drop trigger if exists audit_pools on public.pools;
drop function if exists public.tg_audit_row_change();

alter table public.audit_log add constraint audit_log_actor_id_fkey foreign key (actor_id) references public.profiles(id) not valid;
drop trigger if exists audit_log_no_truncate on public.audit_log;
drop trigger if exists audit_log_no_update_delete on public.audit_log;
drop function if exists public.verify_audit_protection();
drop function if exists public.tg_append_only();

create policy pool_join_codes_select_member on public.pool_join_codes for select to authenticated using (public.is_tenant_member(tenant_id));

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


-- Retroceso de privilegios (NO ejecutar sin aprobación de Security):
-- grant truncate, references, trigger on all tables in schema public to anon, authenticated;
-- grant insert, update, delete on all tables in schema public to anon;
-- grant execute on all functions in schema public to anon;
