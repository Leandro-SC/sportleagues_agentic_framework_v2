-- Recuperación de 20261024000300_result_notifications. Los avisos guardados se pierden con la tabla (no son evidencia: el
-- resultado oficial y el scoring siguen en sus tablas).
set local lock_timeout = '5s';

do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    execute 'alter publication supabase_realtime drop table public.notifications';
  end if;
end $$;
drop trigger if exists official_results_notify on public.official_results;
drop function if exists public.tg_official_results_notify();
drop function if exists public.mark_notifications_read(uuid[]);
drop function if exists public.purge_read_notifications(interval);
drop table if exists public.notifications;
