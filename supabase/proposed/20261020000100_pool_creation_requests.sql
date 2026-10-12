-- ADR-017 (Proposed). Solicitud «Crear mi propia quiniela» con aprobación por operador.
-- NO APLICADA A QA NI A PRODUCCIÓN: requiere autorización expresa del propietario (AGENTS.md §12). Forward-only.
-- Se valida solo en transacción con rollback: node scripts/qa/run-sql-suite.mjs supabase/tests/pool-creation-requests.sql
--   --with-migration supabase/proposed/20261020000100_pool_creation_requests.sql
--
-- Garantías:
--  * Un participante PIDE ser organizador; nunca se autoeleva: no hay DML directo para anon/authenticated y la
--    revisión (review_pool_creation_request) solo es ejecutable por service_role (consola/SQL de operador).
--  * Una sola solicitud 'pending' por solicitante (índice único parcial + bloqueo asesor por usuario): idempotente
--    y segura bajo concurrencia.
--  * Máquina de estados impuesta por trigger (también frente a service_role/propietario): pending → approved |
--    rejected | cancelled; los estados finales son inmutables y no se puede aprobar sin tenant.
--  * Auditoría propia (pool_creation_request_events, append-only): audit_log exige tenant_id NOT NULL y una solicitud
--    pendiente aún no tiene tenant. Al aprobar además se escribe audit_log del tenant nuevo.
--  * ADR-015: un tenant nuevo no tiene quinielas, así que la aprobación no puede crear conflicto administrador/
--    participante. Las participaciones del solicitante en OTROS tenants no se tocan (ADR-015 §2.4: la regla es por quiniela).
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------------------------------------------------
create table public.pool_creation_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  note text check (note is null or (note = btrim(note) and char_length(note) between 1 and 500)),
  requested_at timestamptz not null default clock_timestamp(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,   -- null cuando revisa el operador (service_role sin sesión de usuario)
  review_note text check (review_note is null or char_length(review_note) between 1 and 500),
  cancelled_at timestamptz,
  tenant_id uuid references public.tenants(id) on delete set null,       -- se fija solo al aprobar; nunca lo envía el cliente
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pool_creation_requests_state_shape check (
       (status = 'pending'   and reviewed_at is null     and cancelled_at is null)
    or (status in ('approved', 'rejected') and reviewed_at is not null and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null and reviewed_at is null)),
  constraint pool_creation_requests_tenant_only_if_approved check (status = 'approved' or tenant_id is null),
  constraint pool_creation_requests_review_note_only_if_reviewed check (review_note is null or status in ('approved', 'rejected'))
);

-- Idempotencia bajo concurrencia: como máximo una solicitud pendiente por solicitante.
create unique index pool_creation_requests_one_pending on public.pool_creation_requests (requester_id) where status = 'pending';
create index pool_creation_requests_requester_idx on public.pool_creation_requests (requester_id, requested_at desc);
create index pool_creation_requests_pending_idx on public.pool_creation_requests (requested_at) where status = 'pending';

create trigger pool_creation_requests_set_updated_at before update on public.pool_creation_requests
  for each row execute function public.set_updated_at();

