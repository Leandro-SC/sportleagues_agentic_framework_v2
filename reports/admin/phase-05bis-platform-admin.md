# Fase 05-bis — Infraestructura de Superadmin de plataforma

## Resultado

`PARTIAL / INFRAESTRUCTURA_IMPLEMENTADA_LOCALMENTE / CLOUD_MIGRATION_Y_SQL_TESTS_PENDIENTES`.

Alcance intencionalmente mínimo: solo la frontera de autorización global (tabla, función,
RLS, guard, ruta y layout aislado). Ningún dashboard, listado de tenants, métrica global,
gestión de planes/suspensiones ni auditoría UI — eso queda para una fase posterior explícita.

## Motivación

`ADR-008-platform-superadmin-authorization.md` definió que Superadmin es un actor global,
independiente del modelo `tenant_role`/`tenant_memberships`, y que no debe existir ningún
usuario real provisionado automáticamente. Esta fase implementa exactamente esa frontera.

## Implementación

- `supabase/migrations/20260915000400_phase_05bis_platform_admin_foundation.sql`: tabla
  `platform_admins` (`user_id`, `granted_by`, `granted_at`, `revoked_at`, `note`), sin
  `tenant_id`; RLS habilitada sin policies para `authenticated`/`anon` y sin ningún grant
  directo sobre la tabla; función `is_platform_admin()` (`security definer`, sin argumentos,
  `set search_path`, `revoke all from public`, `grant execute to authenticated` únicamente).
  No inserta ningún usuario real.
- Frontend: `platformAdminRedirect` en `apps/platform/src/lib/navigation-guards.ts` (lógica
  pura y testeable, sin mirar tenant/rol/email); `useSuperadmin` en
  `apps/platform/src/composables/useSuperadmin.ts` (llama exclusivamente
  `rpc('is_platform_admin')`, sin parámetro de identidad posible, y falla en cerrado con
  mensaje neutral ante cualquier error); ruta `/superadmin` protegida en `router.ts` con un
  guard `beforeEach` async que bloquea la navegación hasta resolver el RPC (sin flash de
  contenido) y nunca cae de vuelta a `/admin`; `SuperadminShell.vue` (layout oscuro,
  independiente de `AppShell`, con navegación preparada para Resumen/Tenants/Planes/Auditoría,
  los tres últimos marcados "Próximamente" y no clicables) y `SuperadminView.vue` (contenido
  mínimo: confirmación de sesión verificada, sin métricas ni datos globales).
- `/admin` no se modificó: sigue exclusivamente autorizado por `tenant_memberships`/
  `is_tenant_admin`.

## Validación ejecutada

| Verificación | Resultado |
| --- | --- |
| `npm.cmd run typecheck` | PASS |
| `npm.cmd test` (`vitest run`) | PASS — 37 pruebas en 9 archivos (incluye las nuevas de `navigation-guards` y `useSuperadmin`) |
| `npm.cmd run build` | PASS |
| `git diff --check` | PASS (solo avisos de fin de línea LF/CRLF, sin errores) |
| `supabase/tests/phase-05bis-platform-admin.sql` | NO EJECUTADO — Docker no está disponible en este entorno (`docker info` falla); requiere `npx supabase db reset` local o Cloud de desarrollo |
| Migración en Supabase Cloud | NO APLICADO — por instrucción explícita, esta fase no toca Cloud |

## Decisiones

- `is_platform_admin()` no recibe `user_id`: el llamador nunca decide qué identidad se
  verifica, solo `auth.uid()`.
- Ningún grant directo sobre `platform_admins` para `authenticated`/`anon`: la única vía de
  lectura es la función `security definer`.
- `granted_by` es nullable únicamente para representar el bootstrap del primer Superadmin
  (detalle documentado en ADR-008 y en `docs/operations/PLATFORM-ADMIN-PROVISIONING.md`); un
  alta posterior debe registrar siempre el `auth.uid()` real de quien la otorga.
- El guard de router bloquea la navegación (no permite montar la vista y luego redirigir) para
  eliminar cualquier flash de contenido privilegiado; se reconoce explícitamente que esto es
  solo UX y que RLS/RPC son la autoridad real.

## Riesgos y próximos pasos

1. Ejecutar `supabase/tests/phase-05bis-platform-admin.sql` contra Postgres local (Docker) o
   Cloud de desarrollo en cuanto el entorno lo permita, antes de aplicar la migración a
   ningún ambiente compartido.
2. Aplicar la migración en Supabase Cloud development/staging (pendiente, fuera de alcance de
   esta tarea).
3. Provisionar el primer Superadmin siguiendo `docs/operations/PLATFORM-ADMIN-PROVISIONING.md`
   una vez aplicada la migración — no antes.
4. El dashboard real (listado de tenants, métricas, planes, auditoría) es una fase posterior
   explícita; no iniciar Fase 06 hasta que esta fase y la Fase 05 original cierren sus propios
   gates.

No se modificaron los contratos existentes de `/admin`, Auth, join, participantes, reglas ni
branding.
