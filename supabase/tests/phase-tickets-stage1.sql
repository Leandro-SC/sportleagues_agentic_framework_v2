-- ADR-014 Etapa 1: tickets gratuitos. Se ejecuta con scripts/qa/run-sql-suite.mjs (transacción con rollback; no deja datos).
do $$
declare
  v_t uuid; v_t2 uuid; v_o uuid; v_o2 uuid; v_p uuid; v_q uuid; v_mem uuid; v_out uuid;
  v_tour uuid; v_h uuid; v_a uuid; v_r1 uuid; v_r2 uuid; v_pool uuid; v_pool2 uuid; v_m1 uuid; v_m2 uuid; v_m3 uuid; v_pm3b uuid;
  v_pp uuid; v_pq uuid; v_pp2 uuid; v_tA uuid; v_tB uuid; v_tC uuid; v_tD uuid; v_tE uuid; v_res text; v_body text;
  k1 constant uuid := '00000000-0000-4000-8000-000000000001'; k2 constant uuid := '00000000-0000-4000-8000-000000000002';
  k3 constant uuid := '00000000-0000-4000-8000-000000000003'; k4 constant uuid := '00000000-0000-4000-8000-000000000004';
  k5 constant uuid := '00000000-0000-4000-8000-000000000005'; k6 constant uuid := '00000000-0000-4000-8000-000000000006';
