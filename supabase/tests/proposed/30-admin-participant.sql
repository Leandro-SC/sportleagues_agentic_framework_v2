-- CLASE C — SOLO PROYECTO SUPABASE DESCARTABLE (datos sintéticos). Requiere 1/3, 2/3 y 3/3 aplicadas.
-- Cubre la incompatibilidad administrador/participante (ADR-015 §8: INC-01…INC-17), Superadmin (SA), conflictos
-- heredados (LEG), modelo definitivo pool_staff (MODEL) y elegibilidad (RANK). Se ejecuta tras anteponer _helpers.sql.
-- La concurrencia (INC-C1…C4, R6) está en scripts/qa/remediation/concurrency.mjs (requiere sesiones reales).
do $$
declare
  v_t uuid; v_t2 uuid; v_o uuid; v_o2 uuid; v_a uuid; v_mg uuid; v_fn uuid; v_m1 uuid; v_m2 uuid; v_m3 uuid; v_x uuid; v_y uuid; v_z uuid; v_po uuid; v_tg uuid;
  v_ob uuid; v_pa uuid; v_pa2 uuid;
  v_tour uuid; v_home uuid; v_away uuid; v_round uuid; v_p1 uuid; v_p2 uuid; v_p3 uuid; v_pd uuid; v_q uuid;
  v_mt1 uuid; v_mt2 uuid; v_mt3 uuid; v_pm1 uuid; v_pm2 uuid; v_pm3 uuid; v_part_m1_p1 uuid; v_part_m2_p1 uuid; v_part_m1_p3 uuid; v_part_m3_p3 uuid;
begin
  v_o := pg_temp.mk_user('i-owner'); v_o2 := pg_temp.mk_user('i-owner2'); v_a := pg_temp.mk_user('i-admin');
  v_mg := pg_temp.mk_user('i-mgr'); v_fn := pg_temp.mk_user('i-fin'); v_m1 := pg_temp.mk_user('i-m1'); v_m2 := pg_temp.mk_user('i-m2');
  v_m3 := pg_temp.mk_user('i-m3'); v_x := pg_temp.mk_user('i-x'); v_y := pg_temp.mk_user('i-y'); v_z := pg_temp.mk_user('i-z');
  v_po := pg_temp.mk_user('i-poolowner'); v_tg := pg_temp.mk_user('i-target'); v_ob := pg_temp.mk_user('i-owner-b');
  v_pa := pg_temp.mk_user('i-platform'); v_pa2 := pg_temp.mk_user('i-platform2');
  insert into public.tenants(name) values ('I30 T') returning id into v_t;
  insert into public.tenants(name) values ('I30 T2') returning id into v_t2;
  insert into public.tenant_entitlements(tenant_id, plan_code) values (v_t, 'pro'), (v_t2, 'pro');
  insert into public.tenant_memberships(tenant_id, profile_id, role) values
    (v_t, v_o, 'owner'), (v_t, v_o2, 'owner'), (v_t, v_a, 'admin'), (v_t, v_mg, 'member'), (v_t, v_fn, 'member'), (v_t, v_m1, 'member'),
    (v_t, v_m2, 'member'), (v_t, v_m3, 'member'), (v_t, v_x, 'member'), (v_t, v_y, 'member'), (v_t, v_z, 'member'), (v_t, v_po, 'member'),
    (v_t, v_tg, 'member'), (v_t2, v_ob, 'owner');
  insert into public.tournaments(tenant_id, name) values (v_t, 'T') returning id into v_tour;
  insert into public.teams(tenant_id, name) values (v_t, 'H') returning id into v_home;
  insert into public.teams(tenant_id, name) values (v_t, 'A') returning id into v_away;
  insert into public.rounds(tenant_id, tournament_id, name, sort_order) values (v_t, v_tour, 'R', 1) returning id into v_round;
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at) values (v_t, v_tour, v_round, v_home, v_away, now() + interval '2 hours') returning id into v_mt1;
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at) values (v_t, v_tour, v_round, v_home, v_away, now() + interval '2 hours') returning id into v_mt2;
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at) values (v_t, v_tour, v_round, v_home, v_away, now() + interval '5 minutes') returning id into v_mt3;
  insert into public.pools(tenant_id, name, status, lock_offset) values (v_t, 'P1', 'open', interval '15 minutes') returning id into v_p1;
  insert into public.pools(tenant_id, name, status, lock_offset) values (v_t, 'P2', 'open', interval '15 minutes') returning id into v_p2;
  insert into public.pools(tenant_id, name, status, lock_offset) values (v_t, 'P3', 'open', interval '15 minutes') returning id into v_p3;
  insert into public.pools(tenant_id, name, status) values (v_t, 'PD', 'draft') returning id into v_pd;
  insert into public.pools(tenant_id, name, status) values (v_t2, 'Q', 'open') returning id into v_q;
  insert into public.pool_matches(tenant_id, pool_id, match_id) values (v_t, v_p1, v_mt1) returning id into v_pm1;
  insert into public.pool_matches(tenant_id, pool_id, match_id) values (v_t, v_p2, v_mt2) returning id into v_pm2;
  insert into public.pool_matches(tenant_id, pool_id, match_id) values (v_t, v_p3, v_mt3) returning id into v_pm3;
  insert into public.pool_join_codes(tenant_id, pool_id, code) values
    (v_t, v_p1, 'ZZ30P1'), (v_t, v_p2, 'ZZ30P2'), (v_t, v_p3, 'ZZ30P3'), (v_t, v_pd, 'ZZ30PD'), (v_t2, v_q, 'ZZ30Q1');
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_t, v_p1, v_m1, 'approved', 'paid') returning id into v_part_m1_p1;
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_t, v_p1, v_m2, 'approved', 'paid') returning id into v_part_m2_p1;
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_t, v_p3, v_m1, 'approved', 'paid') returning id into v_part_m1_p3;
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_t, v_p3, v_m3, 'approved', 'paid') returning id into v_part_m3_p3;
  insert into public.predictions(tenant_id, pool_id, pool_match_id, participant_id, home_score, away_score) values
    (v_t, v_p1, v_pm1, v_part_m1_p1, 1, 0), (v_t, v_p1, v_pm1, v_part_m2_p1, 2, 2);
  insert into fx(k, v) values ('t', v_t), ('t2', v_t2), ('o', v_o), ('o2', v_o2), ('a', v_a), ('mg', v_mg), ('fn', v_fn), ('m1', v_m1), ('m2', v_m2), ('m3', v_m3),
    ('x', v_x), ('y', v_y), ('z', v_z), ('po', v_po), ('tg', v_tg), ('ob', v_ob), ('pa', v_pa), ('pa2', v_pa2),
    ('p1', v_p1), ('p2', v_p2), ('p3', v_p3), ('pd', v_pd), ('q', v_q), ('mt1', v_mt1), ('mt2', v_mt2), ('mt3', v_mt3), ('pm1', v_pm1), ('pm2', v_pm2), ('pm3', v_pm3),
    ('part_m1_p1', v_part_m1_p1), ('part_m2_p1', v_part_m2_p1), ('part_m1_p3', v_part_m1_p3), ('part_m3_p3', v_part_m3_p3);
