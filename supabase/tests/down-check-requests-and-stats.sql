-- Verifica la reversión de 20261020 (solicitudes) y 20261021 (Elo + Poisson). Ejecutar con migraciones Y downs en la misma transacción (rollback):
--   node scripts/qa/run-sql-suite.mjs supabase/tests/down-check-requests-and-stats.sql
--     --with-migration supabase/proposed/20261020000100_pool_creation_requests.sql --with-migration supabase/proposed/down/20261020000100_pool_creation_requests.down.sql
--     --with-migration supabase/proposed/20261021000100_stats_elo_poisson.sql --with-migration supabase/proposed/down/20261021000100_stats_elo_poisson.down.sql
do $$
declare v_team_ratings_cols text;
begin
  -- 20261020
  perform pg_temp.rec('DQ01 tablas de solicitud eliminadas', to_regclass('public.pool_creation_requests') is null and to_regclass('public.pool_creation_request_events') is null, '');
  perform pg_temp.rec('DQ02 RPC de solicitud eliminadas', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
      and proname in ('request_pool_creation', 'my_pool_creation_request', 'cancel_pool_creation_request', 'review_pool_creation_request', '_pool_creation_request_json',
                      'tg_pool_creation_requests_guard', 'tg_pool_creation_requests_audit')) = 0, '');
  -- 20261021
  perform pg_temp.rec('DE01 tablas del motor eliminadas', to_regclass('public.stats_model_params') is null and to_regclass('public.stats_rating_runs') is null, '');
  perform pg_temp.rec('DE02 funciones del motor y sugerencia eliminadas', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
      and (proname like 'stats\_%' escape '\' or proname in ('suggest_scoreline', 'rebuild_team_ratings', '_stats_current_params', 'tg_stats_model_params_guard'))) = 0, '');
  select string_agg(column_name, ',' order by column_name) into v_team_ratings_cols from information_schema.columns where table_schema = 'public' and table_name = 'team_ratings';
  perform pg_temp.rec('DE03 team_ratings vuelve sin columnas del motor', coalesce(v_team_ratings_cols, '') !~ '(sport_code|matches_played|last_match_at|run_id)', coalesce(v_team_ratings_cols, ''));
  perform pg_temp.rec('DE04 team_ratings sigue existiendo', to_regclass('public.team_ratings') is not null, '');
  -- No toca el resto del sistema: lo aplicado antes sigue ahí.
  perform pg_temp.rec('DX01 20261022 intacta (política acotada de participants)', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'participants' and policyname = 'participants_select_scoped'), '');
  perform pg_temp.rec('DX02 publish_official_result y save_prediction siguen existiendo', to_regprocedure('public.publish_official_result(uuid,integer,integer,integer)') is not null and to_regprocedure('public.save_prediction(uuid,uuid,integer,integer)') is not null, '');
end $$;
