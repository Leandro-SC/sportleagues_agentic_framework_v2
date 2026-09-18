-- Phase 05 corrective hardening: Cloud default function ACLs grant EXECUTE to
-- anon/authenticated at creation time. record_verified_branding_asset must
-- therefore authorize service_role internally and not rely on its GRANT.

create or replace function public.record_verified_branding_asset(
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
  if auth.role() <> 'service_role' then
    raise exception 'record_verified_branding_asset requires service role' using errcode = '42501';
  end if;

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

-- Defense in depth against the project's explicit default ACLs. The internal
-- guard above remains the authorization boundary if an ACL is changed later.
revoke execute on function public.record_verified_branding_asset(uuid, text, bigint, integer, integer, text) from anon, authenticated;
grant execute on function public.record_verified_branding_asset(uuid, text, bigint, integer, integer, text) to service_role;
