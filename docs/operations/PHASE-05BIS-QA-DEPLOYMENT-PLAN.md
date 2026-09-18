# Plan de despliegue a QA — Fase 05-bis (Superadmin) + migraciones de branding pendientes

Actualiza y reemplaza, para efectos de planificación de despliegue, la sección 5/12 de
`reports/admin/phase-05bis-validation.md`: el proyecto Supabase Cloud enlazado (`plataforma_bet`,
ref `juoftaofzepxbrrxbkhx`) se trata desde ahora como **entorno QA/UAT**, no producción. Cualquier
dato ahí es de prueba. Producción se creará/configurará en una fase posterior, cuando el producto
esté validado. Esto no cambia ninguna decisión de diseño de `ADR-008`; solo el nivel de cautela
operativa al aplicar cambios.

**Este documento es un plan. No se ejecutó ningún `db push` al redactarlo.**

## 1. Plan exacto para aplicar las migraciones a QA

- **Entorno destino:** QA/UAT — proyecto `plataforma_bet` (`juoftaofzepxbrrxbkhx`), el único
  proyecto Cloud enlazado.
- **Comando:** `npx supabase db push --linked` (confirmar interactivamente el resumen que muestra
  la CLI antes de aceptar; no usar `--yes` para poder abortar si el resumen no coincide).
- **Migraciones que se aplicarían, en este orden exacto** (confirmado de nuevo tras el hardening,
  ver sección de validaciones previas):
  1. `20260913000200_phase_05_pool_and_branding_entitlements.sql`
  2. `20260915000100_phase_05_branding_asset_lifecycle.sql`
  3. `20260915000200_phase_05_pending_branding_asset_lookup.sql`
  4. `20260915000300_phase_05_branding_reconciliation.sql`
  5. `20260915000400_phase_05bis_platform_admin_foundation.sql`
- Las migraciones 1-4 pertenecen a Fase 05 (branding/entitlements); la 5 es la única de Fase 05-bis
  (Superadmin).
- Tras el `db push`, las Edge Functions de branding (`branding-asset`, `branding-reconciler`) y el
  bucket de Storage `branding-assets` deben desplegarse/confirmarse por separado
  (`supabase functions deploy ...`) — no viajan en `db push`. Esto es continuación de Fase 05
  principal; no se toca en esta tarea (instrucción explícita de no tocar backend de branding),
  pero sin eso desplegado el flujo de carga de imágenes no funcionará aunque el schema ya exista.

## 2. Validaciones previas (antes de autorizar el push)

- [ ] `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build`, `git diff --check`: todos PASS
      (confirmado en esta tarea de hardening — ver `reports/admin/phase-05bis-hardening.md`).
- [ ] `npx supabase migration list --linked` confirma que solo faltan exactamente las 5
      migraciones listadas arriba (no una lista distinta ni desincronizada).
- [ ] `npx supabase db push --linked --dry-run` confirma el mismo orden y contenido, sin errores.
- [ ] `supabase/tests/phase-05bis-platform-admin.sql` corrido contra Postgres real (local vía
      Docker, o directamente contra QA en una transacción `begin/rollback` si Docker sigue sin
      disponibilidad) — **con resultado PASS**, incluida la nueva aserción de `granted_by` +
      `on delete set null`. No aplicar el push sin esto en verde.
- [ ] Ningún archivo de migración contiene un email, UUID real o secreto (revisión visual de las
      5 migraciones antes del push).
- [ ] Nadie más tiene un `db push` en curso contra el mismo proyecto (evitar carreras).

## 3. Validaciones posteriores (después del push, antes de dar Fase 05-bis por cerrada)

- [ ] `npx supabase migration list --linked` muestra las 5 migraciones con `remote` igual a
      `local` (aplicadas).
- [ ] `select * from public.platform_admins;` como `service_role`/dueño de esquema (no como
      `authenticated`) devuelve `0` filas — confirma que la migración no insertó identidad real.
- [ ] Ejecutar el runbook `docs/operations/PLATFORM-ADMIN-PROVISIONING.md` para provisionar el
      primer Superadmin de **prueba** en QA (permitido ahora por la aclaración de entorno), y
      correr sus pasos 3-4 de verificación (`is_platform_admin()` → `TRUE`; lectura directa de
      `platform_admins` → `permission denied`).
- [ ] Ejecutar `reports/admin/phase-05bis-e2e-manual-checklist.md` completo (`SA-01`..`SA-10`)
      contra QA con cuentas reales de prueba.
