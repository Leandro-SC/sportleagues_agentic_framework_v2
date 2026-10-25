-- Recuperación de 20261024000600_realtime_results: retira las tablas de la publicación (la app sigue con el sondeo).
do $$
declare t text;
begin
  foreach t in array array['official_results', 'matches'] loop
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end $$;