begin
  v_o := pg_temp.mk_user('tk-owner'); v_o2 := pg_temp.mk_user('tk-owner2'); v_p := pg_temp.mk_user('tk-P'); v_q := pg_temp.mk_user('tk-Q');
  v_mem := pg_temp.mk_user('tk-mem'); v_out := pg_temp.mk_user('tk-out');
  insert into public.tenants(name) values ('TK tenant') returning id into v_t;
  insert into public.tenants(name) values ('TK tenant 2') returning id into v_t2;
  insert into public.tenant_entitlements(tenant_id, plan_code) values (v_t, 'pro'), (v_t2, 'pro');
  insert into public.tenant_memberships(tenant_id, profile_id, role) values
    (v_t, v_o, 'owner'), (v_t, v_p, 'member'), (v_t, v_q, 'member'), (v_t, v_mem, 'member'), (v_t2, v_o2, 'owner');
  insert into public.tournaments(tenant_id, name) values (v_t, 'T') returning id into v_tour;
  insert into public.teams(tenant_id, name) values (v_t, 'H') returning id into v_h;
  insert into public.teams(tenant_id, name) values (v_t, 'A') returning id into v_a;
  insert into public.tournament_teams(tenant_id, tournament_id, team_id) values (v_t, v_tour, v_h), (v_t, v_tour, v_a);
  insert into public.rounds(tenant_id, tournament_id, name, sort_order) values (v_t, v_tour, 'Fecha 1', 1) returning id into v_r1;
  insert into public.rounds(tenant_id, tournament_id, name, sort_order) values (v_t, v_tour, 'Fecha 2', 2) returning id into v_r2;
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at) values (v_t, v_tour, v_r1, v_h, v_a, now() + interval '1 hour') returning id into v_m1;
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at) values (v_t, v_tour, v_r1, v_a, v_h, now() + interval '2 hours') returning id into v_m2;
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at) values (v_t, v_tour, v_r2, v_h, v_a, now() + interval '5 hours') returning id into v_m3;
  insert into public.pools(tenant_id, name, status, lock_offset) values (v_t, 'TK pool', 'open', interval '15 minutes') returning id into v_pool;
  insert into public.pool_rules(tenant_id, pool_id, version, exact_points, outcome_points, tie_breaker, is_current) values (v_t, v_pool, 1, 5, 2, 'exact_predictions', true);
  insert into public.pool_matches(tenant_id, pool_id, match_id) values (v_t, v_pool, v_m1), (v_t, v_pool, v_m2), (v_t, v_pool, v_m3);
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_t, v_pool, v_p, 'approved', 'paid') returning id into v_pp;
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_t, v_pool, v_q, 'approved', 'paid') returning id into v_pq;
  -- segunda quiniela SIN tickets (compatibilidad): un pronóstico clásico ya existente
  insert into public.pools(tenant_id, name, status, lock_offset) values (v_t, 'TK classic', 'open', interval '15 minutes') returning id into v_pool2;
  insert into public.pool_rules(tenant_id, pool_id, version, exact_points, outcome_points, tie_breaker, is_current) values (v_t, v_pool2, 1, 5, 2, 'exact_predictions', true);
  insert into public.pool_matches(tenant_id, pool_id, match_id) values (v_t, v_pool2, v_m3) returning id into v_pm3b;
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_t, v_pool2, v_p, 'approved', 'paid') returning id into v_pp2;
  insert into fx(k, v) values ('t', v_t), ('o', v_o), ('o2', v_o2), ('p', v_p), ('q', v_q), ('mem', v_mem), ('out', v_out), ('pool', v_pool), ('pool2', v_pool2),
    ('r1', v_r1), ('r2', v_r2), ('m1', v_m1), ('m2', v_m2), ('m3', v_m3);

  -- ---- compatibilidad: quiniela clásica sigue funcionando (save_prediction con la nueva unicidad parcial) ----
  v_res := pg_temp.as_user(v_p, format($q$select public.save_prediction(%L, %L, 1, 1)$q$, v_pool2, v_m3));
  perform pg_temp.rec('CMP1 save_prediction clásico sigue operativo', pg_temp.is_ok(v_res), v_res);
  v_res := pg_temp.as_user(v_p, format($q$select public.save_prediction(%L, %L, 2, 2)$q$, v_pool2, v_m3));
  perform pg_temp.rec('CMP2 y editar actualiza la misma fila (ON CONFLICT con índice parcial)', pg_temp.is_ok(v_res)
    and (select count(*) from public.predictions where pool_id = v_pool2) = 1 and (select home_score from public.predictions where pool_id = v_pool2) = 2, v_res);
  v_res := pg_temp.as_user(v_o, format($q$select public.enable_pool_tickets(%L)$q$, v_pool2));
  perform pg_temp.rec('CMP3 no se habilitan tickets en una quiniela con pronósticos existentes', pg_temp.is_err(v_res, '42501'), v_res);
  perform pg_temp.rec('CMP4 los pronósticos existentes conservan ticket_id NULL', (select count(*) from public.predictions where pool_id = v_pool2 and ticket_id is not null) = 0, '');

  -- ---- habilitar tickets ----
  v_res := pg_temp.as_user(v_mem, format($q$select public.enable_pool_tickets(%L)$q$, v_pool));
  perform pg_temp.rec('TK1 un miembro no habilita tickets', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_o2, format($q$select public.enable_pool_tickets(%L)$q$, v_pool));
  perform pg_temp.rec('TK2 el admin de otro tenant tampoco', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.scalar_as_user(v_o, format($q$select public.enable_pool_tickets(%L)$q$, v_pool));
  perform pg_temp.rec('TK3 el organizador habilita tickets: 2 jornadas vendibles (límite 1 por defecto)', v_res = 'OK:2', v_res);
  v_res := pg_temp.scalar_as_user(v_o, format($q$select public.enable_pool_tickets(%L)$q$, v_pool));
  perform pg_temp.rec('TK4 habilitar de nuevo es idempotente', v_res = 'OK:2', v_res);
  v_res := pg_temp.as_role('postgres', format($q$update public.pools set ticketing_mode = 'none' where id = %L$q$, v_pool));
  perform pg_temp.rec('TK5 el modo de tickets es irreversible', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_p, format($q$select public.save_prediction(%L, %L, 1, 0)$q$, v_pool, v_m1));
  perform pg_temp.rec('TK6 save_prediction ya no opera en una quiniela con tickets', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_role('postgres', format($q$insert into public.predictions(tenant_id, pool_id, pool_match_id, participant_id, home_score, away_score)
    select %L, %L, pm.id, %L, 1, 1 from public.pool_matches pm where pm.pool_id = %L and pm.match_id = %L$q$, v_t, v_pool, v_pp, v_pool, v_m1));
  perform pg_temp.rec('TK7 ni siquiera el propietario de tabla inserta pronósticos sin ticket en una quiniela con tickets', pg_temp.is_err(v_res, '42501'), v_res);

  -- ---- emisión, idempotencia y límite ----
  v_res := pg_temp.as_user(v_o, format($q$select public.create_ticket(%L, %L, %L)$q$, v_pool, v_r1, k1));
  perform pg_temp.rec('TK8 el administrador no crea tickets en su quiniela', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_mem, format($q$select public.create_ticket(%L, %L, %L)$q$, v_pool, v_r1, k1));
  perform pg_temp.rec('TK9 un no-participante no crea tickets', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_out, format($q$select public.create_ticket(%L, %L, %L)$q$, v_pool, v_r1, k1));
  perform pg_temp.rec('TK10 un ajeno no crea tickets', pg_temp.is_err(v_res, '42501'), v_res);
  v_tA := substr(pg_temp.scalar_as_user(v_p, format($q$select (public.create_ticket(%L, %L, %L)).id$q$, v_pool, v_r1, k1)), 4)::uuid;
  v_res := pg_temp.scalar_as_user(v_p, format($q$select (public.create_ticket(%L, %L, %L)).id$q$, v_pool, v_r1, k1));
  perform pg_temp.rec('TK11 reintentar con la misma clave devuelve el MISMO ticket', v_res = 'OK:' || v_tA::text, v_res);
  v_res := pg_temp.as_user(v_p, format($q$select public.create_ticket(%L, %L, %L)$q$, v_pool, v_r2, k1));
  perform pg_temp.rec('TK12 la misma clave para otra jornada se rechaza (PT409)', pg_temp.is_err(v_res, 'PT409'), v_res);
  v_res := pg_temp.as_user(v_p, format($q$select public.create_ticket(%L, %L, %L)$q$, v_pool, v_r1, k2));
  perform pg_temp.rec('TK13 con límite 1 el segundo ticket de la jornada se rechaza (TICKET_LIMIT)', pg_temp.is_err(v_res, '42501', 'TICKET_LIMIT'), v_res);
  v_res := pg_temp.as_user(v_p, format($q$select public.configure_pool_round(%L, %L, 2::smallint)$q$, v_pool, v_r1));
  perform pg_temp.rec('TK14 un jugador no configura el límite', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_o, format($q$select public.configure_pool_round(%L, %L, 2::smallint)$q$, v_pool, v_r1));
  perform pg_temp.rec('TK15 el organizador configura el límite en 2', pg_temp.is_ok(v_res), v_res);
  v_tB := substr(pg_temp.scalar_as_user(v_p, format($q$select (public.create_ticket(%L, %L, %L)).id$q$, v_pool, v_r1, k2)), 4)::uuid;
  perform pg_temp.rec('TK16 ahora el jugador puede tener 2 tickets en la jornada', v_tB is not null and v_tB <> v_tA, '');
  v_res := pg_temp.as_user(v_p, format($q$select public.create_ticket(%L, %L, %L)$q$, v_pool, v_r1, k3));
  perform pg_temp.rec('TK17 el tercero se rechaza', pg_temp.is_err(v_res, '42501', 'TICKET_LIMIT'), v_res);
  v_res := pg_temp.as_user(v_o, format($q$select public.configure_pool_round(%L, %L, 1::smallint)$q$, v_pool, v_r1));
  perform pg_temp.rec('TK18 no se baja el límite por debajo de lo ya emitido', pg_temp.is_err(v_res, '22023'), v_res);
  v_tC := substr(pg_temp.scalar_as_user(v_q, format($q$select (public.create_ticket(%L, %L, %L)).id$q$, v_pool, v_r1, k4)), 4)::uuid;
  v_tD := substr(pg_temp.scalar_as_user(v_p, format($q$select (public.create_ticket(%L, %L, %L)).id$q$, v_pool, v_r2, k5)), 4)::uuid;
  perform pg_temp.rec('TK19 cada participante tiene su cupo por jornada (Q en F1, P en F2)', v_tC is not null and v_tD is not null, '');
  v_res := pg_temp.scalar_as_user(v_q, format($q$select (public.create_ticket(%L, %L, %L)).id$q$, v_pool, v_r1, k4));
  perform pg_temp.rec('TK20 la clave es por participante: la de Q devuelve el ticket de Q', v_res = 'OK:' || v_tC::text, v_res);

  -- ---- selecciones ----
  v_res := pg_temp.as_user(v_p, format($q$select public.save_ticket_prediction(%L, %L, 2, 1)$q$, v_tA, v_m1));
  perform pg_temp.rec('TK21 el jugador guarda una selección en su ticket', pg_temp.is_ok(v_res), v_res);
  v_res := pg_temp.as_user(v_p, format($q$select public.save_ticket_prediction(%L, %L, 3, 3)$q$, v_tA, v_m1));
  perform pg_temp.rec('TK22 editarla actualiza la misma fila', pg_temp.is_ok(v_res)
    and (select count(*) from public.predictions where ticket_id = v_tA and pool_match_id = (select id from public.pool_matches where pool_id = v_pool and match_id = v_m1)) = 1, v_res);
  perform pg_temp.as_user(v_p, format($q$select public.save_ticket_prediction(%L, %L, 2, 1)$q$, v_tA, v_m1));
  v_res := pg_temp.as_user(v_q, format($q$select public.save_ticket_prediction(%L, %L, 1, 1)$q$, v_tA, v_m1));
  perform pg_temp.rec('TK23 nadie guarda en el ticket de otro', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_p, format($q$select public.save_ticket_prediction(%L, %L, 1, 1)$q$, v_tA, v_m3));
  perform pg_temp.rec('TK24 un partido de otra jornada no entra en el ticket', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_p, format($q$select public.save_ticket_prediction(%L, %L, -1, 1)$q$, v_tA, v_m2));
  perform pg_temp.rec('TK25 marcador negativo rechazado', pg_temp.is_err(v_res, '22023'), v_res);
  perform pg_temp.as_user(v_p, format($q$select public.save_ticket_prediction(%L, %L, 1, 1)$q$, v_tA, v_m2));
  perform pg_temp.as_user(v_p, format($q$select public.save_ticket_prediction(%L, %L, 2, 1)$q$, v_tB, v_m1));
  perform pg_temp.as_user(v_p, format($q$select public.save_ticket_prediction(%L, %L, 0, 0)$q$, v_tB, v_m2));
  perform pg_temp.as_user(v_q, format($q$select public.save_ticket_prediction(%L, %L, 1, 0)$q$, v_tC, v_m1));
  perform pg_temp.as_user(v_q, format($q$select public.save_ticket_prediction(%L, %L, 0, 0)$q$, v_tC, v_m2));
  perform pg_temp.as_user(v_p, format($q$select public.save_ticket_prediction(%L, %L, 0, 0)$q$, v_tD, v_m3));
  perform pg_temp.rec('TK26 cada pronóstico queda asociado a su ticket (6 + 1 filas con ticket_id)', (select count(*) from public.predictions where ticket_id is not null and pool_id = v_pool) = 7, '');
  v_res := pg_temp.as_role('postgres', format($q$update public.predictions set ticket_id = %L where ticket_id = %L$q$, v_tB, v_tA));
  perform pg_temp.rec('TK27 el ticket de un pronóstico es inmutable', pg_temp.is_err(v_res, '42501'), v_res);

  -- ---- privacidad y RLS ----
  v_res := pg_temp.scalar_as_user(v_q, format($q$select count(*) from public.predictions where ticket_id = %L$q$, v_tA));
  perform pg_temp.rec('TK28 otro jugador no lee mis selecciones antes del cierre', v_res = 'OK:0', v_res);
  v_res := pg_temp.scalar_as_user(v_p, format($q$select count(*) from public.predictions where ticket_id = %L$q$, v_tA));
  perform pg_temp.rec('TK29 yo sí las leo', v_res = 'OK:2', v_res);
  v_res := pg_temp.scalar_as_user(v_o, format($q$select count(*) from public.predictions where ticket_id = %L$q$, v_tA));
  perform pg_temp.rec('TK30 el organizador no ve selecciones antes del cierre (ADR-005)', v_res = 'OK:0', v_res);
  v_res := pg_temp.scalar_as_user(v_q, format($q$select count(*) from public.tickets where id = %L$q$, v_tA));
  perform pg_temp.rec('TK31 otro jugador no ve mis tickets', v_res = 'OK:0', v_res);
  v_res := pg_temp.scalar_as_user(v_o, format($q$select count(*) from public.tickets where pool_id = %L$q$, v_pool));
  perform pg_temp.rec('TK32 el organizador ve los tickets de su quiniela (4)', v_res = 'OK:4', v_res);
  v_res := pg_temp.scalar_as_user(v_o2, format($q$select count(*) from public.tickets$q$));
  perform pg_temp.rec('TK33 otro tenant no ve tickets', v_res = 'OK:0', v_res);
  v_res := pg_temp.as_user(v_p, format($q$insert into public.tickets(tenant_id, pool_id, pool_round_id, participant_id, idempotency_key)
    select %L, %L, id, %L, gen_random_uuid() from public.pool_rounds limit 1$q$, v_t, v_pool, v_pp));
  perform pg_temp.rec('TK34 sin INSERT directo en tickets', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_p, format($q$update public.tickets set status = 'submitted' where id = %L$q$, v_tA));
  perform pg_temp.rec('TK35 sin UPDATE directo en tickets', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_role('postgres', format($q$delete from public.tickets where id = %L$q$, v_tA));
  perform pg_temp.rec('TK36 los tickets no se borran', pg_temp.is_err(v_res, '42501'), v_res);

  -- ---- envío, cancelación y cupo ----
  v_tE := substr(pg_temp.scalar_as_user(v_q, format($q$select (public.create_ticket(%L, %L, %L)).id$q$, v_pool, v_r1, k6)), 4)::uuid;
  v_res := pg_temp.as_user(v_q, format($q$select public.submit_ticket(%L)$q$, v_tE));
  perform pg_temp.rec('TK37 un ticket sin selecciones no se envía', pg_temp.is_err(v_res, '22023'), v_res);
  v_res := pg_temp.as_user(v_q, format($q$select public.cancel_ticket(%L)$q$, v_tE));
  perform pg_temp.rec('TK38 se cancela un borrador', pg_temp.is_ok(v_res), v_res);
  v_res := pg_temp.as_user(v_q, format($q$select public.cancel_ticket(%L)$q$, v_tE));
  perform pg_temp.rec('TK39 cancelar de nuevo es idempotente', pg_temp.is_ok(v_res), v_res);
  v_res := pg_temp.as_user(v_q, format($q$select public.save_ticket_prediction(%L, %L, 1, 1)$q$, v_tE, v_m1));
  perform pg_temp.rec('TK40 un ticket cancelado no recibe selecciones', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_q, format($q$select public.submit_ticket(%L)$q$, v_tE));
  perform pg_temp.rec('TK41 ni se envía', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_p, format($q$select public.submit_ticket(%L)$q$, v_tC));
  perform pg_temp.rec('TK42 nadie envía el ticket de otro', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_p, format($q$select public.submit_ticket(%L)$q$, v_tA));
  perform pg_temp.rec('TK43 el jugador envía su ticket (queda elegible)', pg_temp.is_ok(v_res)
    and (select status::text || '/' || eligibility::text from public.tickets where id = v_tA) = 'submitted/eligible', v_res);
  v_res := pg_temp.as_user(v_p, format($q$select public.submit_ticket(%L)$q$, v_tA));
  perform pg_temp.rec('TK44 enviar de nuevo es idempotente', pg_temp.is_ok(v_res), v_res);
  perform pg_temp.as_user(v_p, format($q$select public.submit_ticket(%L)$q$, v_tB));
  perform pg_temp.as_user(v_q, format($q$select public.submit_ticket(%L)$q$, v_tC));
  perform pg_temp.as_user(v_p, format($q$select public.submit_ticket(%L)$q$, v_tD));
  -- cupo liberado por la cancelación: Q puede emitir otro (queda borrador sin selecciones; no compite)
  v_res := pg_temp.as_user(v_q, format($q$select public.create_ticket(%L, %L, gen_random_uuid())$q$, v_pool, v_r1));
  perform pg_temp.rec('TK45 cancelar libera cupo (Q vuelve a poder emitir hasta el límite 2)', pg_temp.is_ok(v_res), v_res);

  -- ---- cierre determinado por el servidor ----
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform public.apply_fixture_update(v_m1, now() - interval '2 minutes', null);
  perform public.apply_fixture_update(v_m2, now() - interval '1 minute', null);
  perform set_config('request.jwt.claims', '', true);
  v_res := pg_temp.as_user(v_q, format($q$select public.create_ticket(%L, %L, gen_random_uuid())$q$, v_pool, v_r1));
  perform pg_temp.rec('LK1 cerrada la jornada (primer bloqueo) no se emiten tickets', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_p, format($q$select public.cancel_ticket(%L)$q$, v_tA));
  perform pg_temp.rec('LK2 ni se cancelan tickets enviados', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_p, format($q$select public.save_ticket_prediction(%L, %L, 9, 9)$q$, v_tA, v_m1));
  perform pg_temp.rec('LK3 el partido bloqueado rechaza la selección', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_o, format($q$select public.configure_pool_round(%L, %L, 5::smallint)$q$, v_pool, v_r1));
  perform pg_temp.rec('LK4 con la venta cerrada no se cambia el límite', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_p, format($q$select public.save_ticket_prediction(%L, %L, 0, 0)$q$, v_tD, v_m3));
  perform pg_temp.rec('LK5 otra jornada aún abierta sigue editable (el bloqueo es por partido)', pg_temp.is_ok(v_res), v_res);

  -- ---- resultados y ranking por mejor ticket (D8) ----
  v_res := pg_temp.as_user(v_o, format($q$select public.publish_official_result(%L, 2, 1, 0)$q$, v_m1));
  perform pg_temp.rec('RK1 resultado M1 (2-1)', pg_temp.is_ok(v_res), v_res);
  v_res := pg_temp.as_user(v_o, format($q$select public.publish_official_result(%L, 0, 0, 0)$q$, v_m2));
  perform pg_temp.rec('RK2 resultado M2 (0-0)', pg_temp.is_ok(v_res), v_res);
  -- A: 2-1 exacto (5) + 1-1 signo (2) = 7 · B: 5 + 5 = 10 · C(Q): 1-0 signo (2) + 0-0 exacto (5) = 7
  v_body := pg_temp.scalar_as_user(v_p, format($q$select string_agg(rank::text || '/' || display_name || '/' || display_no || '/' || points || '/' || is_best, ' ; ' order by rank, display_name, display_no) from public.pool_ticket_leaderboard(%L, %L)$q$, v_pool, v_r1));
  perform pg_temp.rec('RK3 ranking por ticket de la jornada (B 10; A y C 7; el mejor de cada jugador marcado)',
    v_body = 'OK:1/tk-P/2/10/true ; 2/tk-P/1/7/false ; 2/tk-Q/1/7/true', v_body);
  v_body := pg_temp.scalar_as_user(v_p, format($q$select string_agg(rank::text || '/' || display_name || '/' || points || '/' || exact_hits, ' ; ' order by rank) from public.pool_leaderboard(%L)$q$, v_pool));
  perform pg_temp.rec('RK4 ranking por participante usa el MEJOR ticket elegible (P 10 y no 17; Q 7)', v_body = 'OK:1/tk-P/10/2 ; 2/tk-Q/7/1', v_body);
  v_body := pg_temp.scalar_as_user(v_q, format($q$select string_agg(rank::text || '/' || display_name || '/' || points, ' ; ' order by rank) from public.pool_leaderboard(%L, %L)$q$, v_pool, v_r1));
  perform pg_temp.rec('RK5 por jornada igual en la jornada 1', v_body = 'OK:1/tk-P/10 ; 2/tk-Q/7', v_body);
  v_res := pg_temp.scalar_as_user(v_o, format($q$select count(*) from public.pool_leaderboard(%L)$q$, v_pool));
  perform pg_temp.rec('RK6 el organizador no figura en la clasificación', v_res = 'OK:2', v_res);
  v_body := pg_temp.scalar_as_user(v_p, format($q$select string_agg(round_name || '/' || my_points || '/' || my_cumulative || '/' || avg_points, ' ; ' order by sort_order) from public.pool_points_evolution(%L)$q$, v_pool));
  perform pg_temp.rec('RK7 la evolución usa también el mejor ticket (F1: 10, acumulado 10, media 8.50)', v_body = 'OK:Fecha 1/10/10/8.50', v_body);
  v_body := pg_temp.scalar_as_user(v_p, format($q$select rank || '/' || points || '/' || exact_hits || '/' || results_count from public.my_pool_stats(%L)$q$, v_pool));
  perform pg_temp.rec('RK8 mis estadísticas coinciden (#1, 10 pts, 2 exactos, 2 resultados)', v_body = 'OK:1/10/2/2', v_body);
  v_res := pg_temp.as_user(v_p, format($q$select public.publish_official_result(%L, 2, 1, 1)$q$, v_m1));
  perform public._recalculate_match_scoring(v_m1);
  v_body := pg_temp.scalar_as_user(v_p, format($q$select string_agg(display_name || '/' || points, ' ; ' order by rank) from public.pool_leaderboard(%L)$q$, v_pool));
  perform pg_temp.rec('RK9 el recálculo repetido no duplica puntos', v_body = 'OK:tk-P/10 ; tk-Q/7', v_body);
  -- historial del participante
  v_body := pg_temp.scalar_as_user(v_p, format($q$select string_agg(round_name || '/' || display_no || '/' || status || '/' || selections || '/' || round_matches || '/' || results_count || '/' || coalesce(points::text, '-') || '/' || is_best || '/' || max_tickets, ' ; ' order by round_name, display_no) from public.list_my_tickets(%L)$q$, v_pool));
  perform pg_temp.rec('HIS1 historial de P: F1 #1 (7) y #2 (10, mejor); F2 #1 sin resultados',
    v_body = 'OK:Fecha 1/1/submitted/2/2/2/7/false/2 ; Fecha 1/2/submitted/2/2/2/10/true/2 ; Fecha 2/1/submitted/1/1/0/0/true/1', v_body);
  v_res := pg_temp.scalar_as_user(v_q, 'select count(*) from public.list_my_tickets()');
  perform pg_temp.rec('HIS2 el historial de Q solo incluye sus tickets (3: enviado, cancelado y borrador)', v_res = 'OK:3', v_res);
  v_res := pg_temp.scalar_as_user(v_o, 'select count(*) from public.list_my_tickets()');
  perform pg_temp.rec('HIS3 el organizador no tiene historial de jugador', v_res = 'OK:0', v_res);
  v_res := pg_temp.scalar_as_user(v_o2, format($q$select count(*) from public.list_my_tickets(%L)$q$, v_pool));
  perform pg_temp.rec('HIS4 otro tenant no ve nada', v_res = 'OK:0', v_res);

  -- ---- privilegios ----
  perform pg_temp.rec('ACL1 anon sin EXECUTE en las RPC de tickets',
    not has_function_privilege('anon', 'public.create_ticket(uuid,uuid,uuid)', 'execute')
    and not has_function_privilege('anon', 'public.submit_ticket(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.save_ticket_prediction(uuid,uuid,integer,integer)', 'execute')
    and not has_function_privilege('anon', 'public.list_my_tickets(uuid)', 'execute'), '');
  perform pg_temp.rec('ACL2 las ayudas internas no son ejecutables por clientes',
    not has_function_privilege('authenticated', 'public._ticket_points(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public._round_first_lock(uuid,uuid)', 'execute'), '');
  perform pg_temp.rec('ACL3 authenticated sin DML sobre tickets/pool_rounds',
    not has_table_privilege('authenticated', 'public.tickets', 'insert') and not has_table_privilege('authenticated', 'public.tickets', 'update')
    and not has_table_privilege('authenticated', 'public.pool_rounds', 'insert') and not has_table_privilege('authenticated', 'public.pool_rounds', 'update'), '');
  v_res := pg_temp.as_role('anon', format($q$select public.create_ticket(%L, %L, gen_random_uuid())$q$, v_pool, v_r1));
  perform pg_temp.rec('ACL4 anon no emite tickets', pg_temp.is_err(v_res, '42501'), v_res);
  perform pg_temp.rec('AUD1 la emisión y el envío de tickets quedaron auditados',
    (select count(*) from public.audit_log a where a.tenant_id = v_t and a.entity_type = 'tickets') >= 4, '');
end $$;
