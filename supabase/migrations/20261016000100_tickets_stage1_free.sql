-- ADR-014 Etapa 1 (aprobada por el propietario, 2026-10-11): tickets SIN procesamiento económico. Forward-only y atómica.
-- No hay pagos, ledger, precios ni pasarelas. Decisiones: D3 máximo por jornada vendible (1 por defecto), D5 la venta cierra antes del
-- primer bloqueo de la jornada, D6-b gracia 0, D8 mejor ticket elegible (más puntos → más exactos → envío más temprano → ticket_no),
-- D16 sin cambios (ADR-015). Los pools existentes conservan ticketing_mode = 'none' y sus pronósticos sin tocar (ticket_id NULL).
-- La unicidad de predictions y save_prediction se cambian EN ESTA MISMA TRANSACCIÓN (ADR-014 P4: ON CONFLICT exige el predicado).
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Modelo
-- ---------------------------------------------------------------------------------------------------------------
create type public.ticketing_mode as enum ('none', 'tickets');
create type public.ticket_status as enum ('draft', 'submitted', 'cancelled');
create type public.ticket_eligibility as enum ('pending', 'eligible', 'ineligible');

alter table public.pools add column ticketing_mode public.ticketing_mode not null default 'none';

create table public.pool_rounds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  pool_id uuid not null,
  round_id uuid not null,
  max_tickets_per_participant smallint not null default 1 check (max_tickets_per_participant between 1 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pool_id, round_id),
  unique (id, tenant_id, pool_id),
  foreign key (pool_id, tenant_id) references public.pools(id, tenant_id) on delete restrict,
  foreign key (round_id, tenant_id) references public.rounds(id, tenant_id) on delete restrict
);
create trigger pool_rounds_set_updated_at before update on public.pool_rounds for each row execute function public.set_updated_at();

create sequence public.tickets_ticket_no_seq;   -- gap-tolerant (ADR-014 §12); el número visible se deriva por participante/jornada
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  pool_id uuid not null,
  pool_round_id uuid not null,
  participant_id uuid not null,
  ticket_no bigint not null default nextval('public.tickets_ticket_no_seq'),
  idempotency_key uuid not null,
  status public.ticket_status not null default 'draft',
  eligibility public.ticket_eligibility not null default 'pending',
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (participant_id, idempotency_key),
  unique (id, tenant_id, pool_id),
  unique (id, participant_id),
  foreign key (pool_round_id, tenant_id, pool_id) references public.pool_rounds(id, tenant_id, pool_id) on delete restrict,
  foreign key (participant_id, tenant_id, pool_id) references public.participants(id, tenant_id, pool_id) on delete restrict,
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check (status <> 'submitted' or submitted_at is not null)
);
create index tickets_participant_round_idx on public.tickets (participant_id, pool_round_id);
create index tickets_pool_round_idx on public.tickets (pool_round_id) where status = 'submitted';
create trigger tickets_set_updated_at before update on public.tickets for each row execute function public.set_updated_at();

alter table public.predictions add column ticket_id uuid;
alter table public.predictions add constraint predictions_ticket_participant_fkey
  foreign key (ticket_id, participant_id) references public.tickets(id, participant_id) on delete restrict;
alter table public.predictions add constraint predictions_ticket_pool_fkey
  foreign key (ticket_id, tenant_id, pool_id) references public.tickets(id, tenant_id, pool_id) on delete restrict;
create index predictions_ticket_id_idx on public.predictions (ticket_id) where ticket_id is not null;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Unicidad y save_prediction: intercambio atómico (los registros existentes tienen ticket_id NULL y cumplen la nueva unicidad)
-- ---------------------------------------------------------------------------------------------------------------
alter table public.predictions drop constraint predictions_participant_id_pool_match_id_key;
create unique index predictions_participant_pool_match_noticket_key on public.predictions (participant_id, pool_match_id) where ticket_id is null;
create unique index predictions_ticket_pool_match_key on public.predictions (ticket_id, pool_match_id) where ticket_id is not null;

