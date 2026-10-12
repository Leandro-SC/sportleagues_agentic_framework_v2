-- DOWN de 20261016000100_tickets_stage1_free.sql. NO se ejecuta automáticamente. Solo válido mientras NO existan tickets (aborta si los hay):
-- los tickets y sus selecciones son datos de usuario; para conservarlos no se hace rollback sino corrección hacia adelante.
-- Restaura la unicidad de predictions, save_prediction, pool_leaderboard y pool_points_evolution previos.
set local lock_timeout = '5s';
do $$ begin
  if exists (select 1 from public.tickets) or exists (select 1 from public.predictions where ticket_id is not null) then
    raise exception 'tickets exist: rollback refused (forward-fix instead)' using errcode = '42501';
  end if;
end $$;

create or replace function public.pool_leaderboard(p_pool_id uuid, p_round_id uuid default null)
returns table (
  rank integer, participant_id uuid, display_name text, points bigint, exact_hits integer, outcome_hits integer,
  played integer, current_streak integer, best_streak integer, is_me boolean
)
language plpgsql stable security definer set search_path = ''
as $$
declare v_tenant uuid; v_tie public.tie_breaker_kind;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select tenant_id into v_tenant from public.pools where id = p_pool_id;
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
    select pm.id as pool_match_id, pm.lock_at, m.id as match_id, m.starts_at, r.home_score as rh, r.away_score as ra
      from public.pool_matches pm
      join public.matches m on m.id = pm.match_id and m.tenant_id = pm.tenant_id
      join public.official_results r on r.match_id = m.id and r.tenant_id = m.tenant_id
     where pm.pool_id = p_pool_id and pm.tenant_id = v_tenant and (p_round_id is null or m.round_id = p_round_id)
  ),
  grid as (
    select pa.participant_id, pmx.match_id, pmx.starts_at, pmx.lock_at, pd.id as prediction_id, pd.updated_at,
           (pd.id is not null and pd.home_score = pmx.rh and pd.away_score = pmx.ra) as is_exact,
           coalesce((select se.points from public.scoring_events se where se.prediction_id = pd.id
                      order by se.result_revision desc, se.rule_version desc limit 1), 0) as pts
      from parts pa
      cross join played_matches pmx
      left join public.predictions pd on pd.participant_id = pa.participant_id and pd.pool_match_id = pmx.pool_match_id
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

create or replace function public.pool_points_evolution(p_pool_id uuid)
returns table (round_id uuid, round_name text, sort_order integer, my_points bigint, my_cumulative bigint, avg_points numeric, best_points bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare v_tenant uuid;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select tenant_id into v_tenant from public.pools where id = p_pool_id;
  if v_tenant is null or not public.is_tenant_member(v_tenant) then raise exception 'not authorized' using errcode = '42501'; end if;

  return query
  with parts as (
    select p.id as participant_id, (p.profile_id = auth.uid()) as is_me
      from public.participants p
     where p.pool_id = p_pool_id and p.tenant_id = v_tenant and p.approval_status = 'approved' and p.withdrawn_at is null
       and not public.is_pool_excluded(p.pool_id, p.profile_id)
  ),
  per as (
    select pa.participant_id, pa.is_me, m.round_id,
           coalesce(sum((select se.points from public.scoring_events se where se.prediction_id = pd.id
                          order by se.result_revision desc, se.rule_version desc limit 1)), 0)::bigint as pts
      from parts pa
      cross join (select pm.id as pool_match_id, mt.round_id from public.pool_matches pm
                    join public.matches mt on mt.id = pm.match_id and mt.tenant_id = pm.tenant_id
                    join public.official_results r on r.match_id = mt.id and r.tenant_id = mt.tenant_id
                   where pm.pool_id = p_pool_id and pm.tenant_id = v_tenant) m
      left join public.predictions pd on pd.participant_id = pa.participant_id and pd.pool_match_id = m.pool_match_id
     group by pa.participant_id, pa.is_me, m.round_id
  ),
  rounds_agg as (
    select pe.round_id,
           max(pe.pts) filter (where pe.is_me) as mine,
           round(avg(pe.pts), 2) as avg_pts,
           max(pe.pts) as best
      from per pe group by pe.round_id
  )
  select ra.round_id, r.name, r.sort_order, ra.mine,
         case when ra.mine is null then null else sum(ra.mine) over (order by r.sort_order, ra.round_id) end::bigint,
         ra.avg_pts, ra.best
    from rounds_agg ra join public.rounds r on r.id = ra.round_id
   order by r.sort_order, ra.round_id;
end $$;

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
       for share of pm)
  insert into public.predictions(tenant_id, pool_id, pool_match_id, participant_id, home_score, away_score)
  select tenant_id, pool_id, pool_match_id, participant_id, p_home_score, p_away_score from target
   where clock_timestamp() < lock_at
  on conflict (participant_id, pool_match_id) do update
     set home_score = excluded.home_score, away_score = excluded.away_score, updated_at = now()
  returning * into v_prediction;
  if not found then raise exception 'prediction is unavailable, unauthorized, or locked' using errcode = '42501'; end if;
  return v_prediction;
end $$;

drop function if exists public.pool_ticket_leaderboard(uuid, uuid), public.list_my_tickets(uuid), public.cancel_ticket(uuid), public.submit_ticket(uuid),
  public.save_ticket_prediction(uuid, uuid, integer, integer), public.create_ticket(uuid, uuid, uuid), public.configure_pool_round(uuid, uuid, smallint),
  public.enable_pool_tickets(uuid, smallint), public._ticket_points(uuid), public._round_first_lock(uuid, uuid);
drop trigger if exists predictions_ticket_guard on public.predictions;
drop trigger if exists audit_pools_ticketing on public.pools;
drop trigger if exists pools_ticketing_guard on public.pools;
drop index if exists public.predictions_ticket_pool_match_key;
drop index if exists public.predictions_participant_pool_match_noticket_key;
alter table public.predictions add constraint predictions_participant_id_pool_match_id_key unique (participant_id, pool_match_id);
alter table public.predictions drop constraint if exists predictions_ticket_participant_fkey, drop constraint if exists predictions_ticket_pool_fkey;
drop index if exists public.predictions_ticket_id_idx;
alter table public.predictions drop column ticket_id;
drop table public.tickets;
drop table public.pool_rounds;
drop sequence if exists public.tickets_ticket_no_seq;
alter table public.pools drop column ticketing_mode;
drop function if exists public.tg_pools_ticketing_guard(), public.tg_pool_rounds_guard(), public.tg_tickets_guard(), public.tg_predictions_ticket_guard();
drop type public.ticket_eligibility; drop type public.ticket_status; drop type public.ticketing_mode;
