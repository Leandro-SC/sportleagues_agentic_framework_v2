-- Run after all Phase 05 migrations and phase-03-development.sql using a
-- privileged local test role. Every assertion rolls back its data changes.
begin;
set local role authenticated;

-- Owner B (PRO) can start, verify through the internal server path and activate a logo.
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
select set_config('test.logo_one', (select (public.begin_branding_asset('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'logo')).id::text), true);
do $$ begin
  if (select storage_path from public.branding_assets where id = current_setting('test.logo_one')::uuid) <> ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/' || current_setting('test.logo_one')) then
    raise exception 'begin_branding_asset did not derive the canonical storage path';
  end if;
end $$;

-- The same owner may start either slot; a newer pending asset for a slot supersedes
-- an older pending one rather than leaving concurrent client-controlled uploads.
select set_config('test.owner_banner_pending', (select (public.begin_branding_asset('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'banner')).id::text), true);
do $$ begin
  if (select asset_kind from public.branding_assets where id = current_setting('test.owner_banner_pending')::uuid) <> 'banner' then raise exception 'owner PRO did not start banner'; end if;
end $$;

-- The future Edge Function may resolve exactly one pending asset through the
-- caller JWT. Pending rows remain hidden from ordinary RLS reads.
do $$ declare v_result record; begin
  select * into v_result from public.get_pending_branding_asset_for_upload(current_setting('test.owner_banner_pending')::uuid);
  if v_result.asset_id <> current_setting('test.owner_banner_pending')::uuid or v_result.tenant_id <> 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' or v_result.storage_path <> ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/' || current_setting('test.owner_banner_pending')) or v_result.asset_kind <> 'banner' then raise exception 'owner PRO pending lookup returned an invalid contract'; end if;
end $$;

-- Admin B can use the same narrow pending lookup, while member and tenant-A
-- owner are denied without broadening the pending-asset RLS policy.
select set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', true);
do $$ begin
  if not exists (select 1 from public.get_pending_branding_asset_for_upload(current_setting('test.owner_banner_pending')::uuid)) then raise exception 'admin PRO could not read pending asset'; end if;
end $$;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);
do $$ begin begin perform public.get_pending_branding_asset_for_upload(current_setting('test.owner_banner_pending')::uuid); raise exception 'member read pending asset'; exception when others then if sqlerrm <> 'not authorized' then raise; end if; end; end $$;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$ begin begin perform public.get_pending_branding_asset_for_upload(current_setting('test.owner_banner_pending')::uuid); raise exception 'cross-tenant owner read pending asset'; exception when others then if sqlerrm <> 'not authorized' then raise; end if; end; end $$;

-- FREE and non-pending states are denied with controlled errors.
set local role service_role;
insert into public.branding_assets(id, tenant_id, storage_path, asset_kind, status, created_by)
values ('aaaaaaaa-0000-0000-0000-000000000091', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/aaaaaaaa-0000-0000-0000-000000000091', 'logo', 'pending', '11111111-1111-1111-1111-111111111111');
insert into public.branding_assets(id, tenant_id, storage_path, asset_kind, status, created_by, mime_type, byte_size, width, height, sha256, activated_at)
values ('bbbbbbbb-0000-0000-0000-000000000091', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/bbbbbbbb-0000-0000-0000-000000000091', 'logo', 'active', '44444444-4444-4444-4444-444444444444', 'image/webp', 100000, 512, 512, repeat('9', 64), now());
insert into public.branding_assets(id, tenant_id, storage_path, asset_kind, status, created_by, mime_type, byte_size, width, height, sha256, retention_until)
values ('bbbbbbbb-0000-0000-0000-000000000092', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/bbbbbbbb-0000-0000-0000-000000000092', 'logo', 'suspended', '44444444-4444-4444-4444-444444444444', 'image/webp', 100000, 512, 512, repeat('8', 64), now() + interval '30 days');
insert into public.branding_assets(id, tenant_id, storage_path, asset_kind, status, created_by)
values ('bbbbbbbb-0000-0000-0000-000000000093', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/bbbbbbbb-0000-0000-0000-000000000093', 'logo', 'cleanup_pending', '44444444-4444-4444-4444-444444444444');
insert into public.branding_assets(id, tenant_id, storage_path, asset_kind, status, created_by, deleted_at)
values ('bbbbbbbb-0000-0000-0000-000000000094', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/bbbbbbbb-0000-0000-0000-000000000094', 'logo', 'deleted', '44444444-4444-4444-4444-444444444444', now());
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$ begin begin perform public.get_pending_branding_asset_for_upload('aaaaaaaa-0000-0000-0000-000000000091'); raise exception 'FREE owner read pending asset'; exception when others then if sqlerrm <> 'pro branding is required' then raise; end if; end; end $$;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
do $$ begin
  begin perform public.get_pending_branding_asset_for_upload('bbbbbbbb-0000-0000-0000-000000000091'); raise exception 'active asset passed pending lookup'; exception when others then if sqlerrm <> 'branding asset is not pending' then raise; end if; end;
  begin perform public.get_pending_branding_asset_for_upload('bbbbbbbb-0000-0000-0000-000000000092'); raise exception 'suspended asset passed pending lookup'; exception when others then if sqlerrm <> 'branding asset is not pending' then raise; end if; end;
  begin perform public.get_pending_branding_asset_for_upload('bbbbbbbb-0000-0000-0000-000000000093'); raise exception 'cleanup asset passed pending lookup'; exception when others then if sqlerrm <> 'branding asset is not pending' then raise; end if; end;
  begin perform public.get_pending_branding_asset_for_upload('bbbbbbbb-0000-0000-0000-000000000094'); raise exception 'deleted asset passed pending lookup'; exception when others then if sqlerrm <> 'branding asset is not pending' then raise; end if; end;
  begin perform public.get_pending_branding_asset_for_upload('bbbbbbbb-0000-0000-0000-000000000099'); raise exception 'missing asset passed pending lookup'; exception when others then if sqlerrm <> 'branding asset not found' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);

set local role service_role;
select public.record_verified_branding_asset(current_setting('test.logo_one')::uuid, 'image/webp', 100000, 512, 512, repeat('a', 64));
set local role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
select public.activate_branding_asset(current_setting('test.logo_one')::uuid);
do $$ begin
  if (select logo_asset_id from public.tenant_branding where tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') <> current_setting('test.logo_one')::uuid then raise exception 'owner PRO did not activate logo'; end if;
  if (select status from public.branding_assets where id = current_setting('test.logo_one')::uuid) <> 'active' then raise exception 'activated logo is not active'; end if;
end $$;

-- An authenticated caller cannot invoke the Edge Function-only metadata RPC or mutate rows directly.
do $$ begin
  begin perform public.record_verified_branding_asset(current_setting('test.logo_one')::uuid, 'image/webp', 100000, 512, 512, repeat('a', 64)); raise exception 'authenticated caller invoked internal metadata RPC'; exception when insufficient_privilege then null; end;
  begin update public.branding_assets set status = 'deleted' where id = current_setting('test.logo_one')::uuid; raise exception 'authenticated caller updated branding metadata'; exception when insufficient_privilege then null; end;
end $$;

-- Replacing a logo atomically retires the previous active asset.
select set_config('test.logo_two', (select (public.begin_branding_asset('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'logo')).id::text), true);
set local role service_role;
select public.record_verified_branding_asset(current_setting('test.logo_two')::uuid, 'image/webp', 120000, 512, 512, repeat('b', 64));
set local role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
select public.activate_branding_asset(current_setting('test.logo_two')::uuid);
do $$ begin
  if (select logo_asset_id from public.tenant_branding where tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') <> current_setting('test.logo_two')::uuid then raise exception 'replacement did not update logo reference'; end if;
  if (select status from public.branding_assets where id = current_setting('test.logo_one')::uuid) <> 'cleanup_pending' then raise exception 'replacement did not queue prior logo cleanup'; end if;
end $$;

-- Owner B can request logical deletion; a later valid replacement remains possible.
select public.remove_branding_asset('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'logo');
do $$ begin
  if (select status from public.branding_assets where id = current_setting('test.logo_two')::uuid) <> 'cleanup_pending' then raise exception 'owner removal did not queue logo cleanup'; end if;
end $$;
select set_config('test.logo_three', (select (public.begin_branding_asset('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'logo')).id::text), true);
set local role service_role;
select public.record_verified_branding_asset(current_setting('test.logo_three')::uuid, 'image/webp', 120000, 512, 512, repeat('f', 64));
set local role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
select public.activate_branding_asset(current_setting('test.logo_three')::uuid);

-- Admin B (also PRO) can own the same lifecycle for a banner.
select set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', true);
select set_config('test.banner_one', (select (public.begin_branding_asset('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'banner')).id::text), true);
set local role service_role;
select public.record_verified_branding_asset(current_setting('test.banner_one')::uuid, 'image/webp', 200000, 1600, 600, repeat('c', 64));
set local role authenticated;
select set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', true);
select public.activate_branding_asset(current_setting('test.banner_one')::uuid);
do $$ begin
  if (select banner_asset_id from public.tenant_branding where tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') <> current_setting('test.banner_one')::uuid then raise exception 'admin PRO did not activate banner'; end if;
end $$;

-- Slot integrity rejects using an active logo as a banner, even from a privileged context.
set local role service_role;
do $$ begin
  begin update public.tenant_branding set banner_asset_id = current_setting('test.logo_two')::uuid where tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; raise exception 'logo was accepted as banner'; exception when check_violation then null; end;
end $$;

-- Members cannot initiate, activate, or remove branding.
set local role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);
do $$ begin
  begin perform public.begin_branding_asset('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'logo'); raise exception 'member began branding asset'; exception when others then if sqlerrm <> 'not authorized' then raise; end if; end;
  begin perform public.activate_branding_asset(current_setting('test.logo_two')::uuid); raise exception 'member activated branding asset'; exception when others then if sqlerrm <> 'not authorized' then raise; end if; end;
  begin perform public.remove_branding_asset('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'banner'); raise exception 'member removed branding asset'; exception when others then if sqlerrm <> 'not authorized' then raise; end if; end;
end $$;

-- A tenant-A owner cannot target tenant B or its assets.
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$ begin
  begin perform public.begin_branding_asset('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'logo'); raise exception 'cross-tenant owner began asset'; exception when others then if sqlerrm <> 'not authorized' then raise; end if; end;
  begin perform public.activate_branding_asset(current_setting('test.logo_two')::uuid); raise exception 'cross-tenant owner activated asset'; exception when others then if sqlerrm <> 'not authorized' then raise; end if; end;
  begin update public.branding_assets set status = 'deleted' where id = current_setting('test.logo_two')::uuid; raise exception 'cross-tenant owner mutated metadata'; exception when insufficient_privilege then null; end;
end $$;

-- FREE cannot start or activate advanced branding.
set local role service_role;
insert into public.branding_assets(id, tenant_id, storage_path, asset_kind, status, created_by)
values ('aaaaaaaa-0000-0000-0000-000000000090', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/aaaaaaaa-0000-0000-0000-000000000090', 'logo', 'pending', '11111111-1111-1111-1111-111111111111');
select public.record_verified_branding_asset('aaaaaaaa-0000-0000-0000-000000000090', 'image/webp', 100000, 512, 512, repeat('d', 64));
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$ begin
  begin perform public.begin_branding_asset('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'logo'); raise exception 'FREE owner began branding asset'; exception when others then if sqlerrm <> 'pro branding is required' then raise; end if; end;
  begin perform public.activate_branding_asset('aaaaaaaa-0000-0000-0000-000000000090'); raise exception 'FREE owner activated branding asset'; exception when others then if sqlerrm <> 'pro branding is required' then raise; end if; end;
end $$;

-- Deleted assets cannot become active again.
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
select set_config('test.deleted_asset', (select (public.begin_branding_asset('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'banner')).id::text), true);
set local role service_role;
select public.record_verified_branding_asset(current_setting('test.deleted_asset')::uuid, 'image/webp', 200000, 1600, 600, repeat('e', 64));
update public.branding_assets set status = 'deleted', deleted_at = now() where id = current_setting('test.deleted_asset')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
do $$ begin
  begin perform public.activate_branding_asset(current_setting('test.deleted_asset')::uuid); raise exception 'deleted asset was reactivated'; exception when others then if sqlerrm <> 'branding asset is not verified and pending' then raise; end if; end;
end $$;

-- Admin B can remove its active banner; physical Storage cleanup is deliberately deferred.
select set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', true);
select public.remove_branding_asset('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'banner');
do $$ begin
  if (select status from public.branding_assets where id = current_setting('test.banner_one')::uuid) <> 'cleanup_pending' then raise exception 'removal did not queue banner cleanup'; end if;
  if (select banner_asset_id from public.tenant_branding where tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') is not null then raise exception 'removal left banner reference'; end if;
end $$;

-- A PRO-to-FREE update is the single DB authority for immediate suspension.
set local role service_role;
update public.tenant_entitlements set plan_code = 'free' where tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
do $$ begin
  if (select status from public.branding_assets where id = current_setting('test.logo_three')::uuid) <> 'suspended' then raise exception 'downgrade did not suspend active logo'; end if;
  if (select retention_until is not null from public.branding_assets where id = current_setting('test.logo_three')::uuid) is not true then raise exception 'downgrade did not set retention'; end if;
  if (select logo_asset_id is null and banner_asset_id is null and primary_color is null and secondary_color is null from public.tenant_branding where tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') is not true then raise exception 'downgrade did not clear active branding'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);
do $$ begin
  if exists (select 1 from public.get_active_branding_assets('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')) then raise exception 'FREE tenant still resolved active branding'; end if;
  begin perform public.begin_branding_asset('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'logo'); raise exception 'downgraded FREE tenant began branding'; exception when others then if sqlerrm <> 'pro branding is required' then raise; end if; end;
end $$;

-- Storage grants/policies intentionally expose no browser write path and no extension rule.
set local role service_role;
do $$ begin
  if has_table_privilege('authenticated', 'storage.objects', 'INSERT, UPDATE, DELETE') then raise exception 'authenticated still has Storage write privilege'; end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'branding_assets_storage_select_active_member') then raise exception 'restricted branding Storage read policy is missing'; end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'branding_assets_storage_select_active_member' and qual ilike '%extension%') then raise exception 'branding Storage policy still depends on extension'; end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('branding_assets_storage_insert', 'branding_assets_storage_update', 'branding_assets_storage_delete')) then raise exception 'legacy extension-based Storage write policy remains'; end if;
end $$;

-- Concurrent sessions are not available in this SQL file. The migration serializes
-- activation with FOR UPDATE on the asset and tenant_branding rows, plus an advisory
-- lock while replacing pending uploads for the same tenant/kind.

-- Reconciliation is service-only. It never auto-activates expired pending assets,
-- finalizes cleanup idempotently and leaves active rows untouched.
set local role service_role;
insert into public.branding_assets(id, tenant_id, storage_path, asset_kind, status, created_by, created_at)
values ('bbbbbbbb-0000-0000-0000-000000000101', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/bbbbbbbb-0000-0000-0000-000000000101', 'logo', 'pending', '44444444-4444-4444-4444-444444444444', now());
do $$ begin
  if exists (
    select 1 from public.claim_branding_assets_for_reconciliation(50, now() - interval '1 hour', interval '15 minutes')
    where asset_id = 'bbbbbbbb-0000-0000-0000-000000000101'
  ) then raise exception 'recent pending asset was claimed'; end if;
end $$;

insert into public.branding_assets(id, tenant_id, storage_path, asset_kind, status, created_by, created_at)
values ('bbbbbbbb-0000-0000-0000-000000000102', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/bbbbbbbb-0000-0000-0000-000000000102', 'logo', 'pending', '44444444-4444-4444-4444-444444444444', now() - interval '2 hours');
select set_config('test.reconciliation_pending_token', coalesce((select reconciliation_token::text from public.claim_branding_assets_for_reconciliation(50, now() - interval '1 hour', interval '15 minutes') where asset_id = 'bbbbbbbb-0000-0000-0000-000000000102'), ''), true);
do $$ begin
  if current_setting('test.reconciliation_pending_token') = '' then raise exception 'expired pending asset was not claimed'; end if;
  if (select status from public.branding_assets where id = 'bbbbbbbb-0000-0000-0000-000000000102') <> 'cleanup_pending' then raise exception 'expired pending asset was not moved to cleanup'; end if;
  if not public.complete_branding_asset_reconciliation('bbbbbbbb-0000-0000-0000-000000000102', current_setting('test.reconciliation_pending_token')::uuid) then raise exception 'claimed cleanup asset was not finalized'; end if;
  if public.complete_branding_asset_reconciliation('bbbbbbbb-0000-0000-0000-000000000102', current_setting('test.reconciliation_pending_token')::uuid) then raise exception 'deleted asset finalized twice'; end if;
end $$;

insert into public.branding_assets(id, tenant_id, storage_path, asset_kind, status, created_by, mime_type, byte_size, width, height, sha256, retention_until)
values ('bbbbbbbb-0000-0000-0000-000000000103', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/bbbbbbbb-0000-0000-0000-000000000103', 'banner', 'suspended', '44444444-4444-4444-4444-444444444444', 'image/webp', 200000, 1600, 600, repeat('1', 64), now() - interval '1 minute');
select set_config('test.reconciliation_suspended_token', coalesce((select reconciliation_token::text from public.claim_branding_assets_for_reconciliation(50, now() - interval '1 hour', interval '15 minutes') where asset_id = 'bbbbbbbb-0000-0000-0000-000000000103'), ''), true);
do $$ begin
  if current_setting('test.reconciliation_suspended_token') = '' then raise exception 'expired FREE suspended asset was not claimed'; end if;
  if (select status from public.branding_assets where id = 'bbbbbbbb-0000-0000-0000-000000000103') <> 'cleanup_pending' then raise exception 'expired suspended asset was not moved to cleanup'; end if;
end $$;

insert into public.branding_assets(id, tenant_id, storage_path, asset_kind, status, created_by, mime_type, byte_size, width, height, sha256, activated_at)
values ('bbbbbbbb-0000-0000-0000-000000000104', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/bbbbbbbb-0000-0000-0000-000000000104', 'logo', 'active', '44444444-4444-4444-4444-444444444444', 'image/webp', 100000, 512, 512, repeat('2', 64), now());
select set_config('test.reconciliation_active_token', coalesce((select reconciliation_token::text from public.claim_branding_assets_for_reconciliation(50, now() - interval '1 hour', interval '15 minutes') where asset_id = 'bbbbbbbb-0000-0000-0000-000000000104'), ''), true);
do $$ begin
  if current_setting('test.reconciliation_active_token') = '' then raise exception 'active asset was not claimed for audit'; end if;
  if (select status from public.branding_assets where id = 'bbbbbbbb-0000-0000-0000-000000000104') <> 'active' then raise exception 'reconciler changed active asset'; end if;
  if not public.release_branding_asset_reconciliation_claim('bbbbbbbb-0000-0000-0000-000000000104', current_setting('test.reconciliation_active_token')::uuid) then raise exception 'active asset claim was not released'; end if;
end $$;

update public.tenant_entitlements set plan_code = 'pro' where tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
insert into public.branding_assets(id, tenant_id, storage_path, asset_kind, status, created_by, mime_type, byte_size, width, height, sha256, retention_until)
values ('bbbbbbbb-0000-0000-0000-000000000105', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/bbbbbbbb-0000-0000-0000-000000000105', 'banner', 'suspended', '44444444-4444-4444-4444-444444444444', 'image/webp', 200000, 1600, 600, repeat('3', 64), now() - interval '1 minute');
do $$ begin
  if exists (
    select 1 from public.claim_branding_assets_for_reconciliation(50, now() - interval '1 hour', interval '15 minutes')
    where asset_id = 'bbbbbbbb-0000-0000-0000-000000000105'
  ) then raise exception 'expired suspended asset of restored PRO tenant was claimed'; end if;
  if (select status from public.branding_assets where id = 'bbbbbbbb-0000-0000-0000-000000000105') <> 'suspended' then raise exception 'restored PRO suspended asset was changed'; end if;
end $$;
update public.tenant_entitlements set plan_code = 'free' where tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

set local role authenticated;
do $$ begin
  begin perform public.claim_branding_assets_for_reconciliation(1, now() - interval '1 hour', interval '15 minutes'); raise exception 'authenticated caller invoked reconciler RPC'; exception when insufficient_privilege then null; end;
end $$;
rollback;
