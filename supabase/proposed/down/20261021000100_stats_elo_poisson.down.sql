-- Recuperación de 20261021000100_stats_elo_poisson. Elimina el motor estadístico y los datos DERIVADOS (ratings, corridas, parámetros):
-- todo es reconstruible desde official_results aplicando de nuevo la migración y rebuild_team_ratings(). No toca resultados,
-- pronósticos, scoring ni ninguna otra tabla. Las filas de audit_log 'stats.ratings_rebuilt' se conservan (historial de auditoría).
set local lock_timeout = '5s';

drop function if exists public.suggest_scoreline(uuid);
drop function if exists public.rebuild_team_ratings(text, uuid, text);
drop function if exists public._stats_current_params(text, text);
drop function if exists public.stats_pick_scoreline(double precision, double precision, integer);
drop function if exists public.stats_outcome_probs(double precision, double precision, integer);
drop function if exists public.stats_scoreline_matrix(double precision, double precision, integer);
drop function if exists public.stats_goal_expectations(double precision, double precision, double precision, double precision, double precision, double precision, double precision);
drop function if exists public.stats_poisson_pmf(integer, double precision);
drop function if exists public.stats_elo_update(double precision, double precision, integer, integer, double precision, double precision, double precision, boolean);
drop function if exists public.stats_elo_expected(double precision, double precision, double precision, double precision);

delete from public.team_ratings;   -- estado derivado del motor; la tabla vuelve a su forma original (vacía)
drop index if exists public.team_ratings_current_key;
alter table public.team_ratings drop constraint if exists team_ratings_run_fk;
alter table public.team_ratings
  drop column if exists run_id,
  drop column if exists last_match_at,
  drop column if exists matches_played,
  drop column if exists sport_code;

drop table if exists public.stats_rating_runs;
drop trigger if exists stats_model_params_guard on public.stats_model_params;
drop table if exists public.stats_model_params;
drop function if exists public.tg_stats_model_params_guard();
