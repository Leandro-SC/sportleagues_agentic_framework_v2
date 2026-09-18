# Fase 05 — Panel del organizador

## Resultado

`PARTIAL / IMPLEMENTED_LOCALLY / CLOUD_MIGRATION_AND_E2E_PENDING`.

## Implementación

- Se añadió `/admin`, protegida por el guard de sesión/perfil. El composable consulta membresías activas y solo presenta tenants con rol `owner` o `admin`; un miembro que fuerce la ruta recibe un estado de acceso administrativo vacío. RLS y los RPC siguen siendo la autoridad.
- El panel permite crear, editar, abrir, pausar y archivar quinielas; configurar lock y aprobación manual; publicar reglas versionadas; aprobar participantes; cambiar su estado manual (`paid`, `pending`, `invited`); y generar/copiar códigos de unión.
- La nueva migración `20260913000200_phase_05_pool_and_branding_entitlements.sql` incorpora `manage_pool` y `update_tenant_branding`. Las operaciones usan `SECURITY DEFINER`, `auth.uid()`, `is_tenant_admin`, validación de entradas y revocan DML directo sobre `pools` y `tenant_branding`.
- `manage_pool` impone en PostgreSQL el máximo de una quiniela activa/pausada para FREE. La UI lo comunica, pero no se considera frontera de seguridad.
- El branding de color es solo PRO y se valida nuevamente en la función SQL. La carga de logo/banner todavía no está implementada: requiere completar el contrato de registro de asset y reemplazar las policies de Storage existentes para validar PRO antes de exponer el selector de archivos.

## Validación ejecutada

| Verificación | Resultado |
| --- | --- |
| `npx.cmd vitest run src/lib/admin-contracts.test.ts --config apps/platform/vitest.config.ts --reporter=verbose` | PASS — 4 pruebas. |
| `npm.cmd run typecheck` (incluido en build) | PASS. |
| `npm.cmd run build` | PASS. |
| `git diff --check` | PASS. |
| `npx.cmd supabase db push --linked --dry-run` | PASS — Cloud detecta únicamente `20260913000200_phase_05_pool_and_branding_entitlements.sql`; no se aplicaron cambios. |
| Migración en Supabase Cloud development/staging | NO EJECUTADO — la dry-run confirma que requiere aplicación explícita. |
| E2E admin Cloud (owner/admin/member/FREE/PRO) | NO EJECUTADO — depende de la migración y fixtures Cloud. |

## Riesgos y próximos pasos

1. Aplicar y probar la migración nueva contra development/staging antes de desplegar la UI: el cliente usa `manage_pool` y `update_tenant_branding`.
2. Completar el contrato y UI de subida de logo/banner con policies Storage PRO, tamaño máximo y registro atómico del metadata `branding_assets`.
3. Ejecutar E2E con owner/admin/member, una tenant FREE al intentar una segunda quiniela activa y una tenant PRO para branding.

No se modificaron los contratos existentes de Auth, join, participantes o reglas.
