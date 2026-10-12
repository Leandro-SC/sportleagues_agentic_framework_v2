-- F-05 / ADR-021: acceso y cuota del proveedor (ver supabase/proposed/20261023000100_provider_access_and_quota.sql). Clase B: transacción con rollback.
-- Ejecutar: node scripts/qa/run-sql-suite.mjs supabase/tests/provider-access-quota.sql --with-migration supabase/proposed/20261023000100_provider_access_and_quota.sql
-- Datos y proveedores sintéticos (qa_*); nada persiste. NO depende de 20261022000100. No consulta auth.users salvo para crear fixtures sintéticos (helper mk_user).
-- NO cubierto aquí (clase C, pendiente): concurrencia REAL entre dos sesiones simultáneas. Aquí se prueba la lógica del contador con reservas sucesivas
-- (serializadas) y la estructura del bloqueo; la garantía bajo carga paralela real se apoya en pg_advisory_xact_lock + FOR UPDATE + UPDATE condicional.

create or replace function pg_temp.rsv(p_prov text, p_kind text, p_tenant uuid default null, p_n integer default 1, p_cap integer default null)
returns jsonb language plpgsql as $$
declare r record;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  select * into r from public.provider_reserve(p_prov, p_kind, p_tenant, p_n, p_cap);
  perform set_config('request.jwt.claims', '', false);
  return to_jsonb(r);
exception when others then
  perform set_config('request.jwt.claims', '', false);
  raise;
end $$;
create or replace function pg_temp.settle(p_id uuid, p_outcome text, p_code text default null) returns boolean language plpgsql as $$
declare b boolean;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  b := public.provider_settle(p_id, p_outcome, p_code);
  perform set_config('request.jwt.claims', '', false);
  return b;
end $$;
create or replace function pg_temp.access(p_prov text, p_kind text, p_tenant uuid default null) returns text language plpgsql as $$
declare t text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  t := public.provider_access_check(p_prov, p_kind, p_tenant);
  perform set_config('request.jwt.claims', '', false);
  return t;
end $$;
create or replace function pg_temp.allowed(j jsonb) returns boolean language sql as $$ select coalesce((j->>'allowed')::boolean, false) $$;
create or replace function pg_temp.gday(p text) returns integer language sql as $$
  select coalesce((select u.requests from public.provider_usage u where u.provider = p and u.day = (now() at time zone 'utc')::date), 0) $$;
create or replace function pg_temp.gmon(p text) returns integer language sql as $$
  select coalesce((select m.requests from public.provider_usage_monthly m where m.provider = p and m.month = (date_trunc('month', now() at time zone 'utc'))::date), 0) $$;
create or replace function pg_temp.tday(p text, t uuid) returns integer language sql as $$
  select coalesce((select x.requests from public.provider_tenant_usage x where x.tenant_id = t and x.provider = p and x.period = 'day' and x.period_start = (now() at time zone 'utc')::date), 0) $$;
create or replace function pg_temp.tmon(p text, t uuid) returns integer language sql as $$
  select coalesce((select x.requests from public.provider_tenant_usage x where x.tenant_id = t and x.provider = p and x.period = 'month' and x.period_start = (date_trunc('month', now() at time zone 'utc'))::date), 0) $$;

do $$
declare
  v_oa uuid; v_ad uuid; v_mem uuid; v_ob uuid; v_pad uuid;
  v_ta uuid; v_tb uuid; v_tc uuid; v_td uuid; v_te uuid; v_tf uuid; v_tnone uuid;
  actors uuid[]; actor uuid; st text; tbl text; fn text; v_r text; j jsonb; i integer; n_ok integer; n_no integer; v_id uuid; v_id2 uuid;
  b1 boolean; b2 boolean; g0 integer; t0 integer; m0 integer; v_n integer; v_flag0 boolean; v_def_before integer; v_def_after integer;
