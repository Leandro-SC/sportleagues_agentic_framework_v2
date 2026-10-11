-- CLASE A — SOLO LECTURA. Ejecutable sobre QA (y sobre el proyecto descartable). No lee filas de aplicación ni PII.
--   npx supabase db query --linked -o json -f supabase/tests/proposed/00-readonly-baseline.sql
-- Cada fila: check_id, ok, detail. HOY (sin remediación) las comprobaciones de privilegios/triggers deben dar ok = false:
-- es la línea base documentada, no un defecto de la prueba. Tras aplicar 1/3–3/3 en el proyecto descartable deben ser true.
with
tbls as (
  select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public' where c.relkind = 'r'
),
funcs as (
  select p.oid, p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public' where p.prokind = 'f'
)
select 'P01 sin TRUNCATE/REFERENCES/TRIGGER para anon/authenticated' as check_id,
       count(*) = 0 as ok, count(*)::text || ' combinaciones tabla/rol con privilegio' as detail
  from tbls t cross join (values ('anon'), ('authenticated')) r(rol)
 where has_table_privilege(r.rol, t.oid, 'TRUNCATE') or has_table_privilege(r.rol, t.oid, 'REFERENCES') or has_table_privilege(r.rol, t.oid, 'TRIGGER')
union all
select 'P02 anon sin INSERT/UPDATE/DELETE', count(*) = 0, count(*)::text || ' tablas'
  from tbls t
 where has_table_privilege('anon', t.oid, 'INSERT') or has_table_privilege('anon', t.oid, 'UPDATE') or has_table_privilege('anon', t.oid, 'DELETE')
union all
select 'P03 anon sin EXECUTE en funciones de public', count(*) = 0, count(*)::text || ' funciones'
  from funcs f where has_function_privilege('anon', f.oid, 'EXECUTE')
union all
select 'P04 funciones SECURITY DEFINER con search_path fijo', count(*) = 0, count(*)::text || ' sin search_path'
  from funcs f where f.prosecdef and not exists (select 1 from unnest(coalesce(f.proconfig, '{}')) c where c like 'search_path=%')
union all
select 'P05 RLS activo en todas las tablas de public', count(*) = 0, count(*)::text || ' sin RLS'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public' where c.relkind = 'r' and not c.relrowsecurity
union all
select 'P06 audit_log: sin UPDATE/DELETE/TRUNCATE para clientes',
       not (has_table_privilege('authenticated', 'public.audit_log', 'UPDATE') or has_table_privilege('authenticated', 'public.audit_log', 'DELETE')
            or has_table_privilege('authenticated', 'public.audit_log', 'TRUNCATE') or has_table_privilege('anon', 'public.audit_log', 'TRUNCATE')),
       'privilegios efectivos de authenticated/anon'
union all
select 'P07 audit_log: triggers de inmutabilidad habilitados',
       (select count(*) from pg_trigger t where t.tgrelid = 'public.audit_log'::regclass and t.tgname in ('audit_log_no_update_delete', 'audit_log_no_truncate') and t.tgenabled = 'O') = 2,
       'audit_log_no_update_delete y audit_log_no_truncate'
union all
select 'P08 pool_join_codes: sin política de lectura para miembros',
       not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pool_join_codes' and policyname = 'pool_join_codes_select_member'),
       'política pool_join_codes_select_member'
union all
select 'P09 lock persistido (pool_matches.lock_at) existe',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pool_matches' and column_name = 'lock_at'),
       'columna lock_at'
union all
select 'P10 triggers de integridad de lock/horarios presentes',
       (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname in
          ('pools_guard', 'pools_after_offset', 'pool_matches_set_lock', 'pool_matches_guard_update', 'matches_guard_update', 'matches_after_update',
           'matches_guard_delete', 'pool_matches_guard_delete', 'predictions_guard_insert', 'predictions_guard_update', 'predictions_guard_delete',
           'participants_guard_delete', 'official_results_guard_write', 'official_results_guard_delete')) = 14,
       '14 triggers esperados'
union all
select 'P11 triggers de incompatibilidad presentes',
       (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname in
          ('participants_guard_insert', 'participants_guard_update', 'predictions_guard_participant', 'tenant_memberships_guard',
           'tenant_memberships_exclude', 'pool_staff_guard', 'pools_opening_snapshot')) = 7,
       '7 triggers esperados'
union all
select 'P12 tablas de gobernanza con RLS',
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
         where c.relname in ('pool_staff', 'pool_admin_exclusions', 'legacy_admin_conflicts') and c.relrowsecurity) = 3,
       'pool_staff, pool_admin_exclusions, legacy_admin_conflicts'
union all
select 'P13 funciones solo de servicio no ejecutables por authenticated',
       not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
                    where p.proname = 'record_verified_branding_asset' and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
       'record_verified_branding_asset'
union all
select 'P14 sin PUBLIC/anon/authenticated en privilegios por defecto de funciones (postgres): falla cerrado',
       exists (select 1 from pg_default_acl d where d.defaclobjtype = 'f' and pg_get_userbyid(d.defaclrole) = 'postgres' and d.defaclnamespace = 0)
       and not exists (select 1 from pg_default_acl d, aclexplode(d.defaclacl) a
                        where d.defaclobjtype = 'f' and pg_get_userbyid(d.defaclrole) = 'postgres'
                          and (d.defaclnamespace = 0 or d.defaclnamespace = 'public'::regnamespace)   -- esquemas gestionados por la plataforma (storage, graphql…) quedan fuera
                          and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated')))),
       'default ACL de funciones (global y por esquema)'
order by 1;