create or replace function public.save_prediction(p_pool_id uuid, p_match_id uuid, p_home_score integer, p_away_score integer)
returns public.predictions language plpgsql security definer set search_path = public, auth
as $$
declare v_prediction public.predictions; v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_home_score < 0 or p_away_score < 0 then raise exception 'scores must be non-negative' using errcode = '22023'; end if;
  with target as (
    select pm.id as pool_match_id, pm.tenant_id, pm.pool_id, p.id as participant_id, pm.lock_at
      from public.pool_matches pm
      join public.matches m on m.id = pm.match_id and m.tenant_id = pm.tenant_id
      join public.pools pool on pool.id = pm.pool_id and pool.tenant_id = pm.tenant_id
      join public.participants p on p.pool_id = pm.pool_id and p.tenant_id = pm.tenant_id
     where pm.pool_id = p_pool_id and pm.match_id = p_match_id and p.profile_id = v_user
       and p.approval_status = 'approved' and p.withdrawn_at is null
       and pool.status = 'open' and m.status = 'scheduled'
       and pool.ticketing_mode = 'none'                 -- en quinielas con tickets los pronósticos pertenecen a un ticket
       for share of pm)
  insert into public.predictions(tenant_id, pool_id, pool_match_id, participant_id, home_score, away_score)
  select tenant_id, pool_id, pool_match_id, participant_id, p_home_score, p_away_score from target
   where clock_timestamp() < lock_at
  on conflict (participant_id, pool_match_id) where ticket_id is null do update
     set home_score = excluded.home_score, away_score = excluded.away_score, updated_at = now()
  returning * into v_prediction;
  if not found then raise exception 'prediction is unavailable, unauthorized, or locked' using errcode = '42501'; end if;
  return v_prediction;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Guardas de integridad (también para service_role y propietario de tabla)
-- ---------------------------------------------------------------------------------------------------------------
create function public.tg_pools_ticketing_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.ticketing_mode <> 'none' then raise exception 'a pool starts without tickets; enable them explicitly' using errcode = '42501'; end if;
    return new;
  end if;
  if new.ticketing_mode is distinct from old.ticketing_mode then
    if old.ticketing_mode <> 'none' or new.ticketing_mode <> 'tickets' then
      raise exception 'ticketing mode is irreversible (none -> tickets only)' using errcode = '42501';
    end if;
    if exists (select 1 from public.predictions pr where pr.pool_id = new.id) then
      raise exception 'tickets cannot be enabled on a pool that already has predictions' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger pools_ticketing_guard before insert or update of ticketing_mode on public.pools
  for each row execute function public.tg_pools_ticketing_guard();

create function public.tg_pool_rounds_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'sellable rounds are never deleted' using errcode = '42501'; end if;
  if tg_op = 'UPDATE' and (new.tenant_id is distinct from old.tenant_id or new.pool_id is distinct from old.pool_id or new.round_id is distinct from old.round_id) then
    raise exception 'pool round identity is immutable' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and not exists (select 1 from public.pools p where p.id = new.pool_id and p.tenant_id = new.tenant_id and p.ticketing_mode = 'tickets') then
    raise exception 'tickets are not enabled in this pool' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger pool_rounds_guard before insert or update or delete on public.pool_rounds
  for each row execute function public.tg_pool_rounds_guard();

create function public.tg_tickets_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'tickets are never deleted; cancel them' using errcode = '42501'; end if;
  if tg_op = 'UPDATE' then
    if new.tenant_id is distinct from old.tenant_id or new.pool_id is distinct from old.pool_id or new.pool_round_id is distinct from old.pool_round_id
       or new.participant_id is distinct from old.participant_id or new.idempotency_key is distinct from old.idempotency_key or new.ticket_no is distinct from old.ticket_no then
      raise exception 'ticket identity is immutable' using errcode = '42501';
    end if;
    if old.status = 'cancelled' then raise exception 'a cancelled ticket cannot change' using errcode = '42501'; end if;
    if old.status = 'submitted' and new.status = 'draft' then raise exception 'a submitted ticket cannot return to draft' using errcode = '42501'; end if;
    if old.eligibility <> 'pending' and new.eligibility is distinct from old.eligibility and not (new.status = 'cancelled' and new.eligibility = 'ineligible') then
      raise exception 'ticket eligibility is frozen' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger tickets_guard before update or delete on public.tickets
  for each row execute function public.tg_tickets_guard();

create function public.tg_predictions_ticket_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_mode public.ticketing_mode; v_status public.ticket_status; v_round uuid; v_match_round uuid;
begin
  select p.ticketing_mode into v_mode from public.pools p where p.id = new.pool_id and p.tenant_id = new.tenant_id;
  if tg_op = 'UPDATE' and new.ticket_id is distinct from old.ticket_id then
    raise exception 'prediction ticket is immutable' using errcode = '42501';
  end if;
  if v_mode = 'tickets' and new.ticket_id is null then
    raise exception 'predictions in a pool with tickets must belong to a ticket' using errcode = '42501';
  end if;
  if v_mode = 'none' and new.ticket_id is not null then
    raise exception 'this pool does not use tickets' using errcode = '42501';
  end if;
  if new.ticket_id is not null then
    select t.status, pr.round_id into v_status, v_round
      from public.tickets t join public.pool_rounds pr on pr.id = t.pool_round_id
     where t.id = new.ticket_id and t.participant_id = new.participant_id;
    if v_status is null then raise exception 'ticket not found for this participant' using errcode = '23503'; end if;
    if v_status = 'cancelled' then raise exception 'a cancelled ticket cannot receive predictions' using errcode = '42501'; end if;
    select m.round_id into v_match_round from public.pool_matches pm join public.matches m on m.id = pm.match_id and m.tenant_id = pm.tenant_id where pm.id = new.pool_match_id;
    if v_match_round is distinct from v_round then raise exception 'the match does not belong to the ticket round' using errcode = '23503'; end if;
  end if;
  return new;
