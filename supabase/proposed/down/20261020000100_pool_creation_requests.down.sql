-- ROLLBACK de 20261020000100_pool_creation_requests (ADR-017). NO EJECUTAR en QA sin autorización del propietario.
-- Protección: destruye el historial de solicitudes y su auditoría. Exportar antes y fijar
--   select set_config('sl.allow_destructive_rollback', 'on', true);
-- en la misma transacción para confirmar. Sin la bandera, el script aborta si hay filas.
-- Los tenants y membresías creados por aprobaciones NO se eliminan (son datos de negocio y su audit_log es inmutable).
set local lock_timeout = '5s';
do $$
begin
  if coalesce(current_setting('sl.allow_destructive_rollback', true), 'off') <> 'on'
     and (exists (select 1 from public.pool_creation_requests) or exists (select 1 from public.pool_creation_request_events)) then
    raise exception 'rollback would destroy pool creation request history; export it and set sl.allow_destructive_rollback=on';
  end if;
end $$;

drop function if exists public.review_pool_creation_request(uuid, text, text, text);
drop function if exists public.cancel_pool_creation_request();
drop function if exists public.my_pool_creation_request();
drop function if exists public.request_pool_creation(text);
drop function if exists public._pool_creation_request_json(public.pool_creation_requests, boolean);

-- Los triggers de las tablas se eliminan con ellas; las funciones de trigger después.
drop table if exists public.pool_creation_request_events;
drop table if exists public.pool_creation_requests;
drop function if exists public.tg_pool_creation_requests_audit();
drop function if exists public.tg_pool_creation_requests_guard();
