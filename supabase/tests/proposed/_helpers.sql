-- CLASE C (se antepone a cada suite 10/20/30/50 mediante run-suite.mjs). SOLO PARA EL PROYECTO DESCARTABLE, DATOS SINTÉTICOS.
-- Resultados en la tabla temporal t_results; la suite termina con: select * from t_results order by id;
-- Los helpers cambian de rol dentro de la función y SIEMPRE ejecutan RESET ROLE antes de volver, de modo que
-- las aserciones se registran como postgres. Resultado de un intento: 'OK:<filas>' o 'ERR:<sqlstate>:<hint>:<mensaje>'.
create temp table if not exists t_results (id text not null, ok boolean not null, detail text not null default '');
create temp table if not exists fx (k text primary key, v uuid not null);

create or replace function pg_temp.rec(p_id text, p_ok boolean, p_detail text default '') returns void
language plpgsql as $$ begin insert into t_results(id, ok, detail) values (p_id, coalesce(p_ok, false), coalesce(p_detail, '')); end $$;

create or replace function pg_temp.f(p_key text) returns uuid
language sql as $$ select v from fx where k = p_key $$;

create or replace function pg_temp.mk_user(p_label text) returns uuid
language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v, 'authenticated', 'authenticated', p_label || '-' || v::text || '@example.test', 'not-used', now(), '{}', '{}', now(), now());
  insert into public.profiles (id, display_name) values (v, left(p_label, 40));
  return v;
end $$;

-- Ejecuta SQL como un usuario autenticado (claims sintéticos). No devuelve datos: solo el resultado del intento.
create or replace function pg_temp.as_user(p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare v_rows bigint; v_state text; v_msg text; v_hint text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
  execute 'set role authenticated';
  begin
    execute p_sql;
    get diagnostics v_rows = row_count;
    execute 'reset role'; perform set_config('request.jwt.claims', '', false);
    return 'OK:' || v_rows;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
    execute 'reset role'; perform set_config('request.jwt.claims', '', false);
    return 'ERR:' || v_state || ':' || coalesce(v_hint, '') || ':' || v_msg;
  end;
end $$;

-- Igual, devolviendo un escalar de texto (p. ej. un conteo bajo RLS).
create or replace function pg_temp.scalar_as_user(p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare v_text text; v_state text; v_msg text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
  execute 'set role authenticated';
  begin
    execute p_sql into v_text;
    execute 'reset role'; perform set_config('request.jwt.claims', '', false);
    return 'OK:' || coalesce(v_text, '');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    execute 'reset role'; perform set_config('request.jwt.claims', '', false);
    return 'ERR:' || v_state || '::' || v_msg;
  end;
end $$;

-- Ejecuta SQL con un rol de base (service_role, anon) o como postgres si p_role = 'postgres'.
create or replace function pg_temp.as_role(p_role text, p_sql text) returns text
language plpgsql as $$
declare v_rows bigint; v_state text; v_msg text; v_hint text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', p_role)::text, false);
  if p_role <> 'postgres' then execute format('set role %I', p_role); end if;
  begin
    execute p_sql;
    get diagnostics v_rows = row_count;
    execute 'reset role'; perform set_config('request.jwt.claims', '', false);
    return 'OK:' || v_rows;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
    execute 'reset role'; perform set_config('request.jwt.claims', '', false);
    return 'ERR:' || v_state || ':' || coalesce(v_hint, '') || ':' || v_msg;
  end;
end $$;

create or replace function pg_temp.is_err(p_res text, p_state text, p_hint text default null) returns boolean
language sql as $$
  select p_res like 'ERR:' || p_state || ':%' and (p_hint is null or split_part(p_res, ':', 3) = p_hint)
$$;
create or replace function pg_temp.is_ok(p_res text) returns boolean
language sql as $$ select p_res like 'OK:%' $$;
