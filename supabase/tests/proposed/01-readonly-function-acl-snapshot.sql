-- CLASE A — SOLO LECTURA. Instantánea de quién puede ejecutar cada función de public.
-- Uso: guardar la salida ANTES y DESPUÉS de aplicar 2/3 y compararlas (scripts/qa/remediation/run-suite.mjs acl-diff).
-- Criterio: ninguna función pierde EXECUTE para authenticated o service_role salvo que esté en la lista esperada; anon pierde todo.
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fn,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_exec
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
 where p.prokind = 'f'
 order by 1;
