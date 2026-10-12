-- Fase 09: motor estadístico Elo + Poisson y auto-fill (AGENTS §7; docs/requirements/04-stats-engine.md; contrato en docs/architecture/STATS-ENGINE-CONTRACT.md).
-- PROPUESTA: no aplicada a ningún entorno. Forward-only y atómica (sin BEGIN/COMMIT propios: la inyecta el ejecutor).
-- Qué añade:
--   1. stats_model_params: parámetros VERSIONADOS e inmutables del modelo ('elo-poisson-v1' para fútbol).
--   2. team_ratings (existente, vacía: nadie la escribía) se extiende con deporte, partidos jugados, corte y corrida; unicidad
--      del estado vigente por (tenant, equipo, deporte, versión). stats_rating_runs deja huella reproducible de cada reconstrucción.
--   3. Funciones PURAS e IMMUTABLE (Elo, Poisson, matriz, 1X2, marcador más probable). Sin acceso a tablas ni aleatoriedad.
--   4. rebuild_team_ratings(): reconstrucción determinista desde TODOS los resultados oficiales vigentes (solo service_role).
--   5. suggest_scoreline(): RPC de lectura para el participante elegible (barrera ADR-015, lock server-side, sin escrituras).
-- No toca publish_official_result, scoring, lock ni RLS de otras tablas. El auto-fill es una estimación, nunca certeza ni consejo de apuesta.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Parámetros versionados (inmutables: una versión publicada nunca cambia; se publica una nueva)
-- ---------------------------------------------------------------------------------------------------------------
create table public.stats_model_params (
  model_version text not null check (model_version ~ '^[a-z0-9][a-z0-9._-]{1,39}$'),
  sport_code text not null references public.sports(code),
  is_current boolean not null default false,
  elo_initial numeric not null check (elo_initial between 100 and 5000),            -- rating de un equipo sin historial
  elo_scale numeric not null check (elo_scale between 50 and 2000),                 -- 400 = escala logística clásica
  elo_k numeric not null check (elo_k between 1 and 100),                           -- factor K
  elo_home_adv numeric not null check (elo_home_adv between -300 and 300),          -- ventaja local en puntos Elo (0 = campo neutral)
  elo_goal_margin boolean not null,                                                 -- multiplicador por diferencia de goles
  base_goals numeric not null check (base_goals between 0.1 and 10),                -- goles esperados por equipo con ratings iguales y sin ventaja
  goal_slope numeric not null check (goal_slope between 0 and 2),                   -- sensibilidad del λ al diferencial Elo (por escala)
  goal_dr_clamp numeric not null check (goal_dr_clamp between 0.5 and 5),           -- tope |diferencial| / escala antes de calcular λ
  max_goals smallint not null check (max_goals between 2 and 12),                   -- rango de la matriz 0..max_goals por equipo
  created_at timestamptz not null default now(),
  primary key (model_version, sport_code)
);
create unique index stats_model_params_one_current_per_sport on public.stats_model_params (sport_code) where is_current;

create function public.tg_stats_model_params_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'model parameters are immutable; publish a new model_version' using errcode = '42501';
  end if;
  if (new.model_version, new.sport_code, new.elo_initial, new.elo_scale, new.elo_k, new.elo_home_adv, new.elo_goal_margin,
      new.base_goals, new.goal_slope, new.goal_dr_clamp, new.max_goals)
     is distinct from
     (old.model_version, old.sport_code, old.elo_initial, old.elo_scale, old.elo_k, old.elo_home_adv, old.elo_goal_margin,
      old.base_goals, old.goal_slope, old.goal_dr_clamp, old.max_goals) then
    raise exception 'model parameters are immutable; publish a new model_version' using errcode = '42501';
  end if;
  return new;   -- solo is_current puede alternarse
end $$;
create trigger stats_model_params_guard before update or delete on public.stats_model_params
  for each row execute function public.tg_stats_model_params_guard();
revoke all on function public.tg_stats_model_params_guard() from public, anon, authenticated;

insert into public.stats_model_params
  (model_version, sport_code, is_current, elo_initial, elo_scale, elo_k, elo_home_adv, elo_goal_margin, base_goals, goal_slope, goal_dr_clamp, max_goals)
