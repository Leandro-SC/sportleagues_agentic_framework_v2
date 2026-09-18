# HANDOFF — Fase 05: implementación parcial del panel admin

- Agente: Frontend/Admin UX
- Estado: PARTIAL

## Objetivo

Implementar el panel móvil para administración de quinielas y cerrar los controles server-side que faltaban para límite FREE y branding PRO.

## Archivos modificados

- `apps/platform/src/views/AdminView.vue`
- `apps/platform/src/composables/useAdmin.ts`
- `apps/platform/src/lib/admin-contracts.ts`
- `apps/platform/src/lib/admin-contracts.test.ts`
- `apps/platform/src/router.ts`
- `apps/platform/src/components/FormField.vue`
- `apps/platform/src/components/TopBar.vue`
- `supabase/migrations/20260913000200_phase_05_pool_and_branding_entitlements.sql`
- `reports/admin/phase-05-admin.md`
- `PROJECT_STATE.md`

## Contratos/API afectados

Nuevos RPC pendientes de aplicar en Cloud: `manage_pool` y `update_tenant_branding`. Los RPC existentes de participantes, reglas y códigos se conservan sin cambios.

## Tests ejecutados

- Pruebas unitarias de contratos admin: PASS (4).
- Typecheck, build y `git diff --check`: PASS.

## Bloqueos

La Fase 05 no puede declararse cerrada todavía: la migración no se aplicó/validó contra Cloud, faltan carga de logo/banner con enforcement PRO y E2E administrativo.

## Próximo paso permitido

Data/RLS debe revisar y aplicar la migración en development/staging; después Frontend/QA debe completar assets de branding y ejecutar el E2E administrativo. No avanzar a Fase 06.