end $$;

do $$
declare r text; v_part uuid; v_n text;
begin
  -- INC-01 owner y admin del tenant no se inscriben
  r := pg_temp.as_user(pg_temp.f('o'), $q$select public.join_pool('ZZ30P1')$q$);
  perform pg_temp.rec('INC-01 owner no se inscribe en su tenant', pg_temp.is_err(r, '42501', 'ADMIN_PARTICIPANT_INCOMPATIBLE'), r);
  r := pg_temp.as_user(pg_temp.f('a'), $q$select public.join_pool('ZZ30P1')$q$);
  perform pg_temp.rec('INC-01b admin no se inscribe', pg_temp.is_err(r, '42501', 'ADMIN_PARTICIPANT_INCOMPATIBLE'), r);
  perform pg_temp.rec('INC-01c no quedó fila de participante', not exists (select 1 from public.participants where pool_id = pg_temp.f('p1') and profile_id in (pg_temp.f('o'), pg_temp.f('a'))), '');

  -- INC-02 colaboradores (cualquier rol) no se inscriben
  r := pg_temp.as_user(pg_temp.f('o'), format($q$select public.assign_pool_staff(%L, %L, 'pool_manager')$q$, pg_temp.f('p1'), pg_temp.f('mg')));
  perform pg_temp.rec('INC-02 owner asigna pool_manager', pg_temp.is_ok(r), r);
  r := pg_temp.as_user(pg_temp.f('o'), format($q$select public.assign_pool_staff(%L, %L, 'pool_finance')$q$, pg_temp.f('p1'), pg_temp.f('fn')));
  perform pg_temp.rec('INC-02b owner asigna pool_finance', pg_temp.is_ok(r), r);
  r := pg_temp.as_user(pg_temp.f('mg'), $q$select public.join_pool('ZZ30P1')$q$);
  perform pg_temp.rec('INC-02c pool_manager no se inscribe en su quiniela', pg_temp.is_err(r, '42501', 'ADMIN_PARTICIPANT_INCOMPATIBLE'), r);
  r := pg_temp.as_user(pg_temp.f('fn'), $q$select public.join_pool('ZZ30P1')$q$);
  perform pg_temp.rec('INC-02d pool_finance no se inscribe', pg_temp.is_err(r, '42501', 'ADMIN_PARTICIPANT_INCOMPATIBLE'), r);

  -- INC-03 otras quinielas siguen abiertas
  r := pg_temp.as_user(pg_temp.f('mg'), $q$select public.join_pool('ZZ30P2')$q$);
  perform pg_temp.rec('INC-03 el colaborador de P1 sí participa en P2', pg_temp.is_ok(r), r);
  r := pg_temp.as_user(pg_temp.f('a'), $q$select public.join_pool('ZZ30Q1')$q$);
  perform pg_temp.rec('INC-03b el admin del tenant T sí participa en una quiniela de otro tenant', pg_temp.is_ok(r), r);

  -- INC-04/05 fila heredada (se fabrica desactivando el trigger): no puede pronosticar ni competir
  alter table public.participants disable trigger participants_guard_insert;
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status)
    values (pg_temp.f('t'), pg_temp.f('p2'), pg_temp.f('a'), 'approved', 'invited') returning id into v_part;
  alter table public.participants enable trigger participants_guard_insert;
  insert into fx(k, v) values ('part_a_p2', v_part);
  alter table public.predictions disable trigger predictions_guard_participant;
  insert into public.predictions(tenant_id, pool_id, pool_match_id, participant_id, home_score, away_score)
    values (pg_temp.f('t'), pg_temp.f('p2'), pg_temp.f('pm2'), v_part, 3, 3);
  alter table public.predictions enable trigger predictions_guard_participant;
  r := pg_temp.as_user(pg_temp.f('a'), format($q$select public.save_prediction(%L, %L, 1, 1)$q$, pg_temp.f('p2'), pg_temp.f('mt2')));
  perform pg_temp.rec('INC-04 admin heredado no registra pronósticos (RPC)', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('service_role', format($q$insert into public.predictions(tenant_id, pool_id, pool_match_id, participant_id, home_score, away_score) values (%L, %L, %L, %L, 1, 1)$q$,
        pg_temp.f('t'), pg_temp.f('p2'), pg_temp.f('pm2'), v_part));
  perform pg_temp.rec('INC-04b ni por SQL directo como service_role', pg_temp.is_err(r, '42501', 'ADMIN_PARTICIPANT_INCOMPATIBLE'), r);
  r := pg_temp.as_role('postgres', format($q$update public.participants set approval_status = 'pending' where id = %L$q$, v_part));
  r := pg_temp.as_role('postgres', format($q$update public.participants set approval_status = 'approved' where id = %L$q$, v_part));
  perform pg_temp.rec('INC-04c no se puede (re)aprobar a un excluido', pg_temp.is_err(r, '42501', 'ADMIN_PARTICIPANT_INCOMPATIBLE'), r);
  perform pg_temp.rec('INC-05 participation_competes: excluido=false, participante normal=true',
    not public.participation_competes(v_part) and public.participation_competes(pg_temp.f('part_m1_p1')), '');
end $$;

do $$
declare r text; v_n text; v_cnt_before bigint; v_cnt_after bigint;
begin
  -- INC-07 participación activa en P1 (sin lock): hay que retirarse primero
  r := pg_temp.as_user(pg_temp.f('o'), format($q$select public.assign_pool_staff(%L, %L, 'pool_manager')$q$, pg_temp.f('p1'), pg_temp.f('m2')));
  perform pg_temp.rec('INC-07 conceder rol a participante activo → WITHDRAW_FIRST', pg_temp.is_err(r, '42501', 'WITHDRAW_FIRST'), r);

  -- INC-08 retirada antes del primer lock y luego rol
  select count(*) into v_cnt_before from public.predictions where participant_id = pg_temp.f('part_m2_p1');
  r := pg_temp.as_user(pg_temp.f('m2'), format($q$select public.withdraw_participation(%L)$q$, pg_temp.f('p1')));
  perform pg_temp.rec('INC-08 retirada antes del primer lock', pg_temp.is_ok(r), r);
  r := pg_temp.as_user(pg_temp.f('m2'), format($q$select public.withdraw_participation(%L)$q$, pg_temp.f('p1')));
  perform pg_temp.rec('INC-08b retirada idempotente', pg_temp.is_ok(r), r);
  select count(*) into v_cnt_after from public.predictions where participant_id = pg_temp.f('part_m2_p1');
  perform pg_temp.rec('INC-08c predicciones conservadas (no se borra nada)', v_cnt_before = v_cnt_after and v_cnt_after = 1, v_cnt_before || '→' || v_cnt_after);
  perform pg_temp.rec('INC-08d la participación retirada no compite', not public.participation_competes(pg_temp.f('part_m2_p1')), '');
  r := pg_temp.as_user(pg_temp.f('m2'), format($q$select public.save_prediction(%L, %L, 5, 5)$q$, pg_temp.f('p1'), pg_temp.f('mt1')));
  perform pg_temp.rec('INC-08e retirado no pronostica', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_user(pg_temp.f('o'), format($q$select public.assign_pool_staff(%L, %L, 'pool_manager')$q$, pg_temp.f('p1'), pg_temp.f('m2')));
  perform pg_temp.rec('INC-08f tras retirarse puede recibir el rol (antes del primer lock)', pg_temp.is_ok(r), r);
  r := pg_temp.as_user(pg_temp.f('m2'), $q$select public.join_pool('ZZ30P1')$q$);
  perform pg_temp.rec('INC-08g y ya no puede volver a inscribirse', pg_temp.is_err(r, '42501', 'ADMIN_PARTICIPANT_INCOMPATIBLE'), r);
  r := pg_temp.as_role('postgres', format($q$update public.participants set withdrawn_at = null where id = %L$q$, pg_temp.f('part_m2_p1')));
  perform pg_temp.rec('INC-08h la retirada es terminal', pg_temp.is_err(r, '42501'), r);

  -- INC-06/09 primer lock ya alcanzado en P3
  r := pg_temp.as_user(pg_temp.f('m3'), format($q$select public.withdraw_participation(%L)$q$, pg_temp.f('p3')));
  perform pg_temp.rec('INC-09 retirada tras el primer lock → FIRST_LOCK_PASSED', pg_temp.is_err(r, '42501', 'FIRST_LOCK_PASSED'), r);
  r := pg_temp.as_user(pg_temp.f('o'), format($q$select public.assign_pool_staff(%L, %L, 'pool_manager')$q$, pg_temp.f('p3'), pg_temp.f('m3')));
  perform pg_temp.rec('INC-06 participante activo tras el primer lock no recibe rol', pg_temp.is_err(r, '42501'), r);
  update public.participants set withdrawn_at = clock_timestamp() where id = pg_temp.f('part_m1_p3');
  r := pg_temp.as_user(pg_temp.f('o'), format($q$select public.assign_pool_staff(%L, %L, 'pool_manager')$q$, pg_temp.f('p3'), pg_temp.f('m1')));
  perform pg_temp.rec('INC-06b ni siquiera un retirado tras el primer lock → FIRST_LOCK_PASSED', pg_temp.is_err(r, '42501', 'FIRST_LOCK_PASSED'), r);

  -- INC-10 exclusión histórica: perder el rol no devuelve el derecho a participar
  r := pg_temp.as_user(pg_temp.f('o'), format($q$select public.assign_pool_staff(%L, %L, 'pool_manager')$q$, pg_temp.f('p1'), pg_temp.f('x')));
  perform pg_temp.rec('INC-10 asignar rol a x', pg_temp.is_ok(r), r);
  r := pg_temp.as_user(pg_temp.f('o'), format($q$select public.revoke_pool_staff(%L, %L)$q$, pg_temp.f('p1'), pg_temp.f('x')));
  perform pg_temp.rec('INC-10b revocar rol a x', pg_temp.is_ok(r), r);
  r := pg_temp.as_user(pg_temp.f('x'), $q$select public.join_pool('ZZ30P1')$q$);
  perform pg_temp.rec('INC-10c ex-colaborador sigue excluido de P1', pg_temp.is_err(r, '42501', 'ADMIN_PARTICIPANT_INCOMPATIBLE'), r);
  perform pg_temp.rec('INC-10d exclusión registrada (pool_staff)', exists (select 1 from public.pool_admin_exclusions where pool_id = pg_temp.f('p1') and profile_id = pg_temp.f('x') and source = 'pool_staff'), '');
  r := pg_temp.as_user(pg_temp.f('x'), $q$select public.join_pool('ZZ30P2')$q$);
  perform pg_temp.rec('INC-10e …pero puede participar en P2', pg_temp.is_ok(r), r);

  -- INC-11 el rol ejercido solo mientras la quiniela era borrador NO excluye
  r := pg_temp.as_user(pg_temp.f('o'), format($q$select public.assign_pool_staff(%L, %L, 'pool_manager')$q$, pg_temp.f('pd'), pg_temp.f('y')));
  perform pg_temp.rec('INC-11 asignar rol en borrador', pg_temp.is_ok(r), r);
  r := pg_temp.as_user(pg_temp.f('o'), format($q$select public.revoke_pool_staff(%L, %L)$q$, pg_temp.f('pd'), pg_temp.f('y')));
  perform pg_temp.rec('INC-11b revocar en borrador', pg_temp.is_ok(r), r);
  perform pg_temp.rec('INC-11c no hay exclusión (la quiniela no se había abierto)', not exists (select 1 from public.pool_admin_exclusions where pool_id = pg_temp.f('pd') and profile_id = pg_temp.f('y')), '');
  update public.pools set status = 'open' where id = pg_temp.f('pd');
  r := pg_temp.as_user(pg_temp.f('y'), $q$select public.join_pool('ZZ30PD')$q$);
  perform pg_temp.rec('INC-11d tras abrir, quien fue colaborador en borrador sí participa', pg_temp.is_ok(r), r);
  perform pg_temp.rec('INC-11e la apertura registró instantánea de los owners/admin vigentes',
    (select count(*) from public.pool_admin_exclusions where pool_id = pg_temp.f('pd') and source = 'pool_opening_snapshot') >= 3, '');

  -- INC-12 alternar el rol no evade la regla
  r := 'init';
  for i in 1..3 loop
    r := pg_temp.as_user(pg_temp.f('o'), format($q$select public.assign_pool_staff(%L, %L, 'pool_finance')$q$, pg_temp.f('p2'), pg_temp.f('z')));
    r := pg_temp.as_user(pg_temp.f('o'), format($q$select public.revoke_pool_staff(%L, %L)$q$, pg_temp.f('p2'), pg_temp.f('z')));
  end loop;
  r := pg_temp.as_user(pg_temp.f('z'), $q$select public.join_pool('ZZ30P2')$q$);
  perform pg_temp.rec('INC-12 alternar rol 3 veces y luego inscribirse → rechazado', pg_temp.is_err(r, '42501', 'ADMIN_PARTICIPANT_INCOMPATIBLE'), r);

  -- INC-15 rol de tenant concedido a quien participa
  r := pg_temp.as_role('postgres', format($q$update public.tenant_memberships set role = 'admin' where tenant_id = %L and profile_id = %L$q$, pg_temp.f('t'), pg_temp.f('m1')));
  perform pg_temp.rec('INC-15 promover a admin del tenant a quien participa en una quiniela → rechazado', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('postgres', format($q$update public.tenant_memberships set role = 'admin' where tenant_id = %L and profile_id = %L$q$, pg_temp.f('t'), pg_temp.f('tg')));
  perform pg_temp.rec('INC-15b promover a alguien sin participación → permitido', pg_temp.is_ok(r), r);
  perform pg_temp.rec('INC-15c queda excluido en todas las quinielas abiertas del tenant', (select count(*) from public.pool_admin_exclusions where profile_id = pg_temp.f('tg') and tenant_id = pg_temp.f('t')) >= 4, '');
  r := pg_temp.as_user(pg_temp.f('tg'), $q$select public.join_pool('ZZ30P2')$q$);
  perform pg_temp.rec('INC-15d el nuevo admin no se inscribe', pg_temp.is_err(r, '42501', 'ADMIN_PARTICIPANT_INCOMPATIBLE'), r);
  r := pg_temp.as_role('postgres', format($q$update public.tenant_memberships set role = 'member' where tenant_id = %L and profile_id = %L$q$, pg_temp.f('t'), pg_temp.f('tg')));
  r := pg_temp.as_user(pg_temp.f('tg'), $q$select public.join_pool('ZZ30P2')$q$);
  perform pg_temp.rec('INC-15e degradar a member no devuelve el derecho (histórico)', pg_temp.is_err(r, '42501', 'ADMIN_PARTICIPANT_INCOMPATIBLE'), r);
end $$;

do $$
declare r text; v_n text;
begin
  -- INC-13/14 transferencia
  r := pg_temp.as_user(pg_temp.f('o'), format($q$select public.assign_pool_staff(%L, %L, 'pool_owner')$q$, pg_temp.f('p2'), pg_temp.f('po')));
  perform pg_temp.rec('INC-13 asignar pool_owner', pg_temp.is_ok(r), r);
  r := pg_temp.as_user(pg_temp.f('po'), format($q$select public.transfer_pool_administration(%L, %L, %L)$q$, pg_temp.f('p2'), pg_temp.f('po'), pg_temp.f('mg')));
  perform pg_temp.rec('INC-13b transferir a quien participa en P2 (mg es participante de P2) → rechazado', pg_temp.is_err(r, '42501', 'WITHDRAW_FIRST'), r);
  r := pg_temp.as_user(pg_temp.f('mg'), format($q$select public.transfer_pool_administration(%L, %L, %L)$q$, pg_temp.f('p2'), pg_temp.f('po'), pg_temp.f('tg')));
  perform pg_temp.rec('INC-13c un tercero sin capacidad no transfiere', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_user(pg_temp.f('po'), format($q$select public.transfer_pool_administration(%L, %L, %L)$q$, pg_temp.f('p2'), pg_temp.f('po'), pg_temp.f('po')));
  perform pg_temp.rec('INC-13d origen = destino → 22023', pg_temp.is_err(r, '22023'), r);

  r := pg_temp.as_user(pg_temp.f('po'), format($q$select public.transfer_pool_administration(%L, %L, %L)$q$, pg_temp.f('p2'), pg_temp.f('po'), pg_temp.f('fn')));
  perform pg_temp.rec('INC-14 transferencia válida', pg_temp.is_ok(r), r);
  perform pg_temp.rec('INC-14b el saliente queda inactivo y el entrante es pool_owner',
    (select not is_active from public.pool_staff where pool_id = pg_temp.f('p2') and profile_id = pg_temp.f('po'))
    and (select is_active and role = 'pool_owner' from public.pool_staff where pool_id = pg_temp.f('p2') and profile_id = pg_temp.f('fn')), '');
  perform pg_temp.rec('INC-14c queda exclusión del saliente', exists (select 1 from public.pool_admin_exclusions where pool_id = pg_temp.f('p2') and profile_id = pg_temp.f('po')), '');
  perform pg_temp.rec('INC-14d auditoría de la transferencia', exists (select 1 from public.audit_log where action = 'pool.transfer_administration' and entity_id = pg_temp.f('p2')), '');
  r := pg_temp.as_user(pg_temp.f('po'), $q$select public.join_pool('ZZ30P2')$q$);
  perform pg_temp.rec('INC-14e el saliente no puede inscribirse en la edición que administró', pg_temp.is_err(r, '42501', 'ADMIN_PARTICIPANT_INCOMPATIBLE'), r);

  -- INC-16 aislamiento
  v_n := pg_temp.scalar_as_user(pg_temp.f('ob'), format($q$select count(*) from public.pool_admin_exclusions where tenant_id = %L$q$, pg_temp.f('t')));
  perform pg_temp.rec('INC-16 un admin de otro tenant no lee exclusiones ajenas', v_n = 'OK:0', v_n);
  v_n := pg_temp.scalar_as_user(pg_temp.f('ob'), format($q$select public.has_pool_capability(%L, 'staff')::text$q$, pg_temp.f('p1')));
  perform pg_temp.rec('INC-16b sin capacidad cross-tenant', v_n = 'OK:false', v_n);
  r := pg_temp.as_user(pg_temp.f('ob'), format($q$select public.assign_pool_staff(%L, %L, 'pool_owner')$q$, pg_temp.f('p1'), pg_temp.f('ob')));
  perform pg_temp.rec('INC-16c cross-tenant: asignar rol en quiniela ajena → 42501', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_user(pg_temp.f('a'), format($q$select public.assign_pool_staff(%L, %L, 'pool_owner')$q$, pg_temp.f('p1'), pg_temp.f('x')));
  perform pg_temp.rec('INC-16d un admin de tenant (no owner) no gestiona personal', pg_temp.is_err(r, '42501'), r);

  -- INC-17 las exclusiones son inmutables
  r := pg_temp.as_role('postgres', 'update public.pool_admin_exclusions set source = ''tenant_role''');
  perform pg_temp.rec('INC-17 UPDATE de exclusiones → append-only', r like 'ERR:42501:%append-only%', r);
  r := pg_temp.as_role('postgres', 'delete from public.pool_admin_exclusions');
  perform pg_temp.rec('INC-17b DELETE de exclusiones → append-only', r like 'ERR:42501:%append-only%', r);
  r := pg_temp.as_role('postgres', 'truncate table public.pool_admin_exclusions');
  perform pg_temp.rec('INC-17c TRUNCATE de exclusiones → append-only', r like 'ERR:42501:%append-only%', r);
  r := pg_temp.as_user(pg_temp.f('o'), 'delete from public.pool_admin_exclusions');
  perform pg_temp.rec('INC-17d authenticated no escribe exclusiones (privilegio)', r like 'ERR:42501:%permission denied%', r);
  r := pg_temp.as_user(pg_temp.f('o'), format($q$insert into public.pool_staff(tenant_id, pool_id, profile_id, role) values (%L, %L, %L, 'pool_owner')$q$, pg_temp.f('t'), pg_temp.f('p1'), pg_temp.f('y')));
  perform pg_temp.rec('INC-17e authenticated no escribe pool_staff directamente (privilegio)', r like 'ERR:42501:%permission denied%', r);
end $$;

do $$
declare r text; v_n text; v_conf uuid; v_pred_before bigint; v_pred_after bigint;
begin
  -- SA: Superadmin = privilegio global; intervenir en una quiniela lo excluye de ella
  insert into public.platform_admins(user_id, note) values (pg_temp.f('pa'), 'synthetic'), (pg_temp.f('pa2'), 'synthetic');
  r := pg_temp.as_user(pg_temp.f('m1'), format($q$select public.register_platform_intervention(%L, 'support', 'investigating a dispute')$q$, pg_temp.f('p2')));
  perform pg_temp.rec('SA3 un usuario normal no registra intervenciones', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_user(pg_temp.f('pa'), format($q$select public.register_platform_intervention(%L, 'support', 'short')$q$, pg_temp.f('p2')));
  perform pg_temp.rec('SA4 motivo insuficiente → 22023', pg_temp.is_err(r, '22023'), r);
  r := pg_temp.as_user(pg_temp.f('pa'), format($q$select public.register_platform_intervention(%L, 'support', 'investigating a dispute')$q$, pg_temp.f('p2')));
  perform pg_temp.rec('SA1 Superadmin registra intervención', pg_temp.is_ok(r), r);
  perform pg_temp.rec('SA1b exclusión platform_intervention y auditoría', exists (select 1 from public.pool_admin_exclusions where pool_id = pg_temp.f('p2') and profile_id = pg_temp.f('pa') and source = 'platform_intervention')
    and exists (select 1 from public.audit_log where action = 'platform.intervention' and entity_id = pg_temp.f('p2')), '');
  r := pg_temp.as_user(pg_temp.f('pa'), $q$select public.join_pool('ZZ30P2')$q$);
  perform pg_temp.rec('SA1c tras intervenir, el Superadmin no participa en esa quiniela', pg_temp.is_err(r, '42501', 'ADMIN_PARTICIPANT_INCOMPATIBLE'), r);
  r := pg_temp.as_user(pg_temp.f('pa2'), $q$select public.join_pool('ZZ30P3')$q$);
  perform pg_temp.rec('SA2 Superadmin sin intervención participa como cualquier usuario', pg_temp.is_ok(r), r);
  r := pg_temp.as_user(pg_temp.f('pa2'), format($q$select public.register_platform_intervention(%L, 'support', 'investigating a dispute')$q$, pg_temp.f('p3')));
  perform pg_temp.rec('SA2b …y no puede intervenir en una quiniela donde participa', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_user(pg_temp.f('m1'), format($q$select public.participation_competes(%L)$q$, pg_temp.f('part_m1_p1')));
  perform pg_temp.rec('PROBE1 participation_competes no es consultable por clientes', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_user(pg_temp.f('m1'), format($q$select public._has_pool_capability(%L, 'staff', %L)$q$, pg_temp.f('p1'), pg_temp.f('o')));
  perform pg_temp.rec('PROBE2 la capacidad de otros perfiles no es consultable (función interna)', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('postgres', format($q$delete from public.participants where id = %L$q$, pg_temp.f('part_m1_p1')));
  perform pg_temp.rec('DEL1 un participante de una quiniela abierta no se borra', pg_temp.is_err(r, '42501'), r);

  -- LEG: regularización de conflicto heredado (a = admin del tenant, participante heredado de P2)
  insert into public.legacy_admin_conflicts(tenant_id, pool_id, profile_id, participant_id)
    values (pg_temp.f('t'), pg_temp.f('p2'), pg_temp.f('a'), pg_temp.f('part_a_p2')) returning id into v_conf;
  insert into fx(k, v) values ('conf', v_conf);
  r := pg_temp.as_role('postgres', format($q$delete from public.legacy_admin_conflicts where id = %L$q$, pg_temp.f('conf')));
  perform pg_temp.rec('DEL2 un conflicto heredado no se borra', pg_temp.is_err(r, '42501', null), r);
  select count(*) into v_pred_before from public.predictions where pool_id = pg_temp.f('p2');
  r := pg_temp.as_user(pg_temp.f('a'), format($q$select public.regularize_legacy_conflict(%L, 'self regularization attempt')$q$, v_conf));
  perform pg_temp.rec('LEG1 el conflictuado no regulariza su propio conflicto', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_user(pg_temp.f('mg'), format($q$select public.regularize_legacy_conflict(%L, 'manager attempt without staff capability')$q$, v_conf));
  perform pg_temp.rec('LEG2 sin capacidad staff no regulariza', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_user(pg_temp.f('o2'), format($q$select public.regularize_legacy_conflict(%L, 'short')$q$, v_conf));
  perform pg_temp.rec('LEG3 la nota es obligatoria (≥10)', pg_temp.is_err(r, '22023'), r);
  r := pg_temp.as_user(pg_temp.f('o2'), format($q$select public.regularize_legacy_conflict(%L, 'owner formalizes withdrawal of conflicted participation')$q$, v_conf));
  perform pg_temp.rec('LEG4 otro owner regulariza (participación retirada, nada borrado)', pg_temp.is_ok(r), r);
  perform pg_temp.rec('LEG4b estado regularizado y participante retirado',
    (select status = 'regularized' and resolution = 'participation_withdrawn' from public.legacy_admin_conflicts where id = v_conf)
    and (select withdrawn_at is not null from public.participants where id = pg_temp.f('part_a_p2')), '');
  select count(*) into v_pred_after from public.predictions where pool_id = pg_temp.f('p2');
  perform pg_temp.rec('LEG4c predicciones y filas conservadas', v_pred_before = v_pred_after and exists (select 1 from public.participants where id = pg_temp.f('part_a_p2')), v_pred_before || '→' || v_pred_after);
  r := pg_temp.as_user(pg_temp.f('o2'), format($q$select public.regularize_legacy_conflict(%L, 'second call must be idempotent')$q$, v_conf));
  perform pg_temp.rec('LEG5 regularización idempotente', pg_temp.is_ok(r), r);
  perform pg_temp.rec('LEG6 auditoría de la regularización', exists (select 1 from public.audit_log where action = 'legacy_admin_conflicts.update' and entity_id = v_conf), '');
  perform pg_temp.rec('LEG7 sigue sin competir', not public.participation_competes(pg_temp.f('part_a_p2')), '');
end $$;

do $$
declare
  r text; v_t3 uuid := gen_random_uuid(); v_o3 uuid; v_ad3 uuid; v_po3 uuid; v_late uuid; v_pool3 uuid; v_poolb uuid;
begin
  -- MODEL: pasar de administración por tenant a por quiniela no reconstruye nada ni rehabilita a nadie
  v_o3 := pg_temp.mk_user('m-owner'); v_ad3 := pg_temp.mk_user('m-admin'); v_po3 := pg_temp.mk_user('m-poolowner'); v_late := pg_temp.mk_user('m-late');
  insert into public.tenants(id, name) values (v_t3, 'M30 T3');
  insert into public.tenant_entitlements(tenant_id, plan_code) values (v_t3, 'pro');
  insert into public.tenant_memberships(tenant_id, profile_id, role) values (v_t3, v_o3, 'owner'), (v_t3, v_ad3, 'admin'), (v_t3, v_po3, 'member'), (v_t3, v_late, 'member');
  insert into public.pools(tenant_id, name, status) values (v_t3, 'M pool', 'open') returning id into v_pool3;
  insert into public.pool_join_codes(tenant_id, pool_id, code) values (v_t3, v_pool3, 'ZZ30M1');
  r := pg_temp.as_role('postgres', format($q$update public.tenants set pool_admin_model = 'pool' where id = %L$q$, v_t3));
  perform pg_temp.rec('MODEL1 no se pasa a administración por quiniela sin pool_owner', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_user(v_o3, format($q$select public.assign_pool_staff(%L, %L, 'pool_owner')$q$, v_pool3, v_po3));
  perform pg_temp.rec('MODEL2 asignar pool_owner', pg_temp.is_ok(r), r);
  r := pg_temp.as_role('postgres', format($q$update public.tenants set pool_admin_model = 'pool' where id = %L$q$, v_t3));
  perform pg_temp.rec('MODEL3 conmutación permitida con pool_owner', pg_temp.is_ok(r), r);
  perform pg_temp.rec('MODEL4 el owner del tenant ya no tiene capacidad sobre la quiniela',
    not public._has_pool_capability(v_pool3, 'staff', v_o3) and public._has_pool_capability(v_pool3, 'staff', v_po3), '');
  r := pg_temp.as_user(v_ad3, $q$select public.join_pool('ZZ30M1')$q$);
  perform pg_temp.rec('MODEL5 el ex-admin sigue excluido (instantánea persistida): sin reconstruir tickets ni rankings', pg_temp.is_err(r, '42501', 'ADMIN_PARTICIPANT_INCOMPATIBLE'), r);
  r := pg_temp.as_user(v_late, $q$select public.join_pool('ZZ30M1')$q$);
  perform pg_temp.rec('MODEL6 un miembro normal se inscribe', pg_temp.is_ok(r), r);
  r := pg_temp.as_role('postgres', format($q$update public.tenants set pool_admin_model = 'tenant' where id = %L$q$, v_t3));
  perform pg_temp.rec('MODEL7 la conmutación es de un solo sentido', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_user(v_po3, format($q$select public.revoke_pool_staff(%L, %L)$q$, v_pool3, v_po3));
  perform pg_temp.rec('MODEL8 no se deja una quiniela sin quien gestione el personal', pg_temp.is_err(r, '42501'), r);
end $$;

select * from t_results order by id;