end $$;
create trigger predictions_ticket_guard before insert or update on public.predictions
  for each row execute function public.tg_predictions_ticket_guard();

revoke all on function public.tg_pools_ticketing_guard(), public.tg_pool_rounds_guard(), public.tg_tickets_guard(), public.tg_predictions_ticket_guard() from public, anon, authenticated;

create trigger audit_pool_rounds after insert or update on public.pool_rounds
  for each row execute function public.tg_audit_row_change('round_id,max_tickets_per_participant');
create trigger audit_tickets after insert or update on public.tickets
  for each row execute function public.tg_audit_row_change('pool_round_id,participant_id,status,eligibility');
create trigger audit_pools_ticketing after update of ticketing_mode on public.pools
  for each row execute function public.tg_audit_row_change('ticketing_mode');

-- ---------------------------------------------------------------------------------------------------------------
-- 4. RLS y privilegios: lectura acotada; toda escritura por RPC
-- ---------------------------------------------------------------------------------------------------------------
alter table public.pool_rounds enable row level security;
create policy pool_rounds_select_member on public.pool_rounds for select to authenticated using (public.is_tenant_member(tenant_id));
alter table public.tickets enable row level security;
create policy tickets_select_owner_or_admin on public.tickets for select to authenticated using (
  public.is_tenant_admin(tenant_id)
  or exists (select 1 from public.participants p where p.id = tickets.participant_id and p.profile_id = auth.uid()));
revoke all on public.pool_rounds, public.tickets from anon, authenticated;
grant select on public.pool_rounds, public.tickets to authenticated;
revoke all on sequence public.tickets_ticket_no_seq from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Ayudas internas
-- ---------------------------------------------------------------------------------------------------------------
create function public._round_first_lock(p_pool_id uuid, p_round_id uuid) returns timestamptz
language sql stable security definer set search_path = ''
as $$
  select min(pm.lock_at) from public.pool_matches pm join public.matches m on m.id = pm.match_id and m.tenant_id = pm.tenant_id
   where pm.pool_id = p_pool_id and m.round_id = p_round_id
$$;

-- Puntos por ticket (todas las jugadas del pool): eventos de scoring de la revisión/regla más reciente por predicción.
create function public._ticket_points(p_pool_id uuid)
returns table (ticket_id uuid, participant_id uuid, pool_round_id uuid, round_id uuid, ticket_no bigint, status public.ticket_status,
               eligibility public.ticket_eligibility, submitted_at timestamptz, created_at timestamptz,
               points bigint, exact_n integer, outcome_n integer, selections integer)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.participant_id, t.pool_round_id, pr.round_id, t.ticket_no, t.status, t.eligibility, t.submitted_at, t.created_at,
         coalesce(agg.points, 0)::bigint, coalesce(agg.exact_n, 0)::integer, coalesce(agg.outcome_n, 0)::integer,
         (select count(*)::integer from public.predictions x where x.ticket_id = t.id)
    from public.tickets t
    join public.pool_rounds pr on pr.id = t.pool_round_id
    left join (
      select pd.ticket_id as tid,
             sum(coalesce(ev.points, 0)) as points,
             count(*) filter (where pd.home_score = r.home_score and pd.away_score = r.away_score) as exact_n,
             count(*) filter (where coalesce(ev.points, 0) > 0 and not (pd.home_score = r.home_score and pd.away_score = r.away_score)) as outcome_n
        from public.predictions pd
        join public.pool_matches pm on pm.id = pd.pool_match_id
        join public.official_results r on r.match_id = pm.match_id and r.tenant_id = pm.tenant_id
        left join lateral (select se.points from public.scoring_events se where se.prediction_id = pd.id
                            order by se.result_revision desc, se.rule_version desc limit 1) ev on true
       where pd.ticket_id is not null and pd.pool_id = p_pool_id
       group by pd.ticket_id) agg on agg.tid = t.id
   where t.pool_id = p_pool_id
