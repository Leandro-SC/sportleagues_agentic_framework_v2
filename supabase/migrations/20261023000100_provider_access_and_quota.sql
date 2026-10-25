-- ADR-021 / hallazgo F-05 (reports/security/security-review-20261012.md): acceso y cuota del proveedor deportivo. PROPUESTA: no aplicada.
-- Forward-only; reversión en down/20261023000100_provider_access_and_quota.down.sql. Independiente de 20261022000100.
--
-- Decisión del propietario: `sports-sync` solo la ejecutan procesos backend autorizados de la plataforma; ningún administrador de tenant
-- invoca operaciones que consuman cuota del proveedor. Esta migración aporta la mitad de base de datos:
--   1. Presupuesto GLOBAL del proveedor (diario + mensual, con reserva para el sondeo) y presupuesto POR TENANT según plan (diario + mensual).
--   2. Reserva ATÓMICA (`provider_reserve`): o se reservan los cuatro contadores o ninguno; N reservas sucesivas nunca superan el límite.
--   3. Registro de consumo y errores (`provider_quota_reservations`), sin PII ni cuerpos de respuesta del proveedor; `provider_settle` es idempotente.
--   4. Todo es service_role-only: REVOKE a public/anon/authenticated + guarda interna por claim (mismo patrón que `rebuild_team_ratings`).
-- No toca `provider_consume` (legado, service_role-only): la Edge Function deja de usarlo. `auto_results` sigue APAGADO (no se modifica la bandera).
-- AGENTS.md §12: proveedor externo + autorización de una función backend: requiere ADR-021 aceptado antes de aplicar.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Configuración de presupuestos (solo service_role/postgres; el cliente jamás los lee ni los escribe)
-- ---------------------------------------------------------------------------------------------------------------
create table public.provider_quota_config (
  provider text primary key check (provider ~ '^[a-z][a-z0-9_]{1,39}$'),
  daily_limit integer not null check (daily_limit between 1 and 100000),
  monthly_limit integer not null check (monthly_limit >= 1),
  -- Margen del presupuesto diario reservado al sondeo (`sync`): las operaciones de catálogo no pueden consumirlo.
  sync_reserve integer not null default 10 check (sync_reserve >= 0),
  updated_at timestamptz not null default now(),
  check (monthly_limit >= daily_limit),
  check (sync_reserve < daily_limit)
);

create table public.plan_provider_quota (
  provider text not null references public.provider_quota_config(provider) on delete cascade,
  plan_code public.plan_code not null references public.plans(code),
  daily_requests integer not null check (daily_requests >= 0),
  monthly_requests integer not null check (monthly_requests >= 0),
  primary key (provider, plan_code),
  check (monthly_requests >= daily_requests)
);

-- Valores iniciales (política por defecto; ajustables por el operador con service_role, sin migración):
--   api_football (límites definitivos fijados por el propietario): 80 solicitudes/día y 2 400/mes (margen sobre las 100/día del plan gratuito del proveedor).
--   Reserva de sondeo 8 = 10 % del diario (la proporción 10/100 anterior): catálogo ≤ 72/día; `sync` puede usar las 80; 8 < 80.
--   free = 0/0 (sin acceso al proveedor); pro = 20/día y 300/mes por tenant.
insert into public.provider_quota_config(provider, daily_limit, monthly_limit, sync_reserve) values ('api_football', 80, 2400, 8);
insert into public.plan_provider_quota(provider, plan_code, daily_requests, monthly_requests) values
  ('api_football', 'free', 0, 0),
  ('api_football', 'pro', 20, 300);

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Contadores y registro
-- ---------------------------------------------------------------------------------------------------------------
-- El contador GLOBAL DIARIO es el ya existente `provider_usage.requests` (única fuente de verdad); se añade el recuento de rechazos.
alter table public.provider_usage add column quota_rejected integer not null default 0 check (quota_rejected >= 0);

create table public.provider_usage_monthly (
  provider text not null,
  month date not null,
  requests integer not null default 0 check (requests >= 0),
  primary key (provider, month)
);

