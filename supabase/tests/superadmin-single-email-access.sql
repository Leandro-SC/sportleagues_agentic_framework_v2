-- ADR-029: only the designated Auth email may operate the isolated Control console.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777772', 'authenticated', 'authenticated', 'other-operator@example.test', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

do $$ declare v_target uuid; begin
  select id into v_target from auth.users where lower(email) = 'developer.gruposaysil@gmail.com';
  if v_target is null then raise exception 'the designated Auth user must exist in QA before this test'; end if;
  insert into public.platform_admins (user_id, note) values (v_target, 'ADR-029 authorized test fixture')
    on conflict (user_id) do update set revoked_at = null;
end $$;
insert into public.platform_admins (user_id, note) values ('77777777-7777-7777-7777-777777777772', 'ADR-029 rejected test fixture');

select set_config('app.test.control_user_id', (select id::text from auth.users where lower(email) = 'developer.gruposaysil@gmail.com'), true);

set local role authenticated;

select set_config('request.jwt.claim.sub', current_setting('app.test.control_user_id'), true);
do $$ begin
  if not public.is_platform_admin() then raise exception 'designated operator lost the global platform role'; end if;
  if not public.is_control_operator() then raise exception 'designated operator was rejected from Control'; end if;
  perform public.platform_console_monitor();
  perform public.platform_console_growth_metrics();
  perform public.platform_console_live_users();
  perform public.platform_console_error_log();
end $$;
reset role;
select pg_temp.rec('CO01 designated platform admin with the allowlisted email enters Control', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777772', true);
do $$ begin
  if not public.is_platform_admin() then raise exception 'fixture requires the second account to remain a platform admin'; end if;
  if public.is_control_operator() then raise exception 'non-designated platform admin entered Control'; end if;
  begin
    perform public.platform_console_monitor();
    raise exception 'non-designated platform admin executed a Control RPC';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select pg_temp.rec('CO02 non-allowlisted platform admin is rejected by helper and console RPC', true);

set local role anon;
do $$ begin
  begin
    perform public.is_control_operator();
    raise exception 'anon could execute is_control_operator';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select pg_temp.rec('CO03 anon cannot execute the Control authorization helper', true);
