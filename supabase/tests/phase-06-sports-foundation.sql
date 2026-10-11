-- Fase 06: base deportiva (catálogo, inscripción, calendario, resultados, referencias externas).
-- Se ejecuta con scripts/qa/run-sql-suite.mjs: dentro de una transacción con rollback; NO deja datos en QA.
-- Requiere supabase/tests/proposed/_helpers.sql antepuesto (lo hace el ejecutor).
do $$
declare
  v_t1 uuid; v_t2 uuid; v_o1 uuid; v_a1 uuid; v_m1 uuid; v_m2 uuid; v_o2 uuid;
  v_tour uuid; v_tour2 uuid; v_ta uuid; v_tb uuid; v_tc uuid; v_tx uuid; v_round uuid; v_round2 uuid; v_round_x uuid;
  v_match uuid; v_pool uuid; v_part1 uuid; v_part2 uuid; v_pm uuid; v_r text; v_id text; v_cnt text;
begin
  v_o1 := pg_temp.mk_user('s6-owner1'); v_a1 := pg_temp.mk_user('s6-admin1'); v_m1 := pg_temp.mk_user('s6-memb1');
  v_m2 := pg_temp.mk_user('s6-memb2'); v_o2 := pg_temp.mk_user('s6-owner2');
  insert into public.tenants(name) values ('S6 tenant 1') returning id into v_t1;
  insert into public.tenants(name) values ('S6 tenant 2') returning id into v_t2;
  insert into public.tenant_entitlements(tenant_id, plan_code) values (v_t1, 'pro'), (v_t2, 'pro');
  insert into public.tenant_memberships(tenant_id, profile_id, role) values
    (v_t1, v_o1, 'owner'), (v_t1, v_a1, 'admin'), (v_t1, v_m1, 'member'), (v_t1, v_m2, 'member'), (v_t2, v_o2, 'owner');
  insert into fx(k, v) values ('t1', v_t1), ('t2', v_t2);

  -- ---- Catálogo: autorización y validación -------------------------------------------------------------------
  v_r := pg_temp.as_user(v_m1, format($q$select public.upsert_tournament(%L, null, 'Liga X')$q$, v_t1));
  perform pg_temp.rec('CAT1 un miembro no crea torneos', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_o2, format($q$select public.upsert_tournament(%L, null, 'Liga X')$q$, v_t1));
  perform pg_temp.rec('CAT2 el admin de otro tenant no crea torneos (tenant del cliente no autoriza)', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_a1, 'select public.upsert_tournament(null, null, ''Liga X'')');
  perform pg_temp.rec('CAT2b sin tenant → no autorizado', pg_temp.is_err(v_r, '42501'), v_r);
  v_id := pg_temp.scalar_as_user(v_a1, format($q$select (public.upsert_tournament(%L, null, 'Liga X', 'football', 'PE', '2026', '#00FF88')).id$q$, v_t1));
  perform pg_temp.rec('CAT3 el admin crea un torneo con metadatos', v_id like 'OK:%', v_id);
  v_tour := substr(v_id, 4)::uuid;
  v_r := pg_temp.as_user(v_a1, format($q$select public.upsert_tournament(%L, null, 'Liga Y', 'football', 'PE', null, 'rojo')$q$, v_t1));
  perform pg_temp.rec('CAT4 color inválido rechazado', pg_temp.is_err(v_r, '23514'), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$select public.upsert_tournament(%L, null, 'Liga Y', 'curling-xx')$q$, v_t1));
  perform pg_temp.rec('CAT5 deporte fuera del catálogo rechazado', pg_temp.is_err(v_r, '23503'), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$select public.upsert_tournament(%L, null, 'liga x', 'football', 'PE', '2026')$q$, v_t1));
  perform pg_temp.rec('CAT6 nombre+temporada duplicados (sin distinguir mayúsculas) rechazados', pg_temp.is_err(v_r, '23505'), v_r);
  v_r := pg_temp.as_user(v_o2, format($q$select public.upsert_tournament(null, %L, 'Robado')$q$, v_tour));
  perform pg_temp.rec('CAT7 editar un torneo de otro tenant → no autorizado', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$update public.tournaments set name = 'directo' where id = %L$q$, v_tour));
  perform pg_temp.rec('CAT8 sin UPDATE directo sobre torneos', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$insert into public.teams(tenant_id, name) values (%L, 'directo')$q$, v_t1));
  perform pg_temp.rec('CAT9 sin INSERT directo sobre equipos', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$delete from public.rounds where tournament_id = %L$q$, v_tour));
  perform pg_temp.rec('CAT10 sin DELETE directo sobre jornadas', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.scalar_as_user(v_o2, format($q$select count(*) from public.tournaments where id = %L$q$, v_tour));
  perform pg_temp.rec('CAT11 el otro tenant no lee el torneo (RLS)', v_r = 'OK:0', v_r);
  v_r := pg_temp.scalar_as_user(v_m1, format($q$select count(*) from public.tournaments where id = %L$q$, v_tour));
  perform pg_temp.rec('CAT12 un miembro lee el torneo de su tenant', v_r = 'OK:1', v_r);

  -- ---- Equipos e inscripción ---------------------------------------------------------------------------------
  v_ta := substr(pg_temp.scalar_as_user(v_a1, format($q$select (public.upsert_team(%L, null, 'Alianza', 'ALI', 'PE', '#112233', '#FFFFFF')).id$q$, v_t1)), 4)::uuid;
  v_tb := substr(pg_temp.scalar_as_user(v_a1, format($q$select (public.upsert_team(%L, null, 'Cristal')).id$q$, v_t1)), 4)::uuid;
  v_tc := substr(pg_temp.scalar_as_user(v_a1, format($q$select (public.upsert_team(%L, null, 'Melgar')).id$q$, v_t1)), 4)::uuid;
  v_tx := substr(pg_temp.scalar_as_user(v_o2, format($q$select (public.upsert_team(%L, null, 'Ajeno')).id$q$, v_t2)), 4)::uuid;
  v_r := pg_temp.as_user(v_a1, format($q$select public.upsert_team(%L, null, 'Alianza')$q$, v_t1));
  perform pg_temp.rec('EQ1 nombre de equipo duplicado en el tenant rechazado', pg_temp.is_err(v_r, '23505'), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$select public.upsert_team(null, %L, 'Secuestro')$q$, v_tx));
  perform pg_temp.rec('EQ2 editar equipo de otro tenant → no autorizado', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$select public.set_tournament_team(%L, %L, true)$q$, v_tour, v_tx));
  perform pg_temp.rec('EQ3 inscribir un equipo de otro tenant rechazado', pg_temp.is_err(v_r, '22023'), v_r);
  v_r := pg_temp.as_user(v_m1, format($q$select public.set_tournament_team(%L, %L, true)$q$, v_tour, v_ta));
  perform pg_temp.rec('EQ4 un miembro no inscribe equipos', pg_temp.is_err(v_r, '42501'), v_r);
  perform pg_temp.as_user(v_a1, format($q$select public.set_tournament_team(%L, %L, true)$q$, v_tour, v_ta));
  perform pg_temp.as_user(v_a1, format($q$select public.set_tournament_team(%L, %L, true)$q$, v_tour, v_tb));
  v_r := pg_temp.as_user(v_a1, format($q$select public.set_tournament_team(%L, %L, true)$q$, v_tour, v_tb));
  perform pg_temp.rec('EQ5 inscribir dos veces es idempotente', pg_temp.is_ok(v_r), v_r);

  -- ---- Jornadas ----------------------------------------------------------------------------------------------
  v_round := substr(pg_temp.scalar_as_user(v_a1, format($q$select (public.upsert_round(%L, null, 'Fecha 1', 1)).id$q$, v_tour)), 4)::uuid;
  v_round2 := substr(pg_temp.scalar_as_user(v_a1, format($q$select (public.upsert_round(%L, null, 'Fecha 2', 2)).id$q$, v_tour)), 4)::uuid;
  v_r := pg_temp.as_user(v_a1, format($q$select public.upsert_round(%L, null, 'Duplicada', 2)$q$, v_tour));
  perform pg_temp.rec('JOR1 orden duplicado rechazado', pg_temp.is_err(v_r, '23505'), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$select public.reorder_rounds(%L, array[%L, %L]::uuid[])$q$, v_tour, v_round2, v_round));
  perform pg_temp.rec('JOR2 reordenar jornadas (intercambio sin colisión)', pg_temp.is_ok(v_r), v_r);
  v_r := pg_temp.scalar_as_user(v_a1, format($q$select string_agg(sort_order::text, ',' order by sort_order) from public.rounds where tournament_id = %L and id = %L$q$, v_tour, v_round2));
  perform pg_temp.rec('JOR3 la jornada 2 quedó primera (orden 0)', v_r = 'OK:0', v_r);
  v_r := pg_temp.as_user(v_a1, format($q$select public.reorder_rounds(%L, array[%L]::uuid[])$q$, v_tour, v_round));
  perform pg_temp.rec('JOR4 lista incompleta rechazada', pg_temp.is_err(v_r, '22023'), v_r);
  v_tour2 := substr(pg_temp.scalar_as_user(v_a1, format($q$select (public.upsert_tournament(%L, null, 'Copa', 'football', null, null)).id$q$, v_t1)), 4)::uuid;
  v_round_x := substr(pg_temp.scalar_as_user(v_a1, format($q$select (public.upsert_round(%L, null, 'Ronda copa', 1)).id$q$, v_tour2)), 4)::uuid;

  -- ---- Partidos ---------------------------------------------------------------------------------------------
  v_r := pg_temp.as_user(v_a1, format($q$select public.upsert_match(%L, null, %L, %L, %L, now() + interval '2 hours')$q$, v_tour, v_round, v_ta, v_tc));
  perform pg_temp.rec('PAR1 equipo no inscrito en el torneo rechazado', pg_temp.is_err(v_r, '23503'), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$select public.upsert_match(%L, null, %L, %L, %L, now() + interval '2 hours')$q$, v_tour, v_round_x, v_ta, v_tb));
  perform pg_temp.rec('PAR2 jornada de otro torneo rechazada', pg_temp.is_err(v_r, '23503'), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$select public.upsert_match(%L, null, %L, %L, %L, now() + interval '2 hours')$q$, v_tour, v_round, v_ta, v_ta));
  perform pg_temp.rec('PAR3 un equipo no juega contra sí mismo', pg_temp.is_err(v_r, '23514'), v_r);
  v_r := pg_temp.as_user(v_m1, format($q$select public.upsert_match(%L, null, %L, %L, %L, now() + interval '2 hours')$q$, v_tour, v_round, v_ta, v_tb));
  perform pg_temp.rec('PAR4 un miembro no crea partidos', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at) values (%L, %L, %L, %L, %L, now())$q$, v_t1, v_tour, v_round, v_ta, v_tb));
  perform pg_temp.rec('PAR5 sin INSERT directo sobre partidos', pg_temp.is_err(v_r, '42501'), v_r);
  v_match := substr(pg_temp.scalar_as_user(v_a1, format($q$select (public.upsert_match(%L, null, %L, %L, %L, now() + interval '3 hours')).id$q$, v_tour, v_round, v_ta, v_tb)), 4)::uuid;
  perform pg_temp.rec('PAR6 el admin crea un partido', v_match is not null, '');
  v_r := pg_temp.as_user(v_a1, format($q$select public.set_tournament_team(%L, %L, false)$q$, v_tour, v_ta));
  perform pg_temp.rec('PAR7 no se desinscribe un equipo con partidos', pg_temp.is_err(v_r, '23503'), v_r);

  -- ---- Partido en quiniela: lock derivado y calendario -------------------------------------------------------
  insert into public.pools(tenant_id, name, status, lock_offset) values (v_t1, 'S6 pool', 'open', interval '15 minutes') returning id into v_pool;
  insert into public.pool_rules(tenant_id, pool_id, version, exact_points, outcome_points, tie_breaker, is_current)
    values (v_t1, v_pool, 1, 5, 2, 'exact_predictions', true);
  v_r := pg_temp.as_user(v_m1, format($q$select public.set_pool_match(%L, %L, true)$q$, v_pool, v_match));
  perform pg_temp.rec('QUI1 un miembro no asocia partidos', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_o2, format($q$select public.set_pool_match(%L, %L, true)$q$, v_pool, v_match));
  perform pg_temp.rec('QUI2 otro tenant no asocia partidos', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$select public.set_pool_match(%L, %L, true)$q$, v_pool, v_match));
  perform pg_temp.rec('QUI3 el admin asocia el partido', pg_temp.is_ok(v_r), v_r);
  select pm.id into v_pm from public.pool_matches pm where pm.pool_id = v_pool and pm.match_id = v_match;
  perform pg_temp.rec('QUI4 lock_at = kickoff − offset (servidor)',
    (select pm.lock_at = m.starts_at - interval '15 minutes' from public.pool_matches pm join public.matches m on m.id = pm.match_id where pm.id = v_pm), '');
  v_r := pg_temp.as_user(v_a1, format($q$select public.upsert_match(%L, %L, %L, %L, %L, now() + interval '5 hours')$q$, v_tour, v_match, v_round, v_ta, v_tb));
  perform pg_temp.rec('QUI5 reprogramar un partido abierto desplaza su lock', pg_temp.is_ok(v_r), v_r);
  perform pg_temp.rec('QUI5b el lock siguió al nuevo horario',
    (select pm.lock_at = m.starts_at - interval '15 minutes' from public.pool_matches pm join public.matches m on m.id = pm.match_id where pm.id = v_pm), '');
  v_r := pg_temp.as_user(v_a1, format($q$select public.upsert_match(%L, %L, %L, %L, %L, now() + interval '5 minutes')$q$, v_tour, v_match, v_round, v_ta, v_tb));
  perform pg_temp.rec('QUI6 un horario que bloquearía/revelaría ya mismo se rechaza', pg_temp.is_err(v_r, '42501'), v_r);
  v_match := substr(pg_temp.scalar_as_user(v_a1, format($q$select (public.upsert_match(%L, null, %L, %L, %L, now() + interval '10 minutes')).id$q$, v_tour, v_round, v_ta, v_tb)), 4)::uuid;
  v_r := pg_temp.as_user(v_a1, format($q$select public.set_pool_match(%L, %L, true)$q$, v_pool, v_match));
  perform pg_temp.rec('QUI7 no se asocia un partido cuyo lock ya venció', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$select public.set_pool_match(%L, %L, false)$q$, v_pool, (select m2.id from public.matches m2 where m2.tournament_id = v_tour and m2.id <> v_match limit 1)));
  perform pg_temp.rec('QUI8 quitar un partido sin predicciones y con lock futuro es posible', pg_temp.is_ok(v_r), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$delete from public.pool_matches where pool_id = %L$q$, v_pool));
  perform pg_temp.rec('QUI9 sin DELETE directo sobre pool_matches', pg_temp.is_err(v_r, '42501'), v_r);

  insert into fx(k, v) values ('tour', v_tour), ('ta', v_ta), ('tb', v_tb), ('tx', v_tx), ('round', v_round), ('pool', v_pool),
    ('m1', v_m1), ('m2', v_m2), ('a1', v_a1), ('o1', v_o1), ('o2', v_o2);
