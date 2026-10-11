-- Fase 08 (núcleo): leaderboard general / por jornada / rachas, calculado en servidor y de solo lectura. Forward-only.
-- Reglas: puntos = evento de scoring de la revisión de resultado y versión de regla más recientes por predicción (idempotente
-- con ADR-012); solo participantes aprobados, no retirados y no excluidos por administración (ADR-015); un partido sin pronóstico
-- cuenta como fallo para la racha; desempate según pool_rules.tie_breaker; el rango se comparte en empates reales.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function public.pool_leaderboard(p_pool_id uuid, p_round_id uuid default null)
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

revoke all on function public.pool_leaderboard(uuid, uuid) from public, anon;
grant execute on function public.pool_leaderboard(uuid, uuid) to authenticated;
