-- Remediación H1–H6 / ADR-015. Aplicada a Supabase QA (juoftaofzepxbrrxbkhx) con autorización del propietario (2026-10-11).
-- Orden: 2/3 (H3, H4, H5, H6, H7/R5, H9). Forward-only. Solo para un proyecto Supabase Cloud DESCARTABLE hasta ser validada.
--
-- R2  Privilegios mínimos: sin TRUNCATE/REFERENCES/TRIGGER para anon/authenticated; sin I/U/D para anon; sin EXECUTE
--     para PUBLIC/anon en funciones de public (authenticated conserva sus grants explícitos; las funciones solo de
--     service_role siguen así). Los privilegios por defecto futuros se corrigen para el rol postgres.
-- R3  audit_log append-only (UPDATE/DELETE por fila y TRUNCATE por sentencia) + verify_audit_protection().
--     LÍMITE: el propietario/superusuario puede deshabilitar triggers; se mitiga con verify_audit_protection(),
--     exportación externa periódica y revisión de DDL. No hay trigger de eventos (postgres no es superusuario en Supabase).
-- R4  Auditoría por trigger de las acciones administrativas (también vía service_role y DML directo), sin secretos.
-- R5  pool_join_codes: solo administradores del tenant leen códigos (se elimina la política de miembros).
-- R6  join_pool bloquea la quiniela antes de contar el límite Free.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------------------------------------------
-- R2. Privilegios
-- ---------------------------------------------------------------------------------------------------------------
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
revoke insert, update, delete on all tables in schema public from anon;
-- H1: los clientes no actualizan directamente el calendario ni los locks. pools ya
-- se escribe mediante manage_pool; el feed deportivo entra por apply_fixture_update
-- (service_role). Cualquier futura operaciÃ³n administrativa debe ser una RPC
-- SECURITY DEFINER con autorizaciÃ³n por capacidad y auditorÃ­a.
revoke insert, update, delete on public.matches, public.pool_matches from authenticated;
revoke execute on all functions in schema public from public, anon;

alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke insert, update, delete on tables from anon;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon;
-- Sin IN SCHEMA: quita el EXECUTE implícito de PUBLIC en funciones futuras de postgres (el ajuste con IN SCHEMA no lo hace).
alter default privileges for role postgres revoke execute on functions from public;
-- Falla cerrado: toda función nueva exige GRANT explícito (también para authenticated).
alter default privileges for role postgres in schema public revoke execute on functions from authenticated;
alter default privileges for role postgres revoke execute on functions from authenticated;

do $$
begin
  begin
    execute 'alter default privileges for role supabase_admin in schema public revoke truncate, references, trigger on tables from anon, authenticated';
    execute 'alter default privileges for role supabase_admin in schema public revoke insert, update, delete on tables from anon';
    execute 'alter default privileges for role supabase_admin in schema public revoke execute on functions from public, anon';
    execute 'alter default privileges for role supabase_admin in schema public revoke execute on functions from authenticated';
    execute 'alter default privileges for role supabase_admin revoke execute on functions from authenticated';
  exception when insufficient_privilege then
    raise warning 'default privileges of supabase_admin not changed (insufficient privilege); verify with the effective-privileges baseline test';
  end;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- R3. audit_log inmutable
-- ---------------------------------------------------------------------------------------------------------------
create function public.tg_append_only() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;
revoke all on function public.tg_append_only() from public, anon, authenticated;

create trigger audit_log_no_update_delete before update or delete on public.audit_log
  for each row execute function public.tg_append_only();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.tg_append_only();

