-- CLASE C — SOLO PROYECTO SUPABASE DESCARTABLE (datos sintéticos). Requiere 1/3 aplicada (y 2/3 recomendada).
-- Cubre H1/H2/H8 y la compatibilidad con cambios legítimos de horarios, estados y resultados.
-- Se ejecuta tras anteponer _helpers.sql. IDs aleatorios: se puede repetir sin colisiones.
do $$
declare
  v_tenant uuid; v_owner uuid; v_admin uuid; v_m1 uuid; v_m2 uuid;
  v_tour uuid; v_home uuid; v_away uuid; v_round uuid; v_pool uuid;
  v_ms uuid; v_mo uuid; v_ml uuid; v_pms uuid; v_pmo uuid; v_pml uuid;
  v_p1 uuid; v_p2 uuid;
begin
  v_owner := pg_temp.mk_user('l-owner'); v_admin := pg_temp.mk_user('l-admin');
  v_m1 := pg_temp.mk_user('l-memb1'); v_m2 := pg_temp.mk_user('l-memb2');
  insert into public.tenants(name) values ('L10 tenant') returning id into v_tenant;
  insert into public.tenant_entitlements(tenant_id, plan_code) values (v_tenant, 'pro');
  insert into public.tenant_memberships(tenant_id, profile_id, role) values
    (v_tenant, v_owner, 'owner'), (v_tenant, v_admin, 'admin'), (v_tenant, v_m1, 'member'), (v_tenant, v_m2, 'member');
  insert into public.tournaments(tenant_id, name) values (v_tenant, 'T') returning id into v_tour;
  insert into public.teams(tenant_id, name) values (v_tenant, 'Home') returning id into v_home;
  insert into public.teams(tenant_id, name) values (v_tenant, 'Away') returning id into v_away;
  insert into public.rounds(tenant_id, tournament_id, name, sort_order) values (v_tenant, v_tour, 'R1', 1) returning id into v_round;
  insert into public.pools(tenant_id, name, status, lock_offset) values (v_tenant, 'L10 pool', 'open', interval '15 minutes') returning id into v_pool;
  -- M_soon: arranca en 30 min (lock en +15); M_open: en 2 h; M_locked: parte a +30 min y se adelanta por sync (lock = ahora)
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at)
    values (v_tenant, v_tour, v_round, v_home, v_away, now() + interval '30 minutes') returning id into v_ms;
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at)
    values (v_tenant, v_tour, v_round, v_home, v_away, now() + interval '2 hours') returning id into v_mo;
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at)
    values (v_tenant, v_tour, v_round, v_home, v_away, now() + interval '30 minutes') returning id into v_ml;
  insert into public.pool_matches(tenant_id, pool_id, match_id) values (v_tenant, v_pool, v_ms) returning id into v_pms;
  insert into public.pool_matches(tenant_id, pool_id, match_id) values (v_tenant, v_pool, v_mo) returning id into v_pmo;
  insert into public.pool_matches(tenant_id, pool_id, match_id) values (v_tenant, v_pool, v_ml) returning id into v_pml;
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status)
    values (v_tenant, v_pool, v_m1, 'approved', 'paid') returning id into v_p1;
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status)
    values (v_tenant, v_pool, v_m2, 'approved', 'paid') returning id into v_p2;
  insert into public.predictions(tenant_id, pool_id, pool_match_id, participant_id, home_score, away_score) values
    (v_tenant, v_pool, v_pms, v_p1, 2, 1), (v_tenant, v_pool, v_pml, v_p1, 0, 0);
  -- el sincronizador legítimo adelanta M_locked: queda bloqueado AHORA (con su pronóstico ya registrado antes del lock)
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform public.apply_fixture_update(v_ml, now() + interval '5 minutes', null);
  insert into fx(k, v) values ('tenant', v_tenant), ('owner', v_owner), ('admin', v_admin), ('m1', v_m1), ('m2', v_m2),
    ('pool', v_pool), ('ms', v_ms), ('mo', v_mo), ('ml', v_ml), ('pms', v_pms), ('pmo', v_pmo), ('pml', v_pml), ('p1', v_p1), ('p2', v_p2),
    ('tour', v_tour), ('home', v_home), ('away', v_away), ('round', v_round);
