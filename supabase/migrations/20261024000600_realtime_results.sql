-- Tabla y resultados en vivo (2026-10-24, pedido del propietario: «los resultados de la tabla deben actualizarse»). Forward-only;
-- reversión en supabase/proposed/down/20261024000600_realtime_results.down.sql.
--
-- Publica `official_results` y `matches` en Supabase Realtime para que la quiniela abierta recargue su tabla al publicarse o corregirse
-- un resultado o al cambiar el estado de un partido. Realtime aplica las políticas SELECT existentes: solo los miembros del tenant
-- reciben los cambios. No se publica ninguna tabla con pronósticos.
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime no existe: la app usará solo el sondeo';
    return;
  end if;
  foreach t in array array['official_results', 'matches'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