-- Rastro de auditoría previo al tenant. Sin FK (el historial sobrevive a la baja de cuentas, como audit_log.actor_id).
-- No copia la nota del usuario (minimización de PII).
create table public.pool_creation_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  requester_id uuid not null,
  event text not null check (event in ('requested', 'approved', 'rejected', 'cancelled')),
  actor_id uuid,
  actor_kind text not null check (actor_kind in ('user', 'operator')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index pool_creation_request_events_request_idx on public.pool_creation_request_events (request_id, created_at);

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Triggers: máquina de estados, auditoría e inmutabilidad
-- ---------------------------------------------------------------------------------------------------------------
create function public.tg_pool_creation_requests_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.requester_id is distinct from old.requester_id
     or new.requested_at is distinct from old.requested_at or new.note is distinct from old.note then
    raise exception 'pool creation request identity is immutable' using errcode = '42501';
  end if;
  if old.status <> 'pending' then
    -- Estado final inmutable. Única excepción: el desacople del tenant (FK on delete set null) en una aprobada.
    if old.status = 'approved' and new.status = 'approved' and new.tenant_id is null and old.tenant_id is not null
       and (to_jsonb(new) - 'tenant_id' - 'updated_at') = (to_jsonb(old) - 'tenant_id' - 'updated_at') then
      return new;
    end if;
    raise exception 'a % pool creation request is final', old.status using errcode = '42501';
  end if;
  if new.status = 'approved' and (new.tenant_id is null or new.reviewed_at is null) then
    raise exception 'an approval needs the tenant created for the requester' using errcode = '42501';
  end if;
  if new.status in ('approved', 'rejected') and new.reviewed_at is null then
    raise exception 'a review needs reviewed_at' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger pool_creation_requests_guard before update on public.pool_creation_requests
  for each row execute function public.tg_pool_creation_requests_guard();

create function public.tg_pool_creation_requests_audit() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_role text;
  v_actor uuid := auth.uid();
  v_event text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return null; end if;
  v_event := case when tg_op = 'INSERT' then 'requested' else new.status end;
  v_role := coalesce(case when v_claims is not null and pg_input_is_valid(v_claims, 'jsonb') then v_claims::jsonb ->> 'role' end, session_user);
  insert into public.pool_creation_request_events(request_id, requester_id, event, actor_id, actor_kind, metadata)
  values (new.id, new.requester_id, v_event, (select p.id from public.profiles p where p.id = v_actor),
          case when v_event = 'requested' or (v_event = 'cancelled' and v_actor = new.requester_id) then 'user' else 'operator' end,
          jsonb_strip_nulls(jsonb_build_object('tenant_id', new.tenant_id, 'db_role', v_role, 'session_user', session_user)));
  return null;
end $$;
create trigger pool_creation_requests_audit after insert or update on public.pool_creation_requests
  for each row execute function public.tg_pool_creation_requests_audit();

create trigger pool_creation_requests_no_truncate before truncate on public.pool_creation_requests
  for each statement execute function public.tg_append_only();
create trigger pool_creation_request_events_append_only before update or delete on public.pool_creation_request_events
  for each row execute function public.tg_append_only();
create trigger pool_creation_request_events_no_truncate before truncate on public.pool_creation_request_events
  for each statement execute function public.tg_append_only();

revoke all on function public.tg_pool_creation_requests_guard(), public.tg_pool_creation_requests_audit() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. RLS y privilegios (lectura propia; sin DML directo para clientes)
-- ---------------------------------------------------------------------------------------------------------------
alter table public.pool_creation_requests enable row level security;
alter table public.pool_creation_request_events enable row level security;

create policy pool_creation_requests_select_own on public.pool_creation_requests for select to authenticated
  using (requester_id = auth.uid());
-- pool_creation_request_events: RLS activa y SIN política ni grant para clientes (solo operador/SQL).

revoke all on public.pool_creation_requests, public.pool_creation_request_events from public, anon, authenticated;
grant select on public.pool_creation_requests to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. RPC de usuario (security definer; identidad solo desde auth.uid())
-- ---------------------------------------------------------------------------------------------------------------
create function public._pool_creation_request_json(r public.pool_creation_requests, p_created boolean default null) returns jsonb
language sql stable security definer set search_path = ''
as $$
  -- Las claves siempre están presentes (valor null si no aplica): el cliente puede leer reviewed_at sin comprobar existencia.
  select jsonb_build_object(
    'id', r.id, 'status', r.status, 'created', p_created, 'requested_at', r.requested_at, 'reviewed_at', r.reviewed_at,
    'note', r.note, 'review_note', r.review_note, 'tenant_id', r.tenant_id)
$$;
revoke all on function public._pool_creation_request_json(public.pool_creation_requests, boolean) from public, anon, authenticated;

create function public.request_pool_creation(p_note text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_note text;
  v_last_rejection timestamptz;
  r public.pool_creation_requests;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  -- Longitud en bruto: una nota de solo espacios largos también se rechaza.
  if p_note is not null and char_length(p_note) > 500 then
    raise exception 'note_too_long' using errcode = '22023', hint = 'note_too_long';
  end if;
  v_note := nullif(btrim(p_note), '');

  -- Serializa por usuario (el índice único parcial es la red de seguridad).
  perform pg_advisory_xact_lock(hashtextextended('sl:pool-creation-request:' || v_uid::text, 0));

  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'profile_required' using errcode = 'P0001', hint = 'profile_required';
  end if;
  if exists (select 1 from public.tenant_memberships m where m.profile_id = v_uid and m.is_active and m.role in ('owner', 'admin')) then
    raise exception 'already_organizer' using errcode = 'P0001', hint = 'already_organizer';
  end if;

  select * into r from public.pool_creation_requests where requester_id = v_uid and status = 'pending';
  if found then return public._pool_creation_request_json(r, false); end if;

  -- Aprobada y vigente (tenant existente) pero sin membresía administradora: se devuelve, no se duplica.
  select * into r from public.pool_creation_requests
   where requester_id = v_uid and status = 'approved' and tenant_id is not null
   order by requested_at desc limit 1;
  if found then return public._pool_creation_request_json(r, false); end if;

  select max(reviewed_at) into v_last_rejection from public.pool_creation_requests where requester_id = v_uid and status = 'rejected';
  if v_last_rejection is not null and v_last_rejection > now() - interval '7 days' then
    raise exception 'cooldown_active' using errcode = 'P0001', hint = 'cooldown_active',
      detail = 'retry_after=' || to_char(v_last_rejection + interval '7 days', 'YYYY-MM-DD"T"HH24:MI:SSOF');
  end if;
  -- Anti-spam (alta/cancelación en bucle): máximo 5 solicitudes por 24 horas.
  if (select count(*) from public.pool_creation_requests where requester_id = v_uid and requested_at > now() - interval '24 hours') >= 5 then
    raise exception 'rate_limited' using errcode = 'P0001', hint = 'rate_limited';
  end if;

  begin
    insert into public.pool_creation_requests(requester_id, note) values (v_uid, v_note) returning * into r;
    return public._pool_creation_request_json(r, true);
  exception when unique_violation then
    select * into r from public.pool_creation_requests where requester_id = v_uid and status = 'pending';
    if not found then raise; end if;
    return public._pool_creation_request_json(r, false);
  end;
end $$;

create function public.my_pool_creation_request() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); r public.pool_creation_requests;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into r from public.pool_creation_requests where requester_id = v_uid order by requested_at desc, created_at desc limit 1;
  if not found then return null; end if;
  return public._pool_creation_request_json(r);
end $$;

create function public.cancel_pool_creation_request() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); r public.pool_creation_requests;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('sl:pool-creation-request:' || v_uid::text, 0));
  select * into r from public.pool_creation_requests where requester_id = v_uid and status = 'pending' for update;
  if not found then raise exception 'no_pending_request' using errcode = 'P0001', hint = 'no_pending_request'; end if;
  update public.pool_creation_requests set status = 'cancelled', cancelled_at = clock_timestamp() where id = r.id returning * into r;
  return public._pool_creation_request_json(r);