end $$;

-- L00 fixture coherente: lock_at persistido = starts_at - offset (15 min)
select pg_temp.rec('L00 lock_at inicial = starts_at - offset (M_soon y M_open)',
  (select bool_and(pm.lock_at = m.starts_at - interval '15 minutes')
     from public.pool_matches pm join public.matches m on m.id = pm.match_id where pm.id in (pg_temp.f('pms'), pg_temp.f('pmo'))),
  'dos pool_matches abiertos');
select pg_temp.rec('L00b M_locked quedó bloqueado por el sincronizador', (select lock_at <= clock_timestamp() from public.pool_matches where id = pg_temp.f('pml')), '');

do $$
declare r text; v_locked_before timestamptz; v_off interval; v_n text;
begin
  select lock_at into v_locked_before from public.pool_matches where id = pg_temp.f('pml');

  -- L01 subir el offset para bloquear/revelar de inmediato (M_soon quedaría con lock en el pasado) → rechazo
  r := pg_temp.as_user(pg_temp.f('admin'), format($q$select public.manage_pool('update', %L, null, 'L10 pool', 60, false)$q$, pg_temp.f('pool')));
  perform pg_temp.rec('L01 subir offset que bloquearía/revelaría ya → 42501', pg_temp.is_err(r, '42501'), r);
  select lock_offset into v_off from public.pools where id = pg_temp.f('pool');
  perform pg_temp.rec('L01b el offset no cambió tras el rechazo', v_off = interval '15 minutes', v_off::text);

  -- L04 un participante no ve pronósticos ajenos antes del lock (M_soon: lock en +15 min)
  v_n := pg_temp.scalar_as_user(pg_temp.f('m2'), format($q$select count(*) from public.predictions where pool_match_id = %L$q$, pg_temp.f('pms')));
  perform pg_temp.rec('L04 pronóstico ajeno oculto antes del lock', v_n = 'OK:0', v_n);

  -- L02 cambio legítimo: bajar el offset (15→5) mueve solo los locks abiertos; el alcanzado queda intacto
  r := pg_temp.as_user(pg_temp.f('admin'), format($q$select public.manage_pool('update', %L, null, 'L10 pool', 5, false)$q$, pg_temp.f('pool')));
  perform pg_temp.rec('L02 bajar offset legítimo permitido', pg_temp.is_ok(r), r);
  perform pg_temp.rec('L02b locks abiertos recalculados (start - 5 min)',
    (select bool_and(pm.lock_at = m.starts_at - interval '5 minutes') from public.pool_matches pm join public.matches m on m.id = pm.match_id
      where pm.pool_id = pg_temp.f('pool') and pm.id in (pg_temp.f('pms'), pg_temp.f('pmo'))), '');
  perform pg_temp.rec('L02c lock alcanzado intacto (no se reabre)',
    (select lock_at = v_locked_before from public.pool_matches where id = pg_temp.f('pml')), '');

  -- L03 el patrón «subir, leer, bajar y editar» ya no existe: volver a subir tras bajar sigue rechazado
  r := pg_temp.as_user(pg_temp.f('admin'), format($q$select public.manage_pool('update', %L, null, 'L10 pool', 60, false)$q$, pg_temp.f('pool')));
  perform pg_temp.rec('L03 re-subir offset rechazado (sin revelación forzada)', pg_temp.is_err(r, '42501'), r);

  -- L05 el cliente no puede reprogramar; el feed service_role sí y NO reabre el lock.
  r := pg_temp.as_user(pg_temp.f('admin'), format($q$update public.matches set starts_at = now() + interval '1 day' where id = %L$q$, pg_temp.f('ml')));
  perform pg_temp.rec('L05 cliente no reprograma partido bloqueado', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('service_role', format($q$select public.apply_fixture_update(%L, now() + interval '1 day', null)$q$, pg_temp.f('ml')));
  perform pg_temp.rec('L05a feed aplaza partido bloqueado', pg_temp.is_ok(r), r);
  perform pg_temp.rec('L05b su lock_at no cambió', (select lock_at = v_locked_before from public.pool_matches where id = pg_temp.f('pml')), '');
  r := pg_temp.as_user(pg_temp.f('m2'), format($q$select public.save_prediction(%L, %L, 9, 9)$q$, pg_temp.f('pool'), pg_temp.f('ml')));
  perform pg_temp.rec('L05c save_prediction sigue rechazado tras posponer', pg_temp.is_err(r, '42501'), r);

  -- L06 el cliente no cambia estado; el feed conserva la transición monótona.
  r := pg_temp.as_user(pg_temp.f('admin'), format($q$update public.matches set status = 'live' where id = %L$q$, pg_temp.f('ml')));
  perform pg_temp.rec('L06 cliente no cambia estado', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('service_role', format($q$select public.apply_fixture_update(%L, null, 'live')$q$, pg_temp.f('ml')));
  perform pg_temp.rec('L06a feed scheduled→live permitido', pg_temp.is_ok(r), r);
  r := pg_temp.as_role('service_role', format($q$select public.apply_fixture_update(%L, null, 'scheduled')$q$, pg_temp.f('ml')));
  perform pg_temp.rec('L06b feed live→scheduled rechazado', pg_temp.is_err(r, '42501'), r);

  -- L07 adelantar un partido abierto de modo que el lock quede en el pasado: rechazo para el admin
  r := pg_temp.as_user(pg_temp.f('admin'), format($q$update public.matches set starts_at = now() + interval '3 minutes' where id = %L$q$, pg_temp.f('mo')));
  perform pg_temp.rec('L07 adelantar horario que bloquearía ya → 42501', pg_temp.is_err(r, '42501'), r);
  -- L07b …pero el sincronizador legítimo (service_role) lo adelanta y bloquea AHORA, sin revelar antes
  r := pg_temp.as_role('service_role', format($q$select public.apply_fixture_update(%L, now() + interval '3 minutes', null)$q$, pg_temp.f('mo')));
  perform pg_temp.rec('L07b apply_fixture_update por service_role permitido', pg_temp.is_ok(r), r);
  perform pg_temp.rec('L07c el lock quedó en ≤ ahora', (select lock_at <= clock_timestamp() from public.pool_matches where id = pg_temp.f('pmo')), '');
  r := pg_temp.as_role('authenticated', format($q$select public.apply_fixture_update(%L, now() + interval '1 hour', null)$q$, pg_temp.f('mo')));
  perform pg_temp.rec('L07d apply_fixture_update no ejecutable por authenticated', pg_temp.is_err(r, '42501'), r);

  -- L08 pasar a live bloquea los pools que lo usan
  update public.matches set status = 'live' where id = pg_temp.f('ms');
  perform pg_temp.rec('L08 live fuerza lock_at ≤ ahora', (select lock_at <= clock_timestamp() from public.pool_matches where id = pg_temp.f('pms')), '');
end $$;

do $$
declare r text; v_n text;
begin
  -- L09/L10 borrados destructivos
  r := pg_temp.as_user(pg_temp.f('admin'), format($q$delete from public.pool_matches where id = %L$q$, pg_temp.f('pms')));
  perform pg_temp.rec('L09 admin no borra pool_match con predicciones', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('postgres', format($q$delete from public.pool_matches where id = %L$q$, pg_temp.f('pms')));
  perform pg_temp.rec('L09b ni siquiera el propietario de la tabla', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_user(pg_temp.f('admin'), format($q$delete from public.matches where id = %L$q$, pg_temp.f('ms')));
  perform pg_temp.rec('L10 no se borra un partido usado por una quiniela', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('postgres', format($q$delete from public.participants where id = %L$q$, pg_temp.f('p1')));
  perform pg_temp.rec('L10b no se borra un participante con predicciones', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('service_role', format($q$delete from public.predictions where participant_id = %L$q$, pg_temp.f('p1')));
  perform pg_temp.rec('L10c service_role no borra predicciones', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('postgres', format($q$delete from public.pools where id = %L$q$, pg_temp.f('pool')));
  perform pg_temp.rec('L10d no se borra una quiniela abierta', pg_temp.is_err(r, '42501'), r);
  v_n := (select count(*)::text from public.predictions where pool_id = pg_temp.f('pool'));
  perform pg_temp.rec('L10e las predicciones siguen intactas (2)', v_n = '2', v_n);

  -- L11 resultados oficiales: no se borran (se revisan)
  insert into public.official_results(tenant_id, match_id, home_score, away_score, published_by)
    values (pg_temp.f('tenant'), pg_temp.f('ml'), 1, 0, pg_temp.f('owner'));
  r := pg_temp.as_role('postgres', format($q$delete from public.official_results where match_id = %L$q$, pg_temp.f('ml')));
  perform pg_temp.rec('L11 official_results no se borra', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('postgres', format($q$update public.official_results set home_score = 2, revision = 2 where match_id = %L$q$, pg_temp.f('ml')));
  perform pg_temp.rec('L11b la revisión de un resultado (marcador + revision+1) sigue permitida', pg_temp.is_ok(r), r);
  r := pg_temp.as_role('postgres', format($q$update public.official_results set home_score = 9 where match_id = %L$q$, pg_temp.f('ml')));
  perform pg_temp.rec('L11c cambiar el marcador sin subir revision → 42501', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('postgres', format($q$update public.official_results set match_id = %L where match_id = %L$q$, pg_temp.f('mo'), pg_temp.f('ml')));
  perform pg_temp.rec('L11d la identidad de un resultado es inmutable', pg_temp.is_err(r, '42501'), r);

  -- L12 lock_at no es editable por clientes
  r := pg_temp.as_user(pg_temp.f('admin'), format($q$update public.pool_matches set lock_at = now() + interval '10 days' where id = %L$q$, pg_temp.f('pml')));
  perform pg_temp.rec('L12 UPDATE directo de lock_at → 42501', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_user(pg_temp.f('admin'), format($q$select set_config('sl.fixture_sync', 'on', true); update public.matches set starts_at = now() + interval '10 days' where id = %L$q$, pg_temp.f('ml')));
  perform pg_temp.rec('L12a GUC sl.* no habilita DML de calendario', pg_temp.is_err(r, '42501'), r);

  -- L13 identidad inmutable
  r := pg_temp.as_role('postgres', format($q$update public.pools set tenant_id = %L where id = %L$q$, gen_random_uuid(), pg_temp.f('pool')));
  perform pg_temp.rec('L13 tenant de una quiniela inmutable', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('postgres', format($q$update public.matches set round_id = %L where id = %L$q$, gen_random_uuid(), pg_temp.f('ml')));
  perform pg_temp.rec('L13b round de un partido usado inmutable', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('postgres', format($q$update public.predictions set home_score = 7 where participant_id = %L and pool_match_id = %L$q$, pg_temp.f('p1'), pg_temp.f('pml')));
  perform pg_temp.rec('L13c predicción bloqueada inmutable incluso para postgres', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('postgres', format($q$insert into public.predictions(tenant_id, pool_id, pool_match_id, participant_id, home_score, away_score) values (%L, %L, %L, %L, 4, 4)$q$,
        pg_temp.f('tenant'), pg_temp.f('pool'), pg_temp.f('pml'), pg_temp.f('p2')));
  perform pg_temp.rec('L13d crear un pronóstico DESPUÉS del lock (SQL directo/propietario) → 42501', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('service_role', format($q$insert into public.predictions(tenant_id, pool_id, pool_match_id, participant_id, home_score, away_score) values (%L, %L, %L, %L, 4, 4)$q$,
        pg_temp.f('tenant'), pg_temp.f('pool'), pg_temp.f('pml'), pg_temp.f('p2')));
  perform pg_temp.rec('L13e ni siquiera service_role puede crearlo', pg_temp.is_err(r, '42501'), r);
end $$;

do $$
declare v_pool2 uuid; v_open timestamptz; r text;
begin
  -- L14 opened_at: no falsificable, inmutable, fijado al abrir
  insert into public.pools(tenant_id, name, status, opened_at) values (pg_temp.f('tenant'), 'L10 draft', 'draft', '2000-01-01') returning id into v_pool2;
  perform pg_temp.rec('L14 opened_at ignorado en borrador', (select opened_at is null from public.pools where id = v_pool2), '');
  update public.pools set status = 'open' where id = v_pool2;
  select opened_at into v_open from public.pools where id = v_pool2;
  perform pg_temp.rec('L14b opened_at fijado al abrir (reloj del servidor)', v_open is not null and v_open > now() - interval '1 minute', v_open::text);
  r := pg_temp.as_role('postgres', format($q$update public.pools set opened_at = '2000-01-01' where id = %L$q$, v_pool2));
  perform pg_temp.rec('L14c opened_at inmutable', pg_temp.is_err(r, '42501'), r);

  -- L15 pronóstico legítimo antes del lock; tras el lock, rechazo
  r := pg_temp.as_user(pg_temp.f('m2'), format($q$select public.save_prediction(%L, %L, 1, 0)$q$, pg_temp.f('pool'), pg_temp.f('mo')));
  perform pg_temp.rec('L15 save_prediction sobre partido ya bloqueado por sync → 42501', pg_temp.is_err(r, '42501'), r);
end $$;

do $$
declare v_n text; v_tenant uuid := pg_temp.f('tenant'); v_pool uuid := pg_temp.f('pool'); v_m3 uuid; v_mnew uuid; v_pmnew uuid; r text;
begin
  -- L16 un partido NUEVO a 2 h es editable hasta su lock: flujo legítimo completo
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at)
    values (v_tenant, pg_temp.f('tour'), pg_temp.f('round'), pg_temp.f('home'), pg_temp.f('away'), now() + interval '2 hours') returning id into v_mnew;
  insert into public.pool_matches(tenant_id, pool_id, match_id) values (v_tenant, v_pool, v_mnew) returning id into v_pmnew;
  r := pg_temp.as_user(pg_temp.f('m2'), format($q$select public.save_prediction(%L, %L, 3, 1)$q$, v_pool, v_mnew));
  perform pg_temp.rec('L16 pronóstico antes del lock permitido', pg_temp.is_ok(r), r);
  r := pg_temp.as_user(pg_temp.f('m2'), format($q$select public.save_prediction(%L, %L, 3, 2)$q$, v_pool, v_mnew));
  perform pg_temp.rec('L16b edición antes del lock permitida (upsert)', pg_temp.is_ok(r), r);
  r := pg_temp.as_user(pg_temp.f('admin'), format($q$update public.matches set starts_at = now() + interval '4 hours' where id = %L$q$, v_mnew));
  perform pg_temp.rec('L16c el organizador no reprograma por DML directo', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('service_role', format($q$select public.apply_fixture_update(%L, now() + interval '4 hours', null)$q$, v_mnew));
  perform pg_temp.rec('L16c2 feed reprograma partido abierto', pg_temp.is_ok(r), r);
  perform pg_temp.rec('L16d el lock siguió al horario', (select pm.lock_at = m.starts_at - (select lock_offset from public.pools where id = v_pool)
     from public.pool_matches pm join public.matches m on m.id = pm.match_id where pm.id = v_pmnew), '');
  -- finalización legítima: live → final, y revisión del resultado
  update public.matches set status = 'live' where id = v_mnew;
  update public.matches set status = 'final' where id = v_mnew;
  perform pg_temp.rec('L16e live→final permitido', (select status = 'final' from public.matches where id = v_mnew), '');
  -- L17 reveal tras el lock: m2 ve el pronóstico de m1 en el partido bloqueado (ml)
  v_n := pg_temp.scalar_as_user(pg_temp.f('m2'), format($q$select count(*) from public.predictions where pool_match_id = %L and participant_id = %L$q$, pg_temp.f('pml'), pg_temp.f('p1')));
  perform pg_temp.rec('L17 pronóstico ajeno visible tras el lock', v_n = 'OK:1', v_n);
  -- L18 invariantes globales
  perform pg_temp.rec('L18 ningún lock_at posterior a starts_at',
    not exists (select 1 from public.pool_matches pm join public.matches m on m.id = pm.match_id where pm.pool_id = v_pool and pm.lock_at > m.starts_at + interval '1 minute'), '');
end $$;

select * from t_results order by id;
