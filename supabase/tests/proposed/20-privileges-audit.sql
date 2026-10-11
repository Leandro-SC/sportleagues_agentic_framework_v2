-- CLASE C — SOLO PROYECTO SUPABASE DESCARTABLE (datos sintéticos). Requiere 1/3 y 2/3 aplicadas.
-- Cubre R2 (privilegios), R3 (audit_log inmutable), R4 (auditoría administrativa), R5 (códigos de invitación) y aislamiento
-- entre tenants/quinielas para estas superficies. Se ejecuta tras anteponer _helpers.sql.
do $$
declare
  v_ta uuid; v_tb uuid; v_oa uuid; v_aa uuid; v_ma uuid; v_ob uuid; v_pa uuid; v_pb uuid; v_tour uuid;
begin
  v_oa := pg_temp.mk_user('p-owner-a'); v_aa := pg_temp.mk_user('p-admin-a'); v_ma := pg_temp.mk_user('p-member-a'); v_ob := pg_temp.mk_user('p-owner-b');
  insert into public.tenants(name) values ('P20 A') returning id into v_ta;
  insert into public.tenants(name) values ('P20 B') returning id into v_tb;
  insert into public.tenant_entitlements(tenant_id, plan_code) values (v_ta, 'pro'), (v_tb, 'pro');
  insert into public.tenant_memberships(tenant_id, profile_id, role) values
    (v_ta, v_oa, 'owner'), (v_ta, v_aa, 'admin'), (v_ta, v_ma, 'member'), (v_tb, v_ob, 'owner');
  insert into public.pools(tenant_id, name, status, lock_offset) values (v_ta, 'P20 A pool', 'open', interval '10 minutes') returning id into v_pa;
  insert into public.pools(tenant_id, name, status, lock_offset) values (v_tb, 'P20 B pool', 'open', interval '10 minutes') returning id into v_pb;
  insert into public.pool_join_codes(tenant_id, pool_id, code) values (v_ta, v_pa, 'ZZ20A1'), (v_tb, v_pb, 'ZZ20B1');
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_ta, v_pa, v_ma, 'approved', 'invited');
  insert into fx(k, v) values ('ta', v_ta), ('tb', v_tb), ('oa', v_oa), ('aa', v_aa), ('ma', v_ma), ('ob', v_ob), ('pa', v_pa), ('pb', v_pb);
end $$;

