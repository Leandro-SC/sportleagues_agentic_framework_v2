-- Recuperación de 20261024000400_account_deletion. Las cuentas ya anonimizadas NO se restauran (la PII se eliminó a pedido del
-- titular); se conserva `deleted_at` hasta borrar la columna, por lo que conviene exportarla antes si se necesita como evidencia.
set local lock_timeout = '5s';

drop function if exists public.anonymize_account(uuid);
drop function if exists public.account_deletion_blockers();
drop function if exists public._account_deletion_blockers(uuid);
alter table public.profiles drop column if exists deleted_at;