-- Tabla tenant-owned (AGENTS §5): tenant_id + RLS activa; sin políticas ni privilegios para clientes (nadie la lee por la API).
create table public.provider_tenant_usage (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null,
  period text not null check (period in ('day', 'month')),
  period_start date not null,
  requests integer not null default 0 check (requests >= 0),
  errors integer not null default 0 check (errors >= 0),
  rejected integer not null default 0 check (rejected >= 0),
  primary key (tenant_id, provider, period, period_start)
);

-- Libro de reservas: una fila por solicitud HTTP reservada. Sin PII, sin cuerpos de respuesta, `error_code` restringido a un código corto.
create table public.provider_quota_reservations (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  kind text not null check (kind in ('search', 'import_season', 'sync')),
  tenant_id uuid references public.tenants(id) on delete cascade,
  n integer not null check (n between 1 and 20),
  status text not null default 'reserved' check (status in ('reserved', 'consumed', 'failed', 'released')),
  error_code text check (error_code ~ '^[A-Z0-9_]{1,60}$'),
  created_at timestamptz not null default clock_timestamp(),
  settled_at timestamptz,
  check ((status = 'reserved') = (settled_at is null))
);
create index provider_quota_reservations_status_idx on public.provider_quota_reservations (status, created_at);
create index provider_quota_reservations_tenant_idx on public.provider_quota_reservations (tenant_id, created_at desc) where tenant_id is not null;

alter table public.provider_quota_config enable row level security;
alter table public.plan_provider_quota enable row level security;
alter table public.provider_usage_monthly enable row level security;
alter table public.provider_tenant_usage enable row level security;
alter table public.provider_quota_reservations enable row level security;
revoke all on public.provider_quota_config, public.plan_provider_quota, public.provider_usage_monthly,
  public.provider_tenant_usage, public.provider_quota_reservations from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Acceso por tenant/plan (interna; reutilizada por reserva y comprobación previa)
-- ---------------------------------------------------------------------------------------------------------------
-- Ámbito PLATAFORMA (p_tenant nulo): las operaciones de catálogo (search/import_season) solo consumen presupuesto global; `sync` exige además
-- la bandera `auto_results` (el sondeo solo existe para resultados automáticos). Ámbito TENANT: exige tenant con plan, bandera encendida y
-- plan `pro` con cupo > 0 (misma regla que `_auto_results_allowed`, pero con el motivo del rechazo).
-- Motivos: TENANT_UNKNOWN · AUTO_RESULTS_OFF · PLAN_NO_ACCESS. El tenant lo informa el proceso backend de confianza; aquí se valida que exista
-- y se deriva su plan de la base de datos (jamás de la petición).
create function public._provider_tenant_access(p_provider text, p_kind text, p_tenant uuid)
returns table (reason text, daily_limit integer, monthly_limit integer)
language plpgsql stable security definer set search_path = ''
as $$
declare v_plan public.plan_code; v_flag boolean; v_d integer; v_m integer;
begin
  v_flag := coalesce((select f.enabled from public.platform_feature_flags f where f.key = 'auto_results'), false);
  if p_tenant is null then
    if p_kind = 'sync' and not v_flag then return query select 'AUTO_RESULTS_OFF'::text, null::integer, null::integer; return; end if;
    return query select null::text, null::integer, null::integer; return;
  end if;
  select e.plan_code into v_plan from public.tenant_entitlements e where e.tenant_id = p_tenant;
  if not found then return query select 'TENANT_UNKNOWN'::text, null::integer, null::integer; return; end if;
  if not v_flag then return query select 'AUTO_RESULTS_OFF'::text, null::integer, null::integer; return; end if;
  select q.daily_requests, q.monthly_requests into v_d, v_m from public.plan_provider_quota q where q.provider = p_provider and q.plan_code = v_plan;
  if v_plan <> 'pro' or v_d is null or v_d < 1 or v_m < 1 then return query select 'PLAN_NO_ACCESS'::text, null::integer, null::integer; return; end if;
  return query select null::text, v_d, v_m;
end $$;