do $$
declare r text; v_n text; v_before bigint; v_after bigint;
begin
  -- A01 privilegios efectivos (clientes)
  perform pg_temp.rec('A01 TRUNCATE denegado a authenticated en audit_log', not has_table_privilege('authenticated', 'public.audit_log', 'TRUNCATE'), '');
  r := pg_temp.as_user(pg_temp.f('oa'), 'truncate table public.audit_log');
  perform pg_temp.rec('A01b TRUNCATE de audit_log como authenticated → permiso denegado', r like 'ERR:42501:%permission denied%', r);
  r := pg_temp.as_user(pg_temp.f('oa'), 'truncate table public.predictions');
  perform pg_temp.rec('A01c TRUNCATE de predictions como authenticated → permiso denegado', r like 'ERR:42501:%permission denied%', r);
  r := pg_temp.as_role('anon', format($q$insert into public.pools(tenant_id, name, status) values (%L, 'anon', 'draft')$q$, pg_temp.f('ta')));
  perform pg_temp.rec('A02 anon no inserta en pools', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('anon', format($q$select public.save_prediction(%L, %L, 1, 1)$q$, pg_temp.f('pa'), gen_random_uuid()));
  perform pg_temp.rec('A03 anon no ejecuta RPC de public (save_prediction)', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('anon', format($q$select public.join_pool('ZZ20A1')$q$));
  perform pg_temp.rec('A03b anon no ejecuta join_pool', pg_temp.is_err(r, '42501'), r);

  -- A04 audit_log inmutable incluso para el propietario (los intentos se rechazan; las filas siguen)
  select count(*) into v_before from public.audit_log;
  r := pg_temp.as_role('postgres', 'update public.audit_log set action = ''tampered''');
  perform pg_temp.rec('A04 UPDATE de audit_log por postgres → trigger append-only', r like 'ERR:42501:%append-only%', r);
  r := pg_temp.as_role('postgres', 'delete from public.audit_log');
  perform pg_temp.rec('A04b DELETE de audit_log por postgres → 42501', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('postgres', 'truncate table public.audit_log');
  perform pg_temp.rec('A04c TRUNCATE de audit_log por postgres → 42501', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('service_role', 'update public.audit_log set action = ''tampered''');
  perform pg_temp.rec('A04d UPDATE de audit_log por service_role → rechazado', r like 'ERR:%', r);
  select count(*) into v_after from public.audit_log;
  perform pg_temp.rec('A04e el conteo de audit_log no disminuyó', v_after >= v_before, v_before || '→' || v_after);
  perform pg_temp.rec('A05 verify_audit_protection(): todo ok', (select bool_and(ok) from public.verify_audit_protection()), '');

  -- A06 auditoría de acciones administrativas (R4)
  r := pg_temp.as_user(pg_temp.f('aa'), format($q$select public.manage_pool('update', %L, null, 'P20 A pool renamed', 20, false)$q$, pg_temp.f('pa')));
  perform pg_temp.rec('A06 manage_pool update permitido al admin', pg_temp.is_ok(r), r);
  perform pg_temp.rec('A06b queda fila de auditoría pools.update con el actor y el nuevo offset',
    exists (select 1 from public.audit_log l where l.entity_type = 'pools' and l.entity_id = pg_temp.f('pa') and l.action = 'pools.update'
             and l.actor_id = pg_temp.f('aa') and l.metadata -> 'new' ->> 'lock_offset' is not null), '');
  r := pg_temp.as_user(pg_temp.f('oa'), format($q$select public.approve_participant(id) from public.participants where pool_id = %L limit 1$q$, pg_temp.f('pa')));
  r := pg_temp.as_user(pg_temp.f('aa'), format($q$select public.set_participant_payment_status(id, 'paid') from public.participants where pool_id = %L limit 1$q$, pg_temp.f('pa')));
  perform pg_temp.rec('A07 set_participant_payment_status auditado',
    exists (select 1 from public.audit_log l where l.entity_type = 'participants' and l.action = 'participants.update' and l.metadata -> 'new' ->> 'payment_status' = 'paid'
             and l.metadata ->> 'pool_id' = pg_temp.f('pa')::text), r);
  r := pg_temp.as_user(pg_temp.f('aa'), format($q$select public.create_pool_join_code(%L)$q$, pg_temp.f('pa')));
  perform pg_temp.rec('A08 create_pool_join_code auditado y sin el código en claro',
    exists (select 1 from public.audit_log l where l.entity_type = 'pool_join_codes' and l.action = 'pool_join_codes.insert' and l.metadata ->> 'pool_id' = pg_temp.f('pa')::text)
    and not exists (select 1 from public.audit_log l join public.pool_join_codes c on c.pool_id = pg_temp.f('pa') where l.metadata::text like '%' || c.code || '%'), r);

  -- A09 un cambio directo por service_role también se audita (rol de base registrado)
  perform pg_temp.as_role('service_role', format($q$update public.pools set requires_approval = true where id = %L$q$, pg_temp.f('pa')));
  perform pg_temp.rec('A09 cambio vía service_role auditado con db_role',
    exists (select 1 from public.audit_log l where l.entity_id = pg_temp.f('pa') and l.action = 'pools.update' and l.metadata ->> 'db_role' = 'service_role'), '');

  -- R5 códigos de invitación
  v_n := pg_temp.scalar_as_user(pg_temp.f('ma'), format($q$select count(*) from public.pool_join_codes where pool_id = %L$q$, pg_temp.f('pa')));
  perform pg_temp.rec('R5 un miembro no lee los códigos de la quiniela', v_n = 'OK:0', v_n);
  v_n := pg_temp.scalar_as_user(pg_temp.f('aa'), format($q$select count(*) from public.pool_join_codes where pool_id = %L$q$, pg_temp.f('pa')));
  perform pg_temp.rec('R5b un administrador sí los lee', v_n ~ '^OK:[1-9]', v_n);
  v_n := pg_temp.scalar_as_user(pg_temp.f('ob'), format($q$select count(*) from public.pool_join_codes where pool_id = %L$q$, pg_temp.f('pa')));
  perform pg_temp.rec('R5c admin de otro tenant no lee códigos ajenos', v_n = 'OK:0', v_n);

  -- Aislamiento cross-tenant / cross-pool de auditoría
  v_n := pg_temp.scalar_as_user(pg_temp.f('ob'), format($q$select count(*) from public.audit_log where tenant_id = %L$q$, pg_temp.f('ta')));
  perform pg_temp.rec('X1 admin del tenant B no lee la auditoría del tenant A', v_n = 'OK:0', v_n);
  r := pg_temp.as_user(pg_temp.f('ob'), format($q$select public.manage_pool('update', %L, null, 'hack', 5, false)$q$, pg_temp.f('pa')));
  perform pg_temp.rec('X2 admin del tenant B no modifica la quiniela del tenant A', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_user(pg_temp.f('ma'), format($q$select public.manage_pool('update', %L, null, 'hack', 5, false)$q$, pg_temp.f('pa')));
  perform pg_temp.rec('X3 un miembro no ejecuta acciones de administrador', pg_temp.is_err(r, '42501'), r);
end $$;

select * from t_results order by id;
