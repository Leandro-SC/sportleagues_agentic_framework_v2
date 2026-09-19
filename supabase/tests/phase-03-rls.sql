-- Run after the Phase 03 migration and development seed using a privileged local test role.
begin;
-- The development seed's timestamp ages in a long-lived QA project. Keep the
-- pre-lock visibility assertion deterministic without persisting any change.
update public.matches set starts_at = now() + interval '1 day'
where id = 'aaaaaaaa-0000-0000-0000-000000000030'
  and tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
set local role authenticated;

-- 1. Member A can read Tenant A.
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',true);
do $$ begin if not exists (select 1 from public.pools where id = 'aaaaaaaa-0000-0000-0000-000000000001') then raise exception 'member A cannot read tenant A'; end if; end $$;
-- 2. Member A cannot read Tenant B.
do $$ begin if exists (select 1 from public.pools where id = 'bbbbbbbb-0000-0000-0000-000000000001') then raise exception 'cross-tenant read leaked'; end if; end $$;
-- 3. Member A cannot insert into Tenant B.
do $$ begin begin insert into public.pools(tenant_id,name) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','forbidden insert'); raise exception 'member inserted into tenant B'; exception when insufficient_privilege then null; end; end $$;
-- 3. Member A cannot administer Tenant A. The security contract accepts the
-- least-privilege table rejection before RLS as well as an RLS-filtered zero row.
do $$ declare changed integer; begin begin update public.pools set name = 'forbidden' where id = 'aaaaaaaa-0000-0000-0000-000000000001'; get diagnostics changed = row_count; if changed <> 0 then raise exception 'member performed admin write'; end if; exception when insufficient_privilege then null; end; end $$;
-- 4. Admin A cannot administer Tenant B.
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
do $$ declare changed integer; begin begin update public.pools set name = 'forbidden' where id = 'bbbbbbbb-0000-0000-0000-000000000001'; get diagnostics changed = row_count; if changed <> 0 then raise exception 'admin A wrote tenant B'; end if; exception when insufficient_privilege then null; end; end $$;
-- 5. Admin A cannot delete Tenant B.
do $$ declare changed integer; begin begin delete from public.pools where id = 'bbbbbbbb-0000-0000-0000-000000000001'; get diagnostics changed = row_count; if changed <> 0 then raise exception 'admin A deleted tenant B'; end if; exception when insufficient_privilege then null; end; end $$;
-- 6. Owner A remains recognized as the Tenant A administrator. Direct table
-- writes were deliberately revoked in Phase 05 in favour of sanctioned RPCs,
-- so the former UPDATE-positive assertion is no longer this suite's contract.
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
do $$ begin if not public.is_tenant_admin('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') then raise exception 'owner A lost tenant A administration'; end if; end $$;
-- 5. Outsider cannot access private data.
select set_config('request.jwt.claim.sub','66666666-6666-6666-6666-666666666666',true);
do $$ begin if exists (select 1 from public.pools) then raise exception 'outsider read private pools'; end if; end $$;
-- 7. An anonymous role cannot obtain private data.
set local role anon;
do $$ begin if exists (select 1 from public.pools) then raise exception 'anonymous role read private pools'; end if; end $$;
set local role authenticated;
-- 7. Before lock, Member A can read own prediction but not Owner A prediction.
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',true);
do $$ begin if not exists (select 1 from public.predictions where id = 'aaaaaaaa-0000-0000-0000-000000000062') then raise exception 'own prediction hidden'; end if; if exists (select 1 from public.predictions where id = 'aaaaaaaa-0000-0000-0000-000000000061') then raise exception 'other prediction leaked before lock'; end if; end $$;
rollback;

-- 6. Constraint test runs as migration owner, outside the RLS transaction.
begin;
do $$ begin insert into public.pool_matches(tenant_id,pool_id,match_id) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000030'); raise exception 'cross-tenant constraint accepted'; exception when foreign_key_violation then null; end $$;
rollback;