-- Comprobación previa SIN consumir: el Edge Function rechaza antes de abrir trabajos de importación o llamar al proveedor.
create function public.provider_access_check(p_provider text, p_kind text, p_tenant uuid default null)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare v_reason text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role required' using errcode = '42501'; end if;
  if p_kind not in ('search', 'import_season', 'sync') or (p_kind = 'sync' and p_tenant is not null) then
    raise exception 'invalid quota request' using errcode = '22023';
  end if;
  if not exists (select 1 from public.provider_quota_config c where c.provider = p_provider) then return 'PROVIDER_NOT_CONFIGURED'; end if;
  select a.reason into v_reason from public._provider_tenant_access(p_provider, p_kind, p_tenant) a;
  return coalesce(v_reason, 'OK');
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Reserva atómica
-- ---------------------------------------------------------------------------------------------------------------
-- Serializa por proveedor con un bloqueo asesor de transacción (todas las reservas/liberaciones toman el mismo bloqueo primero: sin
-- interbloqueos) y bloquea cada contador con FOR UPDATE antes de comprobar. Luego aplica UPDATE condicional (`requests + n <= límite`) y
-- exige exactamente una fila: si se rompe la invariante la transacción entera se aborta, nunca queda una reserva parcial.
-- Motivos: PROVIDER_NOT_CONFIGURED · TENANT_UNKNOWN · AUTO_RESULTS_OFF · PLAN_NO_ACCESS · GLOBAL_EXHAUSTED · GLOBAL_MONTH_EXHAUSTED ·
--          TENANT_EXHAUSTED · TENANT_MONTH_EXHAUSTED.
-- `p_daily_cap`: el llamador puede RESTAR presupuesto (p. ej. variable de entorno), nunca ampliarlo por encima de la configuración.
create function public.provider_reserve(p_provider text, p_kind text, p_tenant uuid default null, p_n integer default 1, p_daily_cap integer default null)
returns table (allowed boolean, reason text, reservation_id uuid, global_remaining integer, tenant_remaining integer)
language plpgsql security definer set search_path = ''
as $$
declare
  v_cfg public.provider_quota_config;
  v_day date := (now() at time zone 'utc')::date;
  v_month date := (date_trunc('month', now() at time zone 'utc'))::date;
  v_why text; v_tdl integer; v_tml integer; v_gl integer;
  v_gd integer; v_gm integer; v_td integer; v_tm integer; v_id uuid; v_rows integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role required' using errcode = '42501'; end if;
  if p_kind not in ('search', 'import_season', 'sync') or p_n is null or p_n < 1 or p_n > 20
     or (p_daily_cap is not null and p_daily_cap < 1) or (p_kind = 'sync' and p_tenant is not null) then
    raise exception 'invalid quota request' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('provider_quota:' || p_provider, 0));
  select * into v_cfg from public.provider_quota_config c where c.provider = p_provider;
  if not found then return query select false, 'PROVIDER_NOT_CONFIGURED'::text, null::uuid, null::integer, null::integer; return; end if;

  select a.reason, a.daily_limit, a.monthly_limit into v_why, v_tdl, v_tml from public._provider_tenant_access(p_provider, p_kind, p_tenant) a;
  v_gl := least(v_cfg.daily_limit - case when p_kind = 'sync' then 0 else v_cfg.sync_reserve end, coalesce(p_daily_cap, v_cfg.daily_limit));

  -- Filas de contador (existen antes de bloquearlas); un tenant desconocido no crea filas.
  insert into public.provider_usage(provider, day) values (p_provider, v_day) on conflict do nothing;
  insert into public.provider_usage_monthly(provider, month) values (p_provider, v_month) on conflict do nothing;
  if p_tenant is not null and v_why is distinct from 'TENANT_UNKNOWN' then
    insert into public.provider_tenant_usage(tenant_id, provider, period, period_start) values (p_tenant, p_provider, 'day', v_day), (p_tenant, p_provider, 'month', v_month) on conflict do nothing;
  end if;

  if v_why is null then
    select u.requests into v_gd from public.provider_usage u where u.provider = p_provider and u.day = v_day for update;
    select m.requests into v_gm from public.provider_usage_monthly m where m.provider = p_provider and m.month = v_month for update;
    if v_gd + p_n > v_gl then v_why := 'GLOBAL_EXHAUSTED';
    elsif v_gm + p_n > v_cfg.monthly_limit then v_why := 'GLOBAL_MONTH_EXHAUSTED';
    elsif p_tenant is not null then
      select t.requests into v_td from public.provider_tenant_usage t where t.tenant_id = p_tenant and t.provider = p_provider and t.period = 'day' and t.period_start = v_day for update;
      select t.requests into v_tm from public.provider_tenant_usage t where t.tenant_id = p_tenant and t.provider = p_provider and t.period = 'month' and t.period_start = v_month for update;
      if v_td + p_n > v_tdl then v_why := 'TENANT_EXHAUSTED';
      elsif v_tm + p_n > v_tml then v_why := 'TENANT_MONTH_EXHAUSTED';
      end if;
    end if;
  end if;

  if v_why is not null then
    -- Registro del rechazo (acotado: un contador por día/tenant o por día/proveedor, sin una fila por intento). Los motivos del tenant se
    -- atribuyen al tenant; los del presupuesto global/proveedor/tenant inexistente, al contador global.
    if p_tenant is not null and v_why in ('AUTO_RESULTS_OFF', 'PLAN_NO_ACCESS', 'TENANT_EXHAUSTED', 'TENANT_MONTH_EXHAUSTED') then
      update public.provider_tenant_usage t set rejected = t.rejected + 1 where t.tenant_id = p_tenant and t.provider = p_provider and t.period = 'day' and t.period_start = v_day;
    else
      update public.provider_usage u set quota_rejected = u.quota_rejected + 1 where u.provider = p_provider and u.day = v_day;
    end if;
    return query select false, v_why, null::uuid, greatest(v_gl - coalesce(v_gd, 0), 0), null::integer; return;
  end if;

  update public.provider_usage u set requests = u.requests + p_n where u.provider = p_provider and u.day = v_day and u.requests + p_n <= v_gl;
  get diagnostics v_rows = row_count; if v_rows <> 1 then raise exception 'quota invariant violated' using errcode = 'XX000'; end if;
  update public.provider_usage_monthly m set requests = m.requests + p_n where m.provider = p_provider and m.month = v_month and m.requests + p_n <= v_cfg.monthly_limit;
  get diagnostics v_rows = row_count; if v_rows <> 1 then raise exception 'quota invariant violated' using errcode = 'XX000'; end if;
  if p_tenant is not null then
    update public.provider_tenant_usage t set requests = t.requests + p_n where t.tenant_id = p_tenant and t.provider = p_provider and t.period = 'day' and t.period_start = v_day and t.requests + p_n <= v_tdl;
    get diagnostics v_rows = row_count; if v_rows <> 1 then raise exception 'quota invariant violated' using errcode = 'XX000'; end if;
    update public.provider_tenant_usage t set requests = t.requests + p_n where t.tenant_id = p_tenant and t.provider = p_provider and t.period = 'month' and t.period_start = v_month and t.requests + p_n <= v_tml;
    get diagnostics v_rows = row_count; if v_rows <> 1 then raise exception 'quota invariant violated' using errcode = 'XX000'; end if;
  end if;

  insert into public.provider_quota_reservations(provider, kind, tenant_id, n) values (p_provider, p_kind, p_tenant, p_n) returning id into v_id;
  return query select true, null::text, v_id, v_gl - (v_gd + p_n), case when p_tenant is null then null::integer else v_tdl - (v_td + p_n) end;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Liquidación (idempotente): consumed | failed (cuentan; el intento salió) | released (el intento NUNCA salió: se devuelve la cuota)