end $$;

revoke all on function public.request_pool_creation(text), public.my_pool_creation_request(), public.cancel_pool_creation_request() from public, anon;
grant execute on function public.request_pool_creation(text), public.my_pool_creation_request(), public.cancel_pool_creation_request() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Revisión por OPERADOR (solo service_role; nunca expuesta a clientes)
-- ---------------------------------------------------------------------------------------------------------------
-- Aprobar = crear el tenant (plan free, administración 'tenant' por defecto, sin quinielas) + membresía 'owner' activa del
-- solicitante + marcar la solicitud, todo en una transacción. Idempotente: repetir la misma decisión devuelve el estado.
-- reviewed_by queda NULL: el operador actúa como service_role sin sesión de usuario (el actor consta en el evento y en audit_log).
create function public.review_pool_creation_request(p_request_id uuid, p_decision text, p_note text default null, p_tenant_name text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r public.pool_creation_requests;
  v_name text;
  v_tenant uuid;
  v_review_note text := nullif(btrim(p_note), '');
  v_display text;
begin
  -- Defensa en profundidad (la ACL ya limita a service_role): una sesión de usuario nunca revisa.
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'decision must be approve or reject' using errcode = '22023', hint = 'invalid_decision';
  end if;
  if v_review_note is not null and char_length(v_review_note) > 500 then
    raise exception 'review note too long' using errcode = '22023', hint = 'note_too_long';
  end if;

  select * into r from public.pool_creation_requests where id = p_request_id for update;
  if not found then raise exception 'request_not_found' using errcode = '22023', hint = 'request_not_found'; end if;

  if r.status = 'cancelled' then
    raise exception 'request_cancelled' using errcode = 'P0001', hint = 'request_cancelled';
  end if;
  if r.status <> 'pending' then
    -- Idempotencia: la misma decisión devuelve el estado; la contraria no se permite.
    if (r.status = 'approved' and p_decision = 'approve') or (r.status = 'rejected' and p_decision = 'reject') then
      return public._pool_creation_request_json(r, false);
    end if;
    raise exception 'already_reviewed' using errcode = 'P0001', hint = 'already_reviewed';
  end if;

  if p_decision = 'reject' then
    update public.pool_creation_requests
       set status = 'rejected', reviewed_at = clock_timestamp(), review_note = v_review_note
     where id = r.id returning * into r;
    return public._pool_creation_request_json(r, true);
  end if;

  -- Aprobar.
  if exists (select 1 from public.tenant_memberships m where m.profile_id = r.requester_id and m.is_active and m.role in ('owner', 'admin')) then
    raise exception 'already_organizer' using errcode = 'P0001', hint = 'already_organizer';
  end if;
  select p.display_name into v_display from public.profiles p where p.id = r.requester_id;
  v_name := btrim(coalesce(p_tenant_name, 'Quinielas de ' || coalesce(v_display, 'organizador')));
  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'tenant name must be 1..120 characters' using errcode = '22023', hint = 'invalid_tenant_name';
  end if;

  insert into public.tenants(name) values (v_name) returning id into v_tenant;
  insert into public.tenant_entitlements(tenant_id, plan_code) values (v_tenant, 'free');
  insert into public.tenant_memberships(tenant_id, profile_id, role, is_active) values (v_tenant, r.requester_id, 'owner', true);

  update public.pool_creation_requests
     set status = 'approved', tenant_id = v_tenant, reviewed_at = clock_timestamp(), review_note = v_review_note
   where id = r.id returning * into r;

  insert into public.audit_log(tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_tenant, null, 'pool_creation_requests.approve', 'pool_creation_requests', r.id,
          jsonb_build_object('requester_id', r.requester_id, 'channel', 'operator', 'plan', 'free'));
  return public._pool_creation_request_json(r, true);
end $$;

revoke all on function public.review_pool_creation_request(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.review_pool_creation_request(uuid, text, text, text) to service_role;
