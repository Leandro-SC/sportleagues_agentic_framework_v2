-- CLASE B (transaccional reversible) — ADR-017 «Crear mi propia quiniela». Datos sintéticos; sin DML permanente.
-- Ejecutar SOLO con el ejecutor (rollback garantizado):
--   node scripts/qa/run-sql-suite.mjs supabase/tests/pool-creation-requests.sql --with-migration supabase/proposed/20261020000100_pool_creation_requests.sql
-- Requiere las migraciones 20260908…20261019 aplicadas. Se antepone supabase/tests/proposed/_helpers.sql.

create or replace function pg_temp.rid(p_user uuid) returns uuid language sql
as $$ select id from public.pool_creation_requests where requester_id = p_user order by requested_at desc, created_at desc limit 1 $$;

do $$
declare
  v_ta uuid; v_oa uuid; v_aa uuid; v_ma uuid; v_pa uuid; v_plat uuid; v_xo uuid;
  v_tb uuid;
begin
  v_oa := pg_temp.mk_user('pcr-owner-a'); v_aa := pg_temp.mk_user('pcr-admin-a'); v_ma := pg_temp.mk_user('pcr-member-a');
  v_plat := pg_temp.mk_user('pcr-platform'); v_xo := pg_temp.mk_user('pcr-owner-x');
  insert into public.tenants(name) values ('PCR A') returning id into v_ta;
  insert into public.tenants(name) values ('PCR X') returning id into v_tb;
  insert into public.tenant_entitlements(tenant_id, plan_code) values (v_ta, 'pro'), (v_tb, 'pro');
  insert into public.tenant_memberships(tenant_id, profile_id, role) values (v_ta, v_oa, 'owner'), (v_ta, v_aa, 'admin'), (v_ta, v_ma, 'member'), (v_tb, v_xo, 'owner');
  insert into public.pools(tenant_id, name, status, lock_offset) values (v_ta, 'PCR A pool', 'open', interval '10 minutes') returning id into v_pa;
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_ta, v_pa, v_ma, 'approved', 'invited');
  insert into public.platform_admins(user_id, note) values (v_plat, 'pcr test');
  insert into fx(k, v) values ('ta', v_ta), ('tb', v_tb), ('oa', v_oa), ('aa', v_aa), ('ma', v_ma), ('pa', v_pa), ('plat', v_plat), ('xo', v_xo);
  -- solicitantes sintéticos (sin membresías)
  insert into fx(k, v) select k, pg_temp.mk_user('pcr-' || k) from unnest(array['u1','u2','u3','u4','u5','u6','u7','u9','u10','uconc','urej','udef','ulate','uappr','unam','ubad']) k;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- A. Estructura, ACL y RLS
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare p text; t text; r text;
begin
  perform pg_temp.rec('A01 RLS activa en pool_creation_requests y en eventos',
    (select bool_and(relrowsecurity) from pg_class where oid in ('public.pool_creation_requests'::regclass, 'public.pool_creation_request_events'::regclass)), '');
  foreach t in array array['public.pool_creation_requests', 'public.pool_creation_request_events'] loop
    foreach p in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      perform pg_temp.rec('A02 ' || t || ' sin ' || p || ' para anon/authenticated',
        not has_table_privilege('anon', t, p) and not has_table_privilege('authenticated', t, p), '');
    end loop;
  end loop;
  perform pg_temp.rec('A03 authenticated solo SELECT en pool_creation_requests; anon nada',
    has_table_privilege('authenticated', 'public.pool_creation_requests', 'SELECT') and not has_table_privilege('anon', 'public.pool_creation_requests', 'SELECT'), '');
  perform pg_temp.rec('A04 los eventos de auditoría no se leen desde clientes',
    not has_table_privilege('authenticated', 'public.pool_creation_request_events', 'SELECT') and not has_table_privilege('anon', 'public.pool_creation_request_events', 'SELECT'), '');
  foreach p in array array['public.request_pool_creation(text)', 'public.my_pool_creation_request()', 'public.cancel_pool_creation_request()'] loop
    perform pg_temp.rec('A05 ACL ' || p || ': authenticated sí, anon/PUBLIC no',
      has_function_privilege('authenticated', p, 'execute') and not has_function_privilege('anon', p, 'execute')
      and not exists (select 1 from pg_proc x, aclexplode(x.proacl) a where x.oid = p::regprocedure and a.grantee = 0), '');
  end loop;
  p := 'public.review_pool_creation_request(uuid,text,text,text)';
  perform pg_temp.rec('A06 review_pool_creation_request: solo service_role (ni authenticated, anon ni PUBLIC)',
    has_function_privilege('service_role', p, 'execute') and not has_function_privilege('authenticated', p, 'execute')
    and not has_function_privilege('anon', p, 'execute') and not exists (select 1 from pg_proc x, aclexplode(x.proacl) a where x.oid = p::regprocedure and a.grantee = 0), '');
  perform pg_temp.rec('A07 funciones internas y de trigger sin EXECUTE para clientes',
    not has_function_privilege('authenticated', 'public._pool_creation_request_json(public.pool_creation_requests,boolean)', 'execute')
    and not has_function_privilege('authenticated', 'public.tg_pool_creation_requests_guard()', 'execute')
    and not has_function_privilege('authenticated', 'public.tg_pool_creation_requests_audit()', 'execute'), '');
  perform pg_temp.rec('A08 todas las funciones security definer con search_path vacío',
    (select bool_and(coalesce(proconfig @> array['search_path=""'], false)) from pg_proc
      where pronamespace = 'public'::regnamespace and proname in ('request_pool_creation', 'my_pool_creation_request', 'cancel_pool_creation_request',
        'review_pool_creation_request', '_pool_creation_request_json', 'tg_pool_creation_requests_guard', 'tg_pool_creation_requests_audit')), '');
  perform pg_temp.rec('A09 índice único parcial de una pending por solicitante',
    exists (select 1 from pg_indexes where indexname = 'pool_creation_requests_one_pending' and indexdef like '%UNIQUE%' and indexdef like '%requester_id%' and indexdef like '%pending%'), '');
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- B. Camino feliz, idempotencia, cancelar y re-solicitar
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare r text; v_id uuid; v_id2 uuid; u uuid := pg_temp.f('u1'); n bigint; i int; ok boolean := true; v_all text;
begin
  r := pg_temp.scalar_as_user(pg_temp.f('u1'), $q$select public.my_pool_creation_request()::text$q$);
  perform pg_temp.rec('B01 my_pool_creation_request sin solicitudes devuelve null', r = 'OK:', r);

  r := pg_temp.scalar_as_user(u, $q$select public.request_pool_creation('secreto-xyz')->>'status' || '/' || (public.my_pool_creation_request()->>'created')$q$);
  r := pg_temp.scalar_as_user(u, $q$select (public.my_pool_creation_request()->>'status')$q$);
  perform pg_temp.rec('B02 request_pool_creation crea una solicitud pending', r = 'OK:pending', r);
  v_id := pg_temp.rid(u);
  select count(*) into n from public.pool_creation_requests where requester_id = u;
  perform pg_temp.rec('B03 una sola fila tras la primera llamada', n = 1, n::text);

  -- idempotencia ×5: misma solicitud, created=false, sin filas nuevas
  for i in 1..5 loop
    r := pg_temp.scalar_as_user(u, $q$select (public.request_pool_creation('otra nota'))->>'id' || ':' || ((public.request_pool_creation())->>'created')$q$);
    if r <> 'OK:' || v_id::text || ':false' then ok := false; v_all := r; end if;
  end loop;
  select count(*) into n from public.pool_creation_requests where requester_id = u;
  perform pg_temp.rec('B04 idempotente x5: mismo id, created=false, sin duplicados', ok and n = 1, coalesce(v_all, '') || n);
  perform pg_temp.rec('B05 la nota original no se sobrescribe en la repetición',
    (select note from public.pool_creation_requests where id = v_id) = 'secreto-xyz', '');
  r := pg_temp.scalar_as_user(u, $q$select (public.request_pool_creation())::text$q$);
  perform pg_temp.rec('B06 forma de la respuesta: claves id,status,created,requested_at,reviewed_at presentes',
    r like 'OK:%' and (r::text like '%"created": false%') and r like '%"reviewed_at": null%' and r like '%"requested_at"%' and r like '%"status": "pending"%', r);

  -- cancelar
  r := pg_temp.scalar_as_user(u, $q$select public.cancel_pool_creation_request()->>'status'$q$);
  perform pg_temp.rec('B07 cancelar pending → cancelled', r = 'OK:cancelled', r);
  perform pg_temp.rec('B08 cancelled_at fijado y sin reviewed_at',
    exists (select 1 from public.pool_creation_requests where id = v_id and status = 'cancelled' and cancelled_at is not null and reviewed_at is null), '');
  r := pg_temp.as_user(u, $q$select public.cancel_pool_creation_request()$q$);
  perform pg_temp.rec('B09 cancelar sin pending → P0001 no_pending_request', pg_temp.is_err(r, 'P0001', 'no_pending_request'), r);

  -- re-solicitar
  r := pg_temp.scalar_as_user(u, $q$select public.request_pool_creation()->>'created'$q$);
  perform pg_temp.rec('B10 re-solicitar tras cancelar crea una nueva (created=true)', r = 'OK:true', r);
  v_id2 := pg_temp.rid(u);
  perform pg_temp.rec('B11 la nueva solicitud es distinta y la anterior sigue cancelled',
    v_id2 <> v_id and (select status from public.pool_creation_requests where id = v_id) = 'cancelled', '');
  r := pg_temp.scalar_as_user(u, $q$select public.my_pool_creation_request()->>'id'$q$);
  perform pg_temp.rec('B12 my_pool_creation_request devuelve la más reciente', r = 'OK:' || v_id2::text, r);

  -- auditoría de usuario (sin copiar la nota)
  perform pg_temp.rec('B13 eventos: requested x2 y cancelled x1 con actor = el usuario',
    (select count(*) from public.pool_creation_request_events where requester_id = u and event = 'requested' and actor_id = u and actor_kind = 'user') = 2
    and (select count(*) from public.pool_creation_request_events where requester_id = u and event = 'cancelled' and actor_id = u and actor_kind = 'user') = 1, '');
  perform pg_temp.rec('B14 los eventos no contienen la nota del usuario (minimización de PII)',
    not exists (select 1 from public.pool_creation_request_events e where e.requester_id = u and e.metadata::text like '%secreto%'), '');
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- C. Concurrencia lógica: dos inserciones → una sola pending (índice)
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare r text; u uuid := pg_temp.f('uconc'); n bigint;
begin
  r := pg_temp.as_role('postgres', format($q$insert into public.pool_creation_requests(requester_id) values (%L)$q$, u));
  perform pg_temp.rec('C01 primera inserción pending permitida', pg_temp.is_ok(r), r);
  r := pg_temp.as_role('postgres', format($q$insert into public.pool_creation_requests(requester_id) values (%L)$q$, u));
  perform pg_temp.rec('C02 segunda inserción pending → unique_violation (23505)', pg_temp.is_err(r, '23505'), r);
  r := pg_temp.as_role('service_role', format($q$insert into public.pool_creation_requests(requester_id) values (%L)$q$, u));
  perform pg_temp.rec('C03 ni service_role puede duplicar la pending', pg_temp.is_err(r, '23505'), r);
  -- la RPC, ante una pending ya creada «en paralelo», devuelve esa misma sin error
  r := pg_temp.scalar_as_user(u, $q$select (public.request_pool_creation()->>'created') $q$);
  select count(*) into n from public.pool_creation_requests where requester_id = u and status = 'pending';
  perform pg_temp.rec('C04 la RPC devuelve la pending existente (created=false) y sigue habiendo una', r = 'OK:false' and n = 1, r || '/' || n);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- D. Anon y authenticated sin DML directo; aislamiento RLS entre usuarios
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare r text; u1 uuid := pg_temp.f('u1'); u2 uuid := pg_temp.f('u2'); n text; v_id1 uuid := pg_temp.rid(pg_temp.f('u1'));
begin
  r := pg_temp.as_role('anon', $q$select public.request_pool_creation('x')$q$);
  perform pg_temp.rec('D01 anon no ejecuta request_pool_creation', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('anon', $q$select public.my_pool_creation_request()$q$);
  perform pg_temp.rec('D02 anon no ejecuta my_pool_creation_request', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('anon', $q$select public.cancel_pool_creation_request()$q$);
  perform pg_temp.rec('D03 anon no ejecuta cancel_pool_creation_request', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('anon', $q$select count(*) from public.pool_creation_requests$q$);
  perform pg_temp.rec('D04 anon no lee la tabla', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('anon', format($q$select public.review_pool_creation_request(%L, 'approve')$q$, v_id1));
  perform pg_temp.rec('D05 anon no ejecuta review_pool_creation_request', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('anon', format($q$insert into public.pool_creation_requests(requester_id) values (%L)$q$, u2));
  perform pg_temp.rec('D06 anon no inserta', pg_temp.is_err(r, '42501'), r);

  r := pg_temp.as_user(null, $q$select public.request_pool_creation('x')$q$);
  perform pg_temp.rec('D07 sin auth.uid() → 28000 (request)', pg_temp.is_err(r, '28000'), r);
  r := pg_temp.as_user(null, $q$select public.my_pool_creation_request()$q$);
  perform pg_temp.rec('D08 sin auth.uid() → 28000 (my)', pg_temp.is_err(r, '28000'), r);
  r := pg_temp.as_user(null, $q$select public.cancel_pool_creation_request()$q$);
  perform pg_temp.rec('D09 sin auth.uid() → 28000 (cancel)', pg_temp.is_err(r, '28000'), r);

  -- authenticated: sin INSERT/UPDATE/DELETE/TRUNCATE directos (ni propios ni forjando estado)
  r := pg_temp.as_user(u2, format($q$insert into public.pool_creation_requests(requester_id) values (%L)$q$, u2));
  perform pg_temp.rec('D10 authenticated no inserta (ni la propia)', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_user(u2, format($q$insert into public.pool_creation_requests(requester_id, status, reviewed_at, tenant_id) values (%L, 'approved', now(), %L)$q$, u2, pg_temp.f('ta')));
  perform pg_temp.rec('D11 authenticated no inserta una solicitud ya aprobada con tenant ajeno', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_user(u1, format($q$update public.pool_creation_requests set status = 'approved' where id = %L$q$, v_id1));
  perform pg_temp.rec('D12 authenticated no actualiza su solicitud (autoaprobación por UPDATE)', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_user(u1, $q$update public.pool_creation_requests set status = 'approved', tenant_id = null, reviewed_at = now()$q$);
  perform pg_temp.rec('D13 UPDATE masivo con status forjado denegado', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_user(u1, format($q$delete from public.pool_creation_requests where id = %L$q$, v_id1));
  perform pg_temp.rec('D14 authenticated no borra', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_user(u1, $q$truncate table public.pool_creation_requests$q$);
  perform pg_temp.rec('D15 authenticated no ejecuta TRUNCATE', pg_temp.is_err(r, '42501'), r);
  perform pg_temp.rec('D16 la fila de u1 sigue pending tras los intentos',
    (select status from public.pool_creation_requests where id = v_id1) = 'pending', '');
  r := pg_temp.as_user(u1, $q$select count(*) from public.pool_creation_request_events$q$);
  perform pg_temp.rec('D17 authenticated no lee los eventos de auditoría', pg_temp.is_err(r, '42501'), r);

  -- RLS: cada usuario solo ve las suyas
  n := pg_temp.scalar_as_user(u1, $q$select count(*) from public.pool_creation_requests$q$);
  perform pg_temp.rec('D18 u1 ve solo su(s) solicitud(es): 2 (cancelada + pending)', n = 'OK:2', n);
  n := pg_temp.scalar_as_user(u2, format($q$select count(*) from public.pool_creation_requests where requester_id = %L$q$, u1));
  perform pg_temp.rec('D19 u2 no ve las solicitudes de u1', n = 'OK:0', n);
  n := pg_temp.scalar_as_user(u2, format($q$select count(*) from public.pool_creation_requests where id = %L$q$, v_id1));
  perform pg_temp.rec('D20 u2 no ve la solicitud de u1 por id', n = 'OK:0', n);
  n := pg_temp.scalar_as_user(u2, $q$select count(*) from public.pool_creation_requests$q$);
  perform pg_temp.rec('D21 u2 sin solicitudes propias ve 0', n = 'OK:0', n);
  n := pg_temp.scalar_as_user(pg_temp.f('plat'), $q$select count(*) from public.pool_creation_requests$q$);
  perform pg_temp.rec('D22 ni un platform_admin autenticado lee solicitudes ajenas por la API', n = 'OK:0', n);
  n := pg_temp.scalar_as_user(pg_temp.f('oa'), $q$select count(*) from public.pool_creation_requests$q$);
  perform pg_temp.rec('D23 ni un owner de tenant lee solicitudes ajenas', n = 'OK:0', n);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- E. Autoaprobación imposible; review solo por service_role; máquina de estados
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare r text; u1 uuid := pg_temp.f('u1'); v_id uuid := pg_temp.rid(pg_temp.f('u1')); who text; v_before bigint; v_after bigint;
begin
  foreach who in array array['u1', 'oa', 'aa', 'plat', 'ma'] loop
    select count(*) into v_before from public.tenants;
    r := pg_temp.as_user(pg_temp.f(who), format($q$select public.review_pool_creation_request(%L, 'approve', null, 'Mi tenant')$q$, v_id));
    select count(*) into v_after from public.tenants;
    perform pg_temp.rec('E01 ' || who || ' (authenticated) no puede ejecutar review por API', pg_temp.is_err(r, '42501') and v_before = v_after, r);
  end loop;
  r := pg_temp.as_user(pg_temp.f('plat'), format($q$select public.review_pool_creation_request(%L, 'reject')$q$, v_id));
  perform pg_temp.rec('E02 platform_admin tampoco rechaza por API', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('postgres', format($q$do $x$ begin perform set_config('request.jwt.claims', '{"role":"authenticated"}', false); perform public.review_pool_creation_request(%L, 'approve'); end $x$ $q$, v_id));
  perform pg_temp.rec('E03 defensa en profundidad: incluso con ACL, un claim authenticated es rechazado en el cuerpo', pg_temp.is_err(r, '42501'), r);
  perform pg_temp.rec('E04 la solicitud sigue pending y sin tenant',
    exists (select 1 from public.pool_creation_requests where id = v_id and status = 'pending' and tenant_id is null and reviewed_at is null), '');

  -- máquina de estados frente a service_role/propietario (forja de status)
  r := pg_temp.as_role('service_role', format($q$update public.pool_creation_requests set status = 'approved', reviewed_at = now() where id = %L$q$, v_id));
  perform pg_temp.rec('E05 aprobar por UPDATE sin tenant (ni siquiera service_role) → rechazado por el guard', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('postgres', format($q$update public.pool_creation_requests set note = 'cambiada' where id = %L$q$, v_id));
  perform pg_temp.rec('E06 la nota/identidad de la solicitud es inmutable', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('postgres', format($q$update public.pool_creation_requests set requester_id = %L where id = %L$q$, pg_temp.f('u2'), v_id));
  perform pg_temp.rec('E07 requester_id inmutable', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('postgres', format($q$update public.pool_creation_requests set status = 'approved', tenant_id = %L where id = %L$q$, pg_temp.f('ta'), v_id));
  perform pg_temp.rec('E08 aprobar sin reviewed_at → rechazado (constraint de forma)', r like 'ERR:%', r);
  r := pg_temp.as_role('postgres', format($q$update public.pool_creation_requests set status = 'rejected', reviewed_at = now(), tenant_id = %L where id = %L$q$, pg_temp.f('ta'), v_id));
  perform pg_temp.rec('E09 una rechazada no puede llevar tenant (constraint)', r like 'ERR:%', r);
  perform pg_temp.rec('E10 tras los intentos forjados la solicitud sigue pending',
    exists (select 1 from public.pool_creation_requests where id = v_id and status = 'pending' and tenant_id is null), '');

  -- final inmutable: u1 cancela la pending, luego intento de reabrir
  perform pg_temp.scalar_as_user(u1, $q$select public.cancel_pool_creation_request()$q$);
  r := pg_temp.as_role('postgres', format($q$update public.pool_creation_requests set status = 'pending', cancelled_at = null where id = %L$q$, v_id));
  perform pg_temp.rec('E11 una cancelled no se reabre (estado final)', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('service_role', format($q$select public.review_pool_creation_request(%L, 'approve')$q$, v_id));
  perform pg_temp.rec('E12 review sobre cancelled → P0001 request_cancelled', pg_temp.is_err(r, 'P0001', 'request_cancelled'), r);

  r := pg_temp.as_role('postgres', 'truncate table public.pool_creation_requests');
  perform pg_temp.rec('E13 TRUNCATE de solicitudes bloqueado incluso para el propietario', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('postgres', 'update public.pool_creation_request_events set event = ''approved''');
  perform pg_temp.rec('E14 eventos append-only: UPDATE bloqueado', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('postgres', 'delete from public.pool_creation_request_events');
  perform pg_temp.rec('E15 eventos append-only: DELETE bloqueado', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('postgres', 'truncate table public.pool_creation_request_events');
  perform pg_temp.rec('E16 eventos append-only: TRUNCATE bloqueado', pg_temp.is_err(r, '42501'), r);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- F. already_organizer, notas y errores de entrada
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare r text; n bigint; u9 uuid := pg_temp.f('u9'); u4 uuid := pg_temp.f('u4');
begin
  r := pg_temp.as_user(pg_temp.f('oa'), $q$select public.request_pool_creation('quiero otra')$q$);
  perform pg_temp.rec('F01 owner activo → P0001 already_organizer', pg_temp.is_err(r, 'P0001', 'already_organizer') and r like '%already_organizer', r);
  r := pg_temp.as_user(pg_temp.f('aa'), $q$select public.request_pool_creation()$q$);
  perform pg_temp.rec('F02 admin activo → P0001 already_organizer', pg_temp.is_err(r, 'P0001', 'already_organizer'), r);
  select count(*) into n from public.pool_creation_requests where requester_id in (pg_temp.f('oa'), pg_temp.f('aa'));
  perform pg_temp.rec('F03 already_organizer no crea filas', n = 0, n::text);
  -- un admin INACTIVO no es organizador
  insert into public.tenant_memberships(tenant_id, profile_id, role, is_active) values (pg_temp.f('tb'), u4, 'admin', false);
  r := pg_temp.scalar_as_user(u4, $q$select public.request_pool_creation()->>'status'$q$);
  perform pg_temp.rec('F04 admin inactivo sí puede solicitar', r = 'OK:pending', r);
  -- un member de otro tenant (participante) puede solicitar: no es organizador
  r := pg_temp.scalar_as_user(pg_temp.f('ma'), $q$select public.request_pool_creation('soy participante')->>'created'$q$);
  perform pg_temp.rec('F05 un participante (member) puede solicitar', r = 'OK:true', r);

  -- notas
  r := pg_temp.as_user(u9, format($q$select public.request_pool_creation(%L)$q$, repeat('x', 501)));
  perform pg_temp.rec('F06 nota de 501 caracteres → 22023', pg_temp.is_err(r, '22023', 'note_too_long'), r);
  r := pg_temp.as_user(u9, format($q$select public.request_pool_creation(%L)$q$, repeat(' ', 600)));
  perform pg_temp.rec('F07 nota de solo espacios larga (600) → 22023', pg_temp.is_err(r, '22023'), r);
  select count(*) into n from public.pool_creation_requests where requester_id = u9;
  perform pg_temp.rec('F08 las notas inválidas no crean filas', n = 0, n::text);
  r := pg_temp.scalar_as_user(u9, $q$select public.request_pool_creation('   hola   ')->>'note'$q$);
  perform pg_temp.rec('F09 la nota se guarda recortada', r = 'OK:hola', r);
  perform pg_temp.scalar_as_user(u9, $q$select public.cancel_pool_creation_request()$q$);
  r := pg_temp.scalar_as_user(u9, format($q$select char_length(public.request_pool_creation(%L)->>'note')$q$, repeat('y', 500)));
  perform pg_temp.rec('F10 nota de exactamente 500 caracteres aceptada', r = 'OK:500', r);
  perform pg_temp.scalar_as_user(u9, $q$select public.cancel_pool_creation_request()$q$);
  r := pg_temp.scalar_as_user(u9, $q$select public.request_pool_creation('     ')->>'note'$q$);
  perform pg_temp.rec('F11 nota de pocos espacios se normaliza a vacía (null)', r = 'OK:', r);
  perform pg_temp.scalar_as_user(u9, $q$select public.cancel_pool_creation_request()$q$);
  r := pg_temp.as_role('postgres', format($q$insert into public.pool_creation_requests(requester_id, note) values (%L, %L)$q$, pg_temp.f('u2'), repeat('z', 501)));
  perform pg_temp.rec('F12 la tabla rechaza notas > 500 incluso con DML privilegiado', pg_temp.is_err(r, '23514'), r);
  r := pg_temp.as_role('postgres', format($q$insert into public.pool_creation_requests(requester_id, note) values (%L, ' con espacios ')$q$, pg_temp.f('u2')));
  perform pg_temp.rec('F13 la tabla rechaza notas sin recortar', pg_temp.is_err(r, '23514'), r);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- G. Cooldown tras rechazo y límite de frecuencia
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare r text; i int; v_id uuid; u5 uuid := pg_temp.f('u5'); u10 uuid := pg_temp.f('u10');
begin
  perform pg_temp.scalar_as_user(u5, $q$select public.request_pool_creation('primera')$q$);
  v_id := pg_temp.rid(u5);
  r := pg_temp.as_role('service_role', format($q$select public.review_pool_creation_request(%L, 'reject', 'no cumple los requisitos')$q$, v_id));
  perform pg_temp.rec('G01 el operador rechaza con nota', pg_temp.is_ok(r), r);
  perform pg_temp.rec('G02 queda rejected con review_note, reviewed_at y sin tenant',
    exists (select 1 from public.pool_creation_requests where id = v_id and status = 'rejected' and review_note = 'no cumple los requisitos' and reviewed_at is not null and tenant_id is null and reviewed_by is null), '');
  r := pg_temp.as_user(u5, $q$select public.request_pool_creation('otra vez')$q$);
  perform pg_temp.rec('G03 re-solicitar justo tras un rechazo → P0001 cooldown_active', pg_temp.is_err(r, 'P0001', 'cooldown_active'), r);
  r := pg_temp.scalar_as_user(u5, $q$select public.my_pool_creation_request()->>'review_note'$q$);
  perform pg_temp.rec('G04 el usuario ve el motivo del rechazo en my_pool_creation_request', r = 'OK:no cumple los requisitos', r);
  perform pg_temp.rec('G05 el rechazo no creó tenant ni membresía',
    not exists (select 1 from public.tenant_memberships where profile_id = u5), '');
  r := pg_temp.as_role('service_role', format($q$select public.review_pool_creation_request(%L, 'reject')$q$, v_id));
  perform pg_temp.rec('G06 rechazar de nuevo es idempotente (sin error)', pg_temp.is_ok(r), r);
  r := pg_temp.as_role('service_role', format($q$select public.review_pool_creation_request(%L, 'approve')$q$, v_id));
  perform pg_temp.rec('G07 aprobar una rechazada → P0001 already_reviewed (no se revierte)', pg_temp.is_err(r, 'P0001', 'already_reviewed'), r);

  insert into public.pool_creation_requests(requester_id, status, requested_at, reviewed_at, review_note)
    values (pg_temp.f('u6'), 'rejected', now() - interval '9 days', now() - interval '8 days', 'antiguo'),
           (pg_temp.f('u7'), 'rejected', now() - interval '7 days', now() - interval '6 days', 'reciente');
  r := pg_temp.scalar_as_user(pg_temp.f('u6'), $q$select public.request_pool_creation()->>'created'$q$);
  perform pg_temp.rec('G08 rechazo de hace 8 días: puede volver a solicitar', r = 'OK:true', r);
  r := pg_temp.as_user(pg_temp.f('u7'), $q$select public.request_pool_creation()$q$);
  perform pg_temp.rec('G09 rechazo de hace 6 días: sigue el cooldown', pg_temp.is_err(r, 'P0001', 'cooldown_active'), r);

  -- límite de frecuencia: 5 alta/cancelación en 24 h, la sexta se rechaza
  for i in 1..5 loop
    perform pg_temp.scalar_as_user(u10, $q$select public.request_pool_creation()$q$);
    perform pg_temp.scalar_as_user(u10, $q$select public.cancel_pool_creation_request()$q$);
  end loop;
  r := pg_temp.as_user(u10, $q$select public.request_pool_creation()$q$);
  perform pg_temp.rec('G10 la sexta solicitud en 24 h → P0001 rate_limited', pg_temp.is_err(r, 'P0001', 'rate_limited'), r);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- H. Revisión por operador: errores de entrada
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare r text; v_id uuid; u uuid := pg_temp.f('ubad'); n1 bigint; n2 bigint; v_late uuid := pg_temp.f('ulate');
begin
  perform pg_temp.scalar_as_user(u, $q$select public.request_pool_creation()$q$);
  v_id := pg_temp.rid(u);
  r := pg_temp.as_role('service_role', format($q$select public.review_pool_creation_request(%L, 'maybe')$q$, v_id));
  perform pg_temp.rec('H01 decisión inválida → 22023', pg_temp.is_err(r, '22023', 'invalid_decision'), r);
  r := pg_temp.as_role('service_role', format($q$select public.review_pool_creation_request(%L, null)$q$, v_id));
  perform pg_temp.rec('H02 decisión nula → 22023', pg_temp.is_err(r, '22023'), r);
  r := pg_temp.as_role('service_role', format($q$select public.review_pool_creation_request(%L, 'approve')$q$, gen_random_uuid()));
  perform pg_temp.rec('H03 solicitud inexistente → 22023 request_not_found', pg_temp.is_err(r, '22023', 'request_not_found'), r);
  select count(*) into n1 from public.tenants;
  r := pg_temp.as_role('service_role', format($q$select public.review_pool_creation_request(%L, 'approve', null, %L)$q$, v_id, repeat('t', 121)));
  select count(*) into n2 from public.tenants;
  perform pg_temp.rec('H04 nombre de tenant inválido → 22023 y no se crea nada (atómico)', pg_temp.is_err(r, '22023', 'invalid_tenant_name') and n1 = n2
    and exists (select 1 from public.pool_creation_requests where id = v_id and status = 'pending'), r);
  r := pg_temp.as_role('service_role', format($q$select public.review_pool_creation_request(%L, 'approve', null, '   ')$q$, v_id));
  perform pg_temp.rec('H05 nombre de tenant en blanco → 22023', pg_temp.is_err(r, '22023', 'invalid_tenant_name'), r);
  r := pg_temp.as_role('service_role', format($q$select public.review_pool_creation_request(%L, 'reject', %L)$q$, v_id, repeat('n', 501)));
  perform pg_temp.rec('H06 nota de revisión > 500 → 22023', pg_temp.is_err(r, '22023', 'note_too_long'), r);

  -- el solicitante pasó a ser organizador por otra vía antes de la aprobación
  perform pg_temp.scalar_as_user(v_late, $q$select public.request_pool_creation()$q$);
  insert into public.tenant_memberships(tenant_id, profile_id, role) values (pg_temp.f('tb'), v_late, 'admin');
  select count(*) into n1 from public.tenants;
  r := pg_temp.as_role('service_role', format($q$select public.review_pool_creation_request(%L, 'approve')$q$, pg_temp.rid(v_late)));
  select count(*) into n2 from public.tenants;
  perform pg_temp.rec('H07 aprobar a quien ya es organizador → P0001 already_organizer, sin tenant nuevo', pg_temp.is_err(r, 'P0001', 'already_organizer') and n1 = n2, r);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- I. Aprobación: tenant + membresía owner una sola vez; ADR-015; aislamiento
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare
  r text; n text; v_id uuid; v_t uuid; ma uuid := pg_temp.f('ma'); oa uuid := pg_temp.f('oa'); pa uuid := pg_temp.f('pa'); ta uuid := pg_temp.f('ta'); xo uuid := pg_temp.f('xo');
  c1 bigint; c2 bigint; c3 bigint;
begin
  v_id := pg_temp.rid(ma);
  select count(*) into c1 from public.tenants where name = 'PCR Nuevo';
  r := pg_temp.as_role('service_role', format($q$select public.review_pool_creation_request(%L, 'approve', 'bienvenido', 'PCR Nuevo')->>'status'$q$, v_id));
  perform pg_temp.rec('I01 el operador aprueba', pg_temp.is_ok(r), r);
  select tenant_id into v_t from public.pool_creation_requests where id = v_id;
  perform pg_temp.rec('I02 solicitud approved con tenant, reviewed_at y review_note',
    exists (select 1 from public.pool_creation_requests where id = v_id and status = 'approved' and tenant_id is not null and reviewed_at is not null and review_note = 'bienvenido' and reviewed_by is null), '');
  perform pg_temp.rec('I03 tenant creado con el nombre dado, plan free y modelo de administración tenant',
    c1 = 0 and (select name from public.tenants where id = v_t) = 'PCR Nuevo'
    and (select plan_code::text from public.tenant_entitlements where tenant_id = v_t) = 'free'
    and (select pool_admin_model::text from public.tenants where id = v_t) = 'tenant', '');
  perform pg_temp.rec('I04 membresía owner activa del solicitante, y es la única del tenant',
    (select count(*) from public.tenant_memberships where tenant_id = v_t) = 1
    and exists (select 1 from public.tenant_memberships where tenant_id = v_t and profile_id = ma and role = 'owner' and is_active), '');

  -- idempotencia: repetir la aprobación (×3) no duplica nada
  r := pg_temp.as_role('service_role', format($q$select public.review_pool_creation_request(%L, 'approve', null, 'otro nombre')$q$, v_id));
  r := pg_temp.as_role('service_role', format($q$select public.review_pool_creation_request(%L, 'approve')$q$, v_id));
  r := pg_temp.as_role('service_role', format($q$select public.review_pool_creation_request(%L, 'approve')$q$, v_id));
  select count(*) into c1 from public.tenants where name in ('PCR Nuevo', 'otro nombre');
  select count(*) into c2 from public.tenant_memberships where profile_id = ma and role = 'owner';
  select count(*) into c3 from public.audit_log where action = 'pool_creation_requests.approve' and entity_id = v_id;
  perform pg_temp.rec('I05 re-aprobar x3 es idempotente: 1 tenant, 1 membresía owner, 1 auditoría', pg_temp.is_ok(r) and c1 = 1 and c2 = 1 and c3 = 1, c1 || '/' || c2 || '/' || c3);
  r := pg_temp.as_role('service_role', format($q$select public.review_pool_creation_request(%L, 'reject')$q$, v_id));
  perform pg_temp.rec('I06 rechazar una aprobada → P0001 already_reviewed', pg_temp.is_err(r, 'P0001', 'already_reviewed'), r);

  -- auditoría
  perform pg_temp.rec('I07 audit_log del tenant nuevo: approve + alta de membresía (trigger), sin la nota',
    exists (select 1 from public.audit_log where tenant_id = v_t and action = 'pool_creation_requests.approve' and metadata ->> 'channel' = 'operator')
    and exists (select 1 from public.audit_log where tenant_id = v_t and action = 'tenant_memberships.insert')
    and not exists (select 1 from public.audit_log where tenant_id = v_t and metadata::text like '%bienvenido%'), '');
  perform pg_temp.rec('I08 eventos: requested y approved (operator/service_role)',
    exists (select 1 from public.pool_creation_request_events where request_id = v_id and event = 'requested' and actor_kind = 'user' and actor_id = ma)
    and exists (select 1 from public.pool_creation_request_events where request_id = v_id and event = 'approved' and actor_kind = 'operator' and metadata ->> 'db_role' = 'service_role'
                and metadata ->> 'tenant_id' = v_t::text), '');

  -- el usuario ya es organizador
  r := pg_temp.as_user(ma, $q$select public.request_pool_creation()$q$);
  perform pg_temp.rec('I09 tras aprobarse, solicitar de nuevo → already_organizer', pg_temp.is_err(r, 'P0001', 'already_organizer'), r);
  r := pg_temp.scalar_as_user(ma, $q$select public.my_pool_creation_request()->>'status'$q$);
  perform pg_temp.rec('I10 my_pool_creation_request refleja approved', r = 'OK:approved', r);
  n := pg_temp.scalar_as_user(ma, format($q$select public.is_tenant_admin(%L)::text$q$, v_t));
  perform pg_temp.rec('I11 el solicitante administra el tenant nuevo (is_tenant_admin)', n = 'OK:true', n);
  n := pg_temp.scalar_as_user(ma, format($q$select public.is_tenant_admin(%L)::text$q$, ta));
  perform pg_temp.rec('I12 y NO gana administración sobre el tenant donde solo era member', n = 'OK:false', n);

  -- ADR-015
  perform pg_temp.rec('I13 ADR-015: el tenant nuevo no tiene quinielas ni exclusiones ni participantes',
    not exists (select 1 from public.pools where tenant_id = v_t) and not exists (select 1 from public.pool_admin_exclusions where tenant_id = v_t)
    and not exists (select 1 from public.participants where tenant_id = v_t), '');
  perform pg_temp.rec('I14 ADR-015: su participación en la quiniela del otro tenant queda intacta y sin exclusión',
    exists (select 1 from public.participants where pool_id = pa and profile_id = ma and approval_status = 'approved' and withdrawn_at is null)
    and not public.is_pool_excluded(pa, ma)
    and not exists (select 1 from public.pool_admin_exclusions where pool_id = pa and profile_id = ma), '');

  -- aislamiento entre tenants
  n := pg_temp.scalar_as_user(oa, format($q$select (select count(*) from public.tenants where id = %1$L) + (select count(*) from public.tenant_memberships where tenant_id = %1$L)
      + (select count(*) from public.tenant_entitlements where tenant_id = %1$L) + (select count(*) from public.audit_log where tenant_id = %1$L)$q$, v_t));
  perform pg_temp.rec('I15 owner de otro tenant no ve nada del tenant nuevo (tenants, membresías, plan, auditoría)', n = 'OK:0', n);
  n := pg_temp.scalar_as_user(xo, format($q$select (select count(*) from public.tenants where id = %1$L) + (select count(*) from public.tenant_memberships where tenant_id = %1$L)
      + (select count(*) from public.tenant_entitlements where tenant_id = %1$L) + (select count(*) from public.audit_log where tenant_id = %1$L)$q$, v_t));
  perform pg_temp.rec('I16 un tercero tampoco', n = 'OK:0', n);
  n := pg_temp.scalar_as_user(ma, format($q$select (select count(*) from public.tenants where id = %1$L) + (select count(*) from public.tenant_memberships where tenant_id = %1$L)
      + (select count(*) from public.tenant_entitlements where tenant_id = %1$L) + (select count(*) from public.audit_log where tenant_id = %1$L)$q$, v_t));
  perform pg_temp.rec('I17 el nuevo owner sí ve su tenant (1 tenant + 1 membresía + 1 plan + auditoría)', n ~ '^OK:([3-9]|[1-9][0-9]+)$', n);
  n := pg_temp.scalar_as_user(ma, format($q$select (select count(*) from public.audit_log where tenant_id = %L)$q$, ta));
  perform pg_temp.rec('I18 el nuevo owner no ve la auditoría del tenant donde es member', n = 'OK:0', n);
  r := pg_temp.as_user(ma, format($q$insert into public.tenant_memberships(tenant_id, profile_id, role) values (%L, %L, 'owner')$q$, ta, ma));
  perform pg_temp.rec('I19 sigue sin poder autoasignarse roles (sin INSERT directo en membresías)', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_user(ma, format($q$update public.tenant_entitlements set plan_code = 'pro' where tenant_id = %L$q$, v_t));
  perform pg_temp.rec('I20 el owner nuevo no puede subir su plan (entitlements sin UPDATE directo)', pg_temp.is_err(r, '42501'), r);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- J. Aprobación por defecto, nombre por defecto, aprobada sin membresía, desacople de tenant
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare r text; v_id uuid; v_t uuid; ud uuid := pg_temp.f('udef'); ua uuid := pg_temp.f('uappr'); n1 bigint;
begin
  perform pg_temp.scalar_as_user(ud, $q$select public.request_pool_creation()$q$);
  v_id := pg_temp.rid(ud);
  r := pg_temp.as_role('service_role', format($q$select public.review_pool_creation_request(%L, 'approve')$q$, v_id));
  select tenant_id into v_t from public.pool_creation_requests where id = v_id;
  perform pg_temp.rec('J01 nombre por defecto «Quinielas de <perfil>»', pg_temp.is_ok(r) and (select name from public.tenants where id = v_t) like 'Quinielas de %', r);

  -- aprobada con tenant vigente pero sin membresía activa: se devuelve la aprobada (created=false), no se duplica
  perform pg_temp.scalar_as_user(ua, $q$select public.request_pool_creation()$q$);
  r := pg_temp.as_role('service_role', format($q$select public.review_pool_creation_request(%L, 'approve', null, 'PCR Uappr')$q$, pg_temp.rid(ua)));
  update public.tenant_memberships set is_active = false where profile_id = ua;
  select count(*) into n1 from public.pool_creation_requests where requester_id = ua;
  r := pg_temp.scalar_as_user(ua, $q$select (public.request_pool_creation()->>'status') || ':' || (public.request_pool_creation()->>'created')$q$);
  perform pg_temp.rec('J02 approved vigente sin membresía activa → devuelve la aprobada (created=false)', r = 'OK:approved:false'
    and (select count(*) from public.pool_creation_requests where requester_id = ua) = n1, r);

  -- desacople del tenant (FK on delete set null) permitido solo en una aprobada y sin otros cambios
  r := pg_temp.as_role('postgres', format($q$update public.pool_creation_requests set tenant_id = null where id = %L$q$, v_id));
  perform pg_temp.rec('J03 una aprobada admite solo el desacople de tenant (FK set null)', pg_temp.is_ok(r)
    and exists (select 1 from public.pool_creation_requests where id = v_id and status = 'approved' and tenant_id is null), r);
  r := pg_temp.as_role('postgres', format($q$update public.pool_creation_requests set status = 'rejected' where id = %L$q$, v_id));
  perform pg_temp.rec('J04 …pero no puede cambiarse a rejected', pg_temp.is_err(r, '42501'), r);
  r := pg_temp.as_role('postgres', format($q$update public.pool_creation_requests set review_note = 'cambio' where id = %L$q$, v_id));
  perform pg_temp.rec('J05 …ni editar la nota de revisión', pg_temp.is_err(r, '42501'), r);
end $$;