-- ---------------------------------------------------------------------------------------------------------------
-- Devuelve true solo en la transición reserved → estado final; repetir la llamada, o liquidar una reserva ya liquidada/inexistente, devuelve
-- false sin tocar contadores (no hay doble devolución). La devolución usa los periodos de la fecha de la reserva (no los del momento de liquidar).
create function public.provider_settle(p_reservation_id uuid, p_outcome text, p_error_code text default null)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare r public.provider_quota_reservations; v_day date; v_month date; v_code text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role required' using errcode = '42501'; end if;
  if p_outcome not in ('consumed', 'failed', 'released') then raise exception 'invalid settle outcome' using errcode = '22023'; end if;
  select * into r from public.provider_quota_reservations x where x.id = p_reservation_id;
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('provider_quota:' || r.provider, 0));
  select * into r from public.provider_quota_reservations x where x.id = p_reservation_id and x.status = 'reserved' for update;
  if not found then return false; end if;
  v_day := (r.created_at at time zone 'utc')::date;
  v_month := (date_trunc('month', r.created_at at time zone 'utc'))::date;
  v_code := case when p_error_code ~ '^[A-Z0-9_]{1,60}$' then p_error_code else null end;
  if p_outcome = 'released' then
    update public.provider_usage u set requests = greatest(u.requests - r.n, 0) where u.provider = r.provider and u.day = v_day;
    update public.provider_usage_monthly m set requests = greatest(m.requests - r.n, 0) where m.provider = r.provider and m.month = v_month;
    if r.tenant_id is not null then
      update public.provider_tenant_usage t set requests = greatest(t.requests - r.n, 0) where t.tenant_id = r.tenant_id and t.provider = r.provider and t.period = 'day' and t.period_start = v_day;
      update public.provider_tenant_usage t set requests = greatest(t.requests - r.n, 0) where t.tenant_id = r.tenant_id and t.provider = r.provider and t.period = 'month' and t.period_start = v_month;
    end if;
  elsif p_outcome = 'failed' and r.tenant_id is not null then
    update public.provider_tenant_usage t set errors = t.errors + 1 where t.tenant_id = r.tenant_id and t.provider = r.provider and t.period = 'day' and t.period_start = v_day;
  end if;
  update public.provider_quota_reservations x set status = p_outcome, error_code = v_code, settled_at = clock_timestamp() where x.id = r.id;
  return true;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Retención (solo service_role; la programación NO se activa sin autorización)
