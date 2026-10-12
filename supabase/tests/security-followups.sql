-- Seguimiento de seguridad F-01/F-02/F-03 (ver supabase/proposed/20261022000100_security_followups.sql). Clase B: transacción con rollback.
-- Ejecutar: node scripts/qa/run-sql-suite.mjs supabase/tests/security-followups.sql --with-migration supabase/proposed/20261022000100_security_followups.sql
-- Datos sintéticos (fuente 'sf_src'); nada persiste. Sin la migración, S01–S08, S2x y S3x deben FALLAR (línea base de los hallazgos).
do $$
declare
  v_ta uuid; v_tb uuid; v_oa uuid; v_ma uuid; v_ob uuid; v_tour uuid; v_h uuid; v_a uuid; v_round uuid; v_match uuid; v_comp uuid; v_season uuid;
  v_fx uuid; v_cteam uuid; v_r text; v_n bigint; v_pos_auth integer; v_pos_lock integer; v_src text; v_bad text; fn text;
  v_u1 timestamptz; v_u2 timestamptz; v_s1 timestamptz; v_s2 timestamptz; v_lp1 timestamptz; v_lp2 timestamptz; v_c jsonb; v_old1 uuid; v_old2 uuid; v_old3 uuid; v_recent uuid;
  v_fixtures jsonb; v_pad uuid; v_exp bigint; v_mr bigint; v_before_rows bigint; v_j jsonb; v_cf200 uuid; v_cf400 uuid;