create function public.verify_audit_protection()
returns table(check_name text, ok boolean)
language sql stable security definer set search_path = ''
as $$
  select 'audit_log row trigger: enabled, BEFORE ROW UPDATE/DELETE'::text,
         exists (select 1 from pg_trigger t where t.tgrelid = 'public.audit_log'::regclass and t.tgname = 'audit_log_no_update_delete'
                  and t.tgenabled = 'O' and t.tgtype = 27)
  union all
  select 'audit_log truncate trigger: enabled, BEFORE STATEMENT TRUNCATE',
         exists (select 1 from pg_trigger t where t.tgrelid = 'public.audit_log'::regclass and t.tgname = 'audit_log_no_truncate'
                  and t.tgenabled = 'O' and t.tgtype = 34)
  union all
  select 'tg_append_only still raises (body not replaced)',
         exists (select 1 from pg_proc p where p.oid = 'public.tg_append_only()'::regprocedure and p.prosrc like '%raise exception%append-only%')
  union all
  select 'no client UPDATE/DELETE/TRUNCATE on audit_log',
         not (has_table_privilege('authenticated', 'public.audit_log', 'UPDATE') or has_table_privilege('authenticated', 'public.audit_log', 'DELETE')
              or has_table_privilege('authenticated', 'public.audit_log', 'TRUNCATE') or has_table_privilege('anon', 'public.audit_log', 'TRUNCATE')
              or has_table_privilege('anon', 'public.audit_log', 'UPDATE') or has_table_privilege('anon', 'public.audit_log', 'DELETE'))
  union all
  select 'session_replication_role is origin (triggers fire) in this session',
         current_setting('session_replication_role') = 'origin'
  union all
  select 'pool_admin_exclusions protected (if installed)',
         case when to_regclass('public.pool_admin_exclusions') is null then true
              else exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('public.pool_admin_exclusions')
                            and t.tgname = 'pool_admin_exclusions_append_only' and t.tgenabled = 'O' and t.tgtype = 27) end
$$;
revoke all on function public.verify_audit_protection() from public, anon, authenticated;
grant execute on function public.verify_audit_protection() to service_role;

-- audit_log.actor_id deja de ser FK a profiles: una baja de cuenta (supresión de PII) no puede tocar un registro inmutable.
-- El actor sigue guardado como uuid; la integridad de la bitácora prima sobre la referencia.
alter table public.audit_log drop constraint if exists audit_log_actor_id_fkey;

-- ---------------------------------------------------------------------------------------------------------------
-- R4. Auditoría de operaciones administrativas (lista blanca de columnas; nunca códigos de invitación ni secretos)
-- ---------------------------------------------------------------------------------------------------------------
create function public.tg_audit_row_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_cols text[] := string_to_array(coalesce(tg_argv[0], ''), ',');
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_pick_new jsonb; v_pick_old jsonb; v_claims text; v_role text;
begin
  select coalesce(jsonb_object_agg(k, v_new -> k), '{}'::jsonb) into v_pick_new from unnest(v_cols) k where v_new is not null;
  select coalesce(jsonb_object_agg(k, v_old -> k), '{}'::jsonb) into v_pick_old from unnest(v_cols) k where v_old is not null;
  if tg_op = 'UPDATE' and v_pick_new = v_pick_old then return null; end if;
  v_claims := nullif(current_setting('request.jwt.claims', true), '');
  v_role := coalesce(case when v_claims is not null and pg_input_is_valid(v_claims, 'jsonb') then v_claims::jsonb ->> 'role' end, session_user);
  insert into public.audit_log(tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    coalesce(v_row ->> 'tenant_id', case when tg_table_name = 'tenants' then v_row ->> 'id' end)::uuid,
    (select p.id from public.profiles p where p.id = auth.uid()),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    nullif(v_row ->> 'id', '')::uuid,
    jsonb_strip_nulls(jsonb_build_object(
      'pool_id', v_row -> 'pool_id', 'old', nullif(v_pick_old, '{}'::jsonb), 'new', nullif(v_pick_new, '{}'::jsonb), 'db_role', v_role, 'session_user', session_user))
  );
  return null;
end $$;
revoke all on function public.tg_audit_row_change() from public, anon, authenticated;

create trigger audit_pools after insert or update or delete on public.pools
  for each row execute function public.tg_audit_row_change('name,status,lock_offset,requires_approval,opened_at');