-- ---------------------------------------------------------------------------------------------------------------
-- Las reservas sin liquidar tras 1 hora (proceso caído) pasan a `failed`/UNSETTLED y SIGUEN contando (el intento pudo salir).
-- Se borran reservas liquidadas y contadores por tenant más antiguos que p_keep (mínimo 30 días).
create function public.provider_quota_purge(p_keep interval default interval '90 days', p_max_rows integer default 10000)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role required' using errcode = '42501'; end if;
  if p_keep is null or p_keep < interval '30 days' or p_max_rows is null or p_max_rows < 1 or p_max_rows > 100000 then
    raise exception 'invalid retention' using errcode = '22023';
  end if;
  update public.provider_quota_reservations x set status = 'failed', error_code = 'UNSETTLED', settled_at = clock_timestamp()
   where x.status = 'reserved' and x.created_at < clock_timestamp() - interval '1 hour';
  with doomed as (
    select x.id from public.provider_quota_reservations x where x.status <> 'reserved' and x.created_at < clock_timestamp() - p_keep
     order by x.created_at limit p_max_rows for update skip locked)
  delete from public.provider_quota_reservations x using doomed d where x.id = d.id;
  get diagnostics v_n = row_count;
  delete from public.provider_tenant_usage t where t.period_start < ((now() at time zone 'utc')::date - ceil(extract(epoch from p_keep) / 86400)::integer);
  return v_n;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Privilegios (mínimo privilegio): solo service_role; la función interna no la ejecuta nadie directamente
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function
  public._provider_tenant_access(text, text, uuid), public.provider_access_check(text, text, uuid),
  public.provider_reserve(text, text, uuid, integer, integer), public.provider_settle(uuid, text, text),
  public.provider_quota_purge(interval, integer)
  from public, anon, authenticated;
-- La función interna solo la invocan las funciones SECURITY DEFINER (propietario): tampoco service_role la ejecuta directamente.
revoke all on function public._provider_tenant_access(text, text, uuid) from service_role;
grant execute on function
  public.provider_access_check(text, text, uuid), public.provider_reserve(text, text, uuid, integer, integer),
  public.provider_settle(uuid, text, text), public.provider_quota_purge(interval, integer)
  to service_role;
