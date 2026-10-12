-- Fase 08 (núcleo): pool_leaderboard. Se ejecuta con scripts/qa/run-sql-suite.mjs (transacción con rollback; no deja datos).
do $$
declare
  v_t uuid; v_o uuid; v_p uuid; v_q uuid; v_r uuid; v_out uuid; v_mem uuid;
  v_tour uuid; v_h uuid; v_a uuid; v_r1 uuid; v_r2 uuid; v_pool uuid;
  v_m1 uuid; v_m2 uuid; v_m3 uuid; v_pm1 uuid; v_pm2 uuid; v_pm3 uuid; v_pp uuid; v_pq uuid; v_pr uuid; v_res text; v_body text;
begin
  v_o := pg_temp.mk_user('lb-owner'); v_p := pg_temp.mk_user('lb-P'); v_q := pg_temp.mk_user('lb-Q'); v_r := pg_temp.mk_user('lb-R');
  v_out := pg_temp.mk_user('lb-out'); v_mem := pg_temp.mk_user('lb-mem');
  insert into public.tenants(name) values ('LB tenant') returning id into v_t;
  insert into public.tenant_entitlements(tenant_id, plan_code) values (v_t, 'pro');
  insert into public.tenant_memberships(tenant_id, profile_id, role) values
    (v_t, v_o, 'owner'), (v_t, v_p, 'member'), (v_t, v_q, 'member'), (v_t, v_r, 'member'), (v_t, v_mem, 'member');
  insert into public.tournaments(tenant_id, name) values (v_t, 'T') returning id into v_tour;
  insert into public.teams(tenant_id, name) values (v_t, 'H') returning id into v_h;
  insert into public.teams(tenant_id, name) values (v_t, 'A') returning id into v_a;
  insert into public.tournament_teams(tenant_id, tournament_id, team_id) values (v_t, v_tour, v_h), (v_t, v_tour, v_a);
  insert into public.rounds(tenant_id, tournament_id, name, sort_order) values (v_t, v_tour, 'R1', 1) returning id into v_r1;
  insert into public.rounds(tenant_id, tournament_id, name, sort_order) values (v_t, v_tour, 'R2', 2) returning id into v_r2;
  insert into public.pools(tenant_id, name, status, lock_offset) values (v_t, 'LB pool', 'open', interval '15 minutes') returning id into v_pool;
  insert into public.pool_rules(tenant_id, pool_id, version, exact_points, outcome_points, tie_breaker, is_current)
    values (v_t, v_pool, 1, 5, 2, 'exact_predictions', true);
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at) values (v_t, v_tour, v_r1, v_h, v_a, now() + interval '1 hour') returning id into v_m1;
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at) values (v_t, v_tour, v_r1, v_a, v_h, now() + interval '2 hours') returning id into v_m2;
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at) values (v_t, v_tour, v_r2, v_h, v_a, now() + interval '3 hours') returning id into v_m3;
  insert into public.pool_matches(tenant_id, pool_id, match_id) values (v_t, v_pool, v_m1) returning id into v_pm1;
  insert into public.pool_matches(tenant_id, pool_id, match_id) values (v_t, v_pool, v_m2) returning id into v_pm2;
  insert into public.pool_matches(tenant_id, pool_id, match_id) values (v_t, v_pool, v_m3) returning id into v_pm3;
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_t, v_pool, v_p, 'approved', 'paid') returning id into v_pp;
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_t, v_pool, v_q, 'approved', 'paid') returning id into v_pq;
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_t, v_pool, v_r, 'approved', 'paid') returning id into v_pr;
  -- P: 2-1 exacto, 1-1 (signo en empate), 0-1 fallo → 7 pts · Q: 1-0 signo, 0-0 exacto, 1-0 exacto → 12 pts · R: solo M2 exacto → 5 pts
  insert into public.predictions(tenant_id, pool_id, pool_match_id, participant_id, home_score, away_score) values
    (v_t, v_pool, v_pm1, v_pp, 2, 1), (v_t, v_pool, v_pm2, v_pp, 1, 1), (v_t, v_pool, v_pm3, v_pp, 0, 1),
    (v_t, v_pool, v_pm1, v_pq, 1, 0), (v_t, v_pool, v_pm2, v_pq, 0, 0), (v_t, v_pool, v_pm3, v_pq, 1, 0),
    (v_t, v_pool, v_pm2, v_pr, 0, 0);
  insert into fx(k, v) values ('t', v_t), ('o', v_o), ('p', v_p), ('q', v_q), ('r', v_r), ('out', v_out), ('mem', v_mem), ('pool', v_pool), ('r2', v_r2),
    ('m1', v_m1), ('m2', v_m2), ('m3', v_m3), ('pp', v_pp), ('pq', v_pq), ('pr', v_pr);

  -- Antes de cualquier resultado: tabla vacía de puntos (todos 0, mismo rango)
  v_res := pg_temp.scalar_as_user(v_p, format($q$select string_agg(rank::text || ':' || points::text, ',' order by display_name) from public.pool_leaderboard(%L)$q$, v_pool));
  perform pg_temp.rec('LB0 sin resultados todos empatan a 0 en el rango 1', v_res = 'OK:1:0,1:0,1:0', v_res);

  -- los partidos empiezan (sincronizador legítimo) y el organizador publica
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform public.apply_fixture_update(v_m1, now() - interval '3 minutes', null);
  perform public.apply_fixture_update(v_m2, now() - interval '2 minutes', null);
  perform public.apply_fixture_update(v_m3, now() - interval '1 minute', null);
  perform set_config('request.jwt.claims', '', true);
  v_res := pg_temp.as_user(v_o, format($q$select public.publish_official_result(%L, 2, 1, 0)$q$, v_m1));
  perform pg_temp.rec('LB1 resultado M1', pg_temp.is_ok(v_res), v_res);
  v_res := pg_temp.as_user(v_o, format($q$select public.publish_official_result(%L, 0, 0, 0)$q$, v_m2));
  perform pg_temp.rec('LB2 resultado M2', pg_temp.is_ok(v_res), v_res);
  v_res := pg_temp.as_user(v_o, format($q$select public.publish_official_result(%L, 1, 0, 0)$q$, v_m3));
  perform pg_temp.rec('LB3 resultado M3', pg_temp.is_ok(v_res), v_res);

  v_body := pg_temp.scalar_as_user(v_p, format($q$select string_agg(rank::text || '/' || display_name || '/' || points || '/' || exact_hits || '/' || outcome_hits || '/' || played || '/' || current_streak || '/' || best_streak || '/' || is_me, ' ; ' order by rank) from public.pool_leaderboard(%L)$q$, v_pool));
  perform pg_temp.rec('LB4 general: Q 12 pts (2 exactos, 1 signo, racha 3), P 7 (racha 2, actual 0), R 5 (racha 1, actual 0)',
    v_body = 'OK:1/lb-Q/12/2/1/3/3/3/false ; 2/lb-P/7/1/1/3/0/2/true ; 3/lb-R/5/1/0/1/0/1/false', v_body);

  v_body := pg_temp.scalar_as_user(v_p, format($q$select string_agg(rank::text || '/' || display_name || '/' || points, ' ; ' order by rank, display_name) from public.pool_leaderboard(%L, %L)$q$, v_pool, v_r2));
  perform pg_temp.rec('LB5 por jornada (R2: solo M3): Q 5 pts; P y R empatan a 0 en el rango 2',
    v_body = 'OK:1/lb-Q/5 ; 2/lb-P/0 ; 2/lb-R/0', v_body);

  -- idempotencia: republicar el mismo marcador y recalcular no cambia la tabla
  v_res := pg_temp.as_user(v_o, format($q$select public.publish_official_result(%L, 1, 0, 1)$q$, v_m3));
  perform public._recalculate_match_scoring(v_m3);
  v_res := pg_temp.scalar_as_user(v_p, format($q$select sum(points) from public.pool_leaderboard(%L)$q$, v_pool));
  perform pg_temp.rec('LB6 republicar/recalcular no duplica puntos (suma 24)', v_res = 'OK:24', v_res);

  -- corrección M3 → 0-1: P pasa a exacto (+5) y Q pierde los 5 (la revisión más reciente manda)
  v_res := pg_temp.as_user(v_o, format($q$select public.publish_official_result(%L, 0, 1, 1)$q$, v_m3));
  v_body := pg_temp.scalar_as_user(v_p, format($q$select string_agg(rank::text || '/' || display_name || '/' || points, ' ; ' order by rank) from public.pool_leaderboard(%L)$q$, v_pool));
  perform pg_temp.rec('LB7 tras corregir M3 manda la revisión más reciente: P 12, Q 7 (sin sumar la revisión anterior)',
    v_body = 'OK:1/lb-P/12 ; 2/lb-Q/7 ; 3/lb-R/5', v_body);

  -- acceso y privacidad
  v_res := pg_temp.as_user(v_out, format($q$select * from public.pool_leaderboard(%L)$q$, v_pool));
  perform pg_temp.rec('LB8 un usuario ajeno al tenant no lee la tabla', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_mem, format($q$select * from public.pool_leaderboard(%L)$q$, v_pool));
  perform pg_temp.rec('LB9 un miembro del tenant (no participante) la lee', pg_temp.is_ok(v_res), v_res);
  v_res := pg_temp.as_role('anon', format($q$select * from public.pool_leaderboard(%L)$q$, v_pool));
  perform pg_temp.rec('LB10 anon no ejecuta la función', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_p, format($q$select * from public.pool_leaderboard(%L, %L)$q$, v_pool, gen_random_uuid()));
  perform pg_temp.rec('LB11 una jornada inexistente/ajena se rechaza', pg_temp.is_err(v_res, '22023'), v_res);
  v_res := pg_temp.scalar_as_user(v_o, format($q$select count(*) from public.pool_leaderboard(%L)$q$, v_pool));
  perform pg_temp.rec('LB12 el organizador ve la tabla y no figura como participante', v_res = 'OK:3', v_res);

  -- estadísticas, evolución y resumen (misma fuente que la tabla)
  v_body := pg_temp.scalar_as_user(v_p, format($q$select string_agg(round_name || '/' || my_points || '/' || my_cumulative || '/' || avg_points || '/' || best_points, ' ; ' order by sort_order) from public.pool_points_evolution(%L)$q$, v_pool));
  perform pg_temp.rec('ST1 evolución por jornada (R1: 7 → 7, media 6.33; R2: 5 → 12, media 1.67)', v_body = 'OK:R1/7/7/6.33/7 ; R2/5/12/1.67/5', v_body);
  v_body := pg_temp.scalar_as_user(v_p, format($q$select rank || '/' || participants || '/' || points || '/' || exact_hits || '/' || outcome_hits || '/' || results_count || '/' || played || '/' || hit_rate || '/' || avg_points || '/' || best_round_points || '/' || current_streak || '/' || best_streak from public.my_pool_stats(%L)$q$, v_pool));
  perform pg_temp.rec('ST2 mis estadísticas: #1 de 3, 12 pts, 2 exactos, 1 signo, acierto 100 %, media 4.00, mejor jornada 7, racha 3', v_body = 'OK:1/3/12/2/1/3/3/1.00/4.00/7/3/3', v_body);
  v_body := pg_temp.scalar_as_user(v_p, 'select pool_name || ''/'' || rank || ''/'' || participants || ''/'' || points from public.my_points_summary()');
  perform pg_temp.rec('ST3 «Mis puntos» lista mi quiniela con rango y puntos reales', v_body = 'OK:LB pool/1/3/12', v_body);
  v_res := pg_temp.scalar_as_user(v_mem, format($q$select count(*) from public.my_pool_stats(%L)$q$, v_pool));
  perform pg_temp.rec('ST4 quien no participa no tiene estadísticas propias (0 filas)', v_res = 'OK:0', v_res);
  v_res := pg_temp.scalar_as_user(v_mem, format($q$select count(*) from public.pool_points_evolution(%L) where my_points is null$q$, v_pool));
  perform pg_temp.rec('ST5 su evolución propia es nula (no se inventa)', v_res = 'OK:2', v_res);
  v_res := pg_temp.scalar_as_user(v_mem, 'select count(*) from public.my_points_summary()');
  perform pg_temp.rec('ST6 «Mis puntos» vacío para quien no participa', v_res = 'OK:0', v_res);
  v_res := pg_temp.as_user(v_out, format($q$select * from public.pool_points_evolution(%L)$q$, v_pool));
  perform pg_temp.rec('ST7 un ajeno al tenant no lee la evolución', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_out, format($q$select * from public.my_pool_stats(%L)$q$, v_pool));
  perform pg_temp.rec('ST8 ni las estadísticas', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_role('anon', 'select * from public.my_points_summary()');
  perform pg_temp.rec('ST9 anon no ejecuta el resumen', pg_temp.is_err(v_res, '42501'), v_res);

  -- un participante retirado desaparece de la tabla
  update public.participants set withdrawn_at = now(), withdrawn_by = v_r where id = v_pr;
  v_res := pg_temp.scalar_as_user(v_p, format($q$select count(*) from public.pool_leaderboard(%L)$q$, v_pool));
  perform pg_temp.rec('LB13 un participante retirado no figura', v_res = 'OK:2', v_res);
  -- una exclusión administrativa persistida también lo saca
  insert into public.pool_admin_exclusions(tenant_id, pool_id, profile_id, source) values (v_t, v_pool, v_q, 'legacy_backfill');
  v_res := pg_temp.scalar_as_user(v_p, format($q$select string_agg(display_name, ',') from public.pool_leaderboard(%L)$q$, v_pool));
  perform pg_temp.rec('LB14 un perfil con exclusión administrativa no figura (solo queda P)', v_res = 'OK:lb-P', v_res);
end $$;