end $$;

-- ---- Resultados oficiales y recálculo idempotente (ADR-012) ---------------------------------------------------
do $$
declare
  v_t1 uuid := pg_temp.f('t1'); v_tour uuid := pg_temp.f('tour'); v_round uuid := pg_temp.f('round'); v_pool uuid := pg_temp.f('pool');
  v_ta uuid := pg_temp.f('ta'); v_tb uuid := pg_temp.f('tb'); v_a1 uuid := pg_temp.f('a1'); v_o2 uuid := pg_temp.f('o2');
  v_m1 uuid := pg_temp.f('m1'); v_m2 uuid := pg_temp.f('m2');
  v_match uuid; v_pm uuid; v_p1 uuid; v_p2 uuid; v_r text; v_n bigint;
begin
  v_match := substr(pg_temp.scalar_as_user(v_a1, format($q$select (public.upsert_match(%L, null, %L, %L, %L, now() + interval '1 hour')).id$q$, v_tour, v_round, v_ta, v_tb)), 4)::uuid;
  perform pg_temp.as_user(v_a1, format($q$select public.set_pool_match(%L, %L, true)$q$, v_pool, v_match));
  select id into v_pm from public.pool_matches where pool_id = v_pool and match_id = v_match;
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_t1, v_pool, v_m1, 'approved', 'paid') returning id into v_p1;
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_t1, v_pool, v_m2, 'approved', 'paid') returning id into v_p2;
  insert into public.predictions(tenant_id, pool_id, pool_match_id, participant_id, home_score, away_score) values
    (v_t1, v_pool, v_pm, v_p1, 2, 1), (v_t1, v_pool, v_pm, v_p2, 1, 0);

  v_r := pg_temp.as_user(v_a1, format($q$select public.upsert_match(%L, %L, %L, %L, %L, now() + interval '30 minutes')$q$, v_tour, v_match, v_round, v_ta, v_tb));
  perform pg_temp.rec('RES0 reprogramar a un horario con lock aún futuro es válido', pg_temp.is_ok(v_r), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$select public.publish_official_result(%L, 2, 1, 0)$q$, v_match));
  perform pg_temp.rec('RES1 no se publica antes del inicio del partido', pg_temp.is_err(v_r, '22023'), v_r);

  -- el sincronizador legítimo adelanta el partido: queda iniciado y su lock vence ahora
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform public.apply_fixture_update(v_match, now() - interval '1 minute', null);
  perform set_config('request.jwt.claims', '', true);

  v_r := pg_temp.as_user(v_a1, format($q$select public.upsert_match(%L, %L, %L, %L, %L, now() + interval '9 hours')$q$, v_tour, v_match, v_round, v_ta, v_tb));
  perform pg_temp.rec('RES2 con el lock alcanzado el calendario queda congelado (no reabre)', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$select public.set_pool_match(%L, %L, false)$q$, v_pool, v_match));
  perform pg_temp.rec('RES2b un partido con pronósticos no se quita de la quiniela', pg_temp.is_err(v_r, '42501'), v_r);

  v_r := pg_temp.as_user(v_m1, format($q$select public.publish_official_result(%L, 2, 1, 0)$q$, v_match));
  perform pg_temp.rec('RES3 un miembro no publica resultados', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_o2, format($q$select public.publish_official_result(%L, 2, 1, 0)$q$, v_match));
  perform pg_temp.rec('RES4 el admin de otro tenant no publica resultados', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$select public.publish_official_result(%L, -1, 1, 0)$q$, v_match));
  perform pg_temp.rec('RES5 marcador negativo rechazado', pg_temp.is_err(v_r, '22023'), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$select public.publish_official_result(%L, 2, 1, 3)$q$, v_match));
  perform pg_temp.rec('RES6 primera publicación con revisión esperada ≠ 0 → conflicto', pg_temp.is_err(v_r, 'PT409'), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$insert into public.official_results(tenant_id, match_id, home_score, away_score, published_by) values (%L, %L, 9, 9, %L)$q$, v_t1, v_match, v_a1));
  perform pg_temp.rec('RES7 sin INSERT directo en official_results', pg_temp.is_err(v_r, '42501'), v_r);

  v_r := pg_temp.as_user(v_a1, format($q$select public.publish_official_result(%L, 2, 1, 0)$q$, v_match));
  perform pg_temp.rec('RES8 el admin publica el primer resultado', pg_temp.is_ok(v_r), v_r);
  perform pg_temp.rec('RES8b el partido queda final y la revisión es 1',
    (select m.status = 'final' and r.revision = 1 from public.matches m join public.official_results r on r.match_id = m.id where m.id = v_match), '');
  select count(*) into v_n from public.scoring_events se join public.predictions pr on pr.id = se.prediction_id where pr.pool_match_id = v_pm;
  perform pg_temp.rec('RES9 se generan 2 eventos de puntaje', v_n = 2, 'eventos=' || v_n);
  perform pg_temp.rec('RES9b puntos: exacto = 5, signo = 2',
    (select string_agg(se.points::text, ',' order by se.points) from public.scoring_events se join public.predictions pr on pr.id = se.prediction_id where pr.pool_match_id = v_pm) = '2,5', '');

  v_r := pg_temp.as_user(v_a1, format($q$select public.publish_official_result(%L, 2, 1, 1)$q$, v_match));
  perform pg_temp.rec('RES10 repetir el mismo marcador es idempotente', pg_temp.is_ok(v_r), v_r);
  select count(*) into v_n from public.scoring_events se join public.predictions pr on pr.id = se.prediction_id where pr.pool_match_id = v_pm;
  perform pg_temp.rec('RES10b sin eventos duplicados ni nueva revisión', v_n = 2 and (select revision from public.official_results where match_id = v_match) = 1, 'eventos=' || v_n);
  perform pg_temp.rec('RES10c el recálculo interno repetido no duplica', public._recalculate_match_scoring(v_match) = 0, '');

  v_r := pg_temp.as_user(v_a1, format($q$select public.publish_official_result(%L, 0, 0, 1)$q$, v_match));
  perform pg_temp.rec('RES11 corrección con revisión vigente', pg_temp.is_ok(v_r), v_r);
  select count(*) into v_n from public.scoring_events se join public.predictions pr on pr.id = se.prediction_id where pr.pool_match_id = v_pm;
  perform pg_temp.rec('RES11b la corrección añade la revisión 2 (4 eventos; historial conservado)', v_n = 4, 'eventos=' || v_n);
  perform pg_temp.rec('RES11c con 0-0 ambos pronósticos puntúan 0 en la revisión 2',
    (select coalesce(sum(se.points), -1) from public.scoring_events se join public.predictions pr on pr.id = se.prediction_id
      where pr.pool_match_id = v_pm and se.result_revision = 2) = 0, '');
  v_r := pg_temp.as_user(v_a1, format($q$select public.publish_official_result(%L, 3, 3, 1)$q$, v_match));
  perform pg_temp.rec('RES12 una revisión obsoleta se rechaza (sin pérdida de actualización)', pg_temp.is_err(v_r, 'PT409'), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$update public.official_results set home_score = 7 where match_id = %L$q$, v_match));
  perform pg_temp.rec('RES13 sin UPDATE directo en official_results', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_role('postgres', format($q$delete from public.official_results where match_id = %L$q$, v_match));
  perform pg_temp.rec('RES14 los resultados no se borran', pg_temp.is_err(v_r, '42501'), v_r);
  perform pg_temp.rec('RES15 la publicación y la corrección quedaron auditadas',
    (select count(*) from public.audit_log a where a.tenant_id = v_t1 and a.action in ('official_results.insert', 'official_results.update')) >= 2, '');
  v_r := pg_temp.as_user(v_a1, format($q$select public.delete_match(%L)$q$, v_match));
  perform pg_temp.rec('RES16 no se borra un partido con quiniela/resultado', pg_temp.is_err(v_r, '42501'), v_r);
end $$;

-- ---- Referencias externas (futuras APIs) y privilegios -------------------------------------------------------
do $$
declare v_t1 uuid := pg_temp.f('t1'); v_tour uuid := pg_temp.f('tour'); v_ta uuid := pg_temp.f('ta'); v_tb uuid := pg_temp.f('tb'); v_tx uuid := pg_temp.f('tx');
        v_a1 uuid := pg_temp.f('a1'); v_o2 uuid := pg_temp.f('o2'); v_m1 uuid := pg_temp.f('m1'); v_r text; v_fn text;
begin
  v_r := pg_temp.as_user(v_a1, format($q$select public.set_external_ref(%L, 'apifootball', 'team', %L, '33')$q$, v_t1, v_ta));
  perform pg_temp.rec('EXT1 el admin vincula un equipo con un id externo', pg_temp.is_ok(v_r), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$select public.set_external_ref(%L, 'apifootball', 'team', %L, '33')$q$, v_t1, v_tb));
  perform pg_temp.rec('EXT2 un id externo no se asigna a dos equipos', pg_temp.is_err(v_r, '23505'), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$select public.set_external_ref(%L, 'apifootball', 'team', %L, '33')$q$, v_t1, v_ta));
  perform pg_temp.rec('EXT3 repetir el mismo vínculo es idempotente', pg_temp.is_ok(v_r), v_r);
  v_r := pg_temp.as_user(v_o2, format($q$select public.set_external_ref(%L, 'apifootball', 'team', %L, '77')$q$, v_t1, v_ta));
  perform pg_temp.rec('EXT4 otro tenant no vincula', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_m1, format($q$select public.set_external_ref(%L, 'apifootball', 'team', %L, '78')$q$, v_t1, v_ta));
  perform pg_temp.rec('EXT5 un miembro no vincula', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_role('service_role', format($q$select public.set_external_ref(%L, 'apifootball', 'team', %L, '99')$q$, v_t1, v_tx));
  perform pg_temp.rec('EXT6 incluso service_role no vincula entidades de otro tenant', pg_temp.is_err(v_r, '23503'), v_r);
  v_r := pg_temp.as_role('service_role', format($q$select public.set_external_ref(%L, 'apifootball', 'tournament', %L, 'L-128')$q$, v_t1, v_tour));
  perform pg_temp.rec('EXT7 el sincronizador (service_role) vincula y marca last_synced_at', pg_temp.is_ok(v_r)
    and exists (select 1 from public.external_refs where tenant_id = v_t1 and external_id = 'L-128' and last_synced_at is not null), v_r);
  v_r := pg_temp.scalar_as_user(v_m1, 'select count(*) from public.external_refs');
  perform pg_temp.rec('EXT8 un miembro no lee las referencias externas (RLS admin)', v_r = 'OK:0', v_r);
  v_r := pg_temp.scalar_as_user(v_a1, format($q$select count(*) from public.external_refs where tenant_id = %L$q$, v_t1));
  perform pg_temp.rec('EXT9 el admin las lee', v_r = 'OK:2', v_r);
  v_r := pg_temp.scalar_as_user(v_o2, 'select count(*) from public.external_refs');
  perform pg_temp.rec('EXT10 otro tenant no las lee', v_r = 'OK:0', v_r);

  foreach v_fn in array array['upsert_tournament(uuid,uuid,text,text,text,text,text)', 'upsert_team(uuid,uuid,text,text,text,text,text)',
    'set_tournament_team(uuid,uuid,boolean)', 'upsert_round(uuid,uuid,text,integer)', 'reorder_rounds(uuid,uuid[])',
    'upsert_match(uuid,uuid,uuid,uuid,uuid,timestamptz)', 'delete_match(uuid)', 'set_pool_match(uuid,uuid,boolean)',
    'set_external_ref(uuid,text,public.external_entity,uuid,text)', 'publish_official_result(uuid,integer,integer,integer)'] loop
    perform pg_temp.rec('ACL ' || v_fn || ' sin EXECUTE para anon', not has_function_privilege('anon', 'public.' || v_fn, 'execute'), '');
    perform pg_temp.rec('ACL ' || v_fn || ' con EXECUTE para authenticated', has_function_privilege('authenticated', 'public.' || v_fn, 'execute'), '');
  end loop;
  perform pg_temp.rec('ACL _recalculate_match_scoring no ejecutable por clientes',
    not has_function_privilege('authenticated', 'public._recalculate_match_scoring(uuid)', 'execute')
    and not has_function_privilege('anon', 'public._recalculate_match_scoring(uuid)', 'execute'), '');
  perform pg_temp.rec('ACL set_external_ref ejecutable por service_role', has_function_privilege('service_role', 'public.set_external_ref(uuid,text,public.external_entity,uuid,text)', 'execute'), '');
end $$;
