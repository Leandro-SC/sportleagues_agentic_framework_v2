-- Fase 08: estadísticas de rendimiento, evolución de puntos por jornada y resumen «Mis puntos». Solo lectura, forward-only.
-- Reutiliza pool_leaderboard (misma fuente de verdad: eventos de scoring de la revisión/regla más reciente, sin administradores
-- ni retirados). Nada se calcula en el cliente. Solo miembros del tenant; los datos «propios» exigen ser participante aprobado.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Evolución por jornada con resultados: mis puntos, acumulado, promedio de la quiniela y mejor jornada del grupo.
create function public.pool_points_evolution(p_pool_id uuid)
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

-- Mis estadísticas en una quiniela (una fila; ninguna si no soy participante aprobado y vigente).
create function public.my_pool_stats(p_pool_id uuid)
returns table (rank integer, participants integer, points bigint, exact_hits integer, outcome_hits integer, results_count integer,
               played integer, hit_rate numeric, avg_points numeric, best_round_points bigint, current_streak integer, best_streak integer)
language plpgsql stable security definer set search_path = ''
as $$
declare v_tenant uuid;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select tenant_id into v_tenant from public.pools where id = p_pool_id;
  if v_tenant is null or not public.is_tenant_member(v_tenant) then raise exception 'not authorized' using errcode = '42501'; end if;

  return query
  with lb as (select * from public.pool_leaderboard(p_pool_id)),
  me as (select * from lb where lb.is_me),
  n as (select count(*)::integer as c from lb),
  res as (
    select count(*)::integer as c from public.pool_matches pm
      join public.official_results r on r.match_id = pm.match_id and r.tenant_id = pm.tenant_id
     where pm.pool_id = p_pool_id and pm.tenant_id = v_tenant
  ),
  best as (select max(e.my_points) as b from public.pool_points_evolution(p_pool_id) e)
  select me.rank, n.c, me.points, me.exact_hits, me.outcome_hits, res.c, me.played,
         case when res.c = 0 then 0 else round((me.exact_hits + me.outcome_hits)::numeric / res.c, 2) end,
         case when res.c = 0 then 0 else round(me.points::numeric / res.c, 2) end,
         coalesce(best.b, 0), me.current_streak, me.best_streak
    from me cross join n cross join res cross join best;
end $$;

-- «Mis puntos»: una fila por quiniela donde participo (aprobado, vigente y no excluido).
create function public.my_points_summary()
returns table (pool_id uuid, pool_name text, rank integer, participants integer, points bigint, exact_hits integer, current_streak integer)
language plpgsql stable security definer set search_path = ''
as $$
declare v_pool record;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  for v_pool in
    select po.id, po.name from public.participants pa
      join public.pools po on po.id = pa.pool_id and po.tenant_id = pa.tenant_id
     where pa.profile_id = auth.uid() and pa.approval_status = 'approved' and pa.withdrawn_at is null
       and public.is_tenant_member(pa.tenant_id)
     order by po.name, po.id
  loop
    return query
    select v_pool.id, v_pool.name, me.rank, (select count(*)::integer from public.pool_leaderboard(v_pool.id)), me.points, me.exact_hits, me.current_streak
      from public.pool_leaderboard(v_pool.id) me where me.is_me;
  end loop;
end $$;

revoke all on function public.pool_points_evolution(uuid), public.my_pool_stats(uuid), public.my_points_summary() from public, anon;
grant execute on function public.pool_points_evolution(uuid), public.my_pool_stats(uuid), public.my_points_summary() to authenticated;
