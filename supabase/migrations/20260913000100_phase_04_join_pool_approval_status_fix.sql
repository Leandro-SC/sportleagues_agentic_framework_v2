-- Phase 04 hotfix: CASE expressions in join_pool resolve to text unless their
-- branches are explicitly typed. participants.approval_status is an enum, so
-- replace the function forward-only without altering data, RLS or constraints.
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
