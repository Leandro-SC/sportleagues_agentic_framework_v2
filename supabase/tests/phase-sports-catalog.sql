-- ADR-016: catálogo global, importación al tenant, deduplicación, cuota y propagación de calendario/estados/resultados.
-- Clase A/B: se ejecuta con scripts/qa/run-sql-suite.mjs en una transacción con rollback (no deja datos). La concurrencia real de
-- importación se prueba aparte (scripts/qa/e2e/catalog-concurrency.mjs).
do $$
declare
  v_t1 uuid; v_t2 uuid; v_o1 uuid; v_a1 uuid; v_m1 uuid; v_o2 uuid; v_pl1 uuid; v_pl2 uuid;
  v_tour1 uuid; v_tour2 uuid; v_comp uuid; v_season uuid; v_fix uuid[]; v_r text; v_id text; v_c jsonb;
  v_f1 uuid; v_f2 uuid; v_f3 uuid; v_f4 uuid; v_ma uuid; v_mb uuid; v_mc uuid; v_md uuid; v_mx uuid;
  v_pool uuid; v_part uuid; v_pm_a uuid; v_pm_b uuid; v_pm_c uuid; v_lock1 timestamptz; v_lock2 timestamptz; v_n integer; v_rev integer; v_job uuid; v_out text;
  v_round uuid; v_pool2 uuid; v_ts timestamptz; v_f5 uuid; v_my uuid;
  v_future timestamptz := clock_timestamp() + interval '3 days';
