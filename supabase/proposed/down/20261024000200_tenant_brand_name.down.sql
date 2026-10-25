-- Recuperación de 20261024000200_tenant_brand_name. Los nombres de plataforma guardados se pierden con la columna
-- (exportarlos antes si deben conservarse); el historial queda en audit_log.
set local lock_timeout = '5s';

drop trigger if exists audit_tenant_branding on public.tenant_branding;
drop function if exists public.set_tenant_brand_name(uuid, text);
alter table public.tenant_branding drop column if exists brand_name;