values ('elo-poisson-v1', 'football', true, 1500, 400, 20, 65, true, 1.35, 0.5, 2, 6);

alter table public.stats_model_params enable row level security;
create policy stats_model_params_select on public.stats_model_params for select to authenticated using (true);
revoke all on public.stats_model_params from anon, authenticated;
grant select on public.stats_model_params to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Estado: team_ratings extendida (sin romper su esquema) y huella de cada reconstrucción
-- ---------------------------------------------------------------------------------------------------------------
create table public.stats_rating_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sport_code text not null references public.sports(code),
  model_version text not null,
  params jsonb not null,                       -- copia exacta de los parámetros usados (reproducibilidad)
  matches_processed integer not null check (matches_processed >= 0),
  teams_rated integer not null check (teams_rated >= 0),
  results_fingerprint text not null,           -- md5 de (partido, revisión, marcador, inicio) en orden de proceso
  ratings_fingerprint text not null,           -- md5 de (equipo, rating, partidos) ordenado por equipo
  created_at timestamptz not null default now(),
  unique (id, tenant_id)
);
create index stats_rating_runs_tenant_idx on public.stats_rating_runs (tenant_id, sport_code, created_at desc);
alter table public.stats_rating_runs enable row level security;
create policy stats_rating_runs_select_admin on public.stats_rating_runs for select to authenticated using (public.is_tenant_admin(tenant_id));
revoke all on public.stats_rating_runs from anon, authenticated;
grant select on public.stats_rating_runs to authenticated;

alter table public.team_ratings
  add column sport_code text not null default 'football' references public.sports(code),
  add column matches_played integer not null default 0 check (matches_played >= 0),
  add column last_match_at timestamptz,
  add column run_id uuid;
alter table public.team_ratings
  add constraint team_ratings_run_fk foreign key (run_id, tenant_id) references public.stats_rating_runs(id, tenant_id);
-- Estado vigente único por equipo/deporte/versión (la tabla no tenía escritores ni filas antes de esta migración).
create unique index team_ratings_current_key on public.team_ratings (tenant_id, team_id, sport_code, model_version);
revoke insert, update, delete, truncate, references, trigger on public.team_ratings from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Funciones puras (IMMUTABLE, sin tablas ni aleatoriedad). Solo las ejecutan las funciones del motor y service_role.
-- ---------------------------------------------------------------------------------------------------------------
-- Probabilidad Elo de victoria local (empate = 0.5): E = 1 / (1 + 10^(-(Rh + ventaja - Ra)/escala)). Exponente acotado a ±50.
create function public.stats_elo_expected(
  p_r_home double precision, p_r_away double precision, p_home_adv double precision default 0, p_scale double precision default 400)
returns double precision
language plpgsql immutable strict parallel safe set search_path = ''
as $$
declare v_x double precision;
begin
  if not (abs(p_r_home) <= 100000 and abs(p_r_away) <= 100000 and abs(p_home_adv) <= 100000) or not (p_scale > 0 and p_scale <= 100000) then
    raise exception 'invalid elo arguments' using errcode = '22023';
  end if;
  v_x := greatest(-50::double precision, least(50::double precision, (p_r_home + p_home_adv - p_r_away) / p_scale));
  return 1 / (1 + power(10::double precision, -v_x));
end $$;

-- Actualización Elo de un partido. S = 1 / 0.5 / 0 según el marcador. delta = K * G * (S - E); suma cero (el visitante recibe -delta).
-- G (opcional): 1 si |dif| <= 1; 1.5 si 2; (11 + |dif|)/8 si >= 3 (convención World Football Elo). Ambos ratings se calculan con los valores PREVIOS.
create function public.stats_elo_update(
  p_r_home double precision, p_r_away double precision, p_goals_home integer, p_goals_away integer,
  p_k double precision default 20, p_home_adv double precision default 0, p_scale double precision default 400, p_goal_margin boolean default true,
  out new_home double precision, out new_away double precision)
