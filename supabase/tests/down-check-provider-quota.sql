-- Verifica la reversión de 20261023000100 (acceso y cuota del proveedor). Ejecutar con migración Y down en la misma transacción (rollback):
--   node scripts/qa/run-sql-suite.mjs supabase/tests/down-check-provider-quota.sql
--     --with-migration supabase/proposed/20261023000100_provider_access_and_quota.sql --with-migration supabase/proposed/down/20261023000100_provider_access_and_quota.down.sql
do $$
begin
  perform pg_temp.rec('DP01 tablas nuevas eliminadas', to_regclass('public.provider_usage_monthly') is null and to_regclass('public.provider_tenant_usage') is null and to_regclass('public.provider_quota_reservations') is null, '');
  perform pg_temp.rec('DP02 funciones nuevas eliminadas', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
      and (proname like 'provider\_reserve%' escape '\' or proname in ('provider_settle', 'provider_access_check', 'provider_quota_purge', '_provider_tenant_access'))) = 0, '');
  perform pg_temp.rec('DP03 se conservan provider_usage, provider_consume y provider_record_outcome',
    to_regclass('public.provider_usage') is not null
    and (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('provider_consume', 'provider_record_outcome')) = 2, '');
  perform pg_temp.rec('DP04 auto_results sigue apagado',
    not exists (select 1 from public.platform_feature_flags where key = 'auto_results' and enabled), '');
  perform pg_temp.rec('DX01 20261022 intacta (política acotada de participants)', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'participants' and policyname = 'participants_select_scoped'), '');
end $$;
