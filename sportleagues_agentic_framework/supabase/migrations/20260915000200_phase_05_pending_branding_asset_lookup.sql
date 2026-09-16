-- Phase 05: authenticated pre-upload lookup for the branding Edge Function.
-- Pending assets remain hidden by RLS; this narrowly scoped RPC is the only
-- user-JWT path that discloses the data required to upload one of them.

create function public.get_pending_branding_asset_for_upload(p_asset_id uuid)
returns table(
  asset_id uuid,
  tenant_id uuid,
  storage_path text,
  asset_kind public.branding_asset_kind
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_asset public.branding_assets;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;

  select * into v_asset
  from public.branding_assets
  where id = p_asset_id;
  if not found then raise exception 'branding asset not found' using errcode = '22023'; end if;

  if not public.is_tenant_admin(v_asset.tenant_id) then raise exception 'not authorized' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.tenant_entitlements e
    where e.tenant_id = v_asset.tenant_id and e.plan_code = 'pro'
  ) then raise exception 'pro branding is required' using errcode = '42501'; end if;
  if v_asset.status <> 'pending' then raise exception 'branding asset is not pending' using errcode = '22023'; end if;

  return query select v_asset.id, v_asset.tenant_id, v_asset.storage_path, v_asset.asset_kind;
end;
$$;

revoke all on function public.get_pending_branding_asset_for_upload(uuid) from public;
grant execute on function public.get_pending_branding_asset_for_upload(uuid) to authenticated;
