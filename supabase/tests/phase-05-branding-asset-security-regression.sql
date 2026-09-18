-- Focused regression for the Phase 05 branding metadata authorization boundary.
-- Self-contained: it creates no rows and rolls back the simulated request roles.
begin;

do $$
begin
  if has_function_privilege('anon', 'public.record_verified_branding_asset(uuid,text,bigint,integer,integer,text)', 'EXECUTE') then
    raise exception 'anon retains execute on record_verified_branding_asset';
  end if;
  if has_function_privilege('authenticated', 'public.record_verified_branding_asset(uuid,text,bigint,integer,integer,text)', 'EXECUTE') then
    raise exception 'authenticated retains execute on record_verified_branding_asset';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$
begin
  begin
    perform public.record_verified_branding_asset(
      '00000000-0000-0000-0000-000000000001', 'image/png', 1, 1, 1, repeat('a', 64)
    );
    raise exception 'authenticated caller invoked internal metadata RPC';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  begin
    perform public.record_verified_branding_asset(
      '00000000-0000-0000-0000-000000000001', 'image/png', 1, 1, 1, repeat('a', 64)
    );
    raise exception 'anon caller invoked internal metadata RPC';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
begin
  begin
    perform public.record_verified_branding_asset(
      '00000000-0000-0000-0000-000000000001', 'image/png', 1, 1, 1, repeat('a', 64)
    );
    raise exception 'service_role unexpectedly found synthetic branding asset';
  exception when others then
    if sqlstate <> '22023' or sqlerrm <> 'branding asset not found' then raise; end if;
  end;
end;
$$;

rollback;