begin
  v_o1 := pg_temp.mk_user('cg-owner1'); v_a1 := pg_temp.mk_user('cg-admin1'); v_m1 := pg_temp.mk_user('cg-memb1');
  v_o2 := pg_temp.mk_user('cg-owner2'); v_pl1 := pg_temp.mk_user('cg-player1'); v_pl2 := pg_temp.mk_user('cg-player2');
  insert into public.tenants(name) values ('CG tenant 1') returning id into v_t1;
  insert into public.tenants(name) values ('CG tenant 2') returning id into v_t2;
  insert into public.tenant_entitlements(tenant_id, plan_code) values (v_t1, 'pro'), (v_t2, 'pro');
  insert into public.tenant_memberships(tenant_id, profile_id, role) values
    (v_t1, v_o1, 'owner'), (v_t1, v_a1, 'admin'), (v_t1, v_m1, 'member'), (v_t1, v_pl1, 'member'), (v_t1, v_pl2, 'member'), (v_t2, v_o2, 'owner');
  insert into public.tournaments(tenant_id, name, season_label) values (v_t1, 'CG liga', '2026') returning id into v_tour1;
  insert into public.tournaments(tenant_id, name, season_label) values (v_t2, 'CG liga t2', '2026') returning id into v_tour2;

  -- ---- Privilegios: el catálogo es de solo lectura para clientes; los controles internos no son accesibles --------------------
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  v_comp := public.catalog_upsert_competition('api_football', jsonb_build_object('external_id', '39', 'name', 'Premier League', 'kind', 'league',
              'country_name', 'England', 'country_code', 'GB-ENG',
              'seasons', jsonb_build_array(jsonb_build_object('year', 2023, 'start', '2023-08-11', 'end', '2024-05-19', 'current', false))));
  select id into v_season from public.catalog_seasons where competition_id = v_comp and year = 2023;
  perform pg_temp.rec('SVC1 el servicio crea competición y temporada', v_comp is not null and v_season is not null, coalesce(v_comp::text, 'null'));
  v_c := to_jsonb(public.catalog_upsert_competition('api_football', jsonb_build_object('external_id', '39', 'name', 'Premier League', 'kind', 'league',
              'country_name', 'England', 'country_code', 'GB-ENG', 'seasons', '[]'::jsonb)));
  perform pg_temp.rec('SVC2 reimportar la competición no duplica (clave proveedor+externo)', (select count(*) from public.catalog_competitions where external_id = '39') = 1, '');
  perform set_config('request.jwt.claims', '', false);

  v_r := pg_temp.as_user(v_a1, $q$insert into public.catalog_competitions(provider, external_id, name) values ('x', '1', 'Falsa')$q$);
  perform pg_temp.rec('PRIV1 un admin de tenant no escribe el catálogo global', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_a1, $q$update public.catalog_competitions set name = 'Hack'$q$);
  perform pg_temp.rec('PRIV2 un admin de tenant no actualiza el catálogo', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.scalar_as_user(v_m1, 'select count(*) from public.catalog_competitions');
  perform pg_temp.rec('PRIV3 un miembro autenticado lee el catálogo', v_r = 'OK:1', v_r);
  v_r := pg_temp.as_role('anon', 'select count(*) from public.catalog_competitions');
  perform pg_temp.rec('PRIV4 anon no lee el catálogo', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_a1, 'select * from public.provider_usage');
  perform pg_temp.rec('PRIV5 provider_usage inaccesible a clientes', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_a1, 'select * from public.catalog_import_jobs');
  perform pg_temp.rec('PRIV6 catalog_import_jobs inaccesible a clientes', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_a1, $q$select public.provider_consume('api_football', 100, 1)$q$);
  perform pg_temp.rec('PRIV7 provider_consume no ejecutable por clientes', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_a1, $q$select public.catalog_begin_import('api_football', 'x')$q$);
  perform pg_temp.rec('PRIV8 catalog_begin_import no ejecutable por clientes', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_a1, 'select public.catalog_propagate_fixtures(array[gen_random_uuid()])');
  perform pg_temp.rec('PRIV9 la propagación no es ejecutable por clientes', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_a1, 'select public.catalog_fixtures_due(''api_football'')');
  perform pg_temp.rec('PRIV10 catalog_fixtures_due no ejecutable por clientes', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_a1, 'select last_polled_at from public.catalog_fixtures');
  perform pg_temp.rec('PRIV11 la columna interna last_polled_at no se expone', pg_temp.is_err(v_r, '42501'), v_r);

  -- ---- Deduplicación de importaciones y cuota -------------------------------------------------------------------------
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  select outcome, job_id into v_out, v_job from public.catalog_begin_import('api_football', 'season:39:2023:round:1', v_a1);
  perform pg_temp.rec('DUP1 la primera solicitud inicia la importación', v_out = 'started', v_out);
  select outcome into v_out from public.catalog_begin_import('api_football', 'season:39:2023:round:1', v_o1);
  perform pg_temp.rec('DUP2 una segunda solicitud simultánea recibe in_progress (sin consumir cuota)', v_out = 'in_progress', v_out);
  perform public.catalog_finish_import(v_job, 'succeeded', null, 1);
  select outcome into v_out from public.catalog_begin_import('api_football', 'season:39:2023:round:1', v_o1);
  perform pg_temp.rec('DUP3 recién importado → fresh (no se repite)', v_out = 'fresh', v_out);
  select outcome into v_out from public.catalog_begin_import('api_football', 'season:39:2023:round:1', v_o1, interval '0 seconds');
  perform pg_temp.rec('DUP4 vencida la ventana se permite reimportar', v_out = 'started', v_out);
  update public.catalog_import_jobs set started_at = clock_timestamp() - interval '10 minutes' where provider = 'api_football' and status = 'running';
  select outcome into v_out from public.catalog_begin_import('api_football', 'season:39:2023:round:1', v_o1, interval '6 hours');
  perform pg_temp.rec('DUP5 un trabajo colgado (stale) se reemplaza sin bloquear para siempre', v_out in ('started', 'fresh'), v_out);
  select count(*) into v_n from public.catalog_import_jobs where provider = 'api_football' and resource_key = 'season:39:2023:round:1' and status = 'running';
  perform pg_temp.rec('DUP6 nunca hay dos trabajos running del mismo recurso', v_n <= 1, v_n::text);
  v_n := public.provider_consume('api_football', 3, 1); perform pg_temp.rec('QUOTA1 reserva 1/3 → quedan 2', v_n = 2, v_n::text);
  v_n := public.provider_consume('api_football', 3, 2); perform pg_temp.rec('QUOTA2 reserva 2 más → quedan 0', v_n = 0, v_n::text);
  v_n := public.provider_consume('api_football', 3, 1); perform pg_temp.rec('QUOTA3 sin cuota → -1 y no se reserva', v_n = -1, v_n::text);
  select requests into v_n from public.provider_usage where provider = 'api_football' and day = (now() at time zone 'utc')::date;
  perform pg_temp.rec('QUOTA4 el consumo registrado es exactamente 3', v_n = 3, v_n::text);
  perform public.provider_record_outcome('api_football', false, true); perform public.provider_record_outcome('api_football', true, false);
  select rate_limited * 10 + errors into v_n from public.provider_usage where provider = 'api_football' and day = (now() at time zone 'utc')::date;
  perform pg_temp.rec('QUOTA5 429 y errores quedan contados', v_n = 11, v_n::text);

  -- ---- Fixtures de una jornada (formas reales de API-Football, ids ficticios) ---------------------------------------------
  v_fix := public.catalog_upsert_fixtures(v_season, 'api_football', jsonb_build_array(
    jsonb_build_object('external_id', '9001', 'round', 'Regular Season - 1', 'home', jsonb_build_object('external_id', '44', 'name', 'Burnley'),
      'away', jsonb_build_object('external_id', '50', 'name', 'Manchester City'), 'starts_at', to_char(v_future, 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
      'provider_status', 'NS', 'state', 'scheduled'),
    jsonb_build_object('external_id', '9002', 'round', 'Regular Season - 1', 'home', jsonb_build_object('external_id', '42', 'name', 'Arsenal'),
      'away', jsonb_build_object('external_id', '66', 'name', 'Aston Villa'), 'starts_at', to_char(v_future + interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
      'provider_status', 'NS', 'state', 'scheduled'),
    jsonb_build_object('external_id', '9003', 'round', 'Regular Season - 1', 'home', jsonb_build_object('external_id', '33', 'name', 'Man United'),
      'away', jsonb_build_object('external_id', '34', 'name', 'Newcastle'), 'starts_at', to_char(v_future + interval '2 hours', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
      'provider_status', 'NS', 'state', 'scheduled'),
    jsonb_build_object('external_id', '9004', 'round', 'Regular Season - 1', 'home', jsonb_build_object('external_id', '40', 'name', 'Liverpool'),
      'away', jsonb_build_object('external_id', '49', 'name', 'Chelsea'), 'starts_at', null, 'provider_status', 'TBD', 'state', 'scheduled')));
  perform pg_temp.rec('FIX1 primera carga: 4 fixtures nuevos', coalesce(array_length(v_fix, 1), 0) = 4, coalesce(array_length(v_fix, 1), 0)::text);
  select id into v_f1 from public.catalog_fixtures where external_id = '9001'; select id into v_f2 from public.catalog_fixtures where external_id = '9002';
  select id into v_f3 from public.catalog_fixtures where external_id = '9003'; select id into v_f4 from public.catalog_fixtures where external_id = '9004';
  v_fix := public.catalog_upsert_fixtures(v_season, 'api_football', jsonb_build_array(
    jsonb_build_object('external_id', '9001', 'round', 'Regular Season - 1', 'home', jsonb_build_object('external_id', '44', 'name', 'Burnley'),
      'away', jsonb_build_object('external_id', '50', 'name', 'Manchester City'), 'starts_at', to_char(v_future, 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
      'provider_status', 'NS', 'state', 'scheduled')));
  perform pg_temp.rec('FIX2 recargar sin cambios no reporta cambios (sin trabajo de propagación)', coalesce(array_length(v_fix, 1), 0) = 0, coalesce(array_length(v_fix, 1), 0)::text);
  select count(*) into v_n from public.catalog_teams where provider = 'api_football';
  perform pg_temp.rec('FIX3 equipos deduplicados por (proveedor, id externo): 8', v_n = 8, v_n::text);
  perform set_config('request.jwt.claims', '', false);

  -- ---- Importación al tenant -------------------------------------------------------------------------------------------
  v_r := pg_temp.as_user(v_m1, format($q$select public.import_catalog_round(%L, %L, 'Regular Season - 1')$q$, v_tour1, v_season));
  perform pg_temp.rec('IMP1 un miembro no importa', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_o2, format($q$select public.import_catalog_round(%L, %L, 'Regular Season - 1')$q$, v_tour1, v_season));
  perform pg_temp.rec('IMP2 el admin de otro tenant no importa en un torneo ajeno', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$select public.import_catalog_round(%L, %L, 'No existe')$q$, v_tour1, v_season));
  perform pg_temp.rec('IMP3 una jornada no importada al catálogo se rechaza', pg_temp.is_err(v_r, '22023'), v_r);
  v_c := (substr(pg_temp.scalar_as_user(v_a1, format($q$select public.import_catalog_round(%L, %L, 'Regular Season - 1')::text$q$, v_tour1, v_season)), 4))::jsonb;
  perform pg_temp.rec('IMP4 el admin importa: 3 partidos, 1 sin fecha omitido, 8 equipos', (v_c->>'matches_created')::int = 3 and (v_c->>'matches_tbd')::int = 1 and (v_c->>'teams_linked')::int = 8, v_c::text);
  v_c := (substr(pg_temp.scalar_as_user(v_a1, format($q$select public.import_catalog_round(%L, %L, 'Regular Season - 1')::text$q$, v_tour1, v_season)), 4))::jsonb;
  perform pg_temp.rec('IMP5 reimportar es idempotente (0 nuevos, 3 existentes)', (v_c->>'matches_created')::int = 0 and (v_c->>'matches_existing')::int = 3, v_c::text);
  select count(*) into v_n from public.matches where tournament_id = v_tour1;
  perform pg_temp.rec('IMP6 sin partidos duplicados en el tenant', v_n = 3, v_n::text);
  select count(*) into v_n from public.rounds where tournament_id = v_tour1 and name = 'Jornada 1';
  perform pg_temp.rec('IMP7 la jornada se crea una vez con nombre legible', v_n = 1, v_n::text);
  select count(*) into v_n from public.audit_log where tenant_id = v_t1 and action = 'sports.round_imported';
  perform pg_temp.rec('IMP8 la importación queda auditada', v_n >= 1, v_n::text);
  v_c := (substr(pg_temp.scalar_as_user(v_o2, format($q$select public.import_catalog_round(%L, %L, 'Regular Season - 1')::text$q$, v_tour2, v_season)), 4))::jsonb;
  perform pg_temp.rec('IMP9 otro tenant importa el MISMO recurso global con copias propias', (v_c->>'matches_created')::int = 3, v_c::text);
  select count(*) into v_n from public.matches ma join public.matches mb on mb.id <> ma.id and mb.tenant_id <> ma.tenant_id where ma.id = (select id from public.matches where tenant_id = v_t1 limit 1) and ma.home_team_id = mb.home_team_id;
  perform pg_temp.rec('IMP10 los equipos tenant-owned no se comparten entre tenants', v_n = 0, v_n::text);
  select count(*) into v_n from public.catalog_competitions;
  perform pg_temp.rec('IMP11 el catálogo global sigue con una sola competición', v_n = 1, v_n::text);

  select id into v_ma from public.matches where tenant_id = v_t1 and starts_at = (select starts_at from public.catalog_fixtures where external_id = '9001');
  select id into v_mb from public.matches where tenant_id = v_t1 and starts_at = (select starts_at from public.catalog_fixtures where external_id = '9002');
  select id into v_mc from public.matches where tenant_id = v_t1 and starts_at = (select starts_at from public.catalog_fixtures where external_id = '9003');
  select id into v_mx from public.matches where tenant_id = v_t2 and starts_at = (select starts_at from public.catalog_fixtures where external_id = '9001');

  -- ---- Quiniela con pronósticos (lock = inicio − 15 min) ------------------------------------------------------------------
  insert into public.pools(tenant_id, name, status, lock_offset) values (v_t1, 'CG pool', 'open', interval '15 minutes') returning id into v_pool;
  insert into public.pool_rules(tenant_id, pool_id, version, exact_points, outcome_points, tie_breaker, is_current) values (v_t1, v_pool, 1, 5, 2, 'exact_predictions', true);
  insert into public.pool_matches(tenant_id, pool_id, match_id) values (v_t1, v_pool, v_ma) returning id into v_pm_a;
  insert into public.pool_matches(tenant_id, pool_id, match_id) values (v_t1, v_pool, v_mb) returning id into v_pm_b;
  insert into public.pool_matches(tenant_id, pool_id, match_id) values (v_t1, v_pool, v_mc) returning id into v_pm_c;
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_t1, v_pool, v_pl1, 'approved', 'paid') returning id into v_part;
  insert into public.predictions(tenant_id, pool_id, pool_match_id, participant_id, home_score, away_score) values
    (v_t1, v_pool, v_pm_a, v_part, 0, 3), (v_t1, v_pool, v_pm_b, v_part, 1, 1), (v_t1, v_pool, v_pm_c, v_part, 2, 0);

  -- ---- Reprogramación (ADR-011) ----------------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  select lock_at into v_lock1 from public.pool_matches where id = v_pm_a;
  perform public.catalog_upsert_fixtures(v_season, 'api_football', jsonb_build_array(
    jsonb_build_object('external_id', '9001', 'round', 'Regular Season - 1', 'home', jsonb_build_object('external_id', '44', 'name', 'Burnley'),
      'away', jsonb_build_object('external_id', '50', 'name', 'Manchester City'), 'starts_at', to_char(v_future + interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
      'provider_status', 'NS', 'state', 'scheduled')));
  v_c := public.catalog_propagate_fixtures(array[v_f1]);
  select lock_at into v_lock2 from public.pool_matches where id = v_pm_a;
  perform pg_temp.rec('RES1 aplazar a otra fecha futura mueve el partido en AMBOS tenants', (v_c->>'rescheduled')::int = 2, v_c::text);
  perform pg_temp.rec('RES2 el lock se desplaza con el horario mientras no se haya alcanzado', v_lock2 = v_lock1 + interval '1 day', v_lock1::text || ' → ' || v_lock2::text);
  perform pg_temp.rec('RES2b queda registro de la reprogramación', (select count(*) from public.fixture_sync_log where match_id = v_ma and kind = 'rescheduled') = 1, '');
  v_c := public.catalog_propagate_fixtures(array[v_f1]);
  perform pg_temp.rec('RES3 repetir la propagación es idempotente (nada nuevo)', (v_c->>'rescheduled')::int = 0, v_c::text);

  -- adelanto: el partido pasa a empezar en 10 min → bloquea ahora, no revela antes
  perform public.catalog_upsert_fixtures(v_season, 'api_football', jsonb_build_array(
    jsonb_build_object('external_id', '9002', 'round', 'Regular Season - 1', 'home', jsonb_build_object('external_id', '42', 'name', 'Arsenal'),
      'away', jsonb_build_object('external_id', '66', 'name', 'Aston Villa'), 'starts_at', to_char(clock_timestamp() + interval '10 minutes', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
      'provider_status', 'NS', 'state', 'scheduled')));
  perform public.catalog_propagate_fixtures(array[v_f2]);
  select lock_at into v_lock2 from public.pool_matches where id = v_pm_b;
  perform pg_temp.rec('RES4 un adelanto bloquea ahora (lock_at ≤ ahora)', v_lock2 <= clock_timestamp(), v_lock2::text);
  perform set_config('request.jwt.claims', '', false);
  v_r := pg_temp.as_user(v_pl1, format($q$select public.save_prediction(%L, %L, 3, 3)$q$, v_pool, v_mb));
  perform pg_temp.rec('RES5 tras el adelanto no se pueden editar pronósticos', pg_temp.is_err(v_r, '42501'), v_r);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  perform public.catalog_upsert_fixtures(v_season, 'api_football', jsonb_build_array(
    jsonb_build_object('external_id', '9002', 'round', 'Regular Season - 1', 'home', jsonb_build_object('external_id', '42', 'name', 'Arsenal'),
      'away', jsonb_build_object('external_id', '66', 'name', 'Aston Villa'), 'starts_at', to_char(clock_timestamp() + interval '2 days', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
      'provider_status', 'NS', 'state', 'scheduled')));
  perform public.catalog_propagate_fixtures(array[v_f2]);
  select lock_at into v_lock2 from public.pool_matches where id = v_pm_b;
  perform pg_temp.rec('RES6 reprogramar más tarde NUNCA reabre un lock alcanzado', v_lock2 <= clock_timestamp(), v_lock2::text);
  perform set_config('request.jwt.claims', '', false);
  v_r := pg_temp.as_user(v_pl1, format($q$select public.save_prediction(%L, %L, 3, 3)$q$, v_pool, v_mb));
  perform pg_temp.rec('RES6b y la edición sigue rechazada tras aplazar', pg_temp.is_err(v_r, '42501'), v_r);

  -- ---- Estados: en juego, aplazado/TBD, cancelado, regresión ------------------------------------------------------------
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  select starts_at into v_ts from public.matches where id = v_mc;
  perform public.catalog_upsert_fixtures(v_season, 'api_football', jsonb_build_array(
    jsonb_build_object('external_id', '9003', 'round', 'Regular Season - 1', 'home', jsonb_build_object('external_id', '33', 'name', 'Man United'),
      'away', jsonb_build_object('external_id', '34', 'name', 'Newcastle'), 'starts_at', null, 'provider_status', 'PST', 'state', 'postponed')));
  v_c := public.catalog_propagate_fixtures(array[v_f3]);
  perform pg_temp.rec('EST1 aplazado sin fecha: se marca provider_state y se conserva el horario',
    (select provider_state from public.matches where id = v_mc) = 'postponed' and (select status::text from public.matches where id = v_mc) = 'scheduled'
    and (select starts_at from public.matches where id = v_mc) = v_ts, v_c::text);
  perform public.catalog_upsert_fixtures(v_season, 'api_football', jsonb_build_array(
    jsonb_build_object('external_id', '9003', 'round', 'Regular Season - 1', 'home', jsonb_build_object('external_id', '33', 'name', 'Man United'),
      'away', jsonb_build_object('external_id', '34', 'name', 'Newcastle'), 'starts_at', null, 'provider_status', 'CANC', 'state', 'cancelled')));
  v_c := public.catalog_propagate_fixtures(array[v_f3]);
  perform pg_temp.rec('EST2 cancelado: provider_state cancelled, sin resultado y sin puntos', (select provider_state from public.matches where id = v_mc) = 'cancelled'
    and not exists (select 1 from public.official_results where match_id = v_mc), v_c::text);
  perform public.catalog_upsert_fixtures(v_season, 'api_football', jsonb_build_array(
    jsonb_build_object('external_id', '9003', 'round', 'Regular Season - 1', 'home', jsonb_build_object('external_id', '33', 'name', 'Man United'),
      'away', jsonb_build_object('external_id', '34', 'name', 'Newcastle'), 'starts_at', to_char(v_future + interval '2 hours', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'), 'provider_status', 'NS', 'state', 'scheduled')));
  perform public.catalog_propagate_fixtures(array[v_f3]);
  perform pg_temp.rec('EST3 si el proveedor reactiva el partido, provider_state se limpia', (select provider_state from public.matches where id = v_mc) is null, '');
  select count(*) into v_n from public.fixture_sync_log where match_id = v_mc and kind = 'state';
  perform pg_temp.rec('EST4 cada cambio de estado quedó en la bitácora (aplazado, cancelado, limpio)', v_n = 3, v_n::text);

  -- ---- Resultados: aplicar, idempotencia, corrección, conflicto con resultado manual --------------------------------------
  perform public.catalog_upsert_fixtures(v_season, 'api_football', jsonb_build_array(
    jsonb_build_object('external_id', '9001', 'round', 'Regular Season - 1', 'home', jsonb_build_object('external_id', '44', 'name', 'Burnley'),
      'away', jsonb_build_object('external_id', '50', 'name', 'Manchester City'), 'starts_at', to_char(clock_timestamp() - interval '3 hours', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
      'provider_status', 'FT', 'state', 'final', 'home_goals', 0, 'away_goals', 3)));
  v_c := public.catalog_propagate_fixtures(array[v_f1]);
  perform pg_temp.rec('RESU1 resultado final del proveedor → resultado oficial en ambos tenants', (v_c->>'results')::int = 2, v_c::text);
  perform pg_temp.rec('RESU2 partido final, revisión 1, origen proveedor sin autor', (select status::text from public.matches where id = v_ma) = 'final'
    and (select revision from public.official_results where match_id = v_ma) = 1 and (select source from public.official_results where match_id = v_ma) = 'provider'
    and (select published_by from public.official_results where match_id = v_ma) is null, '');
  select count(*) into v_n from public.scoring_events se join public.predictions pr on pr.id = se.prediction_id where pr.pool_match_id = v_pm_a;
  perform pg_temp.rec('RESU3 puntuación creada una vez (1 evento)', v_n = 1, v_n::text);
  perform pg_temp.rec('RESU3b pronóstico 0-3 exacto = 5 puntos', (select se.points from public.scoring_events se join public.predictions pr on pr.id = se.prediction_id where pr.pool_match_id = v_pm_a) = 5, '');
  v_c := public.catalog_propagate_fixtures(array[v_f1, v_f1]);
  select count(*) into v_n from public.scoring_events se join public.predictions pr on pr.id = se.prediction_id where pr.pool_match_id = v_pm_a;
  select revision into v_rev from public.official_results where match_id = v_ma;
  perform pg_temp.rec('RESU4 repetir la sincronización no duplica puntos ni revisiones', v_n = 1 and v_rev = 1 and (v_c->>'results')::int = 0, v_c::text || ' n=' || v_n || ' rev=' || v_rev);
  perform public.catalog_upsert_fixtures(v_season, 'api_football', jsonb_build_array(
    jsonb_build_object('external_id', '9001', 'round', 'Regular Season - 1', 'home', jsonb_build_object('external_id', '44', 'name', 'Burnley'),
      'away', jsonb_build_object('external_id', '50', 'name', 'Manchester City'), 'starts_at', to_char(clock_timestamp() - interval '3 hours', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
      'provider_status', 'FT', 'state', 'final', 'home_goals', 1, 'away_goals', 3)));
  v_c := public.catalog_propagate_fixtures(array[v_f1]);
  select revision into v_rev from public.official_results where match_id = v_ma;
  perform pg_temp.rec('RESU5 corrección del proveedor → revisión 2 en ambos tenants', (v_c->>'corrections')::int = 2 and v_rev = 2, v_c::text);
  perform pg_temp.rec('RESU6 el historial conserva una revisión por resultado y la vigente puntúa el signo (2 pts)',
    (select count(*) from public.scoring_events se join public.predictions pr on pr.id = se.prediction_id where pr.pool_match_id = v_pm_a) = 2
    and (select se.points from public.scoring_events se join public.predictions pr on pr.id = se.prediction_id where pr.pool_match_id = v_pm_a and se.result_revision = 2) = 2, '');
  v_c := public.catalog_propagate_fixtures(array[v_f1]);
  perform pg_temp.rec('RESU7 repetir tras corregir no vuelve a subir la revisión', (select revision from public.official_results where match_id = v_ma) = 2, v_c::text);
  perform set_config('request.jwt.claims', '', false);
  perform pg_temp.rec('RESU8 el ranking usa solo la revisión vigente (2 pts, no 7)', pg_temp.scalar_as_user(v_pl1, format($q$select max(points) from public.pool_leaderboard(%L)$q$, v_pool)) = 'OK:2',
    pg_temp.scalar_as_user(v_pl1, format($q$select max(points) from public.pool_leaderboard(%L)$q$, v_pool)));

  -- resultado manual del administrador: el proveedor no lo pisa; queda conflicto (fixture 9005 de la jornada 2, ya jugado)
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  perform public.catalog_upsert_fixtures(v_season, 'api_football', jsonb_build_array(
    jsonb_build_object('external_id', '9005', 'round', 'Regular Season - 2', 'home', jsonb_build_object('external_id', '42', 'name', 'Arsenal'),
      'away', jsonb_build_object('external_id', '33', 'name', 'Man United'), 'starts_at', to_char(clock_timestamp() - interval '5 hours', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
      'provider_status', 'NS', 'state', 'scheduled')));
  select id into v_f5 from public.catalog_fixtures where external_id = '9005';
  perform set_config('request.jwt.claims', '', false);
  perform pg_temp.scalar_as_user(v_o2, format($q$select public.import_catalog_round(%L, %L, 'Regular Season - 2')::text$q$, v_tour2, v_season));
  select id into v_my from public.matches where tenant_id = v_t2 and tournament_id = v_tour2 and home_team_id = (select entity_id from public.external_refs where tenant_id = v_t2 and entity_type = 'team' and external_id = '42');
  v_r := pg_temp.as_user(v_o2, format($q$select public.publish_official_result(%L, 1, 0, 0)$q$, v_my));
  perform pg_temp.rec('CONF0 el organizador publica un resultado manual', pg_temp.is_ok(v_r), v_r);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  perform public.catalog_upsert_fixtures(v_season, 'api_football', jsonb_build_array(
    jsonb_build_object('external_id', '9005', 'round', 'Regular Season - 2', 'home', jsonb_build_object('external_id', '42', 'name', 'Arsenal'),
      'away', jsonb_build_object('external_id', '33', 'name', 'Man United'), 'starts_at', to_char(clock_timestamp() - interval '5 hours', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
      'provider_status', 'FT', 'state', 'final', 'home_goals', 2, 'away_goals', 2)));
  v_c := public.catalog_propagate_fixtures(array[v_f5]);
  perform pg_temp.rec('CONF1 el resultado manual no se sobrescribe y se cuenta el conflicto', (v_c->>'conflicts')::int = 1
    and (select home_score from public.official_results where match_id = v_my) = 1 and (select source from public.official_results where match_id = v_my) = 'manual', v_c::text);
  perform pg_temp.rec('CONF2 el conflicto queda en la bitácora del tenant', (select count(*) from public.fixture_sync_log where match_id = v_my and kind = 'conflict_manual_result') = 1, '');
  perform set_config('request.jwt.claims', '', false);

  -- ---- Aislamiento de la bitácora y de los datos ----------------------------------------------------------------------
  v_r := pg_temp.scalar_as_user(v_a1, format($q$select count(*) from public.fixture_sync_log where match_id = %L$q$, v_my));
  perform pg_temp.rec('ISO1 el admin del tenant 1 no ve la bitácora del tenant 2', v_r = 'OK:0', v_r);
  v_r := pg_temp.scalar_as_user(v_m1, format($q$select count(*) from public.fixture_sync_log where match_id = %L$q$, v_ma));
  perform pg_temp.rec('ISO2 un miembro sin rol admin no ve la bitácora', v_r = 'OK:0', v_r);
  v_r := pg_temp.scalar_as_user(v_a1, format($q$select count(*) from public.fixture_sync_log where match_id = %L$q$, v_ma));
  perform pg_temp.rec('ISO3 el admin ve la bitácora de su partido', v_r like 'OK:%' and substr(v_r, 4)::int >= 2, v_r);
  v_r := pg_temp.scalar_as_user(v_o2, format($q$select count(*) from public.official_results where match_id = %L$q$, v_ma));
  perform pg_temp.rec('ISO4 el resultado del tenant 1 no es visible al tenant 2', v_r = 'OK:0', v_r);
  v_r := pg_temp.as_user(v_a1, format($q$update public.official_results set home_score = 7 where match_id = %L$q$, v_ma));
  perform pg_temp.rec('ISO5 sin UPDATE directo sobre resultados oficiales', pg_temp.is_err(v_r, '42501') or v_r = 'OK:0', v_r);

  -- ---- Cola de sondeo (adaptativa) y frecuencias -----------------------------------------------------------------------------
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  update public.catalog_fixtures set last_polled_at = clock_timestamp() where provider = 'api_football';
  select count(*) into v_n from public.catalog_fixtures_due('api_football', 100);
  perform pg_temp.rec('DUE1 recién sondeados → nada pendiente', v_n = 0, v_n::text);
  update public.catalog_fixtures set starts_at = clock_timestamp() - interval '30 minutes', state = 'live', provider_status = '1H', last_polled_at = clock_timestamp() - interval '6 minutes' where id = v_f2;
  select count(*) into v_n from public.catalog_fixtures_due('api_football', 100);
  perform pg_temp.rec('DUE2 un partido en juego con 6 min sin sondeo está pendiente', v_n >= 1, v_n::text);
  update public.catalog_fixtures set last_polled_at = clock_timestamp() - interval '2 minutes' where id = v_f2;
  select count(*) into v_n from public.catalog_fixtures_due('api_football', 100) where external_id = '9002';
  perform pg_temp.rec('DUE3 en juego sondeado hace 2 min: no se vuelve a consultar', v_n = 0, v_n::text);
  perform set_config('request.jwt.claims', '', false);
  v_r := pg_temp.as_user(v_a1, 'select * from public.catalog_fixtures_due(''api_football'')');
  perform pg_temp.rec('DUE4 los clientes no consultan la cola', pg_temp.is_err(v_r, '42501'), v_r);
end $$;