begin
  v_oa := pg_temp.mk_user('pq-ownerA'); v_ad := pg_temp.mk_user('pq-adminA'); v_mem := pg_temp.mk_user('pq-memberA');
  v_ob := pg_temp.mk_user('pq-ownerB'); v_pad := pg_temp.mk_user('pq-platform');
  insert into public.tenants(name) values ('PQ A') returning id into v_ta;
  insert into public.tenants(name) values ('PQ B') returning id into v_tb;
  insert into public.tenants(name) values ('PQ C free') returning id into v_tc;
  insert into public.tenants(name) values ('PQ D') returning id into v_td;
  insert into public.tenants(name) values ('PQ E') returning id into v_te;
  insert into public.tenants(name) values ('PQ F') returning id into v_tf;
  insert into public.tenants(name) values ('PQ sin plan') returning id into v_tnone;
  insert into public.tenant_entitlements(tenant_id, plan_code) values (v_ta, 'pro'), (v_tb, 'pro'), (v_tc, 'free'), (v_td, 'pro'), (v_te, 'pro'), (v_tf, 'pro');
  insert into public.tenant_memberships(tenant_id, profile_id, role) values (v_ta, v_oa, 'owner'), (v_ta, v_ad, 'admin'), (v_ta, v_mem, 'member'), (v_tb, v_ob, 'owner');
  insert into public.platform_admins(user_id) values (v_pad);
  actors := array[v_oa, v_ad, v_mem, v_ob, v_pad];

  -- Proveedores sintéticos con presupuestos pequeños y deterministas.
  insert into public.provider_quota_config(provider, daily_limit, monthly_limit, sync_reserve) values
    ('qa_a', 100, 1000, 10), ('qa_g', 8, 100, 2), ('qa_m', 10, 10, 2), ('qa_c', 5, 50, 1), ('qa_big', 60, 600, 10), ('qa_p', 100, 1000, 10);
  insert into public.plan_provider_quota(provider, plan_code, daily_requests, monthly_requests)
    select p, 'free', 0, 0 from unnest(array['qa_a', 'qa_g', 'qa_m', 'qa_c', 'qa_big', 'qa_p']) p;
  insert into public.plan_provider_quota(provider, plan_code, daily_requests, monthly_requests) values
    ('qa_a', 'pro', 3, 5), ('qa_g', 'pro', 20, 200), ('qa_m', 'pro', 10, 10), ('qa_c', 'pro', 5, 50), ('qa_big', 'pro', 60, 600), ('qa_p', 'pro', 3, 5);

  -- ============ P. Privilegios y estructura ============
  perform pg_temp.rec('P01 solo service_role ejecuta reserve/settle/access_check/purge',
    has_function_privilege('service_role', 'public.provider_reserve(text, text, uuid, integer, integer)', 'execute')
    and has_function_privilege('service_role', 'public.provider_settle(uuid, text, text)', 'execute')
    and has_function_privilege('service_role', 'public.provider_access_check(text, text, uuid)', 'execute')
    and has_function_privilege('service_role', 'public.provider_quota_purge(interval, integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.provider_reserve(text, text, uuid, integer, integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.provider_settle(uuid, text, text)', 'execute')
    and not has_function_privilege('authenticated', 'public.provider_access_check(text, text, uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.provider_quota_purge(interval, integer)', 'execute')
    and not has_function_privilege('anon', 'public.provider_reserve(text, text, uuid, integer, integer)', 'execute')
    and not has_function_privilege('anon', 'public.provider_settle(uuid, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.provider_access_check(text, text, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.provider_quota_purge(interval, integer)', 'execute'), '');
  perform pg_temp.rec('P02 la función interna de acceso no es ejecutable por ningún rol de la API',
    not has_function_privilege('authenticated', 'public._provider_tenant_access(text, text, uuid)', 'execute')
    and not has_function_privilege('anon', 'public._provider_tenant_access(text, text, uuid)', 'execute')
    and not has_function_privilege('service_role', 'public._provider_tenant_access(text, text, uuid)', 'execute'), '');

  foreach st in array array[
    $q$select * from public.provider_reserve('qa_a', 'search', null, 1, null)$q$,
    $q$select public.provider_settle(gen_random_uuid(), 'released', null)$q$,
    $q$select public.provider_access_check('qa_a', 'search', null)$q$,
    $q$select public.provider_quota_purge()$q$,
    $q$select * from public._provider_tenant_access('qa_a', 'search', null)$q$] loop
    foreach actor in array actors loop
      v_r := pg_temp.as_user(actor, st);
      perform pg_temp.rec('P03 ' || (select case when actor = v_oa then 'owner' when actor = v_ad then 'admin' when actor = v_mem then 'miembro' when actor = v_ob then 'owner de otro tenant' else 'platform_admin' end)
        || ' no ejecuta: ' || left(st, 48), pg_temp.is_err(v_r, '42501'), v_r);
    end loop;
    v_r := pg_temp.as_role('anon', st);
    perform pg_temp.rec('P04 anon no ejecuta: ' || left(st, 48), pg_temp.is_err(v_r, '42501'), v_r);
  end loop;

  -- La guarda interna por claim funciona aunque el privilegio de ejecución existiera (se ejecuta como postgres con claims de otro rol).
  foreach st in array array[
    $q$select * from public.provider_reserve('qa_a', 'search', null, 1, null)$q$,
    $q$select public.provider_settle(gen_random_uuid(), 'released', null)$q$,
    $q$select public.provider_access_check('qa_a', 'search', null)$q$,
    $q$select public.provider_quota_purge()$q$] loop
    v_r := pg_temp.as_role('postgres', st);
    perform pg_temp.rec('P05 guarda interna (claim distinto de service_role) en: ' || left(st, 48), pg_temp.is_err(v_r, '42501') and v_r like '%service_role required%', v_r);
    perform set_config('request.jwt.claims', json_build_object('sub', v_oa, 'role', 'authenticated')::text, false);
    begin
      execute st; v_r := 'OK';
    exception when others then v_r := 'ERR:' || sqlstate || ':' || sqlerrm;
    end;
    perform set_config('request.jwt.claims', '', false);
    perform pg_temp.rec('P05b guarda interna (claim authenticated de un owner) en: ' || left(st, 48), v_r like 'ERR:42501:%service_role required%', v_r);
  end loop;

  foreach tbl in array array['provider_usage', 'provider_quota_config', 'plan_provider_quota', 'provider_usage_monthly', 'provider_tenant_usage', 'provider_quota_reservations'] loop
    foreach actor in array actors loop
      v_r := pg_temp.as_user(actor, format('select * from public.%I', tbl));
      perform pg_temp.rec('P06 ' || tbl || ': SELECT denegado a usuario autenticado (' || (case when actor = v_pad then 'platform_admin' when actor = v_oa then 'owner' else 'otro' end) || ')', pg_temp.is_err(v_r, '42501'), v_r);
    end loop;
    v_r := pg_temp.as_user(v_oa, format('delete from public.%I', tbl));
    perform pg_temp.rec('P07 ' || tbl || ': DELETE denegado al owner del tenant', pg_temp.is_err(v_r, '42501'), v_r);
    v_r := pg_temp.as_user(v_pad, format('delete from public.%I', tbl));
    perform pg_temp.rec('P07b ' || tbl || ': DELETE denegado al platform_admin', pg_temp.is_err(v_r, '42501'), v_r);
    v_r := pg_temp.as_role('anon', format('select * from public.%I', tbl));
    perform pg_temp.rec('P08 ' || tbl || ': SELECT denegado a anon', pg_temp.is_err(v_r, '42501'), v_r);
  end loop;
  v_r := pg_temp.as_user(v_oa, $q$update public.provider_tenant_usage set requests = 0$q$);
  perform pg_temp.rec('P09 UPDATE de contadores denegado al owner', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_ad, $q$insert into public.provider_tenant_usage(tenant_id, provider, period, period_start) values (gen_random_uuid(), 'qa_a', 'day', current_date)$q$);
  perform pg_temp.rec('P10 INSERT en contadores denegado al admin', pg_temp.is_err(v_r, '42501'), v_r);
  v_r := pg_temp.as_user(v_ad, $q$update public.plan_provider_quota set daily_requests = 1000000, monthly_requests = 1000000$q$);
  perform pg_temp.rec('P11 un administrador de tenant no puede ampliar su cupo de plan', pg_temp.is_err(v_r, '42501'), v_r);

  perform pg_temp.rec('P12 las 5 tablas nuevas tienen RLS activa y ninguna política',
    (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('provider_quota_config', 'plan_provider_quota', 'provider_usage_monthly', 'provider_tenant_usage', 'provider_quota_reservations') and c.relrowsecurity) = 5
    and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename in ('provider_quota_config', 'plan_provider_quota', 'provider_usage_monthly', 'provider_tenant_usage', 'provider_quota_reservations')), '');
  perform pg_temp.rec('P13 las tablas nuevas no conceden privilegios a anon/authenticated',
    not exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.grantee in ('anon', 'authenticated')
      and g.table_name in ('provider_quota_config', 'plan_provider_quota', 'provider_usage_monthly', 'provider_tenant_usage', 'provider_quota_reservations')), '');
  foreach fn in array array['provider_reserve', 'provider_settle', 'provider_access_check', 'provider_quota_purge', '_provider_tenant_access'] loop
    perform pg_temp.rec('P14 ' || fn || ' es SECURITY DEFINER con search_path fijo',
      (select p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = fn), '');
  end loop;
  perform pg_temp.rec('P15 configuración inicial: api_football 80/2400 con reserva 8; free = 0/0, pro = 20/300',
    (select count(*) from public.provider_quota_config where provider = 'api_football' and daily_limit = 80 and monthly_limit = 2400 and sync_reserve = 8) = 1
    and (select count(*) from public.plan_provider_quota where provider = 'api_football' and plan_code = 'free' and daily_requests = 0 and monthly_requests = 0) = 1
    and (select count(*) from public.plan_provider_quota where provider = 'api_football' and plan_code = 'pro' and daily_requests = 20 and monthly_requests = 300) = 1, '');

  -- ============ A. auto_results APAGADO (estado real) ============
  v_flag0 := coalesce((select f.enabled from public.platform_feature_flags f where f.key = 'auto_results'), false);
  perform pg_temp.rec('A01 línea base: auto_results sigue apagado (la migración no lo toca)', not v_flag0, v_flag0::text);
  update public.platform_feature_flags set enabled = false where key = 'auto_results';   -- por si el entorno lo tuviera encendido: la prueba exige el estado apagado
  j := pg_temp.rsv('qa_p', 'search', v_ta);
  perform pg_temp.rec('A02 flag apagado: un tenant PRO es rechazado con AUTO_RESULTS_OFF', not pg_temp.allowed(j) and j->>'reason' = 'AUTO_RESULTS_OFF' and j->>'reservation_id' is null, j::text);
  perform pg_temp.rec('A03 el rechazo no consume cuota ni crea reserva; queda contado como rechazo del tenant',
    pg_temp.gday('qa_p') = 0 and pg_temp.gmon('qa_p') = 0 and pg_temp.tday('qa_p', v_ta) = 0
    and (select x.rejected from public.provider_tenant_usage x where x.tenant_id = v_ta and x.provider = 'qa_p' and x.period = 'day') = 1
    and not exists (select 1 from public.provider_quota_reservations r where r.provider = 'qa_p'), '');
  j := pg_temp.rsv('qa_p', 'sync');
  perform pg_temp.rec('A04 flag apagado: el sondeo (sync) de plataforma es rechazado', not pg_temp.allowed(j) and j->>'reason' = 'AUTO_RESULTS_OFF', j::text);
  j := pg_temp.rsv('qa_p', 'search');
  perform pg_temp.rec('A05 flag apagado: una búsqueda de catálogo de plataforma (sin tenant) sí consume presupuesto global (no es resultado automático)',
    pg_temp.allowed(j) and pg_temp.gday('qa_p') = 1 and pg_temp.gmon('qa_p') = 1, j::text);
  perform pg_temp.rec('A06 comprobación previa con flag apagado: tenant PRO = AUTO_RESULTS_OFF; plataforma/search = OK; plataforma/sync = AUTO_RESULTS_OFF',
    pg_temp.access('qa_p', 'search', v_ta) = 'AUTO_RESULTS_OFF' and pg_temp.access('qa_p', 'search') = 'OK' and pg_temp.access('qa_p', 'sync') = 'AUTO_RESULTS_OFF',
    pg_temp.access('qa_p', 'search', v_ta) || '/' || pg_temp.access('qa_p', 'search') || '/' || pg_temp.access('qa_p', 'sync'));
  update public.platform_feature_flags set enabled = true where key = 'auto_results';   -- solo dentro de la transacción de prueba (rollback)

  -- ============ A2. Límites definitivos del propietario sobre la configuración REAL de api_football (80/día, 2 400/mes, reserva 8) ============
  perform pg_temp.rec('L00 línea base: sin consumo previo de api_football hoy ni este mes en el entorno de prueba', pg_temp.gday('api_football') = 0 and pg_temp.gmon('api_football') = 0,
    pg_temp.gday('api_football') || '/' || pg_temp.gmon('api_football'));
  n_ok := 0; n_no := 0;
  for i in 1..73 loop j := pg_temp.rsv('api_football', 'search'); if pg_temp.allowed(j) then n_ok := n_ok + 1; else n_no := n_no + 1; end if; end loop;
  perform pg_temp.rec('L01 catálogo: exactamente 72 (= 80 - reserva 8) concedidas; la 73.ª se rechaza con GLOBAL_EXHAUSTED',
    n_ok = 72 and n_no = 1 and j->>'reason' = 'GLOBAL_EXHAUSTED' and pg_temp.gday('api_football') = 72, n_ok || '/' || n_no || ' ' || j::text);
  n_ok := 0; n_no := 0;
  for i in 1..9 loop j := pg_temp.rsv('api_football', 'sync'); if pg_temp.allowed(j) then n_ok := n_ok + 1; else n_no := n_no + 1; end if; end loop;
  perform pg_temp.rec('L02 sondeo: exactamente 8 más (total 80); la 81.ª se rechaza con GLOBAL_EXHAUSTED',
    n_ok = 8 and n_no = 1 and j->>'reason' = 'GLOBAL_EXHAUSTED' and pg_temp.gday('api_football') = 80, n_ok || '/' || n_no || ' ' || j::text);
  update public.provider_usage set requests = 0 where provider = 'api_football';        -- simula un día nuevo
  update public.provider_usage_monthly set requests = 2399 where provider = 'api_football';
  j := pg_temp.rsv('api_football', 'sync');
  perform pg_temp.rec('L03 mensual: la solicitud 2 400 se concede', pg_temp.allowed(j) and pg_temp.gmon('api_football') = 2400, j::text);
  j := pg_temp.rsv('api_football', 'sync');
  perform pg_temp.rec('L04 mensual: la 2 401 se rechaza con GLOBAL_MONTH_EXHAUSTED y no incrementa', not pg_temp.allowed(j) and j->>'reason' = 'GLOBAL_MONTH_EXHAUSTED' and pg_temp.gmon('api_football') = 2400, j::text);
  j := pg_temp.rsv('api_football', 'search', v_ta);
  perform pg_temp.rec('L05 con global mensual agotado, un tenant PRO con cupo propio (20/día) también se rechaza', not pg_temp.allowed(j) and j->>'reason' = 'GLOBAL_MONTH_EXHAUSTED' and pg_temp.tday('api_football', v_ta) = 0, j::text);

  -- ============ B. Plan y tenant ============
  j := pg_temp.rsv('qa_a', 'search', v_tc);
  perform pg_temp.rec('B01 tenant FREE rechazado: PLAN_NO_ACCESS (y no consume)', not pg_temp.allowed(j) and j->>'reason' = 'PLAN_NO_ACCESS' and pg_temp.gday('qa_a') = 0 and pg_temp.tday('qa_a', v_tc) = 0, j::text);
  j := pg_temp.rsv('qa_a', 'search', v_tnone);
  perform pg_temp.rec('B02 tenant sin entitlement: TENANT_UNKNOWN y no se crean contadores', not pg_temp.allowed(j) and j->>'reason' = 'TENANT_UNKNOWN'
    and not exists (select 1 from public.provider_tenant_usage x where x.tenant_id = v_tnone), j::text);
  j := pg_temp.rsv('qa_a', 'search', gen_random_uuid());
  perform pg_temp.rec('B03 tenant inexistente: TENANT_UNKNOWN (sin error de FK)', not pg_temp.allowed(j) and j->>'reason' = 'TENANT_UNKNOWN', j::text);
  j := pg_temp.rsv('qa_does_not_exist', 'search', v_ta);
  perform pg_temp.rec('B04 proveedor sin configuración: PROVIDER_NOT_CONFIGURED (falla cerrado)', not pg_temp.allowed(j) and j->>'reason' = 'PROVIDER_NOT_CONFIGURED', j::text);
  perform pg_temp.rec('B05 comprobación previa: PRO = OK; FREE = PLAN_NO_ACCESS; sin plan = TENANT_UNKNOWN; proveedor desconocido; sin consumir',
    pg_temp.access('qa_a', 'search', v_ta) = 'OK' and pg_temp.access('qa_a', 'search', v_tc) = 'PLAN_NO_ACCESS' and pg_temp.access('qa_a', 'import_season', v_tnone) = 'TENANT_UNKNOWN'
    and pg_temp.access('qa_zzz', 'search') = 'PROVIDER_NOT_CONFIGURED' and pg_temp.gday('qa_a') = 0 and pg_temp.tday('qa_a', v_ta) = 0, '');

  -- ============ C. Contador atómico por tenant (reservas sucesivas) ============
  n_ok := 0;
  for i in 1..3 loop j := pg_temp.rsv('qa_a', 'search', v_ta); if pg_temp.allowed(j) then n_ok := n_ok + 1; end if; end loop;
  perform pg_temp.rec('C01 el tenant PRO obtiene exactamente su cupo diario (3) y el contador marca 3 (tenant y global)', n_ok = 3 and pg_temp.tday('qa_a', v_ta) = 3 and pg_temp.gday('qa_a') = 3 and pg_temp.tmon('qa_a', v_ta) = 3, n_ok::text);
  perform pg_temp.rec('C02 el cupo restante informado llega a 0', (j->>'tenant_remaining')::int = 0, j::text);
  j := pg_temp.rsv('qa_a', 'search', v_ta);
  perform pg_temp.rec('C03 la reserva N+1 se rechaza con TENANT_EXHAUSTED y no incrementa nada', not pg_temp.allowed(j) and j->>'reason' = 'TENANT_EXHAUSTED' and pg_temp.tday('qa_a', v_ta) = 3 and pg_temp.gday('qa_a') = 3
    and (select x.rejected from public.provider_tenant_usage x where x.tenant_id = v_ta and x.provider = 'qa_a' and x.period = 'day') = 1, j::text);
  n_ok := 0;
  for i in 1..3 loop j := pg_temp.rsv('qa_a', 'import_season', v_tb); if pg_temp.allowed(j) then n_ok := n_ok + 1; end if; end loop;
  perform pg_temp.rec('C04 aislamiento: el consumo agotado de A no afecta el cupo de B (3 de 3) ni los contadores de A', n_ok = 3 and pg_temp.tday('qa_a', v_tb) = 3 and pg_temp.tday('qa_a', v_ta) = 3 and pg_temp.gday('qa_a') = 6, n_ok::text);
  j := pg_temp.rsv('qa_a', 'search', v_td, 2);
  perform pg_temp.rec('C05 una reserva de n=2 con cupo 3 se admite', pg_temp.allowed(j) and pg_temp.tday('qa_a', v_td) = 2, j::text);
  j := pg_temp.rsv('qa_a', 'search', v_td, 2);
  perform pg_temp.rec('C06 n=2 con 1 de cupo se rechaza ENTERA (sin reserva parcial)', not pg_temp.allowed(j) and j->>'reason' = 'TENANT_EXHAUSTED' and pg_temp.tday('qa_a', v_td) = 2 and pg_temp.gday('qa_a') = 8, j::text);
  j := pg_temp.rsv('qa_a', 'search', v_td, 1);
  perform pg_temp.rec('C07 el último cupo (1) se concede exacto', pg_temp.allowed(j) and pg_temp.tday('qa_a', v_td) = 3, j::text);
  -- Tope mensual del tenant (5): simular un nuevo día reiniciando el contador diario.
  update public.provider_tenant_usage set requests = 0 where tenant_id = v_td and provider = 'qa_a' and period = 'day';
  n_ok := 0;
  for i in 1..3 loop j := pg_temp.rsv('qa_a', 'search', v_td); if pg_temp.allowed(j) then n_ok := n_ok + 1; end if; end loop;
  perform pg_temp.rec('C08 el tope mensual del tenant (5) frena la 6.ª solicitud: TENANT_MONTH_EXHAUSTED', n_ok = 2 and j->>'reason' = 'TENANT_MONTH_EXHAUSTED' and pg_temp.tmon('qa_a', v_td) = 5 and pg_temp.tday('qa_a', v_td) = 2, n_ok || ' ' || j::text);

  -- ============ D. Presupuesto global ============
  n_ok := 0;
  for i in 1..3 loop j := pg_temp.rsv('qa_g', 'search', v_ta); if pg_temp.allowed(j) then n_ok := n_ok + 1; end if; end loop;
  for i in 1..3 loop j := pg_temp.rsv('qa_g', 'search', v_tb); if pg_temp.allowed(j) then n_ok := n_ok + 1; end if; end loop;
  perform pg_temp.rec('D01 dos tenants consumen el presupuesto interactivo global (8 - reserva 2 = 6)', n_ok = 6 and pg_temp.gday('qa_g') = 6, n_ok::text);
  j := pg_temp.rsv('qa_g', 'search', v_td);
  perform pg_temp.rec('D02 GLOBAL_EXHAUSTED aunque el tenant D tenga cupo propio intacto (20/día)', not pg_temp.allowed(j) and j->>'reason' = 'GLOBAL_EXHAUSTED' and pg_temp.tday('qa_g', v_td) = 0
    and pg_temp.access('qa_g', 'search', v_td) = 'OK', j::text);
  perform pg_temp.rec('D03 el rechazo global se contabiliza en el contador global y no consume', (select u.quota_rejected from public.provider_usage u where u.provider = 'qa_g' and u.day = (now() at time zone 'utc')::date) = 1 and pg_temp.gday('qa_g') = 6, '');
  j := pg_temp.rsv('qa_g', 'import_season');
  perform pg_temp.rec('D04 las operaciones de catálogo de plataforma tampoco superan el presupuesto interactivo', not pg_temp.allowed(j) and j->>'reason' = 'GLOBAL_EXHAUSTED', j::text);
  n_ok := 0;
  for i in 1..2 loop j := pg_temp.rsv('qa_g', 'sync'); if pg_temp.allowed(j) then n_ok := n_ok + 1; end if; end loop;
  perform pg_temp.rec('D05 la reserva de sondeo (2) solo la puede usar sync', n_ok = 2 and pg_temp.gday('qa_g') = 8, n_ok::text);
  j := pg_temp.rsv('qa_g', 'sync');
  perform pg_temp.rec('D06 sync tampoco supera el límite diario completo (8)', not pg_temp.allowed(j) and j->>'reason' = 'GLOBAL_EXHAUSTED' and pg_temp.gday('qa_g') = 8, j::text);
  v_r := pg_temp.as_role('service_role', $q$select * from public.provider_reserve('qa_g', 'sync', gen_random_uuid(), 1, null)$q$);
  perform pg_temp.rec('D07 sync atribuido a un tenant es una petición inválida (22023)', pg_temp.is_err(v_r, '22023'), v_r);
  -- Tope mensual global (10): agotar el día de sync y simular un día nuevo.
  for i in 1..10 loop j := pg_temp.rsv('qa_m', 'sync'); end loop;
  update public.provider_usage set requests = 0 where provider = 'qa_m';
  j := pg_temp.rsv('qa_m', 'sync');
  perform pg_temp.rec('D08 el tope mensual global (10) frena: GLOBAL_MONTH_EXHAUSTED', not pg_temp.allowed(j) and j->>'reason' = 'GLOBAL_MONTH_EXHAUSTED' and pg_temp.gmon('qa_m') = 10 and pg_temp.gday('qa_m') = 0, j::text);
  -- El llamador puede restar presupuesto, nunca ampliarlo.
  n_ok := 0;
  for i in 1..3 loop j := pg_temp.rsv('qa_c', 'search', null, 1, 2); if pg_temp.allowed(j) then n_ok := n_ok + 1; end if; end loop;
  perform pg_temp.rec('D09 p_daily_cap=2 limita a 2 aunque la configuración permita más', n_ok = 2 and j->>'reason' = 'GLOBAL_EXHAUSTED', n_ok || ' ' || j::text);
  n_ok := 0;
  for i in 1..4 loop j := pg_temp.rsv('qa_c', 'search', null, 1, 1000); if pg_temp.allowed(j) then n_ok := n_ok + 1; end if; end loop;
  perform pg_temp.rec('D10 p_daily_cap=1000 NO amplía: tope configurado 5 - reserva 1 = 4 en total (2 + 2 nuevas)', n_ok = 2 and pg_temp.gday('qa_c') = 4, n_ok || ' ' || pg_temp.gday('qa_c'));
  -- Lote de reservas sucesivas: exactamente el límite.
  n_ok := 0; n_no := 0;
  for i in 1..60 loop j := pg_temp.rsv('qa_big', 'search'); if pg_temp.allowed(j) then n_ok := n_ok + 1; else n_no := n_no + 1; end if; end loop;
  perform pg_temp.rec('D11 60 reservas sucesivas con límite interactivo 50: 50 concedidas y 10 rechazadas', n_ok = 50 and n_no = 10 and pg_temp.gday('qa_big') = 50 and pg_temp.gmon('qa_big') = 50, n_ok || '/' || n_no);
  perform pg_temp.rec('D12 el libro registra una fila por reserva concedida y ninguna por rechazo', (select count(*) from public.provider_quota_reservations r where r.provider = 'qa_big' and r.status = 'reserved') = 50, '');

  -- ============ E. Validación de entradas ============
  foreach st in array array[
    $q$select * from public.provider_reserve('qa_a', 'bogus', null, 1, null)$q$,
    $q$select * from public.provider_reserve('qa_a', 'search', null, 0, null)$q$,
    $q$select * from public.provider_reserve('qa_a', 'search', null, 21, null)$q$,
    $q$select * from public.provider_reserve('qa_a', 'search', null, null, null)$q$,
    $q$select * from public.provider_reserve('qa_a', 'search', null, 1, 0)$q$,
    $q$select public.provider_access_check('qa_a', 'bogus', null)$q$,
    $q$select public.provider_settle(gen_random_uuid(), 'bogus', null)$q$] loop
    v_r := pg_temp.as_role('service_role', st);
    perform pg_temp.rec('E01 entrada inválida rechazada (22023): ' || left(st, 60), pg_temp.is_err(v_r, '22023'), v_r);
  end loop;
  v_r := pg_temp.as_role('service_role', $q$select public.provider_quota_purge(interval '7 days')$q$);
  perform pg_temp.rec('E02 la retención mínima es de 30 días (22023)', pg_temp.is_err(v_r, '22023'), v_r);
  v_r := pg_temp.as_role('service_role', $q$select public.provider_quota_purge(interval '90 days', 0)$q$);
  perform pg_temp.rec('E03 el tamaño de lote se valida (22023)', pg_temp.is_err(v_r, '22023'), v_r);

  -- ============ F. Liquidación: liberar / ajustar (idempotente) ============
  g0 := pg_temp.gday('qa_a'); m0 := pg_temp.gmon('qa_a');
  j := pg_temp.rsv('qa_a', 'search', v_te);
  v_id := (j->>'reservation_id')::uuid;
  perform pg_temp.rec('F01 reserva concedida con id y contadores +1', pg_temp.allowed(j) and v_id is not null and pg_temp.tday('qa_a', v_te) = 1 and pg_temp.gday('qa_a') = g0 + 1 and pg_temp.gmon('qa_a') = m0 + 1, j::text);
  b1 := pg_temp.settle(v_id, 'released');
  perform pg_temp.rec('F02 liberar una reserva no emitida devuelve la cuota (true) en los 4 contadores',
    b1 and pg_temp.tday('qa_a', v_te) = 0 and pg_temp.tmon('qa_a', v_te) = 0 and pg_temp.gday('qa_a') = g0 and pg_temp.gmon('qa_a') = m0, b1::text);
  b1 := pg_temp.settle(v_id, 'released');
  perform pg_temp.rec('F03 liberar de nuevo es idempotente: false y SIN doble devolución', not b1 and pg_temp.tday('qa_a', v_te) = 0 and pg_temp.gday('qa_a') = g0, b1::text);
  b1 := pg_temp.settle(v_id, 'consumed'); b2 := pg_temp.settle(v_id, 'failed', 'UPSTREAM');
  perform pg_temp.rec('F04 una reserva liberada no puede pasar después a consumed/failed (false) ni cambia contadores',
    not b1 and not b2 and pg_temp.tday('qa_a', v_te) = 0 and pg_temp.gday('qa_a') = g0
    and (select r.status from public.provider_quota_reservations r where r.id = v_id) = 'released', b1::text || b2::text);
  b1 := pg_temp.settle(gen_random_uuid(), 'released');
  perform pg_temp.rec('F05 una reserva inexistente se liquida como false sin error', not b1, b1::text);
  j := pg_temp.rsv('qa_a', 'search', v_te); v_id := (j->>'reservation_id')::uuid;
  b1 := pg_temp.settle(v_id, 'consumed'); b2 := pg_temp.settle(v_id, 'released');
  perform pg_temp.rec('F06 consumed fija el consumo (true) y no devuelve cuota; liberar después es false',
    b1 and not b2 and pg_temp.tday('qa_a', v_te) = 1 and pg_temp.gday('qa_a') = g0 + 1
    and (select r.status from public.provider_quota_reservations r where r.id = v_id) = 'consumed', b1::text || b2::text);
  j := pg_temp.rsv('qa_a', 'search', v_te); v_id2 := (j->>'reservation_id')::uuid;
  b1 := pg_temp.settle(v_id2, 'failed', 'UPSTREAM');
  perform pg_temp.rec('F07 failed cuenta como consumo, registra el código y suma un error al tenant (el intento salió)',
    b1 and pg_temp.tday('qa_a', v_te) = 2
    and (select r.status || ':' || coalesce(r.error_code, '') from public.provider_quota_reservations r where r.id = v_id2) = 'failed:UPSTREAM'
    and (select x.errors from public.provider_tenant_usage x where x.tenant_id = v_te and x.provider = 'qa_a' and x.period = 'day') = 1, b1::text);
  j := pg_temp.rsv('qa_a', 'search', v_te); v_id := (j->>'reservation_id')::uuid;
  perform pg_temp.settle(v_id, 'failed', 'detalle libre con espacios y datos personales');
  perform pg_temp.rec('F08 un código de error libre (posible PII/cuerpo del proveedor) no se almacena', (select r.error_code from public.provider_quota_reservations r where r.id = v_id) is null, '');
  -- Reutilización de cupo liberado (tenant F, cupo 3).
  for i in 1..3 loop j := pg_temp.rsv('qa_a', 'search', v_tf); if i = 2 then v_id := (j->>'reservation_id')::uuid; end if; end loop;
  j := pg_temp.rsv('qa_a', 'search', v_tf);
  perform pg_temp.rec('F09 con cupo agotado la reserva siguiente se rechaza', not pg_temp.allowed(j), j::text);
  perform pg_temp.settle(v_id, 'released');
  j := pg_temp.rsv('qa_a', 'search', v_tf);
  perform pg_temp.rec('F10 tras liberar una, se concede exactamente una más', pg_temp.allowed(j) and pg_temp.tday('qa_a', v_tf) = 3, j::text);
  j := pg_temp.rsv('qa_a', 'search', v_tf);
  perform pg_temp.rec('F11 y la siguiente vuelve a rechazarse', not pg_temp.allowed(j) and pg_temp.tday('qa_a', v_tf) = 3, j::text);
  -- Liberar usa el periodo de la RESERVA, no el de la liquidación (contador de otro día no se toca).
  j := pg_temp.rsv('qa_p', 'search', v_tb); v_id := (j->>'reservation_id')::uuid;
  update public.provider_quota_reservations set created_at = created_at - interval '2 days' where id = v_id;
  g0 := pg_temp.gday('qa_p'); t0 := pg_temp.tday('qa_p', v_tb);
  perform pg_temp.settle(v_id, 'released');
  perform pg_temp.rec('F12 liberar una reserva de otro día no resta del contador de hoy ni baja de 0', pg_temp.gday('qa_p') = g0 and pg_temp.tday('qa_p', v_tb) = t0, g0 || '/' || t0);

  -- ============ G. Comprobación previa y regresión ============
  perform pg_temp.rec('G01 la comprobación previa no consume ni crea reservas', pg_temp.access('qa_c', 'search', v_ta) = 'OK' and pg_temp.gday('qa_c') = 4
    and (select count(*) from public.provider_quota_reservations r where r.provider = 'qa_c') = 4, '');
  v_r := pg_temp.as_role('service_role', $q$select public.provider_access_check('qa_a', 'sync', gen_random_uuid())$q$);
  perform pg_temp.rec('G02 la comprobación previa rechaza sync con tenant (22023)', pg_temp.is_err(v_r, '22023'), v_r);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  v_n := public.provider_consume('qa_legacy', 3, 1);
  perform set_config('request.jwt.claims', '', false);
  perform pg_temp.rec('G03 regresión: el provider_consume heredado sigue funcionando (service_role)', v_n = 2, v_n::text);

  -- ============ H. Retención ============
  insert into public.provider_quota_reservations(provider, kind, tenant_id, n, status, created_at) values ('qa_a', 'search', v_ta, 1, 'reserved', now() - interval '2 hours') returning id into v_id;
  insert into public.provider_quota_reservations(provider, kind, tenant_id, n, status, created_at, settled_at) values ('qa_a', 'search', v_ta, 1, 'consumed', now() - interval '100 days', now() - interval '100 days') returning id into v_id2;
  g0 := pg_temp.gday('qa_a');
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  v_n := public.provider_quota_purge(interval '90 days', 100);
  perform set_config('request.jwt.claims', '', false);
  perform pg_temp.rec('H01 la purga borra reservas liquidadas de más de 90 días', v_n >= 1 and not exists (select 1 from public.provider_quota_reservations r where r.id = v_id2), v_n::text);
  perform pg_temp.rec('H02 una reserva sin liquidar de más de 1 hora pasa a failed/UNSETTLED y SIGUE contando',
    (select r.status || ':' || r.error_code from public.provider_quota_reservations r where r.id = v_id) = 'failed:UNSETTLED' and pg_temp.gday('qa_a') = g0, '');
  perform pg_temp.rec('H03 las reservas recientes se conservan', exists (select 1 from public.provider_quota_reservations r where r.provider = 'qa_big' and r.status = 'reserved'), '');
end $$;
