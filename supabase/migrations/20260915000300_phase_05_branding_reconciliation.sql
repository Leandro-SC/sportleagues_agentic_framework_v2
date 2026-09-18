-- Phase 05: service-only reconciliation for private branding asset lifecycle.
-- The Edge Function owns Storage calls; PostgreSQL owns lifecycle transitions.

alter table public.branding_assets
  add column reconciliation_token uuid,
  add column reconciliation_claimed_at timestamptz,
  add column reconciliation_checked_at timestamptz,
  add constraint branding_assets_reconciliation_claim_check
    check ((reconciliation_token is null) = (reconciliation_claimed_at is null));

create index branding_assets_reconciliation_idx
  on public.branding_assets(status, created_at)
  where reconciliation_token is null;

create function public.assert_branding_reconciler_service_role()
returns void
language plpgsql security definer set search_path = public, auth
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'branding reconciler requires service role' using errcode = '42501';
  end if;
end;
$$;

create function public.claim_branding_assets_for_reconciliation(
  p_batch_size integer default 50,
  p_pending_before timestamptz default now() - interval '1 hour',
  p_claim_timeout interval default interval '15 minutes'
)
returns table(asset_id uuid, storage_path text, source_status public.branding_asset_status, reconciliation_token uuid)
language plpgsql security definer set search_path = public, auth
as $$
begin
  perform public.assert_branding_reconciler_service_role();
  if p_batch_size not between 1 and 50 then raise exception 'invalid reconciliation batch size' using errcode = '22023'; end if;
  if p_pending_before > now() or p_claim_timeout <= interval '0 seconds' then raise exception 'invalid reconciliation window' using errcode = '22023'; end if;

  return query
  with candidates as (
    select a.id, a.status as previous_status, gen_random_uuid() as claim_token
    from public.branding_assets a
    left join public.tenant_branding b
      on b.tenant_id = a.tenant_id and a.id in (b.logo_asset_id, b.banner_asset_id)
    left join public.tenant_entitlements e on e.tenant_id = a.tenant_id
    where (a.reconciliation_token is null or a.reconciliation_claimed_at < now() - p_claim_timeout)
      and (
        (a.status = 'pending' and a.created_at <= p_pending_before)
        or a.status = 'cleanup_pending'
        or (a.status = 'suspended' and a.retention_until <= now() and e.plan_code = 'free' and b.tenant_id is null)
        or a.status = 'active'
      )
    order by case when a.status = 'active' then 1 else 0 end, coalesce(a.reconciliation_checked_at, a.created_at), a.id
    limit p_batch_size
    for update of a skip locked
  ), claimed as (
    update public.branding_assets a
      set status = case when c.previous_status = 'active' then a.status else 'cleanup_pending' end,
          retention_until = case when c.previous_status = 'active' then a.retention_until else null end,
          reconciliation_token = c.claim_token, reconciliation_claimed_at = now()
    from candidates c
    where a.id = c.id and a.status in ('pending', 'cleanup_pending', 'suspended', 'active')
    returning a.id, a.storage_path, c.previous_status, a.reconciliation_token
  )
  select c.id, c.storage_path, c.previous_status, c.reconciliation_token from claimed c;
end;
$$;

create function public.release_branding_asset_reconciliation_claim(p_asset_id uuid, p_reconciliation_token uuid)
returns boolean
language plpgsql security definer set search_path = public, auth
as $$
begin
  perform public.assert_branding_reconciler_service_role();
  update public.branding_assets
    set reconciliation_token = null, reconciliation_claimed_at = null, reconciliation_checked_at = now()
    where id = p_asset_id and reconciliation_token = p_reconciliation_token;
  return found;
end;
$$;

create function public.complete_branding_asset_reconciliation(p_asset_id uuid, p_reconciliation_token uuid)
returns boolean
language plpgsql security definer set search_path = public, auth
as $$
declare v_asset public.branding_assets;
begin
  perform public.assert_branding_reconciler_service_role();
  select * into v_asset from public.branding_assets where id = p_asset_id for update;
  if not found or v_asset.status <> 'cleanup_pending'
    or v_asset.reconciliation_token is distinct from p_reconciliation_token
    or exists (
      select 1 from public.tenant_branding b
      where b.tenant_id = v_asset.tenant_id and v_asset.id in (b.logo_asset_id, b.banner_asset_id)
    ) then return false; end if;

  update public.branding_assets
    set status = 'deleted', deleted_at = now(), retention_until = null,
        reconciliation_token = null, reconciliation_claimed_at = null
    where id = v_asset.id;
  return true;
end;
$$;

create function public.record_branding_reconciliation_issue(p_asset_id uuid, p_issue text)
returns boolean
language plpgsql security definer set search_path = public, auth
as $$
declare v_asset public.branding_assets;
begin
  perform public.assert_branding_reconciler_service_role();
  if p_issue not in ('active_object_missing', 'deleted_object_present', 'storage_object_unknown') then
    raise exception 'invalid branding reconciliation issue' using errcode = '22023';
  end if;
  select * into v_asset from public.branding_assets where id = p_asset_id;
  if not found then return false; end if;
  if not exists (
    select 1 from public.audit_log l
    where l.tenant_id = v_asset.tenant_id and l.entity_type = 'branding_asset' and l.entity_id = v_asset.id
      and l.action = 'branding_reconciliation_' || p_issue and l.created_at > now() - interval '1 hour'
  ) then
    insert into public.audit_log(tenant_id, actor_id, action, entity_type, entity_id, metadata)
      values (v_asset.tenant_id, null, 'branding_reconciliation_' || p_issue, 'branding_asset', v_asset.id, jsonb_build_object('source', 'branding_reconciler'));
  end if;
  return true;
end;
$$;

create function public.get_branding_asset_for_reconciliation(p_asset_id uuid, p_storage_path text)
returns table(asset_id uuid, storage_path text, status public.branding_asset_status)
language sql stable security definer set search_path = public, auth
as $$
  select a.id, a.storage_path, a.status
  from public.branding_assets a
  where a.id = p_asset_id and a.storage_path = p_storage_path and auth.role() = 'service_role';
$$;

revoke all on function public.assert_branding_reconciler_service_role(), public.claim_branding_assets_for_reconciliation(integer, timestamptz, interval), public.release_branding_asset_reconciliation_claim(uuid, uuid), public.complete_branding_asset_reconciliation(uuid, uuid), public.record_branding_reconciliation_issue(uuid, text), public.get_branding_asset_for_reconciliation(uuid, text) from public;
grant execute on function public.assert_branding_reconciler_service_role(), public.claim_branding_assets_for_reconciliation(integer, timestamptz, interval), public.release_branding_asset_reconciliation_claim(uuid, uuid), public.complete_branding_asset_reconciliation(uuid, uuid), public.record_branding_reconciliation_issue(uuid, text), public.get_branding_asset_for_reconciliation(uuid, text) to service_role;
