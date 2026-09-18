-- Phase 05: server-authoritative lifecycle for private PRO branding images.
-- ADR-007 defines the Storage path, metadata, lifecycle and trust boundaries.

create type public.branding_asset_kind as enum ('logo', 'banner');
create type public.branding_asset_status as enum ('pending', 'active', 'suspended', 'cleanup_pending', 'deleted');

alter table public.branding_assets
  alter column mime_type drop not null,
  alter column byte_size drop not null,
  add column asset_kind public.branding_asset_kind,
  add column status public.branding_asset_status not null default 'cleanup_pending',
  add column created_by uuid references public.profiles(id),
  add column width integer,
  add column height integer,
  add column sha256 text,
  add column activated_at timestamptz,
  add column deleted_at timestamptz,
  add column retention_until timestamptz;

-- Existing rows predate the trusted image pipeline. Preserve them for later
-- reconciliation, but do not make them eligible for presentation or mutation.
update public.branding_assets
set status = 'cleanup_pending'
where status = 'cleanup_pending';

alter table public.branding_assets
  add constraint branding_assets_server_path_check
    check (storage_path = tenant_id::text || '/' || id::text) not valid,
  add constraint branding_assets_kind_required_check
    check (asset_kind is not null or status in ('cleanup_pending', 'deleted')),
  add constraint branding_assets_creator_required_check
    check (created_by is not null or status in ('cleanup_pending', 'deleted')),
  add constraint branding_assets_verified_metadata_check
    check (
      status in ('pending', 'cleanup_pending', 'deleted')
      or (
        mime_type in ('image/png', 'image/jpeg', 'image/webp')
        and byte_size is not null
        and width is not null
        and height is not null
        and sha256 is not null
      )
    ),
  add constraint branding_assets_sha256_check
    check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  add constraint branding_assets_dimensions_check
    check (
      (width is null and height is null)
      or (
        width > 0 and height > 0
        and (
          (asset_kind = 'logo' and width between 256 and 2048 and height between 256 and 2048)
          or (asset_kind = 'banner' and width between 1200 and 2400 and height between 450 and 900)
        )
      )
    ),
  add constraint branding_assets_size_check
    check (
      byte_size is null
      or status in ('cleanup_pending', 'deleted')
      or (asset_kind = 'logo' and byte_size between 1 and 1048576)
      or (asset_kind = 'banner' and byte_size between 1 and 2097152)
    ),
  add constraint branding_assets_active_at_check
    check (status <> 'active' or activated_at is not null),
  add constraint branding_assets_deleted_at_check
    check ((status = 'deleted') = (deleted_at is not null)),
  add constraint branding_assets_retention_check
    check ((status = 'suspended') = (retention_until is not null));

create index branding_assets_tenant_status_kind_idx
  on public.branding_assets(tenant_id, status, asset_kind);

create function public.assert_tenant_branding_asset_slots()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.logo_asset_id is not null and not exists (
    select 1 from public.branding_assets a
    where a.id = new.logo_asset_id
      and a.tenant_id = new.tenant_id
      and a.asset_kind = 'logo'
      and a.status = 'active'
  ) then
    raise exception 'logo asset must be an active logo of the tenant' using errcode = '23514';
  end if;
  if new.banner_asset_id is not null and not exists (
    select 1 from public.branding_assets a
    where a.id = new.banner_asset_id
      and a.tenant_id = new.tenant_id
      and a.asset_kind = 'banner'
      and a.status = 'active'
  ) then
    raise exception 'banner asset must be an active banner of the tenant' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger tenant_branding_asset_slots_check
before insert or update of logo_asset_id, banner_asset_id on public.tenant_branding
for each row execute function public.assert_tenant_branding_asset_slots();