- [ ] Verificar que `/admin` (organizador) sigue funcionando sin regresión para las cuentas owner/
      admin/member existentes del seed/fixtures de Fase 03-05 (smoke test, no la suite completa).
- [ ] Branding (Fase 05 principal, fuera del alcance de esta tarea pero parte de la misma tanda de
      migraciones): confirmar que `manage_pool`, `update_tenant_branding`,
      `begin_branding_asset`/`get_active_branding_assets`/`remove_branding_asset` responden sin
      error 500/schema faltante — no se prueba aquí el flujo completo de subida de imagen porque
      depende de las Edge Functions, que están fuera de esta tarea.

## 4. Rollback / recuperación en QA

- Ninguna migración de esta tanda es destructiva: todas son `create table`/`create function`/
  `revoke`/`grant` aditivos; ninguna hace `drop`/`alter ... drop column` sobre datos existentes.
- Cada migración corre en su propia transacción — un fallo a mitad de una migración no deja
  cambios parciales de esa migración, pero las migraciones anteriores de la tanda ya aplicadas
  permanecen aplicadas (la CLI no revierte automáticamente toda la tanda).
- Rollback específico de Fase 05-bis si hiciera falta deshacerla en QA:
  ```sql
  drop function if exists public.is_platform_admin();
  drop table if exists public.platform_admins;
  ```
  Seguro porque nada más depende todavía de `platform_admins`.
- Si falla una migración de branding (1-4), su rollback es específico de esa migración (revisar el
  archivo correspondiente); no se detalla aquí por estar fuera del alcance de esta tarea.
- Como es QA con datos de prueba, un rollback manual (recrear el proyecto o restaurar desde un
  backup de Supabase) es una opción válida si algo queda en un estado inconsistente — no aplica la
  cautela de producción, pero igual se debe registrar qué se hizo (ver "no hacer cambios manuales
  no documentados" más abajo).

## 5. Checklist antes de autorizar el push

- [ ] Sección 2 (validaciones previas) completa y en verde.
- [ ] Confirmación explícita del usuario para ejecutar `supabase db push --linked` (esta tarea NO
      la ejecuta; queda pendiente de autorización aparte).
- [ ] Nadie planea provisionar el Superadmin de prueba antes de confirmar que la migración quedó
      aplicada (evitar un `insert` contra una tabla que todavía no existe).

## 6. Checklist posterior para validar Superadmin, Admin, Member y Branding

Usar en conjunto con `reports/admin/phase-05bis-e2e-manual-checklist.md` (que ya cubre
Superadmin/Admin/Member en detalle, escenarios `SA-01`..`SA-10`). Resumen ejecutivo:

| Área | Qué validar | Dónde |
| --- | --- | --- |
| Superadmin | Acceso, aislamiento, revocación, doble rol, no-fuga por PostgREST | `phase-05bis-e2e-manual-checklist.md` |
| Admin (organizador) | Owner/admin acceden, member no, sin regresión de Fase 05 | Smoke manual + `useTenantAdminAccess.test.ts`/`navigation-guards.test.ts` ya cubren la lógica pura |
| Member | Sin acceso a `/admin` ni `/superadmin`; experiencia de participante intacta | `phase-05bis-e2e-manual-checklist.md` (SA-05) + regresión de Fase 04 |
| Branding | Schema de entitlements/branding responde tras el push (sin probar aún subida real de imagen, que depende de Edge Functions fuera de alcance) | Sección 3 de este documento |

Cualquier fallo se registra con: causa, capa responsable (`frontend`, `RLS`, `RPC`, `Edge
Function`, `migración`, `datos de prueba`), y no se declara Fase 05-bis (ni Fase 05) cerrada
mientras quede un fallo sin resolver o sin registrar.

## No hacer cambios manuales no documentados

Cualquier operación manual contra QA (incluida la de provisionar el Superadmin de prueba) debe
quedar registrada en un runbook o reporte (este documento, `PLATFORM-ADMIN-PROVISIONING.md`, o un
nuevo reporte de cierre) — no ejecutar SQL ad hoc contra QA sin dejar rastro de qué se hizo y por
qué, ni siquiera por tratarse de un entorno de pruebas.

---

**Este plan queda pendiente de tu autorización explícita para el paso 1 (`supabase db push
--linked`). No se ejecutó en esta tarea.**