begin
  v_oa := pg_temp.mk_user('sf-ownerA'); v_ma := pg_temp.mk_user('sf-memberA'); v_ob := pg_temp.mk_user('sf-ownerB'); v_pad := pg_temp.mk_user('sf-platform');
  insert into public.platform_admins(user_id) values (v_pad);
  insert into public.tenants(name) values ('SF tenant A') returning id into v_ta;
  insert into public.tenants(name) values ('SF tenant B') returning id into v_tb;
  insert into public.tenant_entitlements(tenant_id, plan_code) values (v_ta, 'pro'), (v_tb, 'pro');
  insert into public.tenant_memberships(tenant_id, profile_id, role) values (v_ta, v_oa, 'owner'), (v_ta, v_ma, 'member'), (v_tb, v_ob, 'owner');
  insert into public.tournaments(tenant_id, name) values (v_ta, 'SF torneo') returning id into v_tour;
  insert into public.teams(tenant_id, name) values (v_ta, 'SF H') returning id into v_h;
  insert into public.teams(tenant_id, name) values (v_ta, 'SF A') returning id into v_a;
  insert into public.tournament_teams(tenant_id, tournament_id, team_id) values (v_ta, v_tour, v_h), (v_ta, v_tour, v_a);
  insert into public.rounds(tenant_id, tournament_id, name, sort_order) values (v_ta, v_tour, 'SF Fecha 1', 1) returning id into v_round;
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at) values (v_ta, v_tour, v_round, v_h, v_a, now() - interval '2 hours') returning id into v_match;

  -- ---- F-01: la autorización precede al bloqueo (estructural; un bloqueo revertido no es observable desde una sola sesión) ----
  foreach fn in array array['import_catalog_round', 'import_catalog_teams', 'set_tournament_results_mode', 'publish_official_result', 'set_participant_payment_status', 'approve_participant'] loop
    select lower(p.prosrc) into v_src from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = fn;
    v_pos_auth := strpos(v_src, 'is_tenant_admin'); v_pos_lock := strpos(v_src, 'for update');
    perform pg_temp.rec('S0 ' || fn || ': is_tenant_admin se evalúa antes del primer FOR UPDATE', v_pos_auth > 0 and v_pos_lock > 0 and v_pos_auth < v_pos_lock, v_pos_auth || '<' || v_pos_lock);
  end loop;

  -- Sin oráculo de existencia: id inexistente y id ajeno/sin permiso producen el MISMO error.
  v_r := pg_temp.as_user(v_oa, format($q$select public.import_catalog_teams(%L, array[gen_random_uuid()])$q$, gen_random_uuid()));
  perform pg_temp.rec('S10a import_catalog_teams: torneo inexistente = 42501 not authorized', pg_temp.is_err(v_r, '42501') and v_r like '%not authorized', v_r);
  v_r := pg_temp.as_user(v_ob, format($q$select public.import_catalog_teams(%L, array[gen_random_uuid()])$q$, v_tour));
  perform pg_temp.rec('S10b import_catalog_teams: torneo de otro tenant = 42501 not authorized', pg_temp.is_err(v_r, '42501') and v_r like '%not authorized', v_r);
  v_r := pg_temp.as_user(v_ma, format($q$select public.import_catalog_teams(%L, array[gen_random_uuid()])$q$, v_tour));
  perform pg_temp.rec('S10c import_catalog_teams: miembro no administrador = 42501', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_oa, format($q$select public.set_tournament_results_mode(%L, 'manual')$q$, gen_random_uuid()));
  perform pg_temp.rec('S11a set_tournament_results_mode: inexistente = 42501', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_ob, format($q$select public.set_tournament_results_mode(%L, 'manual')$q$, v_tour));
  perform pg_temp.rec('S11b set_tournament_results_mode: ajeno = 42501', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_oa, format($q$select public.publish_official_result(%L, 1, 0, 0)$q$, gen_random_uuid()));
  perform pg_temp.rec('S12a publish_official_result: partido inexistente = 42501', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_ob, format($q$select public.publish_official_result(%L, 1, 0, 0)$q$, v_match));
  perform pg_temp.rec('S12b publish_official_result: partido de otro tenant = 42501 y sin resultado creado',
    pg_temp.is_err(v_r, '42501') and not exists (select 1 from public.official_results where match_id = v_match), v_r);
  v_r := pg_temp.as_user(v_oa, format($q$select public.import_catalog_round(%L, %L, 'x')$q$, gen_random_uuid(), gen_random_uuid()));
  perform pg_temp.rec('S13 import_catalog_round: torneo inexistente = 42501', pg_temp.is_err(v_r, '42501'), v_r);

  -- ---- Catálogo sintético (como service_role) ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  v_comp := public.catalog_upsert_competition('sf_src', jsonb_build_object('external_id', 'SFC1', 'name', 'SF Liga', 'kind', 'league',
              'seasons', jsonb_build_array(jsonb_build_object('year', 2026, 'current', true))));
  select id into v_season from public.catalog_seasons where competition_id = v_comp and year = 2026;
  v_fixtures := jsonb_build_array(jsonb_build_object('external_id', 'SF-FX1', 'round', 'Regular Season - 1',
      'home', jsonb_build_object('external_id', 'SF-T1', 'name', 'SF Uno', 'national', false),
      'away', jsonb_build_object('external_id', 'SF-T2', 'name', 'SF Dos', 'national', false),
      'starts_at', (now() + interval '3 days')::text, 'provider_status', 'NS', 'state', 'scheduled'));
  perform public.catalog_upsert_fixtures(v_season, 'sf_src', v_fixtures);
  perform set_config('request.jwt.claims', '', false);
  select id, updated_at, last_polled_at into v_fx, v_u1, v_lp1 from public.catalog_fixtures where provider = 'sf_src' and external_id = 'SF-FX1';
  select updated_at into v_s1 from public.catalog_seasons where id = v_season;

  -- ---- Rutas autorizadas siguen funcionando -----------------------------------------------------------------------------
  v_r := pg_temp.scalar_as_user(v_oa, format($q$select (public.import_catalog_round(%L, %L, 'Regular Season - 1')->>'matches_created')$q$, v_tour, v_season));
  perform pg_temp.rec('S14 el administrador importa la jornada (1 partido creado)', v_r = 'OK:1', v_r);
  v_r := pg_temp.as_user(v_ma, format($q$select public.import_catalog_round(%L, %L, 'Regular Season - 1')$q$, v_tour, v_season));
  perform pg_temp.rec('S14b un miembro no importa jornadas', pg_temp.is_err(v_r, '42501'), v_r);
  select id into v_cteam from public.catalog_teams where provider = 'sf_src' and external_id = 'SF-T1';
  v_r := pg_temp.scalar_as_user(v_oa, format($q$select (public.import_catalog_teams(%L, array[%L]::uuid[])->>'found')$q$, v_tour, v_cteam));
  perform pg_temp.rec('S15 el administrador importa equipos del catálogo', v_r = 'OK:1', v_r);
  v_r := pg_temp.as_user(v_oa, format($q$select public.set_tournament_results_mode(%L, 'manual')$q$, v_tour));
  perform pg_temp.rec('S16 el administrador fija el modo de resultados', pg_temp.is_ok(v_r), v_r);
  v_r := pg_temp.as_user(v_oa, format($q$select public.set_tournament_results_mode(%L, 'automatic')$q$, v_tour));
  perform pg_temp.rec('S16b modo automático sigue exigiendo interruptor + plan (42501)', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_oa, format($q$select public.publish_official_result(%L, 2, 1, 0)$q$, v_match));
  perform pg_temp.rec('S17 el administrador publica un resultado manual (revisión 1)', pg_temp.is_ok(v_r)
    and (select revision from public.official_results where match_id = v_match) = 1, v_r);
  v_r := pg_temp.as_user(v_oa, format($q$select public.publish_official_result(%L, 2, 1, 0)$q$, v_match));
  perform pg_temp.rec('S17b revisión obsoleta sigue dando conflicto PT409', pg_temp.is_err(v_r, 'PT409'), v_r);

  -- ---- F-02: updated_at no avanza por el sondeo -------------------------------------------------------------------------
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  perform public.catalog_upsert_fixtures(v_season, 'sf_src', v_fixtures);   -- mismo contenido: solo cambia last_polled_at / fixtures_synced_at
  perform set_config('request.jwt.claims', '', false);
  select updated_at, last_polled_at into v_u2, v_lp2 from public.catalog_fixtures where id = v_fx;
  select updated_at into v_s2 from public.catalog_seasons where id = v_season;
  perform pg_temp.rec('S20 un sondeo idéntico no mueve fixtures.updated_at', v_u2 = v_u1, v_u1::text || ' / ' || v_u2::text);
  perform pg_temp.rec('S21 (sanidad) el sondeo sí avanzó last_polled_at', v_lp2 > v_lp1, v_lp1::text || ' / ' || v_lp2::text);
  perform pg_temp.rec('S22 fixtures_synced_at no mueve seasons.updated_at', v_s2 = v_s1, v_s1::text || ' / ' || v_s2::text);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  perform public.catalog_upsert_fixtures(v_season, 'sf_src', jsonb_set(jsonb_set(jsonb_set(v_fixtures, '{0,state}', '"final"'), '{0,home_goals}', '2'), '{0,away_goals}', '1'));
  perform set_config('request.jwt.claims', '', false);
  select updated_at into v_u2 from public.catalog_fixtures where id = v_fx;
  perform pg_temp.rec('S23 un cambio real (estado/marcador) sí mueve fixtures.updated_at', v_u2 > v_u1, v_u1::text || ' / ' || v_u2::text);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  perform public.catalog_upsert_competition('sf_src', jsonb_build_object('external_id', 'SFC1', 'name', 'SF Liga', 'kind', 'league',
            'seasons', jsonb_build_array(jsonb_build_object('year', 2026, 'current', false))));
  perform set_config('request.jwt.claims', '', false);
  select updated_at into v_s2 from public.catalog_seasons where id = v_season;
  perform pg_temp.rec('S24 un cambio real de temporada sí mueve seasons.updated_at', v_s2 > v_s1, v_s1::text || ' / ' || v_s2::text);
  v_r := pg_temp.as_user(v_ma, format('select fixtures_synced_at from public.catalog_seasons where id = %L', v_season));
  perform pg_temp.rec('S25 los clientes no leen catalog_seasons.fixtures_synced_at', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_ma, format('select id, competition_id, year, is_current, updated_at from public.catalog_seasons where id = %L', v_season));
  perform pg_temp.rec('S26 las columnas públicas de catalog_seasons siguen legibles (sincronización del cliente)', v_r = 'OK:1', v_r);
  v_r := pg_temp.as_user(v_ma, format('select last_polled_at from public.catalog_fixtures where id = %L', v_fx));
  perform pg_temp.rec('S27 los clientes no leen catalog_fixtures.last_polled_at', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_ma, format('select updated_at, state from public.catalog_fixtures where id = %L', v_fx));
  perform pg_temp.rec('S28 catalog_fixtures.updated_at/state siguen legibles', v_r = 'OK:1', v_r);

  -- ---- F-03: retención y deduplicación de fixture_sync_log ---------------------------------------------------------------
  insert into public.fixture_sync_log(tenant_id, match_id, kind, detail) values (v_ta, v_match, 'ignored_regression', '{"reason":"premature"}');
  insert into public.fixture_sync_log(tenant_id, match_id, kind, detail) values (v_ta, v_match, 'ignored_regression', '{"reason":"premature"}');
  select count(*) into v_n from public.fixture_sync_log where match_id = v_match and kind = 'ignored_regression';
  perform pg_temp.rec('S30 una entrada repetitiva idéntica no se duplica (24 h)', v_n = 1, v_n::text);
  insert into public.fixture_sync_log(tenant_id, match_id, kind, detail) values (v_ta, v_match, 'ignored_regression', '{"reason":"other"}');
  select count(*) into v_n from public.fixture_sync_log where match_id = v_match and kind = 'ignored_regression';
  perform pg_temp.rec('S31 un detalle distinto sí se registra', v_n = 2, v_n::text);
  insert into public.fixture_sync_log(tenant_id, match_id, kind, detail) values (v_ta, v_match, 'conflict_manual_result', '{"provider_home":1}');
  insert into public.fixture_sync_log(tenant_id, match_id, kind, detail) values (v_ta, v_match, 'conflict_manual_result', '{"provider_home":1}');
  select count(*) into v_n from public.fixture_sync_log where match_id = v_match and kind = 'conflict_manual_result';
  perform pg_temp.rec('S32 el conflicto manual repetido no se duplica', v_n = 1, v_n::text);
  insert into public.fixture_sync_log(tenant_id, match_id, kind, detail) values (v_ta, v_match, 'state', '{"provider_state":"postponed"}');
  insert into public.fixture_sync_log(tenant_id, match_id, kind, detail) values (v_ta, v_match, 'state', '{"provider_state":"postponed"}');
  select count(*) into v_n from public.fixture_sync_log where match_id = v_match and kind = 'state';
  perform pg_temp.rec('S33 los cambios de estado reales no se deduplican (historial)', v_n = 2, v_n::text);

  -- Filas sintéticas para la retención (kind 'rescheduled' = purgable a 180 d; 'conflict_manual_result' = purgable solo a 365 d).
  insert into public.fixture_sync_log(tenant_id, match_id, kind, detail, created_at) values (v_ta, v_match, 'rescheduled', '{"n":1}', now() - interval '200 days') returning id into v_old1;
  insert into public.fixture_sync_log(tenant_id, match_id, kind, detail, created_at) values (v_ta, v_match, 'rescheduled', '{"n":2}', now() - interval '190 days') returning id into v_old2;
  insert into public.fixture_sync_log(tenant_id, match_id, kind, detail, created_at) values (v_ta, v_match, 'rescheduled', '{"n":3}', now() - interval '185 days') returning id into v_old3;
  insert into public.fixture_sync_log(tenant_id, match_id, kind, detail, created_at) values (v_ta, v_match, 'rescheduled', '{"n":4}', now() - interval '100 days') returning id into v_recent;
  insert into public.fixture_sync_log(tenant_id, match_id, kind, detail, created_at) values (v_ta, v_match, 'conflict_manual_result', '{"old":200}', now() - interval '200 days') returning id into v_cf200;
  insert into public.fixture_sync_log(tenant_id, match_id, kind, detail, created_at) values (v_ta, v_match, 'conflict_manual_result', '{"old":400}', now() - interval '400 days') returning id into v_cf400;
  -- Elegibles reales: 3 'rescheduled' > 180 d + 1 conflicto > 365 d (el conflicto de 200 d y la fila de 100 d NO).
  select count(*) into v_exp from public.fixture_sync_log
   where created_at < now() - interval '180 days' and (kind <> 'conflict_manual_result' or created_at < now() - interval '365 days');
  perform pg_temp.rec('S40a privilegios: solo service_role ejecuta la purga (firma nueva de 4 parámetros)',
    has_function_privilege('service_role', 'public.purge_fixture_sync_log(interval, integer, boolean, interval)', 'execute')
    and not has_function_privilege('authenticated', 'public.purge_fixture_sync_log(interval, integer, boolean, interval)', 'execute')
    and not has_function_privilege('anon', 'public.purge_fixture_sync_log(interval, integer, boolean, interval)', 'execute'), '');
  perform pg_temp.rec('S40b la firma antigua (interval, integer) ya no existe (sin sobrecargas con ACL distinta)',
    to_regprocedure('public.purge_fixture_sync_log(interval, integer)') is null
    and (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'purge_fixture_sync_log') = 1, '');
  v_r := pg_temp.as_user(v_oa, 'select public.purge_fixture_sync_log()');
  perform pg_temp.rec('S41 el owner de un tenant no ejecuta la purga', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_ma, $q$select public.purge_fixture_sync_log(interval '180 days', 10, true)$q$);
  perform pg_temp.rec('S41b un miembro no ejecuta ni el dry-run', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_pad, 'select public.purge_fixture_sync_log()');
  perform pg_temp.rec('S41c un platform_admin no ejecuta la purga por esta vía', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_role('anon', 'select public.purge_fixture_sync_log()');
  perform pg_temp.rec('S42 anon no ejecuta la purga', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_role('service_role', $q$select public.purge_fixture_sync_log(interval '7 days')$q$);
  perform pg_temp.rec('S43 la retención mínima es de 30 días (22023)', pg_temp.is_err(v_r, '22023'), v_r);
  v_r := pg_temp.as_role('service_role', $q$select public.purge_fixture_sync_log(interval '180 days', 100, false, interval '364 days')$q$);
  perform pg_temp.rec('S43b la retención mínima de conflictos es de 365 días (22023)', pg_temp.is_err(v_r, '22023'), v_r);
  v_r := pg_temp.as_role('service_role', $q$select public.purge_fixture_sync_log(interval '180 days', 0)$q$);
  perform pg_temp.rec('S44a lote 0 inválido (22023)', pg_temp.is_err(v_r, '22023'), v_r);
  v_r := pg_temp.as_role('service_role', $q$select public.purge_fixture_sync_log(interval '180 days', 100001)$q$);
  perform pg_temp.rec('S44b lote > 100000 inválido (22023)', pg_temp.is_err(v_r, '22023'), v_r);
  v_r := pg_temp.as_role('service_role', $q$select public.purge_fixture_sync_log(interval '180 days', 10, null)$q$);
  perform pg_temp.rec('S44c dry_run nulo inválido (22023)', pg_temp.is_err(v_r, '22023'), v_r);

  -- ---- Ejecución de prueba: cuenta y NO borra ----
  select count(*) into v_mr from public.maintenance_runs;
  select count(*) into v_before_rows from public.fixture_sync_log;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  v_j := public.purge_fixture_sync_log(interval '180 days', 100000, true);
  perform set_config('request.jwt.claims', '', false);
  perform pg_temp.rec('S45 dry-run: ok, dry_run=true, would_delete = elegibles reales y sin clave deleted',
    (v_j->>'ok')::boolean and (v_j->>'dry_run')::boolean and (v_j->>'would_delete')::bigint = v_exp and not (v_j ? 'deleted')
    and (v_j->>'kept_days')::int = 180 and (v_j->>'batch')::int = 100000 and (v_j->>'cutoff') is not null, v_j::text);
  perform pg_temp.rec('S45b dry-run no borra ninguna fila', (select count(*) from public.fixture_sync_log) = v_before_rows
    and exists (select 1 from public.fixture_sync_log where id = v_old1), '');
  perform pg_temp.rec('S45c dry-run registra una fila en maintenance_runs (dry_run, affected = would_delete, sin error)',
    (select count(*) from public.maintenance_runs) = v_mr + 1
    and exists (select 1 from public.maintenance_runs where task = 'purge_fixture_sync_log' and dry_run and affected = v_exp and error is null
                 and params ? 'keep_days' and params ? 'max_rows'), '');
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  v_j := public.purge_fixture_sync_log(interval '180 days', 2, true);
  perform set_config('request.jwt.claims', '', false);
  perform pg_temp.rec('S45d el dry-run respeta el tamaño de lote (would_delete = 2)', (v_j->>'would_delete')::int = 2, v_j::text);

  -- ---- Borrado real por lotes ----
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  v_j := public.purge_fixture_sync_log(interval '180 days', 2);
  perform set_config('request.jwt.claims', '', false);
  perform pg_temp.rec('S46 el lote limita el borrado (deleted = 2) y la respuesta lleva deleted, no would_delete',
    (v_j->>'ok')::boolean and not (v_j->>'dry_run')::boolean and (v_j->>'deleted')::int = 2 and not (v_j ? 'would_delete'), v_j::text);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  v_j := public.purge_fixture_sync_log(interval '180 days', 100);
  perform set_config('request.jwt.claims', '', false);
  perform pg_temp.rec('S47 la siguiente pasada elimina el resto elegible (deleted = elegibles - 2)', (v_j->>'deleted')::bigint = v_exp - 2, v_j::text || ' exp=' || v_exp::text);
  perform pg_temp.rec('S48a se eliminaron las filas antiguas y el conflicto de > 365 días',
    not exists (select 1 from public.fixture_sync_log where id in (v_old1, v_old2, v_old3, v_cf400)), '');
  perform pg_temp.rec('S48b se conservan la fila de 100 días y el conflicto de 200 días (< 365)',
    exists (select 1 from public.fixture_sync_log where id = v_recent) and exists (select 1 from public.fixture_sync_log where id = v_cf200), '');
  perform pg_temp.rec('S48c se conservan las filas recientes (state x2, ignored_regression x2, conflicto reciente)',
    (select count(*) from public.fixture_sync_log where match_id = v_match and created_at > now() - interval '1 day') = 5, '');
  perform pg_temp.rec('S49 cada ejecución dejó su fila: 2 dry-run + 2 reales = 4 nuevas, con affected coherente',
    (select count(*) from public.maintenance_runs) = v_mr + 4
    and (select count(*) from public.maintenance_runs where not dry_run and affected = 2) >= 1
    and (select count(*) from public.maintenance_runs where not dry_run and affected = v_exp - 2) >= 1, '');
  perform pg_temp.rec('S49b el conflicto de 200 días (< 365 d) sigue presente tras las purgas a 180 d',
    exists (select 1 from public.fixture_sync_log where id = v_cf200), '');
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  v_j := public.purge_fixture_sync_log(interval '30 days', 100);
  perform set_config('request.jwt.claims', '', false);
  perform pg_temp.rec('S49c con retención de 30 d se borra lo antiguo (100 d) pero el conflicto de 200 d (< 365 d) sigue intacto',
    (v_j->>'ok')::boolean and not exists (select 1 from public.fixture_sync_log where id = v_recent) and exists (select 1 from public.fixture_sync_log where id = v_cf200), v_j::text);

  -- ---- Error interno: se captura, se registra con SQLSTATE y no se relanza ----
  insert into public.fixture_sync_log(tenant_id, match_id, kind, detail, created_at) values (v_ta, v_match, 'rescheduled', '{"n":9}', now() - interval '300 days') returning id into v_old1;
  create function public.tg_sf_test_block_delete() returns trigger language plpgsql as $f$ begin raise exception 'bloqueado por prueba' using errcode = '55006'; end $f$;
  create trigger sf_test_block_delete before delete on public.fixture_sync_log for each row execute function public.tg_sf_test_block_delete();
  select count(*) into v_mr from public.maintenance_runs;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  v_j := public.purge_fixture_sync_log(interval '180 days', 10);
  perform set_config('request.jwt.claims', '', false);
  perform pg_temp.rec('S50 un error interno devuelve {ok:false, error:<sqlstate>} sin relanzar', not (v_j->>'ok')::boolean and v_j->>'error' = '55006', v_j::text);
  perform pg_temp.rec('S50b el error queda registrado (fila con SQLSTATE, affected 0) y la fila no se borró',
    (select count(*) from public.maintenance_runs) = v_mr + 1
    and exists (select 1 from public.maintenance_runs where task = 'purge_fixture_sync_log' and error = '55006' and affected = 0 and not dry_run)
    and exists (select 1 from public.fixture_sync_log where id = v_old1), '');
  drop trigger sf_test_block_delete on public.fixture_sync_log;
  drop function public.tg_sf_test_block_delete();

  -- ---- maintenance_runs: append-only y sin acceso de clientes ----
  perform pg_temp.rec('S51 maintenance_runs tiene RLS activa y ningún privilegio para anon/authenticated',
    (select relrowsecurity from pg_class where oid = 'public.maintenance_runs'::regclass)
    and not has_table_privilege('anon', 'public.maintenance_runs', 'select') and not has_table_privilege('authenticated', 'public.maintenance_runs', 'select')
    and not has_table_privilege('authenticated', 'public.maintenance_runs', 'insert') and not has_table_privilege('authenticated', 'public.maintenance_runs', 'update')
    and not has_table_privilege('authenticated', 'public.maintenance_runs', 'delete') and not has_table_privilege('authenticated', 'public.maintenance_runs', 'truncate'), '');
  v_r := pg_temp.as_user(v_oa, 'select * from public.maintenance_runs');
  perform pg_temp.rec('S51b el owner de un tenant no lee maintenance_runs', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_pad, 'select * from public.maintenance_runs');
  perform pg_temp.rec('S51c un platform_admin no lee maintenance_runs', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_role('anon', 'select * from public.maintenance_runs');
  perform pg_temp.rec('S51d anon no lee maintenance_runs', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_oa, $q$insert into public.maintenance_runs(task, dry_run) values ('x', true)$q$);
  perform pg_temp.rec('S51e un cliente no inserta en maintenance_runs', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_role('postgres', $q$update public.maintenance_runs set task = 'manipulado'$q$);
  perform pg_temp.rec('S52a UPDATE bloqueado incluso para el propietario (append-only)', pg_temp.is_err(v_r, '42501') and v_r like '%append-only%', v_r);
  v_r := pg_temp.as_role('postgres', 'delete from public.maintenance_runs');
  perform pg_temp.rec('S52b DELETE bloqueado (append-only)', pg_temp.is_err(v_r, '42501') and v_r like '%append-only%', v_r);
  v_r := pg_temp.as_role('postgres', 'truncate public.maintenance_runs');
  perform pg_temp.rec('S52c TRUNCATE bloqueado (append-only)', pg_temp.is_err(v_r, '42501') and v_r like '%append-only%', v_r);
  perform pg_temp.rec('S53 el administrador sigue leyendo la bitácora de su tenant y no la de otro',
    pg_temp.scalar_as_user(v_oa, format('select count(*) from public.fixture_sync_log where tenant_id = %L', v_ta)) ~ '^OK:[1-9]'
    and pg_temp.scalar_as_user(v_ob, format('select count(*) from public.fixture_sync_log where tenant_id = %L', v_ta)) = 'OK:0', '');
end $$;