-- The color RPC remains compatible with the current client signature, but asset
-- references are now exclusively controlled by lifecycle RPCs below.
create or replace function public.update_tenant_branding(
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
  if not exists (select 1 from public.tenant_entitlements e where e.tenant_id = p_tenant_id and e.plan_code = 'pro') then raise exception 'pro branding is required' using errcode = '42501'; end if;
  if p_logo_asset_id is not null or p_banner_asset_id is not null then raise exception 'asset references must use branding lifecycle RPCs' using errcode = '22023'; end if;
  if (p_primary_color is not null and p_primary_color !~ '^#[0-9A-Fa-f]{6}$') or (p_secondary_color is not null and p_secondary_color !~ '^#[0-9A-Fa-f]{6}$') then raise exception 'invalid branding color' using errcode = '22023'; end if;
  insert into public.tenant_branding(tenant_id, primary_color, secondary_color)
    values (p_tenant_id, p_primary_color, p_secondary_color)
  on conflict (tenant_id) do update set primary_color = excluded.primary_color, secondary_color = excluded.secondary_color, updated_at = now()
  returning * into v_branding;
  return v_branding;
end;
$$;

create function public.begin_branding_asset(
  p_tenant_id uuid,
  p_asset_kind public.branding_asset_kind
) returns public.branding_assets
language plpgsql security definer set search_path = public, auth
as $$
declare v_asset public.branding_assets;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not public.is_tenant_admin(p_tenant_id) then raise exception 'not authorized' using errcode = '42501'; end if;
  if not exists (select 1 from public.tenant_entitlements e where e.tenant_id = p_tenant_id and e.plan_code = 'pro') then raise exception 'pro branding is required' using errcode = '42501'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_asset_kind::text, 0));
  update public.branding_assets
    set status = 'cleanup_pending'
    where tenant_id = p_tenant_id and asset_kind = p_asset_kind and status = 'pending';

  v_asset.id := gen_random_uuid();
  insert into public.branding_assets(id, tenant_id, storage_path, asset_kind, status, created_by)
    values (v_asset.id, p_tenant_id, p_tenant_id::text || '/' || v_asset.id::text, p_asset_kind, 'pending', auth.uid())
    returning * into v_asset;
  return v_asset;
end;
$$;

create function public.record_verified_branding_asset(
  p_asset_id uuid,
  p_mime_type text,
  p_byte_size bigint,
  p_width integer,
  p_height integer,
  p_sha256 text
) returns public.branding_assets
language plpgsql security definer set search_path = public, auth
as $$
declare v_asset public.branding_assets;
begin
  select * into v_asset from public.branding_assets where id = p_asset_id for update;
  if not found then raise exception 'branding asset not found' using errcode = '22023'; end if;
  if v_asset.status <> 'pending' then raise exception 'branding asset is not pending' using errcode = '22023'; end if;
  if v_asset.sha256 is not null then
    if v_asset.sha256 = lower(p_sha256) then return v_asset; end if;
    raise exception 'branding asset was already verified with different content' using errcode = '22023';
  end if;
  if v_asset.storage_path <> (v_asset.tenant_id::text || '/' || v_asset.id::text) then raise exception 'branding asset path is invalid' using errcode = '23514'; end if;
  if p_mime_type is null or p_mime_type not in ('image/png', 'image/jpeg', 'image/webp') or p_byte_size is null or p_byte_size <= 0 or p_width is null or p_width <= 0 or p_height is null or p_height <= 0 or p_sha256 is null or lower(p_sha256) !~ '^[0-9a-f]{64}$' then raise exception 'invalid verified branding metadata' using errcode = '22023'; end if;

  update public.branding_assets
    set mime_type = p_mime_type,
        byte_size = p_byte_size,
        width = p_width,
        height = p_height,
        sha256 = lower(p_sha256)
    where id = v_asset.id
    returning * into v_asset;
  return v_asset;
end;
$$;