language plpgsql immutable strict parallel safe set search_path = ''
as $$
declare v_e double precision; v_s double precision; v_g double precision; v_n integer; v_d double precision;
begin
  if p_goals_home < 0 or p_goals_away < 0 or p_goals_home > 1000 or p_goals_away > 1000 or not (p_k >= 0 and p_k <= 1000) then
    raise exception 'invalid elo update arguments' using errcode = '22023';
  end if;
  v_e := public.stats_elo_expected(p_r_home, p_r_away, p_home_adv, p_scale);
  v_s := case when p_goals_home > p_goals_away then 1 when p_goals_home = p_goals_away then 0.5 else 0 end;
  v_n := abs(p_goals_home - p_goals_away);
  v_g := case when not p_goal_margin or v_n <= 1 then 1 when v_n = 2 then 1.5 else (11 + v_n) / 8.0 end;
  v_d := p_k * v_g * (v_s - v_e);
  new_home := p_r_home + v_d;
  new_away := p_r_away - v_d;
end $$;

-- pmf de Poisson: e^-λ λ^k / k!, por recurrencia (sin lgamma). λ en [0, 100], k en [0, 200].
create function public.stats_poisson_pmf(p_k integer, p_lambda double precision)
returns double precision
language plpgsql immutable strict parallel safe set search_path = ''
as $$
declare v_p double precision; i integer;
begin
  if p_k < 0 or p_k > 200 or not (p_lambda >= 0 and p_lambda <= 100) then
    raise exception 'invalid poisson arguments' using errcode = '22023';
  end if;
  if p_lambda = 0 then return case when p_k = 0 then 1::double precision else 0::double precision end; end if;
  v_p := exp(-p_lambda);
  for i in 1..p_k loop v_p := v_p * p_lambda / i; end loop;
  return v_p;
end $$;

-- λ local/visitante desde el diferencial Elo. dr = clamp((Rh + ventaja - Ra)/escala, ±tope);
-- λh = base * exp(+pendiente*dr), λa = base * exp(-pendiente*dr)  (la media geométrica de λh y λa es siempre = base).
create function public.stats_goal_expectations(
  p_r_home double precision, p_r_away double precision, p_home_adv double precision default 0, p_base_goals double precision default 1.35,
  p_slope double precision default 0.5, p_scale double precision default 400, p_dr_clamp double precision default 2,
  out lambda_home double precision, out lambda_away double precision)
language plpgsql immutable strict parallel safe set search_path = ''
as $$
declare v_dr double precision;
begin
  if not (abs(p_r_home) <= 100000 and abs(p_r_away) <= 100000 and abs(p_home_adv) <= 100000)
     or not (p_scale > 0 and p_scale <= 100000) or not (p_base_goals > 0 and p_base_goals <= 20)
     or not (p_slope >= 0 and p_slope <= 10) or not (p_dr_clamp > 0 and p_dr_clamp <= 20) then
    raise exception 'invalid goal expectation arguments' using errcode = '22023';
  end if;
  v_dr := greatest(-p_dr_clamp, least(p_dr_clamp, (p_r_home + p_home_adv - p_r_away) / p_scale));
  lambda_home := p_base_goals * exp(p_slope * v_dr);
  lambda_away := p_base_goals * exp(-p_slope * v_dr);
end $$;

-- Matriz de marcadores (local 0..N x visitante 0..N), goles independientes. Se RENORMALIZA por la masa del rango:
-- prob(h,a) = pmf(h,λh) pmf(a,λa) / (Σ_i pmf(i,λh) · Σ_j pmf(j,λa)), de modo que las (N+1)^2 celdas suman 1.
create function public.stats_scoreline_matrix(p_lambda_home double precision, p_lambda_away double precision, p_max_goals integer default 6)
returns table (home_goals integer, away_goals integer, prob double precision)
language plpgsql immutable strict parallel safe set search_path = ''
as $$
declare v_ph double precision[] := '{}'; v_pa double precision[] := '{}'; v_sh double precision := 0; v_sa double precision := 0; i integer;
begin
  if p_max_goals < 1 or p_max_goals > 12 or not (p_lambda_home >= 0 and p_lambda_home <= 100) or not (p_lambda_away >= 0 and p_lambda_away <= 100) then
    raise exception 'invalid scoreline matrix arguments' using errcode = '22023';
  end if;
  for i in 0..p_max_goals loop
    v_ph := v_ph || public.stats_poisson_pmf(i, p_lambda_home);
    v_pa := v_pa || public.stats_poisson_pmf(i, p_lambda_away);
    v_sh := v_sh + v_ph[i + 1];
    v_sa := v_sa + v_pa[i + 1];
  end loop;
  return query
    select h.i, a.j, v_ph[h.i + 1] * v_pa[a.j + 1] / (v_sh * v_sa)
      from generate_series(0, p_max_goals) as h(i), generate_series(0, p_max_goals) as a(j)
     order by h.i, a.j;
