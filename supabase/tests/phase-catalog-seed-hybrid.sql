-- ADR-016 (revisión): catálogo precargado (carga idempotente, deduplicación, búsqueda paginada), importación de equipos al torneo y
-- resultados híbridos (manual para todos; automático = Premium futuro verificado en base de datos).
-- Datos SINTÉTICOS con la fuente de prueba 'test_src' dentro de una transacción con rollback: no se confunden con el catálogo oficial.
do $$
declare
  v_t1 uuid; v_t2 uuid; v_t3 uuid; v_o1 uuid; v_a1 uuid; v_m1 uuid; v_o2 uuid; v_o3 uuid; v_pl uuid;
  v_tour1 uuid; v_tour2 uuid; v_tour3 uuid; v_r text; v_c jsonb; v_n integer; v_payload jsonb; v_comp uuid; v_season uuid;
  v_peru uuid; v_eng uuid; v_club uuid; v_team uuid; v_season2 uuid; v_fix uuid; v_match uuid; v_round uuid; v_pool uuid; v_pm uuid; v_part uuid;
  v_ids uuid[]; v_m2 uuid; v_m3 uuid; v_fx2 uuid; v_fx3 uuid;
begin
  v_o1 := pg_temp.mk_user('cs-owner1'); v_a1 := pg_temp.mk_user('cs-admin1'); v_m1 := pg_temp.mk_user('cs-memb1');
  v_o2 := pg_temp.mk_user('cs-owner2'); v_o3 := pg_temp.mk_user('cs-owner3'); v_pl := pg_temp.mk_user('cs-player');
  insert into public.tenants(name) values ('CS tenant 1') returning id into v_t1;
  insert into public.tenants(name) values ('CS tenant 2') returning id into v_t2;
  insert into public.tenants(name) values ('CS tenant free') returning id into v_t3;
  insert into public.tenant_entitlements(tenant_id, plan_code) values (v_t1, 'pro'), (v_t2, 'pro'), (v_t3, 'free');
  insert into public.tenant_memberships(tenant_id, profile_id, role) values (v_t1, v_o1, 'owner'), (v_t1, v_a1, 'admin'), (v_t1, v_m1, 'member'), (v_t1, v_pl, 'member'),
    (v_t2, v_o2, 'owner'), (v_t3, v_o3, 'owner');
  insert into public.tournaments(tenant_id, name, season_label) values (v_t1, 'CS torneo 1', '2026') returning id into v_tour1;
  insert into public.tournaments(tenant_id, name, season_label) values (v_t2, 'CS torneo 2', '2026') returning id into v_tour2;
  insert into public.tournaments(tenant_id, name, season_label) values (v_t3, 'CS torneo free', '2026') returning id into v_tour3;

  -- ---- Carga del catálogo --------------------------------------------------------------------------------------------------
  v_payload := jsonb_build_object(
    'source', jsonb_build_object('key', 'test_src', 'name', 'Fuente de prueba', 'license', 'CC0', 'version', 't1'),
    'countries', jsonb_build_array(jsonb_build_object('code', 'QP', 'name_en', 'Quimeria', 'name_es', 'Quimería', 'confederation', 'CONMEBOL'),
                                   jsonb_build_object('code', 'GB-ENG', 'name_en', 'England', 'name_es', 'Inglaterra', 'confederation', 'UEFA')),
    'teams', jsonb_build_array(
      jsonb_build_object('external_id', 'T1', 'name', 'Quimera Cristal', 'kind', 'club', 'country_code', 'QP', 'country_name', 'Quimería', 'aliases', jsonb_build_array('Quimcris')),
      jsonb_build_object('external_id', 'T2', 'name', 'Quimera Alianza', 'kind', 'club', 'country_code', 'QP', 'country_name', 'Quimería'),
      jsonb_build_object('external_id', 'T3', 'name', 'Quimera Universitario', 'official_name', 'Club Quimera de Deportes', 'kind', 'club', 'country_code', 'QP'),
      jsonb_build_object('external_id', 'T4', 'name', 'Quimería Norte', 'kind', 'national', 'country_code', 'GB-ENG', 'aliases', jsonb_build_array('Quimeria North')),
      jsonb_build_object('external_id', 'T5', 'name', 'Quimería Sur', 'kind', 'national', 'country_code', 'QP', 'aliases', jsonb_build_array('Quimeria South')),
      jsonb_build_object('external_id', 'T6', 'name', 'Quimera Arsenal', 'kind', 'club', 'country_code', 'GB-ENG')),
    'competitions', jsonb_build_array(
      jsonb_build_object('external_id', 'C1', 'name', 'Liga Quimera', 'kind', 'league', 'scope', 'domestic', 'country_code', 'QP', 'aliases', jsonb_build_array('Primera División Quimera'),
        'season', jsonb_build_object('year', 2026, 'current', true), 'team_ids', jsonb_build_array('T1', 'T2', 'T3')),
      jsonb_build_object('external_id', 'C2', 'name', 'Copa Quimera', 'kind', 'cup', 'scope', 'continental', 'season', jsonb_build_object('year', 2026, 'current', true), 'team_ids', '[]'::jsonb)));
  v_r := pg_temp.as_user(v_a1, format($q$select public.catalog_seed_load(%L::jsonb)$q$, v_payload::text));
  perform pg_temp.rec('SEED1 un administrador de tenant no puede cargar el catálogo', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_role('anon', format($q$select public.catalog_seed_load(%L::jsonb)$q$, v_payload::text));
  perform pg_temp.rec('SEED2 anon no puede cargar el catálogo', pg_temp.is_err(v_r, '42501'), v_r);
  v_c := public.catalog_seed_load(v_payload);
  perform pg_temp.rec('SEED3 la carga (postgres) inserta 6 equipos y 2 competiciones', (v_c->>'teams')::int = 6 and (v_c->>'competitions')::int = 2, v_c::text);
  v_c := public.catalog_seed_load(v_payload);
  select count(*) into v_n from public.catalog_teams where provider = 'test_src';
  perform pg_temp.rec('SEED4 recargar es idempotente: sin duplicados (6 equipos)', v_n = 6, v_n::text);
  select count(*) into v_n from public.catalog_competitions where provider = 'test_src';
  perform pg_temp.rec('SEED5 recargar no duplica competiciones (2)', v_n = 2, v_n::text);
  select count(*) into v_n from public.catalog_seasons s join public.catalog_competitions c on c.id = s.competition_id where c.provider = 'test_src';
  perform pg_temp.rec('SEED6 una temporada por competición (2)', v_n = 2, v_n::text);
  select count(*) into v_n from public.catalog_competition_teams ct join public.catalog_seasons s on s.id = ct.season_id join public.catalog_competitions c on c.id = s.competition_id where c.external_id = 'C1';
  perform pg_temp.rec('SEED7 participación de 3 clubes en la Liga 1 y sin duplicar al recargar', v_n = 3, v_n::text);
  perform pg_temp.rec('SEED8 queda la procedencia y la licencia de la fuente', (select license from public.catalog_sources where source = 'test_src') = 'CC0', '');
  v_r := pg_temp.as_user(v_a1, 'select * from public.catalog_sources');
  perform pg_temp.rec('SEED9 los clientes leen la procedencia', pg_temp.is_ok(v_r), v_r);
  v_r := pg_temp.as_user(v_a1, $q$insert into public.catalog_teams(provider, external_id, name) values ('x', '1', 'Falso')$q$);
  perform pg_temp.rec('SEED10 los clientes no escriben equipos del catálogo', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_a1, $q$insert into public.catalog_competition_teams(season_id, team_id) select s.id, t.id from public.catalog_seasons s, public.catalog_teams t limit 1$q$);
  perform pg_temp.rec('SEED11 los clientes no alteran la participación', pg_temp.is_err(v_r, '42501'), v_r);

  -- ---- Búsqueda -----------------------------------------------------------------------------------------------------------------
  v_r := pg_temp.scalar_as_user(v_m1, $q$select string_agg(name, ',' order by name) from public.search_catalog_teams('quimeria sur')$q$);
  perform pg_temp.rec('BUS1 "quimeria sur" encuentra la selección por acento (Quimería Sur)', v_r = 'OK:Quimería Sur', v_r);
  v_r := pg_temp.scalar_as_user(v_m1, $q$select string_agg(name, ',' order by name) from public.search_catalog_teams('QUIMCRIS')$q$);
  perform pg_temp.rec('BUS2 insensible a mayúsculas y alias ("quimcris")', v_r = 'OK:Quimera Cristal', v_r);
  v_r := pg_temp.scalar_as_user(v_m1, $q$select string_agg(name, ',' order by name) from public.search_catalog_teams('zzqq inexistente')$q$);
  perform pg_temp.rec('BUS3 un término ausente no devuelve falsos positivos', v_r = 'OK:' or v_r = 'OK', v_r);
  v_r := pg_temp.scalar_as_user(v_m1, $q$select string_agg(name, ',' order by name) from public.search_catalog_teams('club quimera')$q$);
  perform pg_temp.rec('BUS4 busca por nombre oficial', v_r = 'OK:Quimera Universitario', v_r);
  v_r := pg_temp.scalar_as_user(v_m1, $q$select count(*) from public.search_catalog_teams('quimer', 'national')$q$);
  perform pg_temp.rec('BUS5 filtro selecciones nacionales (2)', v_r = 'OK:2', v_r);
  v_r := pg_temp.scalar_as_user(v_m1, $q$select count(*) from public.search_catalog_teams('', 'club', 'QP')$q$);
  perform pg_temp.rec('BUS6 filtro clubes de Perú (3)', v_r = 'OK:3', v_r);
  select id into v_comp from public.catalog_competitions where external_id = 'C1' and provider = 'test_src';
  v_r := pg_temp.scalar_as_user(v_m1, format($q$select string_agg(name, ',' order by name) from public.search_catalog_teams('', null, null, %L)$q$, v_comp));
  perform pg_temp.rec('BUS7 filtro por competición devuelve sus participantes', v_r = 'OK:Quimera Alianza,Quimera Cristal,Quimera Universitario', v_r);
  v_r := pg_temp.scalar_as_user(v_m1, $q$select (array_agg(name order by name))[1] || '/' || max(total) from public.search_catalog_teams('quimer', null, null, null, 2, 0)$q$);
  perform pg_temp.rec('BUS8 paginación: página de 2 con total 6', v_r = 'OK:Quimera Alianza/6', v_r);
  v_r := pg_temp.scalar_as_user(v_m1, $q$select count(*) from public.search_catalog_teams('quimer', null, null, null, 2, 4)$q$);
  perform pg_temp.rec('BUS9 última página con 2 filas', v_r = 'OK:2', v_r);
  v_r := pg_temp.scalar_as_user(v_m1, $q$select count(*) from public.search_catalog_teams('', null, null, null, 100000, 0)$q$);
  perform pg_temp.rec('BUS10 el tamaño de página está acotado (≤ 50)', v_r like 'OK:%' and substr(v_r, 4)::int <= 50, v_r);
  v_r := pg_temp.scalar_as_user(v_m1, $q$select count(*) from public.search_catalog_teams('%_;--')$q$);
  perform pg_temp.rec('BUS11 caracteres especiales no rompen ni inyectan', pg_temp.is_ok(v_r), v_r);
  v_r := pg_temp.scalar_as_user(v_m1, $q$select string_agg(name, ',' order by name) from public.search_catalog_competitions('primera division quimera')$q$);
  perform pg_temp.rec('BUS12 competiciones por alias', v_r = 'OK:Liga Quimera', v_r);
  v_r := pg_temp.scalar_as_user(v_m1, $q$select count(*) from public.search_catalog_competitions('quimera', null, 'continental')$q$);
  perform pg_temp.rec('BUS13 filtro por alcance continental', v_r = 'OK:1', v_r);
  v_r := pg_temp.scalar_as_user(v_m1, $q$select team_count::text from public.search_catalog_competitions('liga quimera')$q$);
  perform pg_temp.rec('BUS14 la competición informa su número de equipos', v_r = 'OK:3', v_r);
  v_r := pg_temp.as_role('anon', $q$select count(*) from public.search_catalog_teams('quimeria')$q$);
  perform pg_temp.rec('BUS15 anon no busca en el catálogo', pg_temp.is_err(v_r, '42501'), v_r);

  -- ---- Importación de equipos al torneo -------------------------------------------------------------------------------------
  select array_agg(id order by name) into v_ids from public.catalog_teams where provider = 'test_src' and kind = 'club' and country_code = 'QP';
  v_r := pg_temp.as_user(v_m1, format($q$select public.import_catalog_teams(%L, %L::uuid[])$q$, v_tour1, v_ids));
  perform pg_temp.rec('TEAM1 un miembro no importa equipos', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_o2, format($q$select public.import_catalog_teams(%L, %L::uuid[])$q$, v_tour1, v_ids));
  perform pg_temp.rec('TEAM2 el admin de otro tenant no importa en un torneo ajeno', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$select public.import_catalog_teams(%L, '{}'::uuid[])$q$, v_tour1));
  perform pg_temp.rec('TEAM3 lista vacía rechazada', pg_temp.is_err(v_r, '22023'), v_r);
  insert into public.teams(tenant_id, name) values (v_t1, 'quimera alianza') returning id into v_team;
  v_c := (substr(pg_temp.scalar_as_user(v_a1, format($q$select public.import_catalog_teams(%L, %L::uuid[])::text$q$, v_tour1, v_ids)), 4))::jsonb;
  perform pg_temp.rec('TEAM4 el admin inscribe 3 clubes del catálogo', (v_c->>'enrolled')::int = 3, v_c::text);
  select count(*) into v_n from public.teams where tenant_id = v_t1 and lower(name) = 'quimera alianza';
  perform pg_temp.rec('TEAM5 un equipo manual homónimo se reutiliza (sin duplicar)', v_n = 1, v_n::text);
  perform pg_temp.rec('TEAM5b y queda vinculado al catálogo', exists (select 1 from public.external_refs where tenant_id = v_t1 and entity_id = v_team and provider = 'test_src'), '');
  v_c := (substr(pg_temp.scalar_as_user(v_a1, format($q$select public.import_catalog_teams(%L, %L::uuid[])::text$q$, v_tour1, v_ids)), 4))::jsonb;
  perform pg_temp.rec('TEAM6 repetir es idempotente (0 nuevos, 3 ya inscritos)', (v_c->>'enrolled')::int = 0 and (v_c->>'already_enrolled')::int = 3, v_c::text);
  select count(*) into v_n from public.tournament_teams where tournament_id = v_tour1;
  perform pg_temp.rec('TEAM7 3 equipos inscritos en total', v_n = 3, v_n::text);
  select array_agg(id) into v_ids from public.catalog_teams where provider = 'test_src' and kind = 'national';
  v_c := (substr(pg_temp.scalar_as_user(v_a1, format($q$select public.import_catalog_teams(%L, %L::uuid[])::text$q$, v_tour1, v_ids)), 4))::jsonb;
  perform pg_temp.rec('TEAM8 selecciones nacionales: tipo y país (incluye subdivisión GB-ENG)',
    (select kind || country_code from public.teams where tenant_id = v_t1 and name = 'Quimería Norte') = 'nationalGB-ENG', v_c::text);
  v_c := (substr(pg_temp.scalar_as_user(v_o2, format($q$select public.import_catalog_teams(%L, %L::uuid[])::text$q$, v_tour2, v_ids)), 4))::jsonb;
  select count(*) into v_n from public.teams t1 join public.teams t2 on t2.name = t1.name and t2.tenant_id <> t1.tenant_id where t1.tenant_id = v_t1 and t1.name = 'Quimería Norte';
  perform pg_temp.rec('TEAM9 el mismo catálogo da copias independientes por tenant (ids distintos)', v_n = 1 and (select count(distinct id) from public.teams where name = 'Quimería Norte') = 2, v_n::text);
  v_r := pg_temp.scalar_as_user(v_o2, format($q$select count(*) from public.teams where tenant_id = %L$q$, v_t1));
  perform pg_temp.rec('TEAM10 los equipos del tenant 1 no son visibles al tenant 2 (RLS)', v_r = 'OK:0', v_r);
  select array_agg(id) into v_ids from (select id from public.catalog_teams limit 1) x;
  v_r := pg_temp.as_user(v_a1, format($q$select public.import_catalog_teams(%L, (select array_agg(gen_random_uuid()) from generate_series(1, 61)))$q$, v_tour1));
  perform pg_temp.rec('TEAM11 más de 60 equipos por solicitud rechazado', pg_temp.is_err(v_r, '22023'), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$select public.upsert_round(%L, null, 'Fecha 1', 1)$q$, v_tour1));
  perform pg_temp.rec('TEAM12 tras importar, el organizador crea jornadas con los RPC existentes', pg_temp.is_ok(v_r), v_r);

  -- ---- Resultados híbridos: interruptor Premium apagado --------------------------------------------------------------------
  v_r := pg_temp.as_user(v_a1, format($q$select public.set_tournament_results_mode(%L, 'automatic')$q$, v_tour1));
  perform pg_temp.rec('MODE1 con el interruptor apagado el modo automático se rechaza aunque el plan sea pro', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$select public.set_tournament_results_mode(%L, 'manual')$q$, v_tour1));
  perform pg_temp.rec('MODE2 el modo manual siempre está disponible', pg_temp.is_ok(v_r), v_r);
  v_r := pg_temp.as_user(v_m1, format($q$select public.set_tournament_results_mode(%L, 'manual')$q$, v_tour1));
  perform pg_temp.rec('MODE3 un miembro no cambia el modo', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_o2, format($q$select public.set_tournament_results_mode(%L, 'manual')$q$, v_tour1));
  perform pg_temp.rec('MODE4 el admin de otro tenant no cambia el modo', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$select public.set_tournament_results_mode(%L, 'turbo')$q$, v_tour1));
  perform pg_temp.rec('MODE5 modo inválido rechazado', pg_temp.is_err(v_r, '22023'), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$update public.tournaments set results_mode = 'automatic' where id = %L$q$, v_tour1));
  perform pg_temp.rec('MODE6 no hay UPDATE directo que sortee el control', pg_temp.is_err(v_r, '42501'), v_r);
  perform pg_temp.rec('MODE7 tenant_can_use_auto_results = false con el interruptor apagado', pg_temp.scalar_as_user(v_a1, format($q$select public.tenant_can_use_auto_results(%L)$q$, v_t1)) = 'OK:false', '');
  update public.platform_feature_flags set enabled = true where key = 'auto_results';
  v_r := pg_temp.as_user(v_o3, format($q$select public.set_tournament_results_mode(%L, 'automatic')$q$, v_tour3));
  perform pg_temp.rec('MODE8 con el interruptor encendido, un tenant FREE sigue sin acceso', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_a1, format($q$select public.set_tournament_results_mode(%L, 'automatic')$q$, v_tour1));
  perform pg_temp.rec('MODE9 interruptor encendido + plan pro → automático permitido', pg_temp.is_ok(v_r), v_r);
  perform pg_temp.rec('MODE9b el modo queda guardado y auditado', (select results_mode from public.tournaments where id = v_tour1) = 'automatic'
    and exists (select 1 from public.audit_log where tenant_id = v_t1 and entity_type = 'tournaments' and entity_id = v_tour1), '');
  perform pg_temp.rec('MODE10 tenant_can_use_auto_results = true solo para miembros del tenant habilitado', pg_temp.scalar_as_user(v_m1, format($q$select public.tenant_can_use_auto_results(%L)$q$, v_t1)) = 'OK:true'
    and pg_temp.scalar_as_user(v_o2, format($q$select public.tenant_can_use_auto_results(%L)$q$, v_t1)) = 'OK:false', '');

  -- ---- Propagación: solo automático + vinculado; política de conflicto con resultados manuales -------------------------------
  insert into public.catalog_seasons(competition_id, year) select id, 2099 from public.catalog_competitions where external_id = 'C1' and provider = 'test_src' returning id into v_season2;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  perform public.catalog_upsert_fixtures(v_season2, 'test_src', jsonb_build_array(
    jsonb_build_object('external_id', 'F1', 'round', 'Ronda 1', 'home', jsonb_build_object('external_id', 'T1', 'name', 'Sporting Cristal'), 'away', jsonb_build_object('external_id', 'T2', 'name', 'Alianza Lima'),
      'starts_at', to_char(clock_timestamp() - interval '4 hours', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'), 'provider_status', 'FT', 'state', 'final', 'home_goals', 2, 'away_goals', 1)));
  select id into v_fix from public.catalog_fixtures where provider = 'test_src' and external_id = 'F1';
  perform set_config('request.jwt.claims', '', false);
  v_round := substr(pg_temp.scalar_as_user(v_a1, format($q$select (public.upsert_round(%L, null, 'Ronda x', 2)).id$q$, v_tour1)), 4)::uuid;
  v_match := substr(pg_temp.scalar_as_user(v_a1, format($q$select (public.upsert_match(%L, null, %L,
      (select entity_id from public.external_refs where tenant_id = %L and external_id = 'T1' and provider = 'test_src'),
      (select entity_id from public.external_refs where tenant_id = %L and external_id = 'T2' and provider = 'test_src'), clock_timestamp() - interval '4 hours')).id$q$, v_tour1, v_round, v_t1, v_t1)), 4)::uuid;
  perform pg_temp.rec('AUTO0 partido manual creado con equipos importados (sin vínculo de proveedor)', v_match is not null, coalesce(v_match::text, ''));
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  v_c := public.catalog_propagate_fixtures(array[v_fix]);
  perform pg_temp.rec('AUTO1 un partido SIN external_ref no recibe resultado del proveedor (se administra a mano)', not exists (select 1 from public.official_results where match_id = v_match) and (v_c->>'matches')::int = 0, v_c::text);
  insert into public.external_refs(tenant_id, provider, entity_type, entity_id, external_id) values (v_t1, 'test_src', 'match', v_match, 'F1');
  update public.platform_feature_flags set enabled = false where key = 'auto_results';
  v_c := public.catalog_propagate_fixtures(array[v_fix]);
  perform pg_temp.rec('AUTO2 con el interruptor apagado la propagación se omite (Premium deshabilitado)', not exists (select 1 from public.official_results where match_id = v_match) and (v_c->>'skipped_not_automatic')::int = 1, v_c::text);
  update public.platform_feature_flags set enabled = true where key = 'auto_results';
  update public.tenant_entitlements set plan_code = 'free' where tenant_id = v_t1;
  v_c := public.catalog_propagate_fixtures(array[v_fix]);
  perform pg_temp.rec('AUTO3 si el tenant baja a free la automatización se detiene', not exists (select 1 from public.official_results where match_id = v_match) and (v_c->>'skipped_not_automatic')::int = 1, v_c::text);
  update public.tenant_entitlements set plan_code = 'pro' where tenant_id = v_t1;
  update public.tournaments set results_mode = 'manual' where id = v_tour1;
  v_c := public.catalog_propagate_fixtures(array[v_fix]);
  perform pg_temp.rec('AUTO4 un torneo en modo manual no recibe resultados automáticos', not exists (select 1 from public.official_results where match_id = v_match) and (v_c->>'skipped_not_automatic')::int = 1, v_c::text);
  update public.tournaments set results_mode = 'automatic' where id = v_tour1;
  v_c := public.catalog_propagate_fixtures(array[v_fix]);
  perform pg_temp.rec('AUTO5 modo automático + Premium + vínculo: el resultado del proveedor se aplica', (v_c->>'results')::int = 1
    and (select home_score from public.official_results where match_id = v_match) = 2 and (select source from public.official_results where match_id = v_match) = 'provider', v_c::text);
  perform set_config('request.jwt.claims', '', false);

  -- el organizador corrige a mano: pasa a manual; el proveedor ya no lo pisa
  v_r := pg_temp.as_user(v_a1, format($q$select public.publish_official_result(%L, 3, 1, 1)$q$, v_match));
  perform pg_temp.rec('MAN1 el organizador corrige el marcador (revisión esperada 1)', pg_temp.is_ok(v_r), v_r);
  perform pg_temp.rec('MAN2 la corrección es manual, revisión 2, con autor', (select source from public.official_results where match_id = v_match) = 'manual'
    and (select revision from public.official_results where match_id = v_match) = 2 and (select published_by from public.official_results where match_id = v_match) = v_a1, '');
  v_r := pg_temp.as_user(v_a1, format($q$select public.publish_official_result(%L, 3, 1, 1)$q$, v_match));
  perform pg_temp.rec('MAN3 revisión esperada obsoleta → conflicto 409 (sin pisar)', pg_temp.is_err(v_r, 'PT409'), v_r);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  perform public.catalog_upsert_fixtures(v_season2, 'test_src', jsonb_build_array(
    jsonb_build_object('external_id', 'F1', 'round', 'Ronda 1', 'home', jsonb_build_object('external_id', 'T1', 'name', 'Sporting Cristal'), 'away', jsonb_build_object('external_id', 'T2', 'name', 'Alianza Lima'),
      'starts_at', to_char(clock_timestamp() - interval '4 hours', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'), 'provider_status', 'FT', 'state', 'final', 'home_goals', 0, 'away_goals', 0)));
  v_c := public.catalog_propagate_fixtures(array[v_fix]);
  perform pg_temp.rec('MAN4 un dato distinto del proveedor NO sobrescribe lo manual: se cuenta el conflicto', (v_c->>'conflicts')::int = 1
    and (select home_score from public.official_results where match_id = v_match) = 3 and (select revision from public.official_results where match_id = v_match) = 2, v_c::text);
  perform pg_temp.rec('MAN5 el conflicto queda registrado para el organizador', (select count(*) from public.fixture_sync_log where match_id = v_match and kind = 'conflict_manual_result') = 1, '');
  perform set_config('request.jwt.claims', '', false);
  v_r := pg_temp.scalar_as_user(v_a1, format($q$select count(*) from public.fixture_sync_log where match_id = %L$q$, v_match));
  perform pg_temp.rec('MAN6 el organizador (admin) ve la bitácora de su partido', v_r like 'OK:%' and substr(v_r, 4)::int >= 2, v_r);

  -- ---- Endurecimiento tras la revisión de seguridad ------------------------------------------------------------------------
  v_ids := array(select entity_id from public.external_refs where tenant_id = v_t1 and provider = 'test_src' and entity_type = 'team' and external_id in ('T1', 'T2') order by external_id);
  -- (a) un estado final del proveedor ANTES de la hora de inicio se ignora (dato imposible)
  v_m2 := substr(pg_temp.scalar_as_user(v_a1, format($q$select (public.upsert_match(%L, null, %L, %L, %L, clock_timestamp() + interval '2 days')).id$q$, v_tour1, v_round, v_ids[1], v_ids[2])), 4)::uuid;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  perform public.catalog_upsert_fixtures(v_season2, 'test_src', jsonb_build_array(
    jsonb_build_object('external_id', 'F2', 'round', 'Ronda 2', 'home', jsonb_build_object('external_id', 'T1', 'name', 'Quimera Cristal'), 'away', jsonb_build_object('external_id', 'T2', 'name', 'Quimera Alianza'),
      'starts_at', to_char(clock_timestamp() + interval '2 days', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'), 'provider_status', 'FT', 'state', 'final', 'home_goals', 1, 'away_goals', 0)));
  select id into v_fx2 from public.catalog_fixtures where provider = 'test_src' and external_id = 'F2';
  insert into public.external_refs(tenant_id, provider, entity_type, entity_id, external_id) values (v_t1, 'test_src', 'match', v_m2, 'F2');
  v_c := public.catalog_propagate_fixtures(array[v_fx2]);
  perform pg_temp.rec('HARD1 un final del proveedor con inicio futuro NO finaliza ni puntúa el partido', not exists (select 1 from public.official_results where match_id = v_m2)
    and (select status::text from public.matches where id = v_m2) = 'scheduled' and (v_c->>'ignored')::int = 1, v_c::text);
  perform pg_temp.rec('HARD1b queda registrado el motivo', (select detail->>'reason' from public.fixture_sync_log where match_id = v_m2 and kind = 'ignored_regression') = 'premature', '');
  perform set_config('request.jwt.claims', '', false);

  -- (b) confirmar un marcador del proveedor como manual queda auditado y no cambia la revisión
  v_m3 := substr(pg_temp.scalar_as_user(v_a1, format($q$select (public.upsert_match(%L, null, %L, %L, %L, clock_timestamp() - interval '4 hours')).id$q$, v_tour1, v_round, v_ids[2], v_ids[1])), 4)::uuid;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  perform public.catalog_upsert_fixtures(v_season2, 'test_src', jsonb_build_array(
    jsonb_build_object('external_id', 'F3', 'round', 'Ronda 2', 'home', jsonb_build_object('external_id', 'T2', 'name', 'Quimera Alianza'), 'away', jsonb_build_object('external_id', 'T1', 'name', 'Quimera Cristal'),
      'starts_at', to_char(clock_timestamp() - interval '4 hours', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'), 'provider_status', 'FT', 'state', 'final', 'home_goals', 2, 'away_goals', 0)));
  select id into v_fx3 from public.catalog_fixtures where provider = 'test_src' and external_id = 'F3';
  insert into public.external_refs(tenant_id, provider, entity_type, entity_id, external_id) values (v_t1, 'test_src', 'match', v_m3, 'F3');
  v_c := public.catalog_propagate_fixtures(array[v_fx3]);
  perform pg_temp.rec('HARD2 un final legítimo (inicio pasado) sí se aplica como proveedor', (v_c->>'results')::int = 1 and (select source from public.official_results where match_id = v_m3) = 'provider', v_c::text);
  perform set_config('request.jwt.claims', '', false);
  v_r := pg_temp.as_user(v_a1, format($q$select public.publish_official_result(%L, 2, 0, 1)$q$, v_m3));
  perform pg_temp.rec('HARD3 el administrador confirma el marcador del proveedor', pg_temp.is_ok(v_r), v_r);
  perform pg_temp.rec('HARD3b pasa a manual sin nueva revisión', (select source from public.official_results where match_id = v_m3) = 'manual' and (select revision from public.official_results where match_id = v_m3) = 1, '');
  perform pg_temp.rec('HARD3c la confirmación queda en la auditoría', (select count(*) from public.audit_log where tenant_id = v_t1 and action = 'official_results.confirm_manual') = 1, '');

  -- (c) la cola de sondeo solo incluye partidos de torneos automáticos con Premium habilitado
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  update public.catalog_fixtures set last_polled_at = null where provider = 'test_src';
  select count(*) into v_n from public.catalog_fixtures_due('test_src', 100) where external_id in ('F1', 'F3');
  perform pg_temp.rec('HARD4 torneo automático + Premium: sus partidos entran en la cola', v_n >= 1, v_n::text);
  update public.tournaments set results_mode = 'manual' where id = v_tour1;
  select count(*) into v_n from public.catalog_fixtures_due('test_src', 100) where external_id in ('F1', 'F2', 'F3');
  perform pg_temp.rec('HARD5 torneo manual: no consume cuota del proveedor', v_n = 0, v_n::text);
  update public.tournaments set results_mode = 'automatic' where id = v_tour1;
  update public.tenant_entitlements set plan_code = 'free' where tenant_id = v_t1;
  select count(*) into v_n from public.catalog_fixtures_due('test_src', 100) where external_id in ('F1', 'F2', 'F3');
  perform pg_temp.rec('HARD6 tenant gratuito: no consume cuota del proveedor', v_n = 0, v_n::text);
  update public.tenant_entitlements set plan_code = 'pro' where tenant_id = v_t1;
  perform set_config('request.jwt.claims', '', false);

  -- (d) importación con equipos homónimos del catálogo, búsqueda acotada y search_name al renombrar
  insert into public.catalog_teams(provider, external_id, name, kind, country_code) values ('test_src', 'H1', 'Quimera Gemelo', 'club', 'QP'), ('test_src', 'H2', 'Quimera Gemelo', 'club', 'QQ');
  select array_agg(id) into v_ids from public.catalog_teams where provider = 'test_src' and external_id in ('H1', 'H2');
  v_c := (substr(pg_temp.scalar_as_user(v_a1, format($q$select public.import_catalog_teams(%L, %L::uuid[])::text$q$, v_tour1, v_ids)), 4))::jsonb;
  perform pg_temp.rec('HARD7 dos equipos homónimos del catálogo se importan sin abortar', (v_c->>'enrolled')::int = 2
    and (select count(*) from public.teams where tenant_id = v_t1 and name like 'Quimera Gemelo%') = 2, v_c::text);
  v_r := pg_temp.scalar_as_user(v_m1, $q$select count(*) from public.search_catalog_teams(repeat('a', 5000))$q$);
  perform pg_temp.rec('HARD8 una consulta enorme se acota y no falla', pg_temp.is_ok(v_r), v_r);
  update public.catalog_teams set name = 'Quimera Renombrado Fc' where provider = 'test_src' and external_id = 'T3';
  v_r := pg_temp.scalar_as_user(v_m1, $q$select string_agg(name, ',') from public.search_catalog_teams('renombrado')$q$);
  perform pg_temp.rec('HARD9 al renombrar, la búsqueda usa el nombre nuevo', v_r = 'OK:Quimera Renombrado Fc', v_r);
end $$;
