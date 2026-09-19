# HANDOFF — Fase 05 / corrección del hallazgo de seguridad 001

- Agente: Orchestrator + Security/Backend/QA (alcance mínimo)
- Estado: PARTIAL

## Objetivo

Preparar una corrección incremental para impedir que `anon` o `authenticated` invoquen
`record_verified_branding_asset` y restaurar la regresión correcta para `is_platform_admin()`.

## Archivos modificados

- `supabase/migrations/20260917000100_phase_05_branding_asset_service_role_guard.sql`
- `supabase/tests/phase-05-branding-assets.sql`
- `supabase/tests/phase-05bis-platform-admin.sql`
- `reports/security/finding-001-record-verified-branding-asset-authorization-gap.md`
- `reports/admin/phase-05bis-qa-validation.md`
- `PROJECT_STATE.md`

## Contratos/API afectados

No cambia la firma de la RPC. `record_verified_branding_asset` conserva su uso exclusivo desde
la Edge Function con `service_role`; las llamadas de `anon` y `authenticated` ahora fallan con
`42501` antes de leer o escribir metadata.

## Decisiones

- Se usó una migración nueva, nunca se modificó una migración ya aplicada.
- La autorización interna es la frontera primaria; el `REVOKE` explícito a roles de API es
  defensa en profundidad contra los default ACLs de Supabase Cloud.
- El test `anon` de `is_platform_admin()` ahora verifica el comportamiento seguro real (`false`),
  no un supuesto de ACL que QA demostró incorrecto.

## Tests ejecutados

- `npx supabase db push --linked --dry-run`: PASS; una sola migración pendiente y no aplicada.
- `npm run typecheck`: PASS.
- `npm test`: PASS, 10 archivos / 49 tests.
- `npm run build`: PASS.
- `git diff --check`: PASS.
- SQL local: NO EJECUTADO; Docker Desktop no estaba disponible (`dockerDesktopLinuxEngine` no
  encontrado), por lo que Supabase no pudo iniciar/inspeccionar la base local.

## Riesgos / limitaciones

El hallazgo alto sigue abierto en QA hasta aplicar la migración y ejecutar la regresión SQL.
No se provisionó Superadmin ni se desplegaron Edge Functions. La validación manual de `/admin`
y `/superadmin` sigue pendiente.

## Bloqueos

- Autorización para aplicar la migración correctiva en QA.
- Docker Desktop/local Supabase disponible, o un fixture QA suficiente, para la regresión SQL.
- Fixture QA `Admin B`/`Pending A`, validación manual de navegador y provisioning de Superadmin
  siguen siendo pendientes independientes del cambio.

## Próximo paso permitido

Aplicar la migración en QA con autorización explícita y repetir los tests SQL; mantener Fase 05/
05-bis sin cerrar y no iniciar Fase 06 hasta completar los gates externos restantes.

## Actualización de ejecución (2026-09-17)

- Migración aplicada en QA; lista sincronizada (9/9).
- `phase-05-branding-asset-security-regression.sql`: PASS contra QA, con rollback.
- `phase-05bis-platform-admin.sql`: PASS contra QA, con rollback.
- `branding-asset`: `deno task check` y 6 tests PASS.
- `branding-reconciler`: `deno task check` y 3 tests PASS.
- Hallazgo 001: CLOSED / VALIDATED.

No se desplegaron funciones: falta `CORS_ALLOWED_ORIGINS` en QA; `BRANDING_RECONCILER_SECRET`
quedó configurado posteriormente.
Fase 06 permanece bloqueada por ese gate y por los pendientes manuales/fixtures/Superadmin.

## Provisioning QA parcial (2026-09-19)

- Superadmin bootstrap provisionado en `platform_admins`, confirmado por `is_platform_admin()`;
  no existe acceso directo de `authenticated` a esa tabla.
- Admin 2 provisionado como admin exclusivamente de Tenant B. Usuario quedó como member de
  Tenant A; ambos negativos admin/global confirmados por helpers SQL.
- Admin 1 completó onboarding y fue asignado como admin exclusivamente de Tenant A; Tenant B y
  plataforma siguen denegados. No se modificó `auth.users`.
- Happy paths de Functions pendientes: falta sesión Auth real/JWT de prueba y la credencial interna
  no se recupera ni rota.

Fase 05/05-bis sigue sin ACCEPTED; no iniciar Fase 06.

## Consolidación final parcial (2026-09-19)

- Matriz QA consolidada: Usuario normal sin admin/global; Admin 1 solo Tenant A; Admin 2 solo
  Tenant B; Superadmin confirmado, sin acceso directo a `platform_admins`.
- El operador informó Magic Link PASS y Google OAuth PASS en el frontend QA; no se almacenaron
  sesiones ni se automatizó autenticación.
- Build PASS y `git diff --check` PASS. `supabase test db --linked`: BLOCKED_EXTERNAL por Docker.
- No recomendar ACCEPTED: faltan happy paths HTTP autenticados de branding-asset y reconciler;
  no recuperar, registrar ni rotar JWT/secretos para reemplazarlos.

No iniciar Fase 06.

## Ejecución QA canónica (2026-09-19)

- Migration list: 11/11 sincronizadas; `db push --dry-run`: sin pendientes, no se aplicó push.
- SQL QA PASS: phase-03 RLS, phase-05 admin RPC, branding assets, security regression y
  platform-admin; todas las suites revierten sus fixtures.
- `supabase test db --linked`: BLOCKED_EXTERNAL por Docker Desktop ausente.
- No se provisionaron QA User/Admin A/Admin B/Superadmin ni happy paths de Functions: faltan
  identidades Auth accesibles, JWT de prueba y credencial interna segura. El bootstrap de
  Superadmin requiere un UUID Auth real proporcionado/confirmado por el operador.

Fase 05/05-bis sigue sin ACCEPTED; no iniciar Fase 06.

## Recuperación canónica (2026-09-19)

- SQL remoto QA PASS: branding assets, admin RPC y RLS; todas las suites revierten sus fixtures.
- Fixtures de Fase 05 autocontenidos; no se crearon usuarios QA persistentes.
- Migraciones `20260918000100` y `20260918000200` recuperadas; Storage valida denegación efectiva
  de INSERT de cliente por RLS, sin policies de escritura branding.
- `npm run typecheck`, `npm test` (49 tests) y `npm run build`: PASS.
- `npx supabase test db --linked`: BLOCKED_EXTERNAL por Docker Desktop ausente.

No cerrar Fase 05/05-bis ni iniciar Fase 06. Quedan cuentas QA reales/accesibles, browser para
Magic Link/OAuth y QA manual, y happy paths autenticados de ambas Functions.

## Actualización de configuración (2026-09-17)

`BRANDING_RECONCILER_SECRET` está configurado en QA con un secreto nuevo criptográficamente
seguro; el valor no se expuso ni registró. Sigue faltando exclusivamente el origen HTTPS del
frontend QA para establecer `CORS_ALLOWED_ORIGINS`. Las fuentes de configuración y documentación
del proyecto solo contienen hosts locales y la URL de Supabase, no un frontend QA desplegado.
Por eso las Edge Functions no se desplegaron ni se invocaron.