end $$;

-- 1X2 derivado de la matriz renormalizada: local (h>a), empate (h=a), visitante (h<a). Suman 1 (±1e-12 en coma flotante).
create function public.stats_outcome_probs(
  p_lambda_home double precision, p_lambda_away double precision, p_max_goals integer default 6,
  out prob_home double precision, out prob_draw double precision, out prob_away double precision)
language plpgsql immutable strict parallel safe set search_path = ''
as $$
begin
  select coalesce(sum(m.prob) filter (where m.home_goals > m.away_goals), 0),
         coalesce(sum(m.prob) filter (where m.home_goals = m.away_goals), 0),
         coalesce(sum(m.prob) filter (where m.home_goals < m.away_goals), 0)
    into prob_home, prob_draw, prob_away
    from public.stats_scoreline_matrix(p_lambda_home, p_lambda_away, p_max_goals) m;
end $$;

-- Marcador más probable. Desempate determinista (probabilidades comparadas redondeadas a 12 decimales):
-- 1.º mayor probabilidad; 2.º menos goles totales; 3.º más goles locales; 4.º menos goles visitantes.
create function public.stats_pick_scoreline(
  p_lambda_home double precision, p_lambda_away double precision, p_max_goals integer default 6,
  out pick_home integer, out pick_away integer, out pick_prob double precision)
language plpgsql immutable strict parallel safe set search_path = ''
as $$
begin
  select m.home_goals, m.away_goals, m.prob into pick_home, pick_away, pick_prob
    from public.stats_scoreline_matrix(p_lambda_home, p_lambda_away, p_max_goals) m
   order by round(m.prob::numeric, 12) desc, (m.home_goals + m.away_goals) asc, m.home_goals desc, m.away_goals asc
   limit 1;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Reconstrucción determinista (solo service_role). Vuelve a aplicar TODOS los resultados oficiales vigentes (una fila por
--    partido con su revisión actual, ADR-012) en orden cronológico estable (inicio, id) desde el rating inicial: una corrección
--    de resultado produce ratings consistentes sin doble conteo. Los ratings son por tenant (los equipos son del tenant).
-- ---------------------------------------------------------------------------------------------------------------
create function public._stats_current_params(p_sport_code text, p_model_version text default null) returns public.stats_model_params
language sql stable security definer set search_path = ''
as $$
  select * from public.stats_model_params s
   where s.sport_code = p_sport_code and ((p_model_version is null and s.is_current) or s.model_version = p_model_version)
$$;
revoke all on function public._stats_current_params(text, text) from public, anon, authenticated;