$$;
revoke all on function public._round_first_lock(uuid, uuid), public._ticket_points(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. RPC de administración
-- ---------------------------------------------------------------------------------------------------------------
create function public.enable_pool_tickets(p_pool_id uuid, p_default_max smallint default 1)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid; v_status public.pool_status; v_n integer;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select tenant_id, status into v_tenant, v_status from public.pools where id = p_pool_id for update;
  if v_tenant is null then raise exception 'pool not found' using errcode = '22023'; end if;
  if not public.is_tenant_admin(v_tenant) then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_status = 'archived' then raise exception 'an archived pool cannot enable tickets' using errcode = '42501'; end if;
  if p_default_max is null or p_default_max < 1 or p_default_max > 20 then raise exception 'invalid ticket limit' using errcode = '22023'; end if;
  update public.pools set ticketing_mode = 'tickets' where id = p_pool_id and ticketing_mode = 'none';   -- el trigger exige que no haya pronósticos
  insert into public.pool_rounds(tenant_id, pool_id, round_id, max_tickets_per_participant)
    select distinct v_tenant, p_pool_id, m.round_id, p_default_max
      from public.pool_matches pm join public.matches m on m.id = pm.match_id and m.tenant_id = pm.tenant_id
     where pm.pool_id = p_pool_id
    on conflict (pool_id, round_id) do nothing;
  select count(*) into v_n from public.pool_rounds where pool_id = p_pool_id;
  return v_n;
end $$;

create function public.configure_pool_round(p_pool_id uuid, p_round_id uuid, p_max smallint)
returns public.pool_rounds language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid; v_mode public.ticketing_mode; v_row public.pool_rounds; v_first timestamptz; v_used integer;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select tenant_id, ticketing_mode into v_tenant, v_mode from public.pools where id = p_pool_id for share;
  if v_tenant is null then raise exception 'pool not found' using errcode = '22023'; end if;
  if not public.is_tenant_admin(v_tenant) then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_mode <> 'tickets' then raise exception 'tickets are not enabled in this pool' using errcode = '42501'; end if;
  if p_max is null or p_max < 1 or p_max > 20 then raise exception 'invalid ticket limit' using errcode = '22023'; end if;
  v_first := public._round_first_lock(p_pool_id, p_round_id);
  if v_first is null then raise exception 'the round has no matches in this pool' using errcode = '22023'; end if;
  if v_first <= clock_timestamp() then raise exception 'ticket sales for this round are closed' using errcode = '42501'; end if;
  select coalesce(max(c), 0) into v_used from (
    select count(*) c from public.tickets t join public.pool_rounds pr on pr.id = t.pool_round_id
     where pr.pool_id = p_pool_id and pr.round_id = p_round_id and t.status <> 'cancelled' group by t.participant_id) x;
  if p_max < v_used then raise exception 'the limit cannot be lower than tickets already issued' using errcode = '22023'; end if;
  insert into public.pool_rounds(tenant_id, pool_id, round_id, max_tickets_per_participant) values (v_tenant, p_pool_id, p_round_id, p_max)
    on conflict (pool_id, round_id) do update set max_tickets_per_participant = excluded.max_tickets_per_participant
    returning * into v_row;
  return v_row;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. RPC del participante (orden de bloqueo: participante → ticket; reloj tras los bloqueos)
-- ---------------------------------------------------------------------------------------------------------------
create function public.create_ticket(p_pool_id uuid, p_round_id uuid, p_idempotency_key uuid)
returns public.tickets language plpgsql security definer set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_part public.participants; v_mode public.ticketing_mode; v_status public.pool_status;
        v_pr public.pool_rounds; v_row public.tickets; v_first timestamptz; v_used integer;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_idempotency_key is null then raise exception 'an idempotency key is required' using errcode = '22023'; end if;
  select p.* into v_part from public.participants p where p.pool_id = p_pool_id and p.profile_id = v_user for update;   -- 1.º participante
  if not found or v_part.approval_status <> 'approved' or v_part.withdrawn_at is not null then
    raise exception 'only approved participants can create tickets' using errcode = '42501';
  end if;
  perform public.assert_pool_participation_allowed(p_pool_id, v_user);   -- ADR-015: administradores (actuales o históricos) excluidos
  select ticketing_mode, status into v_mode, v_status from public.pools where id = p_pool_id and tenant_id = v_part.tenant_id;
  if v_mode is distinct from 'tickets' or v_status <> 'open' then raise exception 'tickets are not available in this pool' using errcode = '42501'; end if;
  select * into v_pr from public.pool_rounds where pool_id = p_pool_id and round_id = p_round_id for share;
  if not found then raise exception 'this round is not sellable' using errcode = '22023'; end if;
  select * into v_row from public.tickets where participant_id = v_part.id and idempotency_key = p_idempotency_key;
  if found then   -- reintento de la misma intención de compra
    if v_row.pool_round_id <> v_pr.id then raise exception 'idempotency key already used for another round' using errcode = 'PT409'; end if;
    return v_row;
  end if;
  v_first := public._round_first_lock(p_pool_id, p_round_id);
  if v_first is null or clock_timestamp() >= v_first then raise exception 'ticket sales for this round are closed' using errcode = '42501'; end if;
  select count(*) into v_used from public.tickets t where t.participant_id = v_part.id and t.pool_round_id = v_pr.id and t.status <> 'cancelled';
  if v_used >= v_pr.max_tickets_per_participant then raise exception 'ticket limit reached for this round' using errcode = '42501', hint = 'TICKET_LIMIT'; end if;
  insert into public.tickets(tenant_id, pool_id, pool_round_id, participant_id, idempotency_key)
    values (v_part.tenant_id, p_pool_id, v_pr.id, v_part.id, p_idempotency_key) returning * into v_row;
  return v_row;
end $$;

create function public.save_ticket_prediction(p_ticket_id uuid, p_match_id uuid, p_home_score integer, p_away_score integer)
returns public.predictions language plpgsql security definer set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_prediction public.predictions;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_home_score is null or p_away_score is null or p_home_score < 0 or p_away_score < 0 then raise exception 'scores must be non-negative' using errcode = '22023'; end if;
  with target as (
    select pm.id as pool_match_id, pm.tenant_id, pm.pool_id, t.participant_id, t.id as ticket_id, pm.lock_at
      from public.tickets t
      join public.participants p on p.id = t.participant_id and p.tenant_id = t.tenant_id
      join public.pool_rounds pr on pr.id = t.pool_round_id
      join public.pools pool on pool.id = t.pool_id and pool.tenant_id = t.tenant_id
      join public.pool_matches pm on pm.pool_id = t.pool_id and pm.tenant_id = t.tenant_id and pm.match_id = p_match_id
      join public.matches m on m.id = pm.match_id and m.tenant_id = pm.tenant_id and m.round_id = pr.round_id
     where t.id = p_ticket_id and p.profile_id = v_user and p.approval_status = 'approved' and p.withdrawn_at is null
       and t.status in ('draft', 'submitted') and pool.status = 'open' and pool.ticketing_mode = 'tickets' and m.status = 'scheduled'
       for share of t, pm)
  insert into public.predictions(tenant_id, pool_id, pool_match_id, participant_id, ticket_id, home_score, away_score)
  select tenant_id, pool_id, pool_match_id, participant_id, ticket_id, p_home_score, p_away_score from target
   where clock_timestamp() < lock_at
  on conflict (ticket_id, pool_match_id) where ticket_id is not null do update
     set home_score = excluded.home_score, away_score = excluded.away_score, updated_at = now()
  returning * into v_prediction;
  if not found then raise exception 'prediction is unavailable, unauthorized, or locked' using errcode = '42501'; end if;
  return v_prediction;
end $$;

create function public.submit_ticket(p_ticket_id uuid)
returns public.tickets language plpgsql security definer set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_t public.tickets; v_first timestamptz; v_round uuid;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  perform 1 from public.participants p join public.tickets t on t.participant_id = p.id
    where t.id = p_ticket_id and p.profile_id = v_user for update of p;                      -- 1.º participante
  select t.* into v_t from public.tickets t join public.participants p on p.id = t.participant_id
    where t.id = p_ticket_id and p.profile_id = v_user and p.approval_status = 'approved' and p.withdrawn_at is null for update of t;   -- 2.º ticket
  if not found then raise exception 'ticket not found or not authorized' using errcode = '42501'; end if;
  perform public.assert_pool_participation_allowed(v_t.pool_id, v_user);
  if v_t.status = 'submitted' then return v_t; end if;   -- idempotente
  if v_t.status = 'cancelled' then raise exception 'a cancelled ticket cannot be submitted' using errcode = '42501'; end if;
  select round_id into v_round from public.pool_rounds where id = v_t.pool_round_id;
  v_first := public._round_first_lock(v_t.pool_id, v_round);
  if v_first is null or clock_timestamp() >= v_first then raise exception 'ticket sales for this round are closed' using errcode = '42501'; end if;
  if not exists (select 1 from public.predictions pr where pr.ticket_id = v_t.id) then raise exception 'a ticket needs at least one selection' using errcode = '22023'; end if;
  update public.tickets set status = 'submitted', eligibility = 'eligible', submitted_at = clock_timestamp() where id = v_t.id returning * into v_t;
  return v_t;
end $$;

create function public.cancel_ticket(p_ticket_id uuid)
returns public.tickets language plpgsql security definer set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_t public.tickets; v_first timestamptz; v_round uuid;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  perform 1 from public.participants p join public.tickets t on t.participant_id = p.id where t.id = p_ticket_id and p.profile_id = v_user for update of p;
  select t.* into v_t from public.tickets t join public.participants p on p.id = t.participant_id where t.id = p_ticket_id and p.profile_id = v_user for update of t;
  if not found then raise exception 'ticket not found or not authorized' using errcode = '42501'; end if;
  if v_t.status = 'cancelled' then return v_t; end if;   -- idempotente
  select round_id into v_round from public.pool_rounds where id = v_t.pool_round_id;
  v_first := public._round_first_lock(v_t.pool_id, v_round);
  if v_first is null or clock_timestamp() >= v_first then raise exception 'a ticket cannot be cancelled after its round closes' using errcode = '42501'; end if;
  update public.tickets set status = 'cancelled', eligibility = 'ineligible', cancelled_at = clock_timestamp() where id = v_t.id returning * into v_t;
  return v_t;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 8. Consulta e historial del participante
-- ---------------------------------------------------------------------------------------------------------------
create function public.list_my_tickets(p_pool_id uuid default null)
returns table (ticket_id uuid, pool_id uuid, pool_name text, round_id uuid, round_name text, display_no integer, status public.ticket_status,
               eligibility public.ticket_eligibility, created_at timestamptz, submitted_at timestamptz, selections integer, round_matches integer,
               results_count integer, points bigint, is_best boolean, max_tickets integer, sales_closes_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare v_pool record;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  for v_pool in
    select po.id, po.name from public.participants pa join public.pools po on po.id = pa.pool_id and po.tenant_id = pa.tenant_id
     where pa.profile_id = auth.uid() and po.ticketing_mode = 'tickets' and (p_pool_id is null or po.id = p_pool_id) and public.is_tenant_member(pa.tenant_id)
     order by po.name, po.id
  loop
    return query
    with mine as (
      select tp.*, row_number() over (partition by tp.participant_id, tp.pool_round_id order by tp.created_at, tp.ticket_no)::integer as dn,
             row_number() over (partition by tp.participant_id, tp.round_id
                                order by (tp.status = 'submitted' and tp.eligibility = 'eligible') desc, tp.points desc, tp.exact_n desc, tp.submitted_at asc nulls last, tp.ticket_no) as best_rn
        from public._ticket_points(v_pool.id) tp
       where tp.participant_id in (select pa.id from public.participants pa where pa.pool_id = v_pool.id and pa.profile_id = auth.uid())
    )
    select mine.ticket_id, v_pool.id, v_pool.name, mine.round_id, r.name, mine.dn, mine.status, mine.eligibility, mine.created_at, mine.submitted_at, mine.selections,
           (select count(*)::integer from public.pool_matches pm join public.matches m on m.id = pm.match_id and m.tenant_id = pm.tenant_id where pm.pool_id = v_pool.id and m.round_id = mine.round_id),
           (select count(*)::integer from public.pool_matches pm join public.matches m on m.id = pm.match_id and m.tenant_id = pm.tenant_id
              join public.official_results res on res.match_id = m.id and res.tenant_id = m.tenant_id where pm.pool_id = v_pool.id and m.round_id = mine.round_id),
           mine.points,
           (mine.best_rn = 1 and mine.status = 'submitted' and mine.eligibility = 'eligible'),
           (select prr.max_tickets_per_participant::integer from public.pool_rounds prr where prr.id = mine.pool_round_id),
           public._round_first_lock(v_pool.id, mine.round_id)
      from mine join public.rounds r on r.id = mine.round_id
     order by r.sort_order, mine.dn;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 9. Ranking: pool_leaderboard (misma firma) con mejor ticket elegible por participante y jornada (D8)
--    + ranking por ticket de una jornada
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.pool_leaderboard(p_pool_id uuid, p_round_id uuid default null)
returns table (
  rank integer, participant_id uuid, display_name text, points bigint, exact_hits integer, outcome_hits integer,
  played integer, current_streak integer, best_streak integer, is_me boolean
)
language plpgsql stable security definer set search_path = ''
as $$
declare v_tenant uuid; v_tie public.tie_breaker_kind; v_mode public.ticketing_mode;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select pl.tenant_id, pl.ticketing_mode into v_tenant, v_mode from public.pools pl where pl.id = p_pool_id;
  if v_tenant is null or not public.is_tenant_member(v_tenant) then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_round_id is not null and not exists (select 1 from public.rounds r where r.id = p_round_id and r.tenant_id = v_tenant) then
    raise exception 'round not found' using errcode = '22023';
  end if;
  select ru.tie_breaker into v_tie from public.pool_rules ru where ru.pool_id = p_pool_id and ru.is_current;

  return query
  with parts as (
    select p.id as participant_id, p.profile_id, pr.display_name
      from public.participants p
      join public.profiles pr on pr.id = p.profile_id
     where p.pool_id = p_pool_id and p.tenant_id = v_tenant and p.approval_status = 'approved' and p.withdrawn_at is null
       and not public.is_pool_excluded(p.pool_id, p.profile_id)
  ),
  played_matches as (
    select pm.id as pool_match_id, pm.lock_at, m.id as match_id, m.round_id, m.starts_at, r.home_score as rh, r.away_score as ra
      from public.pool_matches pm
      join public.matches m on m.id = pm.match_id and m.tenant_id = pm.tenant_id
      join public.official_results r on r.match_id = m.id and r.tenant_id = m.tenant_id
     where pm.pool_id = p_pool_id and pm.tenant_id = v_tenant and (p_round_id is null or m.round_id = p_round_id)
  ),
  best as (   -- jugada que cuenta por (participante, jornada): sin tickets, la propia (ticket NULL); con tickets, el mejor elegible
    (select pa.participant_id, rr.round_id, null::uuid as ticket_id
       from parts pa cross join (select distinct x.round_id from played_matches x) rr
      where v_mode = 'none')
    union all
    (select distinct on (tp.participant_id, tp.round_id) tp.participant_id, tp.round_id, tp.ticket_id
       from public._ticket_points(p_pool_id) tp
      where v_mode = 'tickets' and tp.status = 'submitted' and tp.eligibility = 'eligible'
        and tp.participant_id in (select pa.participant_id from parts pa) and (p_round_id is null or tp.round_id = p_round_id)
      order by tp.participant_id, tp.round_id, tp.points desc, tp.exact_n desc, tp.submitted_at asc, tp.ticket_no asc)
  ),
  grid as (
    select pa.participant_id, pmx.match_id, pmx.starts_at, pmx.lock_at, pd.id as prediction_id, pd.updated_at,
           (pd.id is not null and pd.home_score = pmx.rh and pd.away_score = pmx.ra) as is_exact,
           coalesce((select se.points from public.scoring_events se where se.prediction_id = pd.id
                      order by se.result_revision desc, se.rule_version desc limit 1), 0) as pts
      from parts pa
      cross join played_matches pmx
      left join best b on b.participant_id = pa.participant_id and b.round_id = pmx.round_id
      left join public.predictions pd on b.participant_id is not null and pd.participant_id = pa.participant_id
                                      and pd.pool_match_id = pmx.pool_match_id and pd.ticket_id is not distinct from b.ticket_id
  ),
  marked as (
    select g.*, g.pts > 0 as hit,
           row_number() over (partition by g.participant_id order by g.starts_at, g.match_id) as rn,
           row_number() over (partition by g.participant_id, (g.pts > 0) order by g.starts_at, g.match_id) as rn_hit
      from grid g
  ),
  islands as (
    select m.participant_id, (m.rn - m.rn_hit) as island, count(*)::integer as len, max(m.rn) as last_rn
      from marked m where m.hit group by m.participant_id, (m.rn - m.rn_hit)
  ),
  streaks as (
    select i.participant_id, max(i.len) as best,
           coalesce(max(i.len) filter (where i.last_rn = (select max(m2.rn) from marked m2 where m2.participant_id = i.participant_id)), 0) as cur
      from islands i group by i.participant_id
  ),
  agg as (
    select pa.participant_id, pa.display_name,
           coalesce(sum(g.pts), 0)::bigint as total,
           count(*) filter (where g.is_exact)::integer as exact_n,
           count(*) filter (where g.pts > 0 and not g.is_exact)::integer as outcome_n,
           count(g.prediction_id)::integer as played_n,
           coalesce(sum(extract(epoch from (g.lock_at - g.updated_at))) filter (where g.prediction_id is not null), 0) as earliness
      from parts pa left join grid g on g.participant_id = pa.participant_id
     group by pa.participant_id, pa.display_name
  ),
  ranked as (
    select a.*, coalesce(s.best, 0) as best, coalesce(s.cur, 0) as cur,
           rank() over (order by a.total desc,
                        case when v_tie = 'exact_predictions' then a.exact_n end desc nulls last,
                        case when v_tie = 'prediction_submitted_at' then a.earliness end desc nulls last)::integer as rk
      from agg a left join streaks s on s.participant_id = a.participant_id
  )
  select r.rk, r.participant_id, r.display_name, r.total, r.exact_n, r.outcome_n, r.played_n, r.cur::integer, r.best::integer,
         exists (select 1 from public.participants me where me.id = r.participant_id and me.profile_id = auth.uid())
    from ranked r
   order by r.rk, r.display_name, r.participant_id;
end $$;

create function public.pool_ticket_leaderboard(p_pool_id uuid, p_round_id uuid)
returns table (rank integer, ticket_id uuid, participant_id uuid, display_name text, display_no integer, points bigint, exact_hits integer,
               outcome_hits integer, is_best boolean, is_mine boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare v_tenant uuid; v_mode public.ticketing_mode;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select pl.tenant_id, pl.ticketing_mode into v_tenant, v_mode from public.pools pl where pl.id = p_pool_id;
  if v_tenant is null or not public.is_tenant_member(v_tenant) then raise exception 'not authorized' using errcode = '42501'; end if;
  if not exists (select 1 from public.rounds r where r.id = p_round_id and r.tenant_id = v_tenant) then raise exception 'round not found' using errcode = '22023'; end if;
  if v_mode <> 'tickets' then return; end if;

  return query
  with elig as (
    select tp.*, pr.display_name, pa.profile_id,
           row_number() over (partition by tp.participant_id, tp.pool_round_id order by tp.created_at, tp.ticket_no)::integer as dn
      from public._ticket_points(p_pool_id) tp
      join public.participants pa on pa.id = tp.participant_id
      join public.profiles pr on pr.id = pa.profile_id
     where tp.round_id = p_round_id and pa.approval_status = 'approved' and pa.withdrawn_at is null
       and not public.is_pool_excluded(p_pool_id, pa.profile_id)
  ),
  live as (select e.* from elig e where e.status = 'submitted' and e.eligibility = 'eligible'),
  ranked as (
    select l.*, rank() over (order by l.points desc, l.exact_n desc)::integer as rk,
           row_number() over (partition by l.participant_id order by l.points desc, l.exact_n desc, l.submitted_at asc, l.ticket_no asc) as per_part
      from live l
  )
  select r.rk, r.ticket_id, r.participant_id, r.display_name, r.dn, r.points, r.exact_n, r.outcome_n, (r.per_part = 1), (r.profile_id = auth.uid())
    from ranked r order by r.rk, r.display_name, r.dn;
end $$;

-- Evolución por jornada: se apoya en pool_leaderboard por jornada (vale con y sin tickets)
create or replace function public.pool_points_evolution(p_pool_id uuid)
returns table (round_id uuid, round_name text, sort_order integer, my_points bigint, my_cumulative bigint, avg_points numeric, best_points bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare v_tenant uuid; v_round record; v_cum bigint := 0; v_mine bigint; v_has_me boolean; v_avg numeric; v_best bigint;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select pl.tenant_id into v_tenant from public.pools pl where pl.id = p_pool_id;
  if v_tenant is null or not public.is_tenant_member(v_tenant) then raise exception 'not authorized' using errcode = '42501'; end if;
  for v_round in
    select distinct r.id, r.name, r.sort_order
      from public.pool_matches pm
      join public.matches m on m.id = pm.match_id and m.tenant_id = pm.tenant_id
      join public.official_results res on res.match_id = m.id and res.tenant_id = m.tenant_id
      join public.rounds r on r.id = m.round_id
     where pm.pool_id = p_pool_id and pm.tenant_id = v_tenant
     order by r.sort_order, r.id
  loop
    select max(lb.points) filter (where lb.is_me), bool_or(lb.is_me), round(avg(lb.points), 2), max(lb.points)
      into v_mine, v_has_me, v_avg, v_best
      from public.pool_leaderboard(p_pool_id, v_round.id) lb;
    if v_has_me then v_cum := v_cum + coalesce(v_mine, 0); end if;
    return query select v_round.id, v_round.name, v_round.sort_order, case when v_has_me then v_mine end, case when v_has_me then v_cum end, coalesce(v_avg, 0), coalesce(v_best, 0);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 10. Grants
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function
  public.enable_pool_tickets(uuid, smallint), public.configure_pool_round(uuid, uuid, smallint),
  public.create_ticket(uuid, uuid, uuid), public.save_ticket_prediction(uuid, uuid, integer, integer),
  public.submit_ticket(uuid), public.cancel_ticket(uuid), public.list_my_tickets(uuid), public.pool_ticket_leaderboard(uuid, uuid)
  from public, anon;
grant execute on function
  public.enable_pool_tickets(uuid, smallint), public.configure_pool_round(uuid, uuid, smallint),
  public.create_ticket(uuid, uuid, uuid), public.save_ticket_prediction(uuid, uuid, integer, integer),
  public.submit_ticket(uuid), public.cancel_ticket(uuid), public.list_my_tickets(uuid), public.pool_ticket_leaderboard(uuid, uuid)
  to authenticated;