create trigger audit_pool_rules after insert or update or delete on public.pool_rules
  for each row execute function public.tg_audit_row_change('version,exact_points,outcome_points,tie_breaker,is_current');
create trigger audit_pool_join_codes after insert or update or delete on public.pool_join_codes
  for each row execute function public.tg_audit_row_change('is_enabled,expires_at');
create trigger audit_participants after insert or update or delete on public.participants
  for each row execute function public.tg_audit_row_change('profile_id,approval_status,payment_status,withdrawn_at');
create trigger audit_matches after insert or update or delete on public.matches
  for each row execute function public.tg_audit_row_change('starts_at,status,round_id,tournament_id,home_team_id,away_team_id');
create trigger audit_pool_matches after insert or update or delete on public.pool_matches
  for each row execute function public.tg_audit_row_change('match_id,lock_at');
create trigger audit_rounds after insert or update or delete on public.rounds
  for each row execute function public.tg_audit_row_change('name,sort_order,tournament_id');
create trigger audit_tournaments after insert or update or delete on public.tournaments
  for each row execute function public.tg_audit_row_change('name');
create trigger audit_tenant_memberships after insert or update or delete on public.tenant_memberships
  for each row execute function public.tg_audit_row_change('profile_id,role,is_active');
create trigger audit_official_results after insert or update or delete on public.official_results
  for each row execute function public.tg_audit_row_change('match_id,home_score,away_score,revision');

-- ---------------------------------------------------------------------------------------------------------------
-- R5. Códigos de invitación: solo administradores del tenant (la política de escritura de administradores incluye SELECT)
-- ---------------------------------------------------------------------------------------------------------------
drop policy if exists pool_join_codes_select_member on public.pool_join_codes;

-- ---------------------------------------------------------------------------------------------------------------
-- R6. join_pool con bloqueo de la quiniela (ACL conservada por CREATE OR REPLACE). Cuerpo = migración 20260913000100
--     más el bloqueo marcado «R6».
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.join_pool(p_code text)
returns public.participants
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_code public.pool_join_codes;
  v_participant public.participants;
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select * into v_code
  from public.pool_join_codes
  where code = upper(p_code)
    and is_enabled
    and (expires_at is null or expires_at > now())
  for update;

  if not found then
    raise exception 'join code is invalid or expired' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.pools
    where id = v_code.pool_id
      and tenant_id = v_code.tenant_id
      and status = 'open'
  ) then
    raise exception 'pool is not open' using errcode = '22023';
  end if;

  insert into public.tenant_memberships(tenant_id, profile_id, role)
  values (v_code.tenant_id, v_user, 'member')
  on conflict (tenant_id, profile_id) do nothing;

  select * into v_participant
  from public.participants
  where tenant_id = v_code.tenant_id
    and pool_id = v_code.pool_id
    and profile_id = v_user;

  if found then
    return v_participant;
  end if;

  -- R6: serializar el conteo del límite Free por quiniela (varios códigos activos no lo evaden).
  perform 1 from public.pools where id = v_code.pool_id and tenant_id = v_code.tenant_id for no key update;

  if exists (
    select 1
    from public.tenant_entitlements e
    where e.tenant_id = v_code.tenant_id
      and e.plan_code = 'free'
  ) and (
    select count(*)
    from public.participants
    where tenant_id = v_code.tenant_id
      and pool_id = v_code.pool_id
      and withdrawn_at is null
  ) >= 10 then
    raise exception 'free participant limit reached' using errcode = '22023';
  end if;

  insert into public.participants(
    tenant_id,
    pool_id,
    profile_id,
    approval_status,
    payment_status
  )
  select
    v_code.tenant_id,
    v_code.pool_id,
    v_user,
    case
      when p.requires_approval then 'pending'::public.participant_approval_status
      else 'approved'::public.participant_approval_status
    end,
    'invited'::public.participant_payment_status
  from public.pools p
  where p.id = v_code.pool_id
    and p.tenant_id = v_code.tenant_id
  returning * into v_participant;

  return v_participant;
end;
$$;
