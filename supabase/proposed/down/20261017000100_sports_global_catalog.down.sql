-- Recuperación de 20261017000100 (ADR-016). Rechaza si ya hay resultados de origen 'provider' o partidos con provider_state
-- (no se pierde información de puntuación). Las referencias external_refs y los datos importados en tenants NO se borran.
do $$
begin
  if exists (select 1 from public.official_results where source = 'provider') then
    raise exception 'down rechazado: existen resultados oficiales de origen proveedor';
  end if;
end $$;
drop function if exists public.catalog_fixtures_due(text, integer);
drop function if exists public.catalog_propagate_fixtures(uuid[]);
drop function if exists public._provider_result(public.matches, integer, integer);
drop function if exists public.import_catalog_round(uuid, uuid, text);
drop function if exists public.catalog_upsert_fixtures(uuid, text, jsonb);
drop function if exists public.catalog_upsert_competition(text, jsonb);
drop function if exists public.provider_record_outcome(text, boolean, boolean);
drop function if exists public.provider_consume(text, integer, integer);
drop function if exists public.catalog_finish_import(uuid, text, text, integer);
drop function if exists public.catalog_begin_import(text, text, uuid, interval, interval);
drop table if exists public.fixture_sync_log;
alter table public.official_results drop constraint if exists official_results_source_actor;
alter table public.official_results drop column if exists source;
alter table public.official_results alter column published_by set not null;
alter table public.matches drop column if exists provider_state;
drop table if exists public.provider_usage, public.catalog_import_jobs, public.catalog_fixtures, public.catalog_teams, public.catalog_seasons, public.catalog_competitions;
drop function if exists public.tg_catalog_touch();
