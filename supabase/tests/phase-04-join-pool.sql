-- Run against the development/staging database after the Phase 03 seed and
-- migration 20260913000100. Every write is rolled back.
begin;

set local role authenticated;
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);

-- A first join creates an approved participant for an open pool and proves
-- the enum-valued CASE in join_pool is assignable to approval_status.
do $$
declare
  v_participant public.participants;
begin
  select * into v_participant from public.join_pool('ALPHA1');

  if v_participant.tenant_id <> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' then
    raise exception 'join_pool returned the wrong tenant';
  end if;

  if v_participant.pool_id <> 'aaaaaaaa-0000-0000-0000-000000000001' then
    raise exception 'join_pool returned the wrong pool';
  end if;

  if v_participant.approval_status <> 'approved'::public.participant_approval_status then
    raise exception 'expected approved join status, got %', v_participant.approval_status;
  end if;
end
$$;

-- Repeating the same join is idempotent and returns the existing participant.
do $$
declare
  v_first_id uuid;
  v_second_id uuid;
begin
  select id into v_first_id
  from public.participants
  where profile_id = '66666666-6666-6666-6666-666666666666'
    and pool_id = 'aaaaaaaa-0000-0000-0000-000000000001';

  select id into v_second_id from public.join_pool('ALPHA1');

  if v_first_id is null or v_second_id <> v_first_id then
    raise exception 'repeated join was not idempotent';
  end if;
end
$$;

-- Invalid codes must not create a membership or participant.
do $$
begin
  begin
    perform public.join_pool('ZZZZZZ');
    raise exception 'invalid code was accepted';
  exception
    when sqlstate '22023' then
      null;
  end;
end
$$;

rollback;
