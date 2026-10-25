-- Reconstrucción programada de ratings. Se ejecuta con scripts/qa/run-sql-suite.mjs (transacción con rollback; no deja datos).
do $$
declare v_res text; v_u uuid; v_n integer;
begin
  select count(*) into v_n from cron.job where jobname = 'rebuild-team-ratings' and schedule = '*/30 * * * *' and command like '%scheduled_rebuild_team_ratings%';
  perform pg_temp.rec('SC01 el job de pg_cron está programado cada 30 minutos', v_n = 1, 'jobs=' || v_n);

  v_res := public.scheduled_rebuild_team_ratings();
  perform pg_temp.rec('SC02 la primera ejecución reconstruye o informa que no hay cambios', v_res in ('rebuilt', 'skipped'), v_res);
  v_res := public.scheduled_rebuild_team_ratings();
  perform pg_temp.rec('SC03 sin resultados nuevos desde la última corrida no recalcula', v_res = 'skipped', v_res);

  v_u := pg_temp.mk_user('sc-user');
  v_res := pg_temp.as_user(v_u, 'select public.scheduled_rebuild_team_ratings()');
  perform pg_temp.rec('SC04 un usuario no ejecuta la reconstrucción programada', pg_temp.is_err(v_res, '42501'), v_res);
  v_res := pg_temp.as_role('anon', 'select public.scheduled_rebuild_team_ratings()');
  perform pg_temp.rec('SC05 anon tampoco', pg_temp.is_err(v_res, '42501'), v_res);
end $$;
