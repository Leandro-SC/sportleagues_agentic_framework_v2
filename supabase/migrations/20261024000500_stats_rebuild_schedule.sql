-- Reconstrucción programada de ratings Elo (ADR-019 §operación, 2026-10-24). Forward-only; reversión en
-- supabase/proposed/down/20261024000500_stats_rebuild_schedule.down.sql.
--
-- `rebuild_team_ratings` es determinista e idempotente, pero solo se ejecutaba a mano: tras nuevos resultados, las sugerencias usaban
-- ratings viejos. pg_cron (extensión de Supabase, sin proveedor externo) la ejecuta cada 30 minutos SOLO si hubo resultados oficiales
-- publicados o corregidos después de la última corrida. Sin EXECUTE para clientes.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create extension if not exists pg_cron;

create function public.scheduled_rebuild_team_ratings() returns text
language plpgsql security definer set search_path = ''
as $$
declare v_last timestamptz; v_newest timestamptz;
begin
  select max(created_at) into v_last from public.stats_rating_runs;
  select max(published_at) into v_newest from public.official_results;
  if v_newest is null or (v_last is not null and v_newest <= v_last) then return 'skipped'; end if;
  -- La función de reconstrucción exige el rol service_role en los claims de la petición; el job no tiene petición HTTP.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.rebuild_team_ratings('football', null, null);
  return 'rebuilt';
end $$;
revoke all on function public.scheduled_rebuild_team_ratings() from public, anon, authenticated;

select cron.schedule('rebuild-team-ratings', '*/30 * * * *', 'select public.scheduled_rebuild_team_ratings()');
