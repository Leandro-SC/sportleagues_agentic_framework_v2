-- Recuperación de 20261024000800_admin_pool_participants (la vista de administración vuelve a no poder listar nombres).
set local lock_timeout = '5s';
drop function if exists public.admin_pool_participants(uuid);
