-- Recuperación de 20261024000500_stats_rebuild_schedule. Los ratings ya calculados se conservan; la extensión pg_cron se deja
-- instalada (puede tener otros jobs). Para quitarla: `drop extension pg_cron;` tras revisar `cron.job`.
set local lock_timeout = '5s';

do $$
begin
  if exists (select 1 from cron.job where jobname = 'rebuild-team-ratings') then perform cron.unschedule('rebuild-team-ratings'); end if;
end $$;
drop function if exists public.scheduled_rebuild_team_ratings();
