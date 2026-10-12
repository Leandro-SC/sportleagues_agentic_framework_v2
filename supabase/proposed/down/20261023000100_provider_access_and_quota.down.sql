-- Reversión de 20261023000100_provider_access_and_quota.sql. Elimina SOLO lo que esa migración creó: presupuestos por plan, contadores por
-- tenant/mes, libro de reservas y funciones de reserva. NO toca `provider_usage` (salvo la columna añadida `quota_rejected`), `provider_consume`,
-- `provider_record_outcome`, el catálogo, la bandera `auto_results` ni datos de tenants. El conteo global diario (`provider_usage.requests`)
-- se conserva. Tras revertir, la Edge Function debe volver a `provider_consume` (o permanecer sin desplegar, que es su estado actual).
set local lock_timeout = '5s';
set local statement_timeout = '120s';

drop function if exists public.provider_quota_purge(interval, integer);
drop function if exists public.provider_settle(uuid, text, text);
drop function if exists public.provider_reserve(text, text, uuid, integer, integer);
drop function if exists public.provider_access_check(text, text, uuid);
drop function if exists public._provider_tenant_access(text, text, uuid);

drop table if exists public.provider_quota_reservations;
drop table if exists public.provider_tenant_usage;
drop table if exists public.provider_usage_monthly;
drop table if exists public.plan_provider_quota;
drop table if exists public.provider_quota_config;

alter table public.provider_usage drop column if exists quota_rejected;
