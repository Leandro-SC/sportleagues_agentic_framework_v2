-- Phase 05: keep FREE/PRO capacity and branding checks in PostgreSQL rather
-- than relying on hidden client controls. Existing direct-write grants are
-- replaced by narrowly scoped SECURITY DEFINER functions.

create function public.manage_pool(
  p_action text,
  p_pool_id uuid default null,
  p_tenant_id uuid default null,
  p_name text default null,
  p_lock_offset_minutes integer default null,
  p_requires_approval boolean default null
) returns public.pools
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_pool public.pools;
  v_tenant_id uuid;
  v_active_count integer;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_action = 'create' then
    if p_tenant_id is null or p_name is null or p_lock_offset_minutes is null then raise exception 'tenant, name and lock offset are required' using errcode = '22023'; end if;
    if not public.is_tenant_admin(p_tenant_id) then raise exception 'not authorized' using errcode = '42501'; end if;
    if char_length(btrim(p_name)) not between 1 and 120 or p_lock_offset_minutes not between 0 and 1440 then raise exception 'invalid pool configuration' using errcode = '22023'; end if;
    if exists (select 1 from public.tenant_entitlements where tenant_id = p_tenant_id and plan_code = 'free') then
      select count(*) into v_active_count from public.pools where tenant_id = p_tenant_id and status in ('open', 'paused');
      if v_active_count >= 1 then raise exception 'free plan allows one active pool' using errcode = '22023'; end if;
    end if;
    insert into public.pools(tenant_id, name, status, lock_offset, requires_approval)
      values (p_tenant_id, btrim(p_name), 'draft', make_interval(mins => p_lock_offset_minutes), coalesce(p_requires_approval, false))
      returning * into v_pool;
    return v_pool;
  end if;

  select * into v_pool from public.pools where id = p_pool_id for update;
  if not found then raise exception 'pool not found' using errcode = '22023'; end if;
  v_tenant_id := v_pool.tenant_id;
  if not public.is_tenant_admin(v_tenant_id) then raise exception 'not authorized' using errcode = '42501'; end if;

  if p_action = 'update' then
    if p_name is null or p_lock_offset_minutes is null or char_length(btrim(p_name)) not between 1 and 120 or p_lock_offset_minutes not between 0 and 1440 then raise exception 'invalid pool configuration' using errcode = '22023'; end if;
    update public.pools set name = btrim(p_name), lock_offset = make_interval(mins => p_lock_offset_minutes), requires_approval = coalesce(p_requires_approval, false), updated_at = now() where id = v_pool.id returning * into v_pool;
  elsif p_action = 'open' then
    if exists (select 1 from public.tenant_entitlements where tenant_id = v_tenant_id and plan_code = 'free') then
      select count(*) into v_active_count from public.pools where tenant_id = v_tenant_id and status in ('open', 'paused') and id <> v_pool.id;
      if v_active_count >= 1 then raise exception 'free plan allows one active pool' using errcode = '22023'; end if;
    end if;
    update public.pools set status = 'open', updated_at = now() where id = v_pool.id and status in ('draft', 'paused') returning * into v_pool;
    if not found then raise exception 'pool cannot be opened from its current status' using errcode = '22023'; end if;
  elsif p_action = 'pause' then
    update public.pools set status = 'paused', updated_at = now() where id = v_pool.id and status = 'open' returning * into v_pool;
    if not found then raise exception 'only an open pool can be paused' using errcode = '22023'; end if;
  elsif p_action = 'archive' then
    update public.pools set status = 'archived', updated_at = now() where id = v_pool.id and status <> 'archived' returning * into v_pool;
    if not found then raise exception 'pool is already archived' using errcode = '22023'; end if;
  else
    raise exception 'unsupported pool action' using errcode = '22023';
  end if;
  return v_pool;
end;
$$;

create function public.update_tenant_branding(
  p_tenant_id uuid,
  p_primary_color text,
  p_secondary_color text,
  p_logo_asset_id uuid default null,
  p_banner_asset_id uuid default null
) returns public.tenant_branding
language plpgsql security definer set search_path = public, auth
as $$
declare v_branding public.tenant_branding;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not public.is_tenant_admin(p_tenant_id) then raise exception 'not authorized' using errcode = '42501'; end if;
  if not exists (select 1 from public.tenant_entitlements where tenant_id = p_tenant_id and plan_code = 'pro') then raise exception 'pro branding is required' using errcode = '42501'; end if;
  if (p_primary_color is not null and p_primary_color !~ '^#[0-9A-Fa-f]{6}$') or (p_secondary_color is not null and p_secondary_color !~ '^#[0-9A-Fa-f]{6}$') then raise exception 'invalid branding color' using errcode = '22023'; end if;
  insert into public.tenant_branding(tenant_id, primary_color, secondary_color, logo_asset_id, banner_asset_id)
    values (p_tenant_id, p_primary_color, p_secondary_color, p_logo_asset_id, p_banner_asset_id)
  on conflict (tenant_id) do update set primary_color = excluded.primary_color, secondary_color = excluded.secondary_color, logo_asset_id = excluded.logo_asset_id, banner_asset_id = excluded.banner_asset_id, updated_at = now()
  returning * into v_branding;
  return v_branding;
end;
$$;

revoke insert, update, delete on public.pools, public.tenant_branding from authenticated;
revoke all on function public.manage_pool(text, uuid, uuid, text, integer, boolean), public.update_tenant_branding(uuid, text, text, uuid, uuid) from public;
grant execute on function public.manage_pool(text, uuid, uuid, text, integer, boolean), public.update_tenant_branding(uuid, text, text, uuid, uuid) to authenticated;
