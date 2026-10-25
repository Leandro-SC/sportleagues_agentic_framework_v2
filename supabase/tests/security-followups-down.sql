-- Verifica la reversión de 20261022000100. Ejecutar con migración Y down en la misma transacción (rollback):
--   node scripts/qa/run-sql-suite.mjs supabase/tests/security-followups-down.sql --with-migration supabase/proposed/20261022000100_security_followups.sql --with-migration supabase/proposed/down/20261022000100_security_followups.down.sql
do $$
declare v_src text; fn text;
begin
  perform pg_temp.rec('D01 maintenance_runs eliminada', to_regclass('public.maintenance_runs') is null, '');
  perform pg_temp.rec('D02 no queda ninguna sobrecarga de purge_fixture_sync_log', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'purge_fixture_sync_log') = 0, '');
  perform pg_temp.rec('D03 funciones de trigger nuevas eliminadas', to_regprocedure('public.tg_catalog_touch_relevant()') is null and to_regprocedure('public.tg_fixture_sync_log_dedupe()') is null, '');
  perform pg_temp.rec('D04 sin trigger de deduplicación ni índice por created_at',
    not exists (select 1 from pg_trigger where tgrelid = 'public.fixture_sync_log'::regclass and tgname = 'fixture_sync_log_dedupe') and to_regclass('public.fixture_sync_log_created_idx') is null, '');
  perform pg_temp.rec('D05 política de participants restaurada (is_tenant_member) y sin la acotada',
    exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'participants' and policyname = 'participants_select_member')
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'participants' and policyname = 'participants_select_scoped'), '');
  perform pg_temp.rec('D06 triggers de updated_at vuelven a tg_catalog_touch',
    (select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgname in ('catalog_fixtures_touch', 'catalog_seasons_touch') and p.proname = 'tg_catalog_touch') = 2, '');
  perform pg_temp.rec('D07 catalog_seasons vuelve a ser legible por columna operativa para authenticated', has_column_privilege('authenticated', 'public.catalog_seasons', 'fixtures_synced_at', 'select'), '');
  foreach fn in array array['import_catalog_round', 'import_catalog_teams', 'set_tournament_results_mode', 'publish_official_result', 'set_participant_payment_status', 'approve_participant'] loop
    select lower(p.prosrc) into v_src from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = fn;
    perform pg_temp.rec('D1 ' || fn || ' restaurada (FOR UPDATE antes de is_tenant_admin)', strpos(v_src, 'for update') > 0 and strpos(v_src, 'for update') < strpos(v_src, 'is_tenant_admin'), '');
  end loop;
end $$;
