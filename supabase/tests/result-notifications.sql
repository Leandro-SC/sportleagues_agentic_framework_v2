-- ADR-025: notificaciones de resultados. Se ejecuta con scripts/qa/run-sql-suite.mjs (transacción con rollback; no deja datos).
do $$
declare
  v_t uuid; v_o uuid; v_p uuid; v_q uuid; v_r uuid; v_w uuid; v_out uuid;
  v_tour uuid; v_h uuid; v_a uuid; v_r1 uuid; v_pool uuid; v_m1 uuid; v_pm1 uuid; v_pp uuid; v_pq uuid; v_pw uuid;
  v_res text; v_n integer; v_other uuid;
begin
  v_o := pg_temp.mk_user('nt-owner'); v_p := pg_temp.mk_user('nt-P'); v_q := pg_temp.mk_user('nt-Q'); v_r := pg_temp.mk_user('nt-R');
  v_w := pg_temp.mk_user('nt-W'); v_out := pg_temp.mk_user('nt-out');
  insert into public.tenants(name) values ('NT tenant') returning id into v_t;
  insert into public.tenant_entitlements(tenant_id, plan_code) values (v_t, 'pro');
  insert into public.tenant_memberships(tenant_id, profile_id, role) values (v_t, v_o, 'owner'), (v_t, v_p, 'member'), (v_t, v_q, 'member'), (v_t, v_r, 'member'), (v_t, v_w, 'member');
  insert into public.tournaments(tenant_id, name) values (v_t, 'T') returning id into v_tour;
  insert into public.teams(tenant_id, name) values (v_t, 'Alianza') returning id into v_h;
  insert into public.teams(tenant_id, name) values (v_t, 'Cristal') returning id into v_a;
  insert into public.tournament_teams(tenant_id, tournament_id, team_id) values (v_t, v_tour, v_h), (v_t, v_tour, v_a);
  insert into public.rounds(tenant_id, tournament_id, name, sort_order) values (v_t, v_tour, 'R1', 1) returning id into v_r1;
  insert into public.pools(tenant_id, name, status, lock_offset) values (v_t, 'Liga NT', 'open', interval '15 minutes') returning id into v_pool;
  insert into public.pool_rules(tenant_id, pool_id, version, exact_points, outcome_points, tie_breaker, is_current) values (v_t, v_pool, 1, 5, 2, 'exact_predictions', true);
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at) values (v_t, v_tour, v_r1, v_h, v_a, now() + interval '1 hour') returning id into v_m1;
  insert into public.pool_matches(tenant_id, pool_id, match_id) values (v_t, v_pool, v_m1) returning id into v_pm1;
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_t, v_pool, v_p, 'approved', 'paid') returning id into v_pp;
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_t, v_pool, v_q, 'approved', 'paid') returning id into v_pq;
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_t, v_pool, v_r, 'pending', 'invited');
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_t, v_pool, v_w, 'approved', 'paid') returning id into v_pw;
  insert into public.predictions(tenant_id, pool_id, pool_match_id, participant_id, home_score, away_score) values (v_t, v_pool, v_pm1, v_pp, 2, 1), (v_t, v_pool, v_pm1, v_pq, 1, 0);
  -- W se retira antes del primer lock (mecanismo legítimo)
  v_res := pg_temp.as_user(v_w, format($q$select public.withdraw_participation(%L)$q$, v_pool));
  perform pg_temp.rec('NT00 W se retira antes del lock', pg_temp.is_ok(v_res), v_res);

  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform public.apply_fixture_update(v_m1, now() - interval '1 minute', null);
  perform set_config('request.jwt.claims', '', true);
  v_res := pg_temp.as_user(v_o, format($q$select public.publish_official_result(%L, 2, 1, 0)$q$, v_m1));
  perform pg_temp.rec('NT01 el organizador publica 2-1', pg_temp.is_ok(v_res), v_res);

  select title || ' | ' || body into v_res from public.notifications where profile_id = v_p;
  perform pg_temp.rec('NT02 P recibe el resultado con su pronóstico exacto y 5 pts', v_res = 'Resultado: Alianza 2-1 Cristal | Liga NT · Tu pronóstico 2-1: 5 pts', coalesce(v_res, 'sin aviso'));
  select body into v_res from public.notifications where profile_id = v_q;
  perform pg_temp.rec('NT03 Q acierta el ganador: 2 pts', v_res = 'Liga NT · Tu pronóstico 1-0: 2 pts', coalesce(v_res, 'sin aviso'));
  select count(*) into v_n from public.notifications where profile_id in (v_r, v_w, v_o, v_out);
  perform pg_temp.rec('NT04 sin aviso para pendientes, retirados, organizador ni ajenos', v_n = 0, 'filas=' || v_n);

  v_res := pg_temp.as_user(v_o, format($q$select public.publish_official_result(%L, 2, 1, 1)$q$, v_m1));
  select count(*) into v_n from public.notifications where pool_id = v_pool;
  perform pg_temp.rec('NT05 republicar el mismo marcador no duplica avisos', pg_temp.is_ok(v_res) and v_n = 2, v_res || ' filas=' || v_n);

  v_res := pg_temp.as_user(v_o, format($q$select public.publish_official_result(%L, 0, 0, 1)$q$, v_m1));
  select title || ' | ' || body into v_res from public.notifications where profile_id = v_p and result_revision = 2;
  perform pg_temp.rec('NT06 la corrección avisa de nuevo con el puntaje recalculado', v_res = 'Resultado corregido: Alianza 0-0 Cristal | Liga NT · Tu pronóstico 2-1: 0 pts', coalesce(v_res, 'sin aviso'));
  select kind into v_res from public.notifications where profile_id = v_q and result_revision = 2;
  perform pg_temp.rec('NT07 la corrección se marca como result_corrected', v_res = 'result_corrected', coalesce(v_res, 'sin aviso'));

  -- Privacidad y escritura
  v_res := pg_temp.scalar_as_user(v_p, 'select count(*)::text from public.notifications');
  perform pg_temp.rec('NT08 cada jugador solo ve sus avisos', v_res = 'OK:2', v_res);
  v_res := pg_temp.scalar_as_user(v_out, 'select count(*)::text from public.notifications');
  perform pg_temp.rec('NT09 un ajeno no ve avisos de nadie', v_res = 'OK:0', v_res);
  v_res := pg_temp.as_user(v_p, format($q$insert into public.notifications(tenant_id, profile_id, pool_id, match_id, kind, result_revision, title, body) values (%L, %L, %L, %L, 'result_published', 9, 'x', 'x')$q$, v_t, v_q, v_pool, v_m1));
  perform pg_temp.rec('NT10 nadie inserta avisos directamente', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_p, format($q$update public.notifications set read_at = now() where profile_id = %L$q$, v_q));
  perform pg_temp.rec('NT11 nadie modifica avisos directamente', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_role('anon', 'select count(*) from public.notifications');
  perform pg_temp.rec('NT12 anon no lee avisos', pg_temp.is_err(v_res, '42501'), v_res);

  -- Marcar como leídas
  select id into v_other from public.notifications where profile_id = v_q limit 1;
  v_res := pg_temp.scalar_as_user(v_p, format($q$select public.mark_notifications_read(array[%L]::uuid[])::text$q$, v_other));
  perform pg_temp.rec('NT13 no se pueden marcar avisos ajenos', v_res = 'OK:0', v_res);
  v_res := pg_temp.scalar_as_user(v_p, 'select public.mark_notifications_read()::text');
  select count(*) into v_n from public.notifications where profile_id = v_q and read_at is null;
  perform pg_temp.rec('NT14 marcar todo afecta solo a los propios (P 2; Q sigue con 2 sin leer)', v_res = 'OK:2' and v_n = 2, v_res || ' Q sin leer=' || v_n);
  v_res := pg_temp.as_role('anon', 'select public.mark_notifications_read()');
  perform pg_temp.rec('NT15 anon no marca avisos', pg_temp.is_err(v_res, '42501'), v_res);

  -- Retención (solo service_role, mínimo 30 días)
  v_res := pg_temp.as_user(v_p, 'select public.purge_read_notifications()');
  perform pg_temp.rec('NT16 authenticated no purga', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_role('service_role', $q$select public.purge_read_notifications(interval '1 day')$q$);
  perform pg_temp.rec('NT17 la retención mínima es de 30 días', pg_temp.is_err(v_res, '22023'), v_res);
  v_res := pg_temp.as_role('service_role', 'select public.purge_read_notifications()');
  select count(*) into v_n from public.notifications where pool_id = v_pool;
  perform pg_temp.rec('NT18 la purga no borra avisos recientes', pg_temp.is_ok(v_res) and v_n = 4, v_res || ' filas=' || v_n);
end $$;