create function public.activate_branding_asset(p_asset_id uuid)
returns public.tenant_branding
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_asset public.branding_assets;
  v_branding public.tenant_branding;
  v_previous_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into v_asset from public.branding_assets where id = p_asset_id for update;
  if not found then raise exception 'branding asset not found' using errcode = '22023'; end if;
  if not public.is_tenant_admin(v_asset.tenant_id) then raise exception 'not authorized' using errcode = '42501'; end if;
  if not exists (select 1 from public.tenant_entitlements e where e.tenant_id = v_asset.tenant_id and e.plan_code = 'pro') then raise exception 'pro branding is required' using errcode = '42501'; end if;
  if v_asset.status = 'active' then
    select * into v_branding from public.tenant_branding where tenant_id = v_asset.tenant_id;
    if (v_asset.asset_kind = 'logo' and v_branding.logo_asset_id = v_asset.id) or (v_asset.asset_kind = 'banner' and v_branding.banner_asset_id = v_asset.id) then return v_branding; end if;
    raise exception 'branding asset is already active' using errcode = '22023';
  end if;
  if v_asset.status <> 'pending' or v_asset.mime_type is null or v_asset.byte_size is null or v_asset.width is null or v_asset.height is null or v_asset.sha256 is null then raise exception 'branding asset is not verified and pending' using errcode = '22023'; end if;

  insert into public.tenant_branding(tenant_id) values (v_asset.tenant_id) on conflict (tenant_id) do nothing;
  select * into v_branding from public.tenant_branding where tenant_id = v_asset.tenant_id for update;
  v_previous_id := case when v_asset.asset_kind = 'logo' then v_branding.logo_asset_id else v_branding.banner_asset_id end;

  update public.branding_assets set status = 'active', activated_at = now(), retention_until = null where id = v_asset.id;
  if v_asset.asset_kind = 'logo' then
    update public.tenant_branding set logo_asset_id = v_asset.id, updated_at = now() where tenant_id = v_asset.tenant_id returning * into v_branding;
  else
    update public.tenant_branding set banner_asset_id = v_asset.id, updated_at = now() where tenant_id = v_asset.tenant_id returning * into v_branding;
  end if;
  if v_previous_id is not null and v_previous_id <> v_asset.id then
    update public.branding_assets set status = 'cleanup_pending', retention_until = null where id = v_previous_id and status = 'active';
  end if;
  return v_branding;
end;
$$;

create function public.remove_branding_asset(
  p_tenant_id uuid,
  p_asset_kind public.branding_asset_kind
) returns public.branding_assets
language plpgsql security definer set search_path = public, auth
as $$
declare v_branding public.tenant_branding; v_asset public.branding_assets; v_asset_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not public.is_tenant_admin(p_tenant_id) then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into v_branding from public.tenant_branding where tenant_id = p_tenant_id for update;
  if not found then return null; end if;
  v_asset_id := case when p_asset_kind = 'logo' then v_branding.logo_asset_id else v_branding.banner_asset_id end;
  if v_asset_id is null then return null; end if;
  select * into v_asset from public.branding_assets where id = v_asset_id for update;
  if not found or v_asset.tenant_id <> p_tenant_id or v_asset.asset_kind <> p_asset_kind then raise exception 'branding reference is invalid' using errcode = '23514'; end if;

  if p_asset_kind = 'logo' then
    update public.tenant_branding set logo_asset_id = null, updated_at = now() where tenant_id = p_tenant_id;
  else
    update public.tenant_branding set banner_asset_id = null, updated_at = now() where tenant_id = p_tenant_id;
  end if;
  update public.branding_assets set status = 'cleanup_pending', retention_until = null where id = v_asset.id returning * into v_asset;
  return v_asset;
end;
$$;

