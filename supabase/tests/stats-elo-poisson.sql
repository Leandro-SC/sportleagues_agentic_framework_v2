-- Fase 09: motor Elo + Poisson y auto-fill. Se ejecuta con scripts/qa/run-sql-suite.mjs --with-migration supabase/proposed/20261021000100_stats_elo_poisson.sql
-- (transacción con rollback; no deja datos). Vectores numéricos calculados por separado (JS independiente de la implementación SQL).
create or replace function pg_temp.near(a double precision, b double precision, tol double precision) returns boolean
language sql as $$ select abs(a - b) <= tol $$;
create or replace function pg_temp.rating(p_t uuid, p_name text) returns numeric
language sql as $$ select tr.rating from public.team_ratings tr join public.teams t on t.id = tr.team_id and t.tenant_id = tr.tenant_id where tr.tenant_id = p_t and t.name = p_name $$;
create or replace function pg_temp.state(p_t uuid) returns text
language sql as $$
  select coalesce(string_agg(t.name || '|' || tr.rating || '|' || tr.matches_played || '|' || tr.model_version || '|' || tr.sport_code || '|' || coalesce(tr.last_match_at::text, '-'), ';' order by t.name), '')
    from public.team_ratings tr join public.teams t on t.id = tr.team_id and t.tenant_id = tr.tenant_id where tr.tenant_id = p_t $$;
create or replace function pg_temp.sug(p_uid uuid, p_pm uuid) returns jsonb
language plpgsql as $$
declare v_res text;
begin
  v_res := pg_temp.scalar_as_user(p_uid, format($q$select public.suggest_scoreline(%L)::text$q$, p_pm));
  return case when v_res like 'OK:%' then substr(v_res, 4)::jsonb end;
end $$;
create or replace function pg_temp.sug_err(p_uid uuid, p_pm uuid) returns text
language sql as $$ select pg_temp.as_user(p_uid, format($q$select public.suggest_scoreline(%L)$q$, p_pm)) $$;

do $$
declare
  v_t1 uuid; v_t2 uuid; v_o uuid; v_p uuid; v_q uuid; v_w uuid; v_m uuid; v_l uuid; v_x uuid; v_xp uuid; v_y uuid;
  v_tour uuid; v_tour2 uuid; v_tourb uuid; v_rnd uuid; v_rndb uuid; v_pool uuid; v_pool2 uuid; v_tour_t2 uuid; v_rnd_t2 uuid;
  v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_u1 uuid; v_u2 uuid; v_e uuid; v_f uuid;
  v_m1 uuid; v_m2 uuid; v_m3 uuid; v_m4 uuid; v_me uuid;
  v_ab uuid; v_u uuid; v_au uuid; v_off uuid; v_live uuid; v_bb uuid; v_t2m uuid;
  v_pm_ab uuid; v_pm_u uuid; v_pm_au uuid; v_pm_off uuid; v_pm_live uuid; v_pm_bb uuid; v_pm_t2 uuid; v_pp uuid;
  v_res text; v_n numeric; v_n2 numeric; v_s1 text; v_s2 text; v_s3 text; v_fp1 text; v_fp2 text; v_j jsonb; v_j2 jsonb;
  v_cnt1 bigint; v_cnt2 bigint; v_ok boolean; v_prev double precision; v_ph double precision; v_pa double precision; v_lh double precision;
  r record; v_g record; v_pr record; v_pk record; v_i integer;
