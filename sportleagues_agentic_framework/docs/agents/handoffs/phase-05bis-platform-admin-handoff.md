# HANDOFF — Fase 05-bis: infraestructura de Superadmin de plataforma

- Agente: Architecture/Data-RLS + Frontend
- Estado: PARTIAL

## Objetivo

Implementar únicamente la frontera de autorización global de Superadmin definida en
`ADR-008-platform-superadmin-authorization.md`: tabla `platform_admins`, `is_platform_admin()`,
RLS, guard de frontend y ruta/layout aislado de `/superadmin`. Sin dashboard, sin identidad
real provisionada, sin tocar `/admin`.

## Archivos modificados/creados

- `supabase/migrations/20260915000400_phase_05bis_platform_admin_foundation.sql` (nuevo)
- `supabase/tests/phase-05bis-platform-admin.sql` (nuevo)
- `apps/platform/src/lib/navigation-guards.ts` (añadido `platformAdminRedirect`)
- `apps/platform/src/lib/navigation-guards.test.ts` (tests nuevos)
- `apps/platform/src/composables/useSuperadmin.ts` (nuevo)
- `apps/platform/src/composables/useSuperadmin.test.ts` (nuevo)
- `apps/platform/src/components/SuperadminShell.vue` (nuevo)
- `apps/platform/src/views/SuperadminView.vue` (nuevo)
- `apps/platform/src/router.ts` (nueva ruta `/superadmin` + guard `requirePlatformAdmin`)
- `docs/architecture/adr/ADR-008-platform-superadmin-authorization.md` (addendum de bootstrap)
- `docs/operations/PLATFORM-ADMIN-PROVISIONING.md` (nuevo)
- `reports/admin/phase-05bis-platform-admin.md` (nuevo)
- `PROJECT_STATE.md`

## Contratos/API afectados

Nuevo RPC: `is_platform_admin()` (sin argumentos, `security definer`, solo `authenticated`).
No modifica ningún contrato existente de `/admin`, Auth, join, participantes, reglas ni
branding. `tenant_role` no cambia (sin valor `superadmin`).

## Decisiones

Ver `reports/admin/phase-05bis-platform-admin.md` y el addendum de `ADR-008`.

## Tests ejecutados

- Typecheck, `npm.cmd test` (37 pruebas, 9 archivos), build y `git diff --check`: PASS.
- `supabase/tests/phase-05bis-platform-admin.sql`: NO EJECUTADO (Docker no disponible en este
  entorno).

## Riesgos / limitaciones

- La migración no se probó contra Postgres real (local ni Cloud). No aplicar a ningún entorno
  compartido sin correr antes `supabase/tests/phase-05bis-platform-admin.sql`.
- No se provisionó ningún Superadmin real; ver runbook antes de hacerlo.

## Bloqueos

Ejecutar los tests SQL requiere Docker local (o acceso a un Cloud de desarrollo) — no
disponible en este entorno de trabajo.

## Próximo paso permitido

Data/RLS: correr `supabase/tests/phase-05bis-platform-admin.sql` contra Postgres real antes de
aplicar la migración a Cloud. Después de aplicarla, provisionar el primer Superadmin siguiendo
`docs/operations/PLATFORM-ADMIN-PROVISIONING.md`. El dashboard real de `/superadmin`
(tenants, planes, auditoría) es una fase posterior explícita. No iniciar Fase 06.