create function public.get_active_branding_assets(p_tenant_id uuid)
returns table(asset_id uuid, asset_kind public.branding_asset_kind, storage_path text, mime_type text, byte_size bigint, width integer, height integer)
language sql stable security invoker set search_path = public, auth
as $$
  select a.id, a.asset_kind, a.storage_path, a.mime_type, a.byte_size, a.width, a.height
  from public.tenant_branding b
  join public.branding_assets a on a.tenant_id = b.tenant_id and a.id in (b.logo_asset_id, b.banner_asset_id)
  join public.tenant_entitlements e on e.tenant_id = b.tenant_id and e.plan_code = 'pro'
  where b.tenant_id = p_tenant_id
    and a.status = 'active'
    and public.is_tenant_member(p_tenant_id);
$$;

create function public.suspend_branding_on_plan_downgrade()
returns trigger
language plpgsql security definer set search_path = public, auth
as $$
begin
  if old.plan_code = 'pro' and new.plan_code = 'free' then
    update public.branding_assets
      set status = 'suspended', retention_until = now() + interval '30 days'
      where tenant_id = new.tenant_id and status = 'active';
    update public.tenant_branding
      set logo_asset_id = null, banner_asset_id = null, primary_color = null, secondary_color = null, updated_at = now()
      where tenant_id = new.tenant_id;
  end if;
  return new;
end;
$$;

create trigger tenant_entitlements_suspend_branding_on_downgrade
after update of plan_code on public.tenant_entitlements
for each row execute function public.suspend_branding_on_plan_downgrade();

create function public.can_read_active_branding_object(p_name text)
returns boolean
language sql stable security definer set search_path = public, auth
as $$
  select exists (
    select 1
    from public.branding_assets a
    join public.tenant_branding b on b.tenant_id = a.tenant_id and a.id in (b.logo_asset_id, b.banner_asset_id)
    join public.tenant_entitlements e on e.tenant_id = a.tenant_id and e.plan_code = 'pro'
    join public.tenant_memberships m on m.tenant_id = a.tenant_id and m.profile_id = auth.uid() and m.is_active
    where a.storage_path = p_name and a.status = 'active'
  );
$$;

revoke insert, update, delete on public.branding_assets from authenticated, anon;
drop policy if exists branding_assets_select_member on public.branding_assets;
create policy branding_assets_select_active_member on public.branding_assets
  for select to authenticated
  using (
    status = 'active'
    and exists (
      select 1 from public.tenant_branding b
      join public.tenant_entitlements e on e.tenant_id = b.tenant_id and e.plan_code = 'pro'
      where b.tenant_id = branding_assets.tenant_id
        and branding_assets.id in (b.logo_asset_id, b.banner_asset_id)
    )
    and public.is_tenant_member(tenant_id)
  );

update storage.buckets
  set public = false,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']::text[]
  where id = 'branding-assets';
drop policy if exists branding_assets_storage_select on storage.objects;
drop policy if exists branding_assets_storage_insert on storage.objects;
drop policy if exists branding_assets_storage_update on storage.objects;
drop policy if exists branding_assets_storage_delete on storage.objects;
revoke insert, update, delete on storage.objects from authenticated, anon;
create policy branding_assets_storage_select_active_member on storage.objects
  for select to authenticated
  using (bucket_id = 'branding-assets' and public.can_read_active_branding_object(name));

revoke all on function public.assert_tenant_branding_asset_slots(), public.begin_branding_asset(uuid, public.branding_asset_kind), public.record_verified_branding_asset(uuid, text, bigint, integer, integer, text), public.activate_branding_asset(uuid), public.remove_branding_asset(uuid, public.branding_asset_kind), public.get_active_branding_assets(uuid), public.suspend_branding_on_plan_downgrade(), public.can_read_active_branding_object(text) from public;
grant execute on function public.begin_branding_asset(uuid, public.branding_asset_kind), public.activate_branding_asset(uuid), public.remove_branding_asset(uuid, public.branding_asset_kind), public.get_active_branding_assets(uuid), public.can_read_active_branding_object(text) to authenticated;
grant execute on function public.record_verified_branding_asset(uuid, text, bigint, integer, integer, text) to service_role;
