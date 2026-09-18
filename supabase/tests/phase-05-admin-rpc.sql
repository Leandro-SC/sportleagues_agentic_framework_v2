-- Run after the Phase 03 migration/seed and the Phase 05 admin RPC migration using a
-- privileged local test role.
begin;
set local role authenticated;

-- 1. Admin A can approve a pending participant in Tenant A.
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
do $$ declare v_status public.participant_approval_status; begin
  select approval_status into v_status from public.approve_participant('aaaaaaaa-0000-0000-0000-000000000053');
  if v_status <> 'approved' then raise exception 'approve_participant did not approve the participant'; end if;
end $$;

-- 2. Admin A cannot approve a participant in Tenant B.
do $$ begin begin perform public.approve_participant('bbbbbbbb-0000-0000-0000-000000000052'); raise exception 'admin A approved a Tenant B participant'; exception when others then if sqlerrm <> 'not authorized' then raise; end if; end; end $$;

-- 3. Member A cannot approve anyone, even inside Tenant A.
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',true);
do $$ begin begin perform public.approve_participant('aaaaaaaa-0000-0000-0000-000000000053'); raise exception 'member approved a participant'; exception when others then if sqlerrm <> 'not authorized' then raise; end if; end; end $$;

-- 4. Owner A can change a participant payment status.
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
do $$ declare v_status public.participant_payment_status; begin
  select payment_status into v_status from public.set_participant_payment_status('aaaaaaaa-0000-0000-0000-000000000052','paid');
  if v_status <> 'paid' then raise exception 'set_participant_payment_status did not persist'; end if;
end $$;

-- 5. Member A cannot change payment status.
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',true);
do $$ begin begin perform public.set_participant_payment_status('aaaaaaaa-0000-0000-0000-000000000052','pending'); raise exception 'member changed payment status'; exception when others then if sqlerrm <> 'not authorized' then raise; end if; end; end $$;

-- 6. Owner A can publish an initial rule version for Pool A.
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
do $$ declare v_version integer; begin
  select version into v_version from public.publish_pool_rules('aaaaaaaa-0000-0000-0000-000000000001', 10, 5, 'exact_predictions'::public.tie_breaker_kind);
  if v_version <> 1 then raise exception 'first published rule version should be 1, got %', v_version; end if;
end $$;

-- 7. Publishing again supersedes the previous version atomically (exactly one current row).
do $$ declare v_version integer; v_current_count integer; begin
  select version into v_version from public.publish_pool_rules('aaaaaaaa-0000-0000-0000-000000000001', 12, 6, 'prediction_submitted_at'::public.tie_breaker_kind);
  if v_version <> 2 then raise exception 'second published rule version should be 2, got %', v_version; end if;
  select count(*) into v_current_count from public.pool_rules where pool_id = 'aaaaaaaa-0000-0000-0000-000000000001' and is_current;
  if v_current_count <> 1 then raise exception 'expected exactly one current rule version, found %', v_current_count; end if;
end $$;

-- 8. Member A cannot publish pool rules.
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',true);
do $$ begin begin perform public.publish_pool_rules('aaaaaaaa-0000-0000-0000-000000000001', 1, 1, 'exact_predictions'::public.tie_breaker_kind); raise exception 'member published pool rules'; exception when others then if sqlerrm <> 'not authorized' then raise; end if; end; end $$;

-- 9. Admin A cannot publish rules for a Tenant B pool.
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
do $$ begin begin perform public.publish_pool_rules('bbbbbbbb-0000-0000-0000-000000000001', 1, 1, 'exact_predictions'::public.tie_breaker_kind); raise exception 'admin A published rules on Tenant B pool'; exception when others then if sqlerrm <> 'not authorized' then raise; end if; end; end $$;

-- 10. Owner A can create a new join code for Pool A.
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
do $$ declare v_tenant uuid; begin
  select tenant_id into v_tenant from public.create_pool_join_code('aaaaaaaa-0000-0000-0000-000000000001');
  if v_tenant <> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' then raise exception 'created join code carries the wrong tenant'; end if;
end $$;

-- 11. Member A cannot create a join code.
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',true);
do $$ begin begin perform public.create_pool_join_code('aaaaaaaa-0000-0000-0000-000000000001'); raise exception 'member created a join code'; exception when others then if sqlerrm <> 'not authorized' then raise; end if; end; end $$;

-- 12. Direct table writes remain blocked; the RPCs are the only sanctioned path.
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
do $$ begin begin insert into public.pool_rules(tenant_id,pool_id,version,exact_points,outcome_points,tie_breaker) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','aaaaaaaa-0000-0000-0000-000000000001',99,1,1,'exact_predictions'); raise exception 'owner inserted pool_rules directly'; exception when insufficient_privilege then null; end; end $$;
do $$ begin begin insert into public.pool_join_codes(tenant_id,pool_id,code) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','aaaaaaaa-0000-0000-0000-000000000001','ZZZZZZ'); raise exception 'owner inserted pool_join_codes directly'; exception when insufficient_privilege then null; end; end $$;
do $$ begin begin update public.participants set approval_status = 'approved' where id = 'aaaaaaaa-0000-0000-0000-000000000053'; raise exception 'owner updated participants directly'; exception when insufficient_privilege then null; end; end $$;

-- 13. An outsider (no membership anywhere) cannot invoke any admin RPC.
select set_config('request.jwt.claim.sub','66666666-6666-6666-6666-666666666666',true);
do $$ begin begin perform public.approve_participant('aaaaaaaa-0000-0000-0000-000000000052'); raise exception 'outsider approved a participant'; exception when others then if sqlerrm <> 'not authorized' then raise; end if; end; end $$;

rollback;
