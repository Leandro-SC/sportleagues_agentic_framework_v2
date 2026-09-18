-- Phase 05: admin RPCs for participant approval/payment status, atomic pool rule versioning
-- and server-generated join codes. These operations were intentionally left without a direct
-- client-write grant in the Phase 03 migration because they are either revoked entirely
-- (participants) or require atomicity/generation that a bare client insert/update cannot
-- guarantee (pool_rules current-version swap, pool_join_codes uniqueness).

create function public.approve_participant(p_participant_id uuid) returns public.participants language plpgsql security definer set search_path = public, auth as $$
declare v_participant public.participants;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into v_participant from public.participants where id = p_participant_id for update;
  if not found then raise exception 'participant not found' using errcode = '22023'; end if;
  if not public.is_tenant_admin(v_participant.tenant_id) then raise exception 'not authorized' using errcode = '42501'; end if;
  update public.participants set approval_status = 'approved', updated_at = now() where id = p_participant_id returning * into v_participant;
  return v_participant;
end $$;

create function public.set_participant_payment_status(p_participant_id uuid, p_status public.participant_payment_status) returns public.participants language plpgsql security definer set search_path = public, auth as $$
declare v_participant public.participants;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into v_participant from public.participants where id = p_participant_id for update;
  if not found then raise exception 'participant not found' using errcode = '22023'; end if;
  if not public.is_tenant_admin(v_participant.tenant_id) then raise exception 'not authorized' using errcode = '42501'; end if;
  update public.participants set payment_status = p_status, updated_at = now() where id = p_participant_id returning * into v_participant;
  return v_participant;
end $$;

create function public.publish_pool_rules(p_pool_id uuid, p_exact_points integer, p_outcome_points integer, p_tie_breaker public.tie_breaker_kind, p_bonus_rules jsonb default '[]'::jsonb) returns public.pool_rules language plpgsql security definer set search_path = public, auth as $$
declare v_tenant_id uuid; v_next_version integer; v_rule public.pool_rules;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select tenant_id into v_tenant_id from public.pools where id = p_pool_id for update;
  if v_tenant_id is null then raise exception 'pool not found' using errcode = '22023'; end if;
  if not public.is_tenant_admin(v_tenant_id) then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_exact_points < 0 or p_outcome_points < 0 then raise exception 'points must be non-negative' using errcode = '22023'; end if;
  if jsonb_typeof(p_bonus_rules) <> 'array' then raise exception 'bonus_rules must be a json array' using errcode = '22023'; end if;
  select coalesce(max(version), 0) + 1 into v_next_version from public.pool_rules where pool_id = p_pool_id;
  update public.pool_rules set is_current = false where pool_id = p_pool_id and is_current;
  insert into public.pool_rules(tenant_id, pool_id, version, exact_points, outcome_points, tie_breaker, bonus_rules, is_current)
    values (v_tenant_id, p_pool_id, v_next_version, p_exact_points, p_outcome_points, p_tie_breaker, p_bonus_rules, true)
    returning * into v_rule;
  return v_rule;
end $$;

create function public.create_pool_join_code(p_pool_id uuid, p_expires_at timestamptz default null) returns public.pool_join_codes language plpgsql security definer set search_path = public, auth as $$
declare v_tenant_id uuid; v_code text; v_result public.pool_join_codes; v_attempt integer := 0;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select tenant_id into v_tenant_id from public.pools where id = p_pool_id;
  if v_tenant_id is null then raise exception 'pool not found' using errcode = '22023'; end if;
  if not public.is_tenant_admin(v_tenant_id) then raise exception 'not authorized' using errcode = '42501'; end if;
  loop
    v_attempt := v_attempt + 1;
    v_code := upper(substr(md5(gen_random_uuid()::text), 1, 6));
    begin
      insert into public.pool_join_codes(tenant_id, pool_id, code, expires_at) values (v_tenant_id, p_pool_id, v_code, p_expires_at) returning * into v_result;
      return v_result;
    exception when unique_violation then
      if v_attempt >= 10 then raise exception 'could not generate a unique join code' using errcode = '40001'; end if;
    end;
  end loop;
end $$;

revoke all on function public.approve_participant(uuid), public.set_participant_payment_status(uuid, public.participant_payment_status), public.publish_pool_rules(uuid, integer, integer, public.tie_breaker_kind, jsonb), public.create_pool_join_code(uuid, timestamptz) from public;
grant execute on function public.approve_participant(uuid), public.set_participant_payment_status(uuid, public.participant_payment_status), public.publish_pool_rules(uuid, integer, integer, public.tie_breaker_kind, jsonb), public.create_pool_join_code(uuid, timestamptz) to authenticated;

-- Version swaps and code generation must go through the RPCs above; remove the direct-write
-- surface that Phase 03 granted broadly so the client cannot bypass atomicity/uniqueness.
revoke insert, update, delete on public.pool_rules from authenticated;
revoke insert on public.pool_join_codes from authenticated;
