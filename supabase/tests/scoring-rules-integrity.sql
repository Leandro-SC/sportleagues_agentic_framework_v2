-- ADR-023: integridad de las reglas de puntuación. Se ejecuta con scripts/qa/run-sql-suite.mjs (transacción con rollback; no deja datos).
do $$
declare
  v_tf uuid; v_tp uuid; v_of uuid; v_op uuid; v_mem uuid; v_out uuid; v_pl uuid;
  v_tour uuid; v_h uuid; v_a uuid; v_r1 uuid; v_pf uuid; v_pp uuid; v_pd uuid; v_m1 uuid; v_pm1 uuid; v_part uuid;
  v_res text; v_n integer;
begin
  v_of := pg_temp.mk_user('sr-owner-free'); v_op := pg_temp.mk_user('sr-owner-pro'); v_mem := pg_temp.mk_user('sr-mem');
  v_out := pg_temp.mk_user('sr-out'); v_pl := pg_temp.mk_user('sr-player');
  insert into public.tenants(name) values ('SR free') returning id into v_tf;
  insert into public.tenants(name) values ('SR pro') returning id into v_tp;
  insert into public.tenant_entitlements(tenant_id, plan_code) values (v_tf, 'free'), (v_tp, 'pro');
  insert into public.tenant_memberships(tenant_id, profile_id, role) values
    (v_tf, v_of, 'owner'), (v_tp, v_op, 'owner'), (v_tp, v_mem, 'member'), (v_tp, v_pl, 'member');
  insert into public.pools(tenant_id, name, status, lock_offset) values (v_tf, 'SR free pool', 'draft', interval '15 minutes') returning id into v_pf;
  insert into public.pools(tenant_id, name, status, lock_offset) values (v_tp, 'SR pro pool', 'open', interval '15 minutes') returning id into v_pp;
  insert into public.pools(tenant_id, name, status, lock_offset) values (v_tp, 'SR draft pool', 'draft', interval '15 minutes') returning id into v_pd;
  insert into public.tournaments(tenant_id, name) values (v_tp, 'T') returning id into v_tour;
  insert into public.teams(tenant_id, name) values (v_tp, 'H') returning id into v_h;
  insert into public.teams(tenant_id, name) values (v_tp, 'A') returning id into v_a;
  insert into public.tournament_teams(tenant_id, tournament_id, team_id) values (v_tp, v_tour, v_h), (v_tp, v_tour, v_a);
  insert into public.rounds(tenant_id, tournament_id, name, sort_order) values (v_tp, v_tour, 'R1', 1) returning id into v_r1;
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at)
    values (v_tp, v_tour, v_r1, v_h, v_a, now() + interval '1 hour') returning id into v_m1;
  insert into public.pool_matches(tenant_id, pool_id, match_id) values (v_tp, v_pp, v_m1) returning id into v_pm1;
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_tp, v_pp, v_pl, 'approved', 'paid') returning id into v_part;
  insert into public.pool_rules(tenant_id, pool_id, version, exact_points, outcome_points, tie_breaker, is_current)
    values (v_tp, v_pp, 1, 5, 2, 'exact_predictions', true);
  insert into public.predictions(tenant_id, pool_id, pool_match_id, participant_id, home_score, away_score) values (v_tp, v_pp, v_pm1, v_part, 2, 1);

  -- S2: plan FREE = puntuación estándar; el desempate es elegible
  v_res := pg_temp.scalar_as_user(v_of, format($q$select version::text from public.publish_pool_rules(%L, 3, 1, 'exact_predictions')$q$, v_pf));
  perform pg_temp.rec('SR01 FREE publica la puntuación estándar 3/1 (versión 1)', v_res = 'OK:1', v_res);
  v_res := pg_temp.scalar_as_user(v_of, format($q$select version::text from public.publish_pool_rules(%L, 3, 1, 'prediction_submitted_at')$q$, v_pf));
  perform pg_temp.rec('SR02 FREE puede cambiar el desempate (versión 2)', v_res = 'OK:2', v_res);
  v_res := pg_temp.as_user(v_of, format($q$select public.publish_pool_rules(%L, 5, 2, 'exact_predictions')$q$, v_pf));
  perform pg_temp.rec('SR03 FREE no personaliza puntos (PRO_SCORING_REQUIRED)', pg_temp.is_err(v_res, '42501', 'PRO_SCORING_REQUIRED'), v_res);

  -- PRO antes del primer lock: personaliza y es idempotente
  v_res := pg_temp.scalar_as_user(v_op, format($q$select version::text from public.publish_pool_rules(%L, 6, 3, 'exact_predictions')$q$, v_pp));
  perform pg_temp.rec('SR04 PRO personaliza antes del primer lock (versión 2)', v_res = 'OK:2', v_res);
  v_res := pg_temp.scalar_as_user(v_op, format($q$select version::text from public.publish_pool_rules(%L, 6, 3, 'exact_predictions')$q$, v_pp));
  select count(*) into v_n from public.pool_rules where pool_id = v_pp;
  perform pg_temp.rec('SR05 republicar la misma regla no crea versión', v_res = 'OK:2' and v_n = 2, v_res || ' filas=' || v_n);

  -- S5 y validaciones
  v_res := pg_temp.as_user(v_op, format($q$select public.publish_pool_rules(%L, 1, 2, 'exact_predictions')$q$, v_pp));
  perform pg_temp.rec('SR06 exacto menor que signo se rechaza', pg_temp.is_err(v_res, '22023'), v_res);
  v_res := pg_temp.as_user(v_op, format($q$select public.publish_pool_rules(%L, 6, 3, 'exact_predictions', '[{"kind":"x"}]'::jsonb)$q$, v_pp));
  perform pg_temp.rec('SR07 bonificaciones sin motor se rechazan', pg_temp.is_err(v_res, '22023', 'BONUS_RULES_UNSUPPORTED'), v_res);
  v_res := pg_temp.as_user(v_op, format($q$select public.publish_pool_rules(%L, null, 3, 'exact_predictions')$q$, v_pp));
  perform pg_temp.rec('SR08 puntos nulos se rechazan', pg_temp.is_err(v_res, '22023'), v_res);
  v_res := pg_temp.as_user(v_op, format($q$select public.publish_pool_rules(%L, 1001, 3, 'exact_predictions')$q$, v_pp));
  perform pg_temp.rec('SR09 más de 1000 puntos se rechaza', pg_temp.is_err(v_res, '22023'), v_res);

  -- Autorización (sin oráculo de existencia)
  v_res := pg_temp.as_user(v_mem, format($q$select public.publish_pool_rules(%L, 6, 3, 'exact_predictions')$q$, v_pp));
  perform pg_temp.rec('SR10 un miembro no publica reglas', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_of, format($q$select public.publish_pool_rules(%L, 3, 1, 'exact_predictions')$q$, v_pp));
  perform pg_temp.rec('SR11 el admin de otro tenant no publica reglas', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_op, format($q$select public.publish_pool_rules(%L, 3, 1, 'exact_predictions')$q$, gen_random_uuid()));
  perform pg_temp.rec('SR12 una quiniela inexistente responde igual que no autorizado', pg_temp.is_err(v_res, '42501'), v_res);

  -- S6: estado para la UI
  v_res := pg_temp.scalar_as_user(v_op, format($q$select editable::text || '/' || custom_allowed::text from public.pool_rules_policy(%L)$q$, v_pp));
  perform pg_temp.rec('SR13 PRO antes del lock: editable y personalizable', v_res = 'OK:true/true', v_res);
  v_res := pg_temp.scalar_as_user(v_of, format($q$select editable::text || '/' || custom_allowed::text from public.pool_rules_policy(%L)$q$, v_pf));
  perform pg_temp.rec('SR14 FREE: editable, sin personalización', v_res = 'OK:true/false', v_res);
  v_res := pg_temp.as_user(v_mem, format($q$select * from public.pool_rules_policy(%L)$q$, v_pp));
  perform pg_temp.rec('SR15 un miembro no consulta la política', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_role('anon', format($q$select * from public.pool_rules_policy(%L)$q$, v_pp));
  perform pg_temp.rec('SR16 anon no ejecuta la política', pg_temp.is_err(v_res, '42501'), v_res);

  -- S1: congelación al alcanzar el primer lock (el sincronizador legítimo adelanta el partido)
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform public.apply_fixture_update(v_m1, now() - interval '1 minute', null);
  perform set_config('request.jwt.claims', '', true);
  v_res := pg_temp.as_user(v_op, format($q$select public.publish_pool_rules(%L, 10, 4, 'exact_predictions')$q$, v_pp));
  perform pg_temp.rec('SR17 tras el primer lock no se cambian las reglas (RULES_FROZEN)', pg_temp.is_err(v_res, '42501', 'RULES_FROZEN'), v_res);
  v_res := pg_temp.scalar_as_user(v_op, format($q$select version::text from public.publish_pool_rules(%L, 6, 3, 'exact_predictions')$q$, v_pp));
  perform pg_temp.rec('SR18 republicar la regla vigente sigue siendo idempotente', v_res = 'OK:2', v_res);
  v_res := pg_temp.scalar_as_user(v_op, format($q$select editable::text from public.pool_rules_policy(%L)$q$, v_pp));
  perform pg_temp.rec('SR19 la política informa que ya no es editable', v_res = 'OK:false', v_res);

  -- S1 (defensa): ni el propietario de la base sortea la congelación por DML directo
  begin
    insert into public.pool_rules(tenant_id, pool_id, version, exact_points, outcome_points, tie_breaker, is_current) values (v_tp, v_pp, 3, 9, 1, 'exact_predictions', false);
    perform pg_temp.rec('SR20 DML directo: versión nueva tras el lock bloqueada', false, 'insert aceptado');
  exception when others then
    perform pg_temp.rec('SR20 DML directo: versión nueva tras el lock bloqueada', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;
  begin
    update public.pool_rules set is_current = false where pool_id = v_pp and is_current;
    perform pg_temp.rec('SR21 DML directo: retirar la vigente tras el lock bloqueado', false, 'update aceptado');
  exception when others then
    perform pg_temp.rec('SR21 DML directo: retirar la vigente tras el lock bloqueado', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;
  begin
    update public.pool_rules set exact_points = 50 where pool_id = v_pp and version = 1;
    perform pg_temp.rec('SR22 una versión publicada es inmutable', false, 'update aceptado');
  exception when others then
    perform pg_temp.rec('SR22 una versión publicada es inmutable', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;

  -- La puntuación usa la versión vigente congelada (6/3): exacto 2-1 → 6
  v_res := pg_temp.as_user(v_op, format($q$select public.publish_official_result(%L, 2, 1, 0)$q$, v_m1));
  select string_agg(rule_version::text || ':' || points::text, ',') into v_res from public.scoring_events where prediction_id in (select id from public.predictions where pool_match_id = v_pm1);
  perform pg_temp.rec('SR23 el resultado puntúa con la versión vigente (v2: 6 pts)', v_res = '2:6', coalesce(v_res, 'sin eventos'));

  -- S4: re-puntuación solo service_role e idempotente cuando ya es coherente
  v_res := pg_temp.as_user(v_op, format($q$select public.rescore_pool(%L)$q$, v_pp));
  perform pg_temp.rec('SR24 authenticated no ejecuta rescore_pool', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_role('service_role', format($q$select public.rescore_pool(%L)$q$, v_pp));
  select count(*) into v_n from public.scoring_events where prediction_id in (select id from public.predictions where pool_match_id = v_pm1);
  perform pg_temp.rec('SR25 rescore_pool coherente no duplica eventos', pg_temp.is_ok(v_res) and v_n = 1, v_res || ' eventos=' || v_n);

  -- S3: abrir sin reglas asigna la estándar
  update public.pools set status = 'open' where id = v_pd;
  select string_agg(version || '/' || exact_points || '/' || outcome_points || '/' || tie_breaker || '/' || is_current, ',') into v_res from public.pool_rules where pool_id = v_pd;
  perform pg_temp.rec('SR26 abrir una quiniela sin reglas asigna la estándar 3/1', v_res = '1/3/1/exact_predictions/true', coalesce(v_res, 'sin reglas'));
  update public.pools set status = 'paused' where id = v_pd;
  update public.pools set status = 'open' where id = v_pd;
  select count(*) into v_n from public.pool_rules where pool_id = v_pd;
  perform pg_temp.rec('SR27 reabrir no duplica la regla estándar', v_n = 1, 'filas=' || v_n);
end $$;
