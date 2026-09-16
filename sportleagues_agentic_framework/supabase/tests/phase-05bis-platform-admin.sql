-- Run after supabase/seed/phase-03-development.sql and the Phase 05-bis migration
-- (20260915000400_phase_05bis_platform_admin_foundation.sql), using a privileged local test role.
-- Fixture rows below are inserted while still connected as the privileged session role, before
-- switching to `authenticated`, because platform_admins grants no direct write access to
-- authenticated/anon (that is the point being tested).
begin;

insert into public.platform_admins (user_id, granted_by) values
  ('66666666-6666-6666-6666-666666666666', null);
insert into public.platform_admins (user_id, granted_by, revoked_at) values
  ('55555555-5555-5555-5555-555555555555', '66666666-6666-6666-6666-666666666666', now());

-- 0. `granted_by` uses `on delete set null`: deleting an Auth account that once granted access to
-- someone else must succeed, and the dependent row must survive with `granted_by` cleared, not
-- be deleted or block the delete. Ad-hoc fixtures, self-contained and rolled back with everything
-- else in this file.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','99999999-9999-9999-9999-999999999991','authenticated','authenticated','fk-granter@example.test','not-used',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','99999999-9999-9999-9999-999999999992','authenticated','authenticated','fk-dependent@example.test','not-used',now(),'{}','{}',now(),now());
insert into public.platform_admins (user_id, granted_by) values
  ('99999999-9999-9999-9999-999999999991', null);
insert into public.platform_admins (user_id, granted_by) values
  ('99999999-9999-9999-9999-999999999992', '99999999-9999-9999-9999-999999999991');
do $$ declare v_granted_by uuid; begin
  delete from auth.users where id = '99999999-9999-9999-9999-999999999991';
  if not found then raise exception 'expected the granter fixture user to exist before deleting it'; end if;
  select granted_by into v_granted_by from public.platform_admins where user_id = '99999999-9999-9999-9999-999999999992';
  if v_granted_by is not null then raise exception 'granted_by was not cleared after the granting account was deleted'; end if;
end $$;

set local role authenticated;

-- 1. A normal authenticated user with no platform_admins row is not a platform admin.
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',true);
do $$ begin
  if public.is_platform_admin() then raise exception 'member A was treated as a platform admin'; end if;
end $$;

-- 2. An active platform admin is recognized, even with zero tenant memberships anywhere.
select set_config('request.jwt.claim.sub','66666666-6666-6666-6666-666666666666',true);
do $$ begin
  if not public.is_platform_admin() then raise exception 'active platform admin without a tenant was rejected'; end if;
end $$;

-- 3. A revoked platform admin is rejected immediately; revocation does not wait on JWT expiry.
select set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',true);
do $$ begin
  if public.is_platform_admin() then raise exception 'revoked platform admin was still accepted'; end if;
end $$;

-- 4. Being a tenant owner does not imply platform admin.
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
do $$ begin
  if public.is_platform_admin() then raise exception 'tenant owner was treated as a platform admin'; end if;
end $$;

-- 5. Being a tenant admin does not imply platform admin.
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
do $$ begin
  if public.is_platform_admin() then raise exception 'tenant admin was treated as a platform admin'; end if;
end $$;

-- 6. authenticated cannot enumerate the platform admin roster directly.
do $$ begin
  begin
    perform 1 from public.platform_admins limit 1;
    raise exception 'authenticated selected platform_admins directly';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 7. anon cannot invoke is_platform_admin() at all.
reset role;
set local role anon;
do $$ begin
  begin
    perform public.is_platform_admin();
    raise exception 'anon executed is_platform_admin()';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