begin
  -- ===========================================================================================================
  -- FUNCIONES PURAS: vectores conocidos
  -- ===========================================================================================================
  perform pg_temp.rec('P01 Elo esperado = 0.5 con ratings iguales y sin ventaja', public.stats_elo_expected(1500, 1500, 0) = 0.5, public.stats_elo_expected(1500, 1500, 0)::text);
  perform pg_temp.rec('P02 Elo esperado con ventaja local 65 = 0.59246623058', pg_temp.near(public.stats_elo_expected(1500, 1500, 65), 0.5924662305843318, 1e-12), public.stats_elo_expected(1500, 1500, 65)::text);
  perform pg_temp.rec('P03 Elo esperado 1600 vs 1500 = 0.64006499980', pg_temp.near(public.stats_elo_expected(1600, 1500, 0), 0.6400649998028851, 1e-12), '');
  perform pg_temp.rec('P04 Elo esperado es simétrico: E(a,b)+E(b,a) = 1',
    pg_temp.near(public.stats_elo_expected(1713, 1422, 0) + public.stats_elo_expected(1422, 1713, 0), 1, 1e-12), '');

  select * into v_g from public.stats_elo_update(1500, 1500, 1, 0, 20, 0, 400, true);
  perform pg_temp.rec('P05 Elo update 1-0 entre iguales sin ventaja: 1510 / 1490', pg_temp.near(v_g.new_home, 1510, 1e-9) and pg_temp.near(v_g.new_away, 1490, 1e-9), v_g::text);
  select * into v_g from public.stats_elo_update(1500, 1500, 3, 0, 20, 0, 400, true);
  perform pg_temp.rec('P06 margen de goles 3-0: G = 1.75 → 1517.5 / 1482.5', pg_temp.near(v_g.new_home, 1517.5, 1e-9) and pg_temp.near(v_g.new_away, 1482.5, 1e-9), v_g::text);
  select * into v_g from public.stats_elo_update(1500, 1500, 2, 0, 20, 0, 400, true);
  perform pg_temp.rec('P06b margen 2-0: G = 1.5 → 1515', pg_temp.near(v_g.new_home, 1515, 1e-9), v_g::text);
  select * into v_g from public.stats_elo_update(1500, 1500, 3, 0, 20, 0, 400, false);
  perform pg_temp.rec('P06c sin margen de goles 3-0 equivale a 1-0 (1510)', pg_temp.near(v_g.new_home, 1510, 1e-9), v_g::text);
  select * into v_g from public.stats_elo_update(1500, 1500, 1, 1, 20, 0, 400, true);
  perform pg_temp.rec('P07 empate entre iguales sin ventaja no mueve ratings', pg_temp.near(v_g.new_home, 1500, 1e-9) and pg_temp.near(v_g.new_away, 1500, 1e-9), v_g::text);
  select * into v_g from public.stats_elo_update(1600, 1500, 2, 2, 20, 0, 400, true);
  perform pg_temp.rec('P07b empate 2-2, 1600 vs 1500: 1597.1987 / 1502.8013', pg_temp.near(v_g.new_home, 1597.1987000039423, 1e-9) and pg_temp.near(v_g.new_away, 1502.8012999960577, 1e-9), v_g::text);
  select * into v_g from public.stats_elo_update(1500, 1500, 1, 0, 20, 65, 400, true);
  perform pg_temp.rec('P07c con ventaja local 65, 1-0: 1508.1507 / 1491.8493', pg_temp.near(v_g.new_home, 1508.1506753883134, 1e-9) and pg_temp.near(v_g.new_away, 1491.8493246116866, 1e-9), v_g::text);
  v_ok := true;
  for r in select a, b, gh, ga from (values (1400.0, 1650.0, 0, 4), (1800.0, 1300.0, 5, 0), (1500.0, 1500.0, 2, 2), (1234.5, 1999.9, 1, 0)) as x(a, b, gh, ga) loop
    select * into v_g from public.stats_elo_update(r.a::double precision, r.b::double precision, r.gh, r.ga, 32, 65, 400, true);
    v_ok := v_ok and pg_temp.near(v_g.new_home + v_g.new_away, (r.a + r.b)::double precision, 1e-9);
  end loop;
  perform pg_temp.rec('P08 la actualización Elo es de suma cero', v_ok, '');
  v_res := pg_temp.as_role('postgres', 'select * from public.stats_elo_update(1500, 1500, -1, 0)');
  perform pg_temp.rec('P08b goles negativos se rechazan (22023)', pg_temp.is_err(v_res, '22023'), v_res);

  perform pg_temp.rec('P09 Poisson pmf(0, 1) = e^-1', public.stats_poisson_pmf(0, 1) = exp(-1::double precision), public.stats_poisson_pmf(0, 1)::text);
  perform pg_temp.rec('P09b pmf(2, 3) = 0.22404180765538773', pg_temp.near(public.stats_poisson_pmf(2, 3), 0.22404180765538773, 1e-15), '');
  perform pg_temp.rec('P09c pmf(4, 2.5) = 0.13360188578108528', pg_temp.near(public.stats_poisson_pmf(4, 2.5), 0.13360188578108528, 1e-15), '');
  perform pg_temp.rec('P09d λ=0: pmf(0)=1 y pmf(3)=0', public.stats_poisson_pmf(0, 0) = 1 and public.stats_poisson_pmf(3, 0) = 0, '');
  select sum(public.stats_poisson_pmf(k, 2.5)), sum(k * public.stats_poisson_pmf(k, 2.5)) into v_ph, v_pa from generate_series(0, 60) k;
  perform pg_temp.rec('P09e Σ pmf = 1 y media = λ (2.5)', pg_temp.near(v_ph, 1, 1e-12) and pg_temp.near(v_pa, 2.5, 1e-12), v_ph::text || '/' || v_pa::text);
  v_res := pg_temp.as_role('postgres', 'select public.stats_poisson_pmf(1, -0.5)');
  perform pg_temp.rec('P10 λ negativo se rechaza (22023)', pg_temp.is_err(v_res, '22023'), v_res);
  v_res := pg_temp.as_role('postgres', $q$select public.stats_poisson_pmf(1, 'NaN'::double precision)$q$);
  perform pg_temp.rec('P10b λ = NaN se rechaza (22023)', pg_temp.is_err(v_res, '22023'), v_res);

  select * into v_g from public.stats_goal_expectations(1500, 1500, 0, 1.35);
  perform pg_temp.rec('P11 λ con ratings iguales y sin ventaja = base (1.35 / 1.35)', pg_temp.near(v_g.lambda_home, 1.35, 1e-12) and pg_temp.near(v_g.lambda_away, 1.35, 1e-12), v_g::text);
  select * into v_g from public.stats_goal_expectations(1500, 1500, 65, 1.35);
  perform pg_temp.rec('P11b con ventaja local 65: λ local 1.46427 / visitante 1.24465', pg_temp.near(v_g.lambda_home, 1.4642667312934277, 1e-12) and pg_temp.near(v_g.lambda_away, 1.244650281981163, 1e-12), v_g::text);
  perform pg_temp.rec('P11c media geométrica de λ = base (invariante)', pg_temp.near(v_g.lambda_home * v_g.lambda_away, 1.35 * 1.35, 1e-12), '');
  select * into v_g from public.stats_goal_expectations(3000, 1500, 0, 1.35);
  perform pg_temp.rec('P11d diferencial acotado (tope 2 escalas): 3.66968 / 0.49664', pg_temp.near(v_g.lambda_home, 3.669680468419711, 1e-12) and pg_temp.near(v_g.lambda_away, 0.4966372455814472, 1e-12), v_g::text);

  select count(*), sum(prob) into v_cnt1, v_ph from public.stats_scoreline_matrix(1.4, 1.1, 6);
  perform pg_temp.rec('P12 matriz 0..6 tiene 49 celdas y suma 1 (renormalizada)', v_cnt1 = 49 and pg_temp.near(v_ph, 1, 1e-12), v_cnt1::text || '/' || v_ph::text);
  select count(*), sum(prob) into v_cnt1, v_ph from public.stats_scoreline_matrix(1.4, 1.1, 3);
  perform pg_temp.rec('P12b rango configurable: 0..3 → 16 celdas, suma 1', v_cnt1 = 16 and pg_temp.near(v_ph, 1, 1e-12), v_cnt1::text || '/' || v_ph::text);
  select (select prob from public.stats_scoreline_matrix(1.4, 1.1, 6) where home_goals = 1 and away_goals = 0) / (select prob from public.stats_scoreline_matrix(1.4, 1.1, 6) where home_goals = 0 and away_goals = 0),
         (select prob from public.stats_scoreline_matrix(1.4, 1.1, 6) where home_goals = 0 and away_goals = 1) / (select prob from public.stats_scoreline_matrix(1.4, 1.1, 6) where home_goals = 0 and away_goals = 0)
    into v_ph, v_pa;
  perform pg_temp.rec('P12c independencia: P(1,0)/P(0,0) = λ local y P(0,1)/P(0,0) = λ visitante', pg_temp.near(v_ph, 1.4, 1e-12) and pg_temp.near(v_pa, 1.1, 1e-12), v_ph::text || '/' || v_pa::text);
  select bool_and(a.prob = b.prob) into v_ok
    from public.stats_scoreline_matrix(1.7, 1.7, 6) a join public.stats_scoreline_matrix(1.7, 1.7, 6) b on a.home_goals = b.away_goals and a.away_goals = b.home_goals;
  perform pg_temp.rec('P12d λ iguales → matriz simétrica', v_ok, '');
  v_res := pg_temp.as_role('postgres', 'select * from public.stats_scoreline_matrix(1.4, 1.1, 13)');
  perform pg_temp.rec('P12e rango fuera de 1..12 se rechaza (22023)', pg_temp.is_err(v_res, '22023'), v_res);

  select * into v_pr from public.stats_outcome_probs(1, 1, 6);
  perform pg_temp.rec('P13 1X2 con λ=(1,1): 0.345720 / 0.308560 / 0.345720 y suma 1',
    pg_temp.near(v_pr.prob_home, 0.34572015763545766, 1e-12) and pg_temp.near(v_pr.prob_draw, 0.3085596847290847, 1e-12)
    and pg_temp.near(v_pr.prob_away, 0.3457201576354577, 1e-12) and pg_temp.near(v_pr.prob_home + v_pr.prob_draw + v_pr.prob_away, 1, 1e-12), v_pr::text);
  select * into v_pr from public.stats_outcome_probs(1.5, 1.2, 6);
  perform pg_temp.rec('P13b 1X2 con λ=(1.5,1.2): 0.441058 / 0.255117 / 0.303825',
    pg_temp.near(v_pr.prob_home, 0.4410584458312109, 1e-12) and pg_temp.near(v_pr.prob_draw, 0.2551168507911732, 1e-12) and pg_temp.near(v_pr.prob_away, 0.3038247033776157, 1e-12), v_pr::text);

  select * into v_pk from public.stats_pick_scoreline(1, 1, 6);
  perform pg_temp.rec('P14 desempate: λ=(1,1) cuatro marcadores empatan → menos goles totales: 0-0', v_pk.pick_home = 0 and v_pk.pick_away = 0 and pg_temp.near(v_pk.pick_prob, 0.135357816979, 1e-9), v_pk::text);
  select * into v_pk from public.stats_pick_scoreline(2, 2, 6);
  perform pg_temp.rec('P14b desempate: λ=(2,2) empatan 1-1, 1-2, 2-1, 2-2 → 1-1', v_pk.pick_home = 1 and v_pk.pick_away = 1, v_pk::text);
  select * into v_pk from public.stats_pick_scoreline(1.5, 1.2, 6);
  perform pg_temp.rec('P14c más probable con λ=(1.5,1.2): 1-1 (0.121112)', v_pk.pick_home = 1 and v_pk.pick_away = 1 and pg_temp.near(v_pk.pick_prob, 0.121112456772, 1e-9), v_pk::text);
  select * into v_pk from public.stats_pick_scoreline(2.5, 0.6, 6);
  perform pg_temp.rec('P14d favorito claro λ=(2.5,0.6): 2-0', v_pk.pick_home = 2 and v_pk.pick_away = 0, v_pk::text);

  v_ok := true; v_prev := null;
  for v_i in 0..4 loop
    select * into v_g from public.stats_goal_expectations((1300 + 100 * v_i)::double precision, 1500, 65, 1.35);
    select * into v_pr from public.stats_outcome_probs(v_g.lambda_home, v_g.lambda_away, 6);
    if v_prev is not null and not (v_pr.prob_home > v_prev and v_pr.prob_away < v_pa and v_g.lambda_home > v_lh) then v_ok := false; end if;
    v_prev := v_pr.prob_home; v_pa := v_pr.prob_away; v_lh := v_g.lambda_home;
  end loop;
  perform pg_temp.rec('P15 monotonicidad: más rating local → más P(local), menos P(visitante), más λ local', v_ok, '');
  v_ok := public.stats_elo_expected(1400, 1500, 0) < public.stats_elo_expected(1500, 1500, 0) and public.stats_elo_expected(1500, 1500, 0) < public.stats_elo_expected(1600, 1500, 0);
  perform pg_temp.rec('P15b monotonicidad del Elo esperado', v_ok, '');

  select (g.lambda_home, g.lambda_away, p.prob_home, p.prob_draw, p.prob_away, k.pick_home, k.pick_away, k.pick_prob)::text into v_s1
    from public.stats_goal_expectations(1560, 1480, 65, 1.35) g, public.stats_outcome_probs(1.5, 1.1, 6) p, public.stats_pick_scoreline(1.5, 1.1, 6) k;
  select (g.lambda_home, g.lambda_away, p.prob_home, p.prob_draw, p.prob_away, k.pick_home, k.pick_away, k.pick_prob)::text into v_s2
    from public.stats_goal_expectations(1560, 1480, 65, 1.35) g, public.stats_outcome_probs(1.5, 1.1, 6) p, public.stats_pick_scoreline(1.5, 1.1, 6) k;
  perform pg_temp.rec('P16 determinismo: misma entrada dos veces = salida idéntica', v_s1 = v_s2 and v_s1 is not null, v_s1);
  select count(*) into v_cnt1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('stats_elo_expected', 'stats_elo_update', 'stats_poisson_pmf', 'stats_goal_expectations', 'stats_scoreline_matrix', 'stats_outcome_probs', 'stats_pick_scoreline') and p.provolatile = 'i';
  perform pg_temp.rec('P17 las 7 funciones puras son IMMUTABLE', v_cnt1 = 7, v_cnt1::text);
  select count(*) into v_cnt1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'stats\_%' and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'));
  perform pg_temp.rec('P18 toda función del motor fija search_path', v_cnt1 = 0, v_cnt1::text);
  select count(*) into v_cnt1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('rebuild_team_ratings', 'suggest_scoreline', '_stats_current_params') and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'));
  perform pg_temp.rec('P18b rebuild/suggest/_stats_current_params fijan search_path', v_cnt1 = 0, v_cnt1::text);

  -- ===========================================================================================================
  -- FIXTURES (datos sintéticos)
  -- ===========================================================================================================
  v_o := pg_temp.mk_user('st-owner'); v_p := pg_temp.mk_user('st-P'); v_q := pg_temp.mk_user('st-Q'); v_w := pg_temp.mk_user('st-W');
  v_m := pg_temp.mk_user('st-mem'); v_l := pg_temp.mk_user('st-legacy'); v_x := pg_temp.mk_user('st-t2owner'); v_xp := pg_temp.mk_user('st-t2player');
  v_y := pg_temp.mk_user('st-nomember');
  insert into public.tenants(name) values ('ST tenant 1') returning id into v_t1;
  insert into public.tenants(name) values ('ST tenant 2') returning id into v_t2;
  insert into public.tenant_entitlements(tenant_id, plan_code) values (v_t1, 'pro'), (v_t2, 'pro');
  insert into public.tenant_memberships(tenant_id, profile_id, role) values
    (v_t1, v_o, 'owner'), (v_t1, v_p, 'member'), (v_t1, v_q, 'member'), (v_t1, v_w, 'member'), (v_t1, v_m, 'member'), (v_t1, v_l, 'member'),
    (v_t2, v_x, 'owner'), (v_t2, v_xp, 'member');
  insert into public.tournaments(tenant_id, name) values (v_t1, 'ST T1') returning id into v_tour;
  insert into public.tournaments(tenant_id, name, sport_code) values (v_t1, 'ST basket', 'basketball') returning id into v_tourb;
  insert into public.tournaments(tenant_id, name) values (v_t2, 'ST T2') returning id into v_tour_t2;
  insert into public.teams(tenant_id, name) values (v_t1, 'A') returning id into v_a;
  insert into public.teams(tenant_id, name) values (v_t1, 'B') returning id into v_b;
  insert into public.teams(tenant_id, name) values (v_t1, 'C') returning id into v_c;
  insert into public.teams(tenant_id, name) values (v_t1, 'D') returning id into v_d;
  insert into public.teams(tenant_id, name) values (v_t1, 'U1') returning id into v_u1;
  insert into public.teams(tenant_id, name) values (v_t1, 'U2') returning id into v_u2;
  insert into public.teams(tenant_id, name) values (v_t2, 'E') returning id into v_e;
  insert into public.teams(tenant_id, name) values (v_t2, 'F') returning id into v_f;
  insert into public.tournament_teams(tenant_id, tournament_id, team_id) values
    (v_t1, v_tour, v_a), (v_t1, v_tour, v_b), (v_t1, v_tour, v_c), (v_t1, v_tour, v_d), (v_t1, v_tour, v_u1), (v_t1, v_tour, v_u2),
    (v_t1, v_tourb, v_a), (v_t1, v_tourb, v_b), (v_t2, v_tour_t2, v_e), (v_t2, v_tour_t2, v_f);
  insert into public.rounds(tenant_id, tournament_id, name, sort_order) values (v_t1, v_tour, 'R1', 1) returning id into v_rnd;
  insert into public.rounds(tenant_id, tournament_id, name, sort_order) values (v_t1, v_tourb, 'R1', 1) returning id into v_rndb;
  insert into public.rounds(tenant_id, tournament_id, name, sort_order) values (v_t2, v_tour_t2, 'R1', 1) returning id into v_rnd_t2;

  -- Historial oficial T1 (orden cronológico): A 2-0 B · C 1-1 D · A 1-0 C · B 0-3 D ; T2: E 1-0 F
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at, status) values (v_t1, v_tour, v_rnd, v_a, v_b, now() - interval '10 days', 'final') returning id into v_m1;
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at, status) values (v_t1, v_tour, v_rnd, v_c, v_d, now() - interval '9 days', 'final') returning id into v_m2;
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at, status) values (v_t1, v_tour, v_rnd, v_a, v_c, now() - interval '8 days', 'final') returning id into v_m3;
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at, status) values (v_t1, v_tour, v_rnd, v_b, v_d, now() - interval '7 days', 'final') returning id into v_m4;
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at, status) values (v_t2, v_tour_t2, v_rnd_t2, v_e, v_f, now() - interval '5 days', 'final') returning id into v_me;
  insert into public.official_results(tenant_id, match_id, home_score, away_score, revision, published_by) values
    (v_t1, v_m1, 2, 0, 1, v_o), (v_t1, v_m2, 1, 1, 1, v_o), (v_t1, v_m3, 1, 0, 1, v_o), (v_t1, v_m4, 0, 3, 1, v_o), (v_t2, v_me, 1, 0, 1, v_x);

  -- Quiniela de T1 y participantes
  insert into public.pools(tenant_id, name, status, lock_offset) values (v_t1, 'ST pool', 'open', interval '15 minutes') returning id into v_pool;
  insert into public.pools(tenant_id, name, status, lock_offset) values (v_t2, 'ST pool 2', 'open', interval '15 minutes') returning id into v_pool2;
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_t1, v_pool, v_p, 'approved', 'paid') returning id into v_pp;
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_t1, v_pool, v_q, 'pending', 'invited');
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_t1, v_pool, v_w, 'approved', 'paid');
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_t1, v_pool, v_l, 'approved', 'paid');
  insert into public.participants(tenant_id, pool_id, profile_id, approval_status, payment_status) values (v_t2, v_pool2, v_xp, 'approved', 'paid');
  update public.participants set withdrawn_at = now(), withdrawn_by = v_w where pool_id = v_pool and profile_id = v_w;
  insert into public.pool_admin_exclusions(tenant_id, pool_id, profile_id, source) values (v_t1, v_pool, v_l, 'legacy_backfill');

  -- Partidos futuros de la quiniela
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at) values (v_t1, v_tour, v_rnd, v_a, v_b, now() + interval '1 day') returning id into v_ab;
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at) values (v_t1, v_tour, v_rnd, v_u1, v_u2, now() + interval '2 days') returning id into v_u;
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at) values (v_t1, v_tour, v_rnd, v_a, v_u1, now() + interval '3 days') returning id into v_au;
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at) values (v_t1, v_tour, v_rnd, v_c, v_d, now() + interval '10 minutes') returning id into v_off;
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at) values (v_t1, v_tour, v_rnd, v_c, v_d, now() + interval '4 days') returning id into v_live;
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at) values (v_t1, v_tourb, v_rndb, v_a, v_b, now() + interval '1 day') returning id into v_bb;
  insert into public.matches(tenant_id, tournament_id, round_id, home_team_id, away_team_id, starts_at) values (v_t2, v_tour_t2, v_rnd_t2, v_e, v_f, now() + interval '1 day') returning id into v_t2m;
  insert into public.pool_matches(tenant_id, pool_id, match_id) values (v_t1, v_pool, v_ab) returning id into v_pm_ab;
  insert into public.pool_matches(tenant_id, pool_id, match_id) values (v_t1, v_pool, v_u) returning id into v_pm_u;
  insert into public.pool_matches(tenant_id, pool_id, match_id) values (v_t1, v_pool, v_au) returning id into v_pm_au;
  insert into public.pool_matches(tenant_id, pool_id, match_id) values (v_t1, v_pool, v_off) returning id into v_pm_off;
  insert into public.pool_matches(tenant_id, pool_id, match_id) values (v_t1, v_pool, v_live) returning id into v_pm_live;
  insert into public.pool_matches(tenant_id, pool_id, match_id) values (v_t1, v_pool, v_bb) returning id into v_pm_bb;
  insert into public.pool_matches(tenant_id, pool_id, match_id) values (v_t2, v_pool2, v_t2m) returning id into v_pm_t2;
  insert into fx(k, v) values ('t1', v_t1), ('t2', v_t2), ('o', v_o), ('p', v_p), ('xp', v_xp), ('pm_ab', v_pm_ab);

  -- ===========================================================================================================
  -- ESTADO: reconstrucción determinista (rebuild_team_ratings)
  -- ===========================================================================================================
  select count(*) into v_cnt1 from public.team_ratings;
  perform pg_temp.rec('R00 sin reconstrucción no hay ratings (estado vacío por defecto)', v_cnt1 = 0, v_cnt1::text);

  v_res := pg_temp.as_user(v_o, $q$select public.rebuild_team_ratings('football')$q$);
  perform pg_temp.rec('R01 un owner autenticado NO ejecuta la reconstrucción (42501)', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_role('anon', $q$select public.rebuild_team_ratings('football')$q$);
  perform pg_temp.rec('R02 anon no ejecuta la reconstrucción (42501)', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_role('postgres', $q$select public.rebuild_team_ratings('football')$q$);
  perform pg_temp.rec('R03 sin claim service_role la función rechaza aunque el rol sea privilegiado (42501)', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_role('service_role', $q$select public.rebuild_team_ratings('basketball')$q$);
  perform pg_temp.rec('R04 deporte sin modelo se rechaza (22023 STATS_UNSUPPORTED_SPORT)', pg_temp.is_err(v_res, '22023', 'STATS_UNSUPPORTED_SPORT'), v_res);
  v_res := pg_temp.as_role('service_role', $q$select public.rebuild_team_ratings('football', null, 'elo-poisson-v999')$q$);
  perform pg_temp.rec('R04b versión inexistente se rechaza (22023)', pg_temp.is_err(v_res, '22023', 'STATS_UNSUPPORTED_SPORT'), v_res);

  -- Alcance por tenant: reconstruir solo T1 no crea ratings de T2
  v_res := pg_temp.as_role('service_role', format($q$select public.rebuild_team_ratings('football', %L)$q$, v_t1));
  perform pg_temp.rec('R05 service_role reconstruye el tenant T1', pg_temp.is_ok(v_res), v_res);
  select count(*) into v_cnt1 from public.team_ratings where tenant_id = v_t2;
  select count(*) into v_cnt2 from public.team_ratings where tenant_id = v_t1;
  perform pg_temp.rec('R06 alcance por tenant: T1 4 equipos con partidos; T2 intacto (0)', v_cnt2 = 4 and v_cnt1 = 0, v_cnt2::text || '/' || v_cnt1::text);
  perform pg_temp.rec('R07 ratings de T1 = vector independiente (A 1519.9885 · B 1467.7272 · C 1490.3881 · D 1521.8961)',
    pg_temp.near(pg_temp.rating(v_t1, 'A'), 1519.9885431294492, 1.1e-4) and pg_temp.near(pg_temp.rating(v_t1, 'B'), 1467.7271723193326, 1.1e-4)
    and pg_temp.near(pg_temp.rating(v_t1, 'C'), 1490.3881453413342, 1.1e-4) and pg_temp.near(pg_temp.rating(v_t1, 'D'), 1521.896139209884, 1.1e-4),
    pg_temp.state(v_t1));
  select sum(rating) into v_n from public.team_ratings where tenant_id = v_t1;
  perform pg_temp.rec('R08 conservación: Σ ratings = 4 × 1500 (suma cero, sin doble conteo)', abs(v_n - 6000) <= 0.0005, v_n::text);
  select count(*) into v_cnt1 from public.team_ratings where tenant_id = v_t1 and matches_played = 2 and model_version = 'elo-poisson-v1' and sport_code = 'football' and run_id is not null and last_match_at is not null;
  perform pg_temp.rec('R09 cada equipo: 2 partidos, versión de modelo, deporte, corrida y corte registrados', v_cnt1 = 4, v_cnt1::text);

  -- Idempotencia
  v_s1 := pg_temp.state(v_t1);
  select string_agg(results_fingerprint || '/' || ratings_fingerprint, ',' order by created_at, id) into v_fp1 from public.stats_rating_runs where tenant_id = v_t1;
  v_res := pg_temp.as_role('service_role', format($q$select public.rebuild_team_ratings('football', %L)$q$, v_t1));
  v_s2 := pg_temp.state(v_t1);
  select count(*) into v_cnt1 from public.team_ratings where tenant_id = v_t1;
  select count(*), min(results_fingerprint) = max(results_fingerprint) and min(ratings_fingerprint) = max(ratings_fingerprint) into v_cnt2, v_ok from public.stats_rating_runs where tenant_id = v_t1;
  perform pg_temp.rec('R10 idempotencia: dos corridas = mismo estado, sin filas duplicadas', v_s1 = v_s2 and v_cnt1 = 4, v_s1 || ' <> ' || v_s2);
  perform pg_temp.rec('R10b las dos corridas dejan huella (2) con las mismas huellas de entrada y de ratings', v_cnt2 = 2 and v_ok, v_cnt2::text);
  select count(*) into v_cnt1 from public.team_ratings tr where tr.tenant_id = v_t1 and exists (select 1 from public.stats_rating_runs sr where sr.id = tr.run_id and sr.tenant_id = tr.tenant_id and sr.created_at = tr.calculated_at);
  perform pg_temp.rec('R10c versión y timestamp del cálculo enlazados con la corrida más reciente', v_cnt1 = 4, v_cnt1::text);

  -- Corrección de un resultado oficial: A 2-0 B pasa a 0-2 (revisión 2)
  update public.official_results set home_score = 0, away_score = 2, revision = 2 where match_id = v_m1;
  v_res := pg_temp.as_role('service_role', format($q$select public.rebuild_team_ratings('football', %L)$q$, v_t1));
  perform pg_temp.rec('R11 corrección 0-2: ratings = vector independiente (A 1490.8228 · B 1496.2700 · C 1489.5539 · D 1523.3533)',
    pg_temp.near(pg_temp.rating(v_t1, 'A'), 1490.8228308469347, 1.1e-4) and pg_temp.near(pg_temp.rating(v_t1, 'B'), 1496.2700351467706, 1.1e-4)
    and pg_temp.near(pg_temp.rating(v_t1, 'C'), 1489.5538576238487, 1.1e-4) and pg_temp.near(pg_temp.rating(v_t1, 'D'), 1523.353276382446, 1.1e-4),
    pg_temp.state(v_t1));
  select sum(rating), count(*), min(matches_played), max(matches_played) into v_n, v_cnt1, v_cnt2, v_n2 from public.team_ratings where tenant_id = v_t1;
  perform pg_temp.rec('R12 tras la corrección: Σ = 6000, 4 filas, 2 partidos por equipo (sin doble conteo)', abs(v_n - 6000) <= 0.0005 and v_cnt1 = 4 and v_cnt2 = 2 and v_n2 = 2, v_n::text);
  v_s3 := pg_temp.state(v_t1);
  v_res := pg_temp.as_role('service_role', format($q$select public.rebuild_team_ratings('football', %L)$q$, v_t1));
  perform pg_temp.rec('R13 repetir la reconstrucción tras la corrección es idempotente', pg_temp.state(v_t1) = v_s3, pg_temp.state(v_t1));
  -- se revierte al marcador original (revisión 3): el estado vuelve EXACTAMENTE al de la primera corrida (depende solo del resultado vigente)
  update public.official_results set home_score = 2, away_score = 0, revision = 3 where match_id = v_m1;
  v_res := pg_temp.as_role('service_role', format($q$select public.rebuild_team_ratings('football', %L)$q$, v_t1));
  perform pg_temp.rec('R14 revertir el resultado devuelve exactamente el estado inicial (no depende del historial de correcciones)', pg_temp.state(v_t1) = v_s1, pg_temp.state(v_t1));

  -- Reconstrucción global: T2 obtiene sus propios ratings; T1 no cambia; aislamiento entre tenants
  v_res := pg_temp.as_role('service_role', $q$select public.rebuild_team_ratings('football')$q$);
  perform pg_temp.rec('R15 reconstrucción global OK', pg_temp.is_ok(v_res), v_res);
  perform pg_temp.rec('R15b T1 sigue idéntico tras la reconstrucción global', pg_temp.state(v_t1) = v_s1, pg_temp.state(v_t1));
  perform pg_temp.rec('R15c T2: E 1508.1507 · F 1491.8493 (con ventaja local) y no usa datos de T1',
    pg_temp.near(pg_temp.rating(v_t2, 'E'), 1508.1506753883134, 1.1e-4) and pg_temp.near(pg_temp.rating(v_t2, 'F'), 1491.8493246116866, 1.1e-4), pg_temp.state(v_t2));
  select count(*) into v_cnt1 from public.team_ratings tr where not exists (select 1 from public.teams t where t.id = tr.team_id and t.tenant_id = tr.tenant_id);
  perform pg_temp.rec('R15d todo rating pertenece a un equipo del mismo tenant', v_cnt1 = 0, v_cnt1::text);
  -- Orden estable: dos partidos con el mismo inicio sobre equipos distintos no dependen del orden → mismo estado en ambas corridas
  v_res := pg_temp.as_role('service_role', $q$select public.rebuild_team_ratings('football')$q$);
  perform pg_temp.rec('R16 orden cronológico estable: nueva corrida global = mismo estado en T1 y T2', pg_temp.state(v_t1) = v_s1 and pg_temp.state(v_t2) like 'E|1508.1507|1|elo-poisson-v1|football|%', pg_temp.state(v_t2));

  -- RLS / ACL de las tablas tocadas
  v_res := pg_temp.scalar_as_user(v_p, format($q$select count(*) from public.team_ratings where tenant_id = %L$q$, v_t1));
  perform pg_temp.rec('R20 un miembro del tenant lee los ratings de su tenant (4)', v_res = 'OK:4', v_res);
  v_res := pg_temp.scalar_as_user(v_xp, format($q$select count(*) from public.team_ratings where tenant_id = %L$q$, v_t1));
  perform pg_temp.rec('R21 un jugador de OTRO tenant no ve ratings ajenos (RLS: 0)', v_res = 'OK:0', v_res);
  v_res := pg_temp.scalar_as_user(v_y, format($q$select count(*) from public.team_ratings where tenant_id = %L$q$, v_t1));
  perform pg_temp.rec('R21b un usuario sin membresía no ve ratings (0)', v_res = 'OK:0', v_res);
  v_res := pg_temp.as_user(v_o, format($q$insert into public.team_ratings(tenant_id, team_id, rating, model_version) values (%L, %L, 2000, 'x')$q$, v_t1, v_a));
  perform pg_temp.rec('R22 ni un owner puede insertar ratings (42501)', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_o, format($q$update public.team_ratings set rating = 3000 where tenant_id = %L$q$, v_t1));
  perform pg_temp.rec('R22b ni modificarlos (42501)', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_user(v_o, format($q$delete from public.team_ratings where tenant_id = %L$q$, v_t1));
  perform pg_temp.rec('R22c ni borrarlos (42501)', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.scalar_as_user(v_o, format($q$select count(*) from public.stats_rating_runs where tenant_id = %L$q$, v_t1));
  perform pg_temp.rec('R23 el owner lee las corridas de su tenant (≥ 5)', v_res ~ '^OK:([5-9]|[1-9][0-9]+)$', v_res);
  v_res := pg_temp.scalar_as_user(v_p, format($q$select count(*) from public.stats_rating_runs where tenant_id = %L$q$, v_t1));
  perform pg_temp.rec('R23b un miembro no administrador no lee corridas (0)', v_res = 'OK:0', v_res);
  v_res := pg_temp.scalar_as_user(v_x, format($q$select count(*) from public.stats_rating_runs where tenant_id = %L$q$, v_t1));
  perform pg_temp.rec('R23c el owner de OTRO tenant no lee corridas ajenas (0)', v_res = 'OK:0', v_res);
  v_res := pg_temp.as_user(v_o, format($q$insert into public.stats_rating_runs(tenant_id, sport_code, model_version, params, matches_processed, teams_rated, results_fingerprint, ratings_fingerprint) values (%L, 'football', 'x', '{}', 0, 0, 'a', 'b')$q$, v_t1));
  perform pg_temp.rec('R24 las corridas no se escriben desde el cliente (42501)', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.scalar_as_user(v_p, 'select count(*) from public.stats_model_params');
  perform pg_temp.rec('R25 los parámetros del modelo son legibles por usuarios autenticados', v_res = 'OK:1', v_res);
  v_res := pg_temp.as_user(v_o, $q$update public.stats_model_params set elo_k = 99$q$);
  perform pg_temp.rec('R25b el cliente no modifica parámetros (42501)', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_role('anon', 'select count(*) from public.stats_model_params');
  perform pg_temp.rec('R25c anon no lee parámetros (42501)', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_role('postgres', $q$update public.stats_model_params set elo_k = 99 where model_version = 'elo-poisson-v1'$q$);
  perform pg_temp.rec('R26 una versión publicada es inmutable incluso para el propietario (42501)', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_role('postgres', $q$delete from public.stats_model_params where model_version = 'elo-poisson-v1'$q$);
  perform pg_temp.rec('R26b y no se borra (42501)', pg_temp.is_err(v_res, '42501'), v_res);
  select count(*) into v_cnt1 from public.audit_log where tenant_id = v_t1 and action = 'stats.ratings_rebuilt';
  perform pg_temp.rec('R27 cada reconstrucción queda auditada por tenant', v_cnt1 >= 5, v_cnt1::text);

  -- ===========================================================================================================
  -- suggest_scoreline
  -- ===========================================================================================================
  select count(*) into v_cnt1 from public.predictions;
  select count(*) into v_cnt2 from public.model_predictions;
  select count(*) into v_i from public.team_ratings;

  -- sin rating: valores por defecto documentados
  v_j := pg_temp.sug(v_p, v_pm_u);
  perform pg_temp.rec('G01 equipos sin rating: rated=false con ratings por defecto (1500) y ventaja local',
    v_j is not null and (v_j ->> 'rated') = 'false' and pg_temp.near((v_j ->> 'lambda_home')::double precision, 1.464267, 2e-6) and pg_temp.near((v_j ->> 'lambda_away')::double precision, 1.244650, 2e-6)
    and pg_temp.near((v_j ->> 'p_home')::double precision, 0.422156, 2e-6) and pg_temp.near((v_j ->> 'p_draw')::double precision, 0.256174, 2e-6) and pg_temp.near((v_j ->> 'p_away')::double precision, 0.321670, 2e-6)
    and (v_j ->> 'home_goals') = '1' and (v_j ->> 'away_goals') = '1' and (v_j -> 'ratings_as_of') = 'null'::jsonb, coalesce(v_j::text, 'sin respuesta'));
  v_j := pg_temp.sug(v_p, v_pm_au);
  perform pg_temp.rec('G02 un solo equipo con rating: rated=false (A con rating, U1 por defecto)', v_j is not null and (v_j ->> 'rated') = 'false', coalesce(v_j::text, 'sin respuesta'));

  -- con rating
  v_j := pg_temp.sug(v_p, v_pm_ab);
  perform pg_temp.rec('G03 ambos equipos con rating: rated=true y valores = vector independiente (A 1519.99 vs B 1467.73)',
    v_j is not null and (v_j ->> 'rated') = 'true' and pg_temp.near((v_j ->> 'lambda_home')::double precision, 1.563116, 2e-5) and pg_temp.near((v_j ->> 'lambda_away')::double precision, 1.165940, 2e-5)
    and pg_temp.near((v_j ->> 'p_home')::double precision, 0.464581, 2e-5) and pg_temp.near((v_j ->> 'p_draw')::double precision, 0.251133, 2e-5) and pg_temp.near((v_j ->> 'p_away')::double precision, 0.284286, 2e-5)
    and (v_j ->> 'home_goals') = '1' and (v_j ->> 'away_goals') = '1', coalesce(v_j::text, 'sin respuesta'));
  perform pg_temp.rec('G04 contrato: todas las claves presentes, versión del modelo y timestamps',
    v_j ?& array['home_goals', 'away_goals', 'p_home', 'p_draw', 'p_away', 'lambda_home', 'lambda_away', 'model_version', 'computed_at', 'rated', 'disclaimer', 'p_scoreline', 'ratings_as_of']
    and (v_j ->> 'model_version') = 'elo-poisson-v1' and (v_j ->> 'computed_at') is not null and (v_j ->> 'ratings_as_of') is not null, coalesce(v_j::text, ''));
  perform pg_temp.rec('G05 1X2 suma exactamente 1 (6 decimales) y todo entre 0 y 1',
    (v_j ->> 'p_home')::numeric + (v_j ->> 'p_draw')::numeric + (v_j ->> 'p_away')::numeric = 1
    and (v_j ->> 'p_home')::numeric between 0 and 1 and (v_j ->> 'p_draw')::numeric between 0 and 1 and (v_j ->> 'p_away')::numeric between 0 and 1, coalesce(v_j::text, ''));
  perform pg_temp.rec('G06 aviso: no es certeza ni recomendación de apuesta', (v_j ->> 'disclaimer') ~* 'no es una certeza' and (v_j ->> 'disclaimer') ~* 'apuesta', coalesce(v_j ->> 'disclaimer', ''));
  v_j2 := pg_temp.sug(v_p, v_pm_ab);
  perform pg_temp.rec('G07 determinismo: dos llamadas = misma respuesta (salvo computed_at)', v_j2 is not null and (v_j - 'computed_at') = (v_j2 - 'computed_at'), coalesce(v_j2::text, ''));
  v_j2 := pg_temp.sug(v_p, v_pm_ab);
  perform pg_temp.rec('G07b el marcador sugerido coincide con la moda de la matriz del propio modelo (stats_pick_scoreline)',
    (v_j2 ->> 'home_goals')::integer = (select pick_home from public.stats_pick_scoreline((v_j2 ->> 'lambda_home')::double precision, (v_j2 ->> 'lambda_away')::double precision, 6)), '');
  -- control positivo en T2 (rated por la reconstrucción global)
  v_j2 := pg_temp.sug(v_xp, v_pm_t2);
  perform pg_temp.rec('G08 control positivo: el jugador de T2 obtiene sugerencia de SU quiniela (rated=true)', v_j2 is not null and (v_j2 ->> 'rated') = 'true', coalesce(v_j2::text, 'sin respuesta'));

  -- no escribe nada
  select count(*) into v_ph from public.predictions; select count(*) into v_pa from public.model_predictions;
  perform pg_temp.rec('G09 suggest_scoreline no escribe pronósticos, model_predictions ni ratings',
    v_ph = v_cnt1 and v_pa = v_cnt2 and (select count(*) from public.team_ratings) = v_i, v_ph::text || '/' || v_pa::text);

  -- barrera de elegibilidad
  v_res := pg_temp.sug_err(v_xp, v_pm_ab);
  perform pg_temp.rec('G10 un jugador de OTRO tenant no puede sugerir para esta quiniela (22023 STATS_NOT_FOUND)', pg_temp.is_err(v_res, '22023', 'STATS_NOT_FOUND'), v_res);
  v_res := pg_temp.sug_err(v_y, v_pm_ab);
  perform pg_temp.rec('G10b un usuario sin membresía: mismo error indistinguible (22023 STATS_NOT_FOUND)', pg_temp.is_err(v_res, '22023', 'STATS_NOT_FOUND'), v_res);
  v_res := pg_temp.sug_err(v_p, gen_random_uuid());
  perform pg_temp.rec('G10c un pool_match inexistente: 22023 STATS_NOT_FOUND', pg_temp.is_err(v_res, '22023', 'STATS_NOT_FOUND'), v_res);
  v_res := pg_temp.sug_err(v_p, null);
  perform pg_temp.rec('G10d id nulo: 22023 STATS_NOT_FOUND', pg_temp.is_err(v_res, '22023', 'STATS_NOT_FOUND'), v_res);
  v_res := pg_temp.sug_err(v_o, v_pm_ab);
  perform pg_temp.rec('G11 el administrador (owner) de la quiniela NO puede usarla (42501 ADMIN_PARTICIPANT_INCOMPATIBLE)', pg_temp.is_err(v_res, '42501', 'ADMIN_PARTICIPANT_INCOMPATIBLE'), v_res);
  v_res := pg_temp.sug_err(v_l, v_pm_ab);
  perform pg_temp.rec('G11b un perfil con exclusión administrativa persistida tampoco (42501 ADMIN_PARTICIPANT_INCOMPATIBLE)', pg_temp.is_err(v_res, '42501', 'ADMIN_PARTICIPANT_INCOMPATIBLE'), v_res);
  v_res := pg_temp.sug_err(v_m, v_pm_ab);
  perform pg_temp.rec('G12 un miembro no inscrito no puede (42501 STATS_NOT_ELIGIBLE)', pg_temp.is_err(v_res, '42501', 'STATS_NOT_ELIGIBLE'), v_res);
  v_res := pg_temp.sug_err(v_q, v_pm_ab);
  perform pg_temp.rec('G12b un participante pendiente de aprobación no puede (42501 STATS_NOT_ELIGIBLE)', pg_temp.is_err(v_res, '42501', 'STATS_NOT_ELIGIBLE'), v_res);
  v_res := pg_temp.sug_err(v_w, v_pm_ab);
  perform pg_temp.rec('G12c un participante retirado no puede (42501 STATS_NOT_ELIGIBLE)', pg_temp.is_err(v_res, '42501', 'STATS_NOT_ELIGIBLE'), v_res);
  v_res := pg_temp.as_role('anon', format($q$select public.suggest_scoreline(%L)$q$, v_pm_ab));
  perform pg_temp.rec('G13 anon no ejecuta suggest_scoreline (42501)', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_role('postgres', format($q$select public.suggest_scoreline(%L)$q$, v_pm_ab));
  perform pg_temp.rec('G13b sin sesión (auth.uid nulo) se rechaza (28000)', pg_temp.is_err(v_res, '28000'), v_res);

  -- lock server-side
  v_res := pg_temp.sug_err(v_p, v_pm_off);
  perform pg_temp.rec('G20 lock por offset: el partido empieza en 10 min y el lock es a los 15 → 42501 STATS_LOCKED', pg_temp.is_err(v_res, '42501', 'STATS_LOCKED'), v_res);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform public.apply_fixture_update(v_live, null, 'live');
  perform set_config('request.jwt.claims', '', true);
  v_res := pg_temp.sug_err(v_p, v_pm_live);
  perform pg_temp.rec('G21 partido en vivo → 42501 STATS_LOCKED', pg_temp.is_err(v_res, '42501', 'STATS_LOCKED'), v_res);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform public.apply_fixture_update(v_ab, now() - interval '1 minute', null);
  perform set_config('request.jwt.claims', '', true);
  v_res := pg_temp.sug_err(v_p, v_pm_ab);
  perform pg_temp.rec('G22 el partido adelantado por el sincronizador se bloquea al instante (STATS_LOCKED) aunque el reloj del cliente diga otra cosa', pg_temp.is_err(v_res, '42501', 'STATS_LOCKED'), v_res);
  update public.pools set status = 'paused' where id = v_pool;
  v_res := pg_temp.sug_err(v_p, v_pm_u);
  perform pg_temp.rec('G23 quiniela pausada → 42501 STATS_LOCKED', pg_temp.is_err(v_res, '42501', 'STATS_LOCKED'), v_res);
  update public.pools set status = 'open' where id = v_pool;
  v_res := pg_temp.sug_err(v_p, v_pm_u);
  perform pg_temp.rec('G24 al reabrir la quiniela vuelve a estar disponible (control positivo)', pg_temp.is_ok(v_res), v_res);
  v_res := pg_temp.sug_err(v_p, v_pm_bb);
  perform pg_temp.rec('G25 deporte sin modelo (baloncesto) → 22023 STATS_UNSUPPORTED_SPORT', pg_temp.is_err(v_res, '22023', 'STATS_UNSUPPORTED_SPORT'), v_res);

  -- ACL
  perform pg_temp.rec('A01 suggest_scoreline: authenticated sí; anon y PUBLIC no',
    has_function_privilege('authenticated', 'public.suggest_scoreline(uuid)', 'execute') and not has_function_privilege('anon', 'public.suggest_scoreline(uuid)', 'execute'), '');
  perform pg_temp.rec('A02 rebuild_team_ratings: solo service_role',
    has_function_privilege('service_role', 'public.rebuild_team_ratings(text,uuid,text)', 'execute')
    and not has_function_privilege('authenticated', 'public.rebuild_team_ratings(text,uuid,text)', 'execute')
    and not has_function_privilege('anon', 'public.rebuild_team_ratings(text,uuid,text)', 'execute'), '');
  perform pg_temp.rec('A03 funciones puras: sin EXECUTE para clientes',
    not has_function_privilege('authenticated', 'public.stats_poisson_pmf(integer,double precision)', 'execute')
    and not has_function_privilege('anon', 'public.stats_scoreline_matrix(double precision,double precision,integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.stats_elo_update(double precision,double precision,integer,integer,double precision,double precision,double precision,boolean)', 'execute'), '');
  perform pg_temp.rec('A04 _stats_current_params no ejecutable por clientes',
    not has_function_privilege('authenticated', 'public._stats_current_params(text,text)', 'execute') and not has_function_privilege('anon', 'public._stats_current_params(text,text)', 'execute'), '');
  v_res := pg_temp.as_user(v_p, 'select public.stats_poisson_pmf(0, 1)');
  perform pg_temp.rec('A05 un autenticado no ejecuta las puras directamente (42501)', pg_temp.is_err(v_res, '42501'), v_res);
  select count(*) into v_cnt1 from pg_tables t where t.schemaname = 'public' and t.tablename in ('stats_model_params', 'stats_rating_runs', 'team_ratings') and t.rowsecurity;
  perform pg_temp.rec('A06 RLS activa en las 3 tablas del motor', v_cnt1 = 3, v_cnt1::text);
  select count(*) into v_cnt1 from information_schema.role_table_grants g
   where g.table_schema = 'public' and g.table_name in ('stats_model_params', 'stats_rating_runs', 'team_ratings') and g.grantee in ('anon', 'authenticated') and g.privilege_type <> 'SELECT';
  perform pg_temp.rec('A07 clientes solo tienen SELECT en las tablas del motor', v_cnt1 = 0, v_cnt1::text);
  select count(*) into v_cnt1 from information_schema.role_table_grants g
   where g.table_schema = 'public' and g.table_name in ('stats_model_params', 'stats_rating_runs') and g.grantee = 'anon';
  perform pg_temp.rec('A08 anon sin ningún privilegio sobre parámetros ni corridas', v_cnt1 = 0, v_cnt1::text);
end $$;