create function public.rebuild_team_ratings(p_sport_code text default 'football', p_tenant_id uuid default null, p_model_version text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_par public.stats_model_params;
  v_tenant uuid; r record; u record;
  v_r jsonb; v_n jsonb; v_last jsonb;
  v_rh double precision; v_ra double precision;
  v_run uuid; v_matches integer; v_teams integer; v_rfp text; v_pfp text; v_ts timestamptz;
  v_tot_tenants integer := 0; v_tot_matches integer := 0; v_tot_teams integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'rating rebuild requires service_role' using errcode = '42501';
  end if;
  v_par := public._stats_current_params(p_sport_code, p_model_version);
  if v_par.model_version is null then
    raise exception 'no statistical model for this sport/version' using errcode = '22023', hint = 'STATS_UNSUPPORTED_SPORT';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('stats_rebuild:' || p_sport_code, 0));
  v_ts := clock_timestamp();

  for v_tenant in
    select t.tenant_id from (
      select m.tenant_id from public.official_results o
        join public.matches m on m.id = o.match_id and m.tenant_id = o.tenant_id
        join public.tournaments tr on tr.id = m.tournament_id and tr.tenant_id = m.tenant_id
       where tr.sport_code = p_sport_code and m.provider_state is null
      union
      select x.tenant_id from public.team_ratings x where x.sport_code = p_sport_code and x.model_version = v_par.model_version
    ) t
    where p_tenant_id is null or t.tenant_id = p_tenant_id
    order by t.tenant_id
  loop
    v_r := '{}'::jsonb; v_n := '{}'::jsonb; v_last := '{}'::jsonb; v_matches := 0;
    for r in
      select m.id as match_id, m.home_team_id, m.away_team_id, m.starts_at, o.home_score, o.away_score
        from public.official_results o
        join public.matches m on m.id = o.match_id and m.tenant_id = o.tenant_id
        join public.tournaments tr on tr.id = m.tournament_id and tr.tenant_id = m.tenant_id
       where m.tenant_id = v_tenant and tr.sport_code = p_sport_code and m.provider_state is null
       order by m.starts_at, m.id
    loop
      v_rh := coalesce((v_r ->> r.home_team_id::text)::double precision, v_par.elo_initial::double precision);
      v_ra := coalesce((v_r ->> r.away_team_id::text)::double precision, v_par.elo_initial::double precision);
      select * into u from public.stats_elo_update(v_rh, v_ra, r.home_score, r.away_score, v_par.elo_k::double precision,
                                                   v_par.elo_home_adv::double precision, v_par.elo_scale::double precision, v_par.elo_goal_margin);
      -- numeric (15 cifras significativas, independiente de extra_float_digits) mantiene el estado reproducible entre sesiones
      v_r := v_r || jsonb_build_object(r.home_team_id::text, u.new_home::numeric, r.away_team_id::text, u.new_away::numeric);
      v_n := v_n || jsonb_build_object(
        r.home_team_id::text, coalesce((v_n ->> r.home_team_id::text)::integer, 0) + 1,
        r.away_team_id::text, coalesce((v_n ->> r.away_team_id::text)::integer, 0) + 1);
      v_last := v_last || jsonb_build_object(r.home_team_id::text, r.starts_at, r.away_team_id::text, r.starts_at);
      v_matches := v_matches + 1;
    end loop;

    select count(*) into v_teams from jsonb_object_keys(v_r);
    select md5(coalesce(string_agg(format('%s|%s|%s|%s|%s', m.id, o.revision, o.home_score, o.away_score, extract(epoch from m.starts_at)), ',' order by m.starts_at, m.id), ''))
      into v_pfp
      from public.official_results o
      join public.matches m on m.id = o.match_id and m.tenant_id = o.tenant_id
      join public.tournaments tr on tr.id = m.tournament_id and tr.tenant_id = m.tenant_id
     where m.tenant_id = v_tenant and tr.sport_code = p_sport_code and m.provider_state is null;
    select md5(coalesce(string_agg(format('%s|%s|%s', e.key, round((e.value #>> '{}')::numeric, 4), v_n ->> e.key), ',' order by e.key), ''))
      into v_rfp from jsonb_each(v_r) e;

    insert into public.stats_rating_runs(tenant_id, sport_code, model_version, params, matches_processed, teams_rated, results_fingerprint, ratings_fingerprint, created_at)
    values (v_tenant, p_sport_code, v_par.model_version, to_jsonb(v_par) - 'created_at' - 'is_current', v_matches, v_teams, v_pfp, v_rfp, v_ts)
    returning id into v_run;

    delete from public.team_ratings where tenant_id = v_tenant and sport_code = p_sport_code and model_version = v_par.model_version;
    insert into public.team_ratings(tenant_id, team_id, rating, model_version, calculated_at, sport_code, matches_played, last_match_at, run_id)
    select v_tenant, e.key::uuid, round((e.value #>> '{}')::numeric, 4), v_par.model_version, v_ts, p_sport_code,
           (v_n ->> e.key)::integer, (v_last ->> e.key)::timestamptz, v_run
      from jsonb_each(v_r) e;

    insert into public.audit_log(tenant_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_tenant, null, 'stats.ratings_rebuilt', 'stats_rating_run', v_run,
            jsonb_build_object('model_version', v_par.model_version, 'sport_code', p_sport_code, 'matches', v_matches, 'teams', v_teams,
                               'results_fingerprint', v_pfp, 'ratings_fingerprint', v_rfp));
    v_tot_tenants := v_tot_tenants + 1; v_tot_matches := v_tot_matches + v_matches; v_tot_teams := v_tot_teams + v_teams;
  end loop;

  return jsonb_build_object('model_version', v_par.model_version, 'sport_code', p_sport_code,
                            'tenants', v_tot_tenants, 'matches_processed', v_tot_matches, 'teams_rated', v_tot_teams);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Auto-fill para el participante: suggest_scoreline(pool_match). Solo lectura (no escribe pronósticos, ratings ni model_predictions).
--    Contexto tenant/pool derivado en servidor; barrera ADR-015 (administradores excluidos); lock con reloj de la BD.
--    Errores (SQLSTATE / hint): 28000 sin sesión · 22023 STATS_NOT_FOUND (inexistente o ajeno al tenant: indistinguibles) ·
--    42501 STATS_NOT_ELIGIBLE (miembro sin participación aprobada/activa) · 42501 ADMIN_PARTICIPANT_INCOMPATIBLE (administrador) ·
--    42501 STATS_LOCKED (bloqueado, partido no programado o quiniela no abierta) · 22023 STATS_UNSUPPORTED_SPORT.
-- ---------------------------------------------------------------------------------------------------------------
create function public.suggest_scoreline(p_pool_match_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ctx record; v_part record; v_par public.stats_model_params;
  v_rh double precision; v_ra double precision; v_rated_h boolean := false; v_rated_a boolean := false;
  v_asof_h timestamptz; v_asof_a timestamptz;
  v_lh double precision; v_la double precision; v_ph numeric; v_pd numeric; v_pa numeric; v_pick record; v_probs record; v_g record;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select pm.tenant_id, pm.pool_id, pm.lock_at, m.status as match_status, m.home_team_id, m.away_team_id, po.status as pool_status, tr.sport_code
    into v_ctx
    from public.pool_matches pm
    join public.matches m on m.id = pm.match_id and m.tenant_id = pm.tenant_id
    join public.pools po on po.id = pm.pool_id and po.tenant_id = pm.tenant_id
    join public.tournaments tr on tr.id = m.tournament_id and tr.tenant_id = m.tenant_id
   where pm.id = p_pool_match_id;
  if not found or not public.is_tenant_member(v_ctx.tenant_id) then
    raise exception 'pool match not found' using errcode = '22023', hint = 'STATS_NOT_FOUND';
  end if;
  if public.is_pool_excluded(v_ctx.pool_id, v_uid) then
    raise exception 'administrators of a pool cannot participate in it' using errcode = '42501', hint = 'ADMIN_PARTICIPANT_INCOMPATIBLE';
  end if;
  select p.approval_status, p.withdrawn_at into v_part
    from public.participants p
   where p.pool_id = v_ctx.pool_id and p.tenant_id = v_ctx.tenant_id and p.profile_id = v_uid;
  if not found or v_part.approval_status <> 'approved' or v_part.withdrawn_at is not null then
    raise exception 'not an eligible participant of this pool' using errcode = '42501', hint = 'STATS_NOT_ELIGIBLE';
  end if;
  if v_ctx.pool_status <> 'open' or v_ctx.match_status <> 'scheduled' or clock_timestamp() >= v_ctx.lock_at then
    raise exception 'suggestions are unavailable: the match is locked or the pool is not open' using errcode = '42501', hint = 'STATS_LOCKED';
  end if;
  v_par := public._stats_current_params(v_ctx.sport_code);
  if v_par.model_version is null then
    raise exception 'no statistical model for this sport' using errcode = '22023', hint = 'STATS_UNSUPPORTED_SPORT';
  end if;

  select tr.rating::double precision, tr.calculated_at into v_rh, v_asof_h
    from public.team_ratings tr
   where tr.tenant_id = v_ctx.tenant_id and tr.team_id = v_ctx.home_team_id and tr.sport_code = v_ctx.sport_code and tr.model_version = v_par.model_version;
  v_rated_h := found;
  select tr.rating::double precision, tr.calculated_at into v_ra, v_asof_a
    from public.team_ratings tr
   where tr.tenant_id = v_ctx.tenant_id and tr.team_id = v_ctx.away_team_id and tr.sport_code = v_ctx.sport_code and tr.model_version = v_par.model_version;
  v_rated_a := found;
  v_rh := coalesce(v_rh, v_par.elo_initial::double precision);
  v_ra := coalesce(v_ra, v_par.elo_initial::double precision);

  select * into v_g from public.stats_goal_expectations(v_rh, v_ra, v_par.elo_home_adv::double precision, v_par.base_goals::double precision,
                                                        v_par.goal_slope::double precision, v_par.elo_scale::double precision, v_par.goal_dr_clamp::double precision);
  v_lh := v_g.lambda_home; v_la := v_g.lambda_away;
  select * into v_probs from public.stats_outcome_probs(v_lh, v_la, v_par.max_goals);
  select * into v_pick from public.stats_pick_scoreline(v_lh, v_la, v_par.max_goals);
  v_ph := round(v_probs.prob_home::numeric, 6);
  v_pd := round(v_probs.prob_draw::numeric, 6);
  v_pa := 1 - v_ph - v_pd;   -- las tres probabilidades suman exactamente 1 con 6 decimales

  return jsonb_build_object(
    'home_goals', v_pick.pick_home,
    'away_goals', v_pick.pick_away,
    'p_scoreline', round(v_pick.pick_prob::numeric, 6),
    'p_home', v_ph, 'p_draw', v_pd, 'p_away', v_pa,
    'lambda_home', round(v_lh::numeric, 6), 'lambda_away', round(v_la::numeric, 6),
    'model_version', v_par.model_version,
    'computed_at', clock_timestamp(),
    'ratings_as_of', case when v_rated_h and v_rated_a then least(v_asof_h, v_asof_a) end,
    'rated', v_rated_h and v_rated_a,
    'disclaimer', 'Estimación estadística (Elo + Poisson) basada en resultados anteriores. No es una certeza ni una recomendación de apuesta: puedes ignorarla o cambiarla.');
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Privilegios (mínimo): puras y reconstrucción solo service_role; la sugerencia solo authenticated (autoriza dentro)
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function
  public.stats_elo_expected(double precision, double precision, double precision, double precision),
  public.stats_elo_update(double precision, double precision, integer, integer, double precision, double precision, double precision, boolean),
  public.stats_poisson_pmf(integer, double precision),
  public.stats_goal_expectations(double precision, double precision, double precision, double precision, double precision, double precision, double precision),
  public.stats_scoreline_matrix(double precision, double precision, integer),
  public.stats_outcome_probs(double precision, double precision, integer),
  public.stats_pick_scoreline(double precision, double precision, integer),
  public.rebuild_team_ratings(text, uuid, text),
  public.suggest_scoreline(uuid)
  from public, anon, authenticated;
grant execute on function
  public.stats_elo_expected(double precision, double precision, double precision, double precision),
  public.stats_elo_update(double precision, double precision, integer, integer, double precision, double precision, double precision, boolean),
  public.stats_poisson_pmf(integer, double precision),
  public.stats_goal_expectations(double precision, double precision, double precision, double precision, double precision, double precision, double precision),
  public.stats_scoreline_matrix(double precision, double precision, integer),
  public.stats_outcome_probs(double precision, double precision, integer),
  public.stats_pick_scoreline(double precision, double precision, integer),
  public.rebuild_team_ratings(text, uuid, text)
  to service_role;
grant execute on function public.suggest_scoreline(uuid) to authenticated;
