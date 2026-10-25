# ADR-020 — Lectura acotada de `participants` y privacidad financiera

- Estado: **Accepted para QA** (2026-10-12, decisión del propietario tras el informe de seguridad). **Aplicada solo en Supabase QA** (migración `20261022000100_security_followups.sql`, 24/24 sincronizadas). **No aplicada en producción: requiere autorización posterior.**
- Origen: hallazgo F-04 de `reports/security/security-review-20261012.md` y Encargo Maestro §5 (finanzas estrictamente privadas por administrador).
- Relacionados: ADR-002, ADR-014 (capacidad `finance`), ADR-015. Impacto AGENTS.md §12: reduce autorización y cambia RLS central.

## Contexto

La política `participants_select_member` (fase 03) usa `is_tenant_member`: cualquier miembro del tenant lee `participants.payment_status` de **todas** las quinielas del tenant. No hay fuga entre tenants (admin A y platform_admin ven 0 filas del tenant B), pero un participante ve el estado de pago de otros y personal con capacidad `finance` de una quiniela ve pagos de otra. Reproducido en QA dentro de rollback (38/44 sin migración).

## Decisión

1. Reemplazar la política por `participants_select_scoped`: se puede leer la **fila propia**, o las filas del tenant si se es admin del tenant, o las de **esa** quiniela con la capacidad `finance`.
2. Revocar `SELECT` de `anon` en `participants` y `audit_log` (la RLS ya lo frenaba; se elimina la dependencia de una sola defensa).
3. Sin cambios en escritura: `set_participant_payment_status` sigue exigiendo admin del tenant (el personal `pool_finance` lee, no escribe; límite funcional que decide la fase comercial de ADR-014).
4. Compatibilidad verificada en el código: el frontend solo lee la fila propia (`usePoolPlay`, `useMyPools`, `usePoolTickets`) o listados de administrador del tenant (`useAdmin`, `useAdminFinance`). La clasificación del ranking pasa por RPC `SECURITY DEFINER`.

## Decisión del propietario y alcance exacto (2026-10-12)

- Autorizada la aplicación **solo en QA**, tras revisar el SQL definitivo, pruebas SQL en verde, respaldo y recuperación. Alcance aplicado: (a) política `participants_select_scoped` (fila propia, admin del tenant o capacidad `finance` de esa quiniela) en lugar de `participants_select_member`; (b) `REVOKE SELECT` de `anon` en `participants` y `audit_log`; (c) F-01 a F-03 de la misma migración (autorizar antes de bloquear en 6 RPC, `updated_at` del catálogo, retención de `fixture_sync_log` con ejecución de prueba y registro en `maintenance_runs`).
- Respaldo previo: `reports/security/qa-pre-apply-20261022-definitions.json` (definiciones de catálogo, sin datos). Recuperación: `supabase/proposed/down/20261022000100_security_followups.down.sql` (13/13 en rollback).
- Verificación posterior en QA (estado real, modo rollback): `finance-privacy` 44/44, `security-followups` 68/68, Fase 06 95/95, tickets 72/72, Fase 08 24/24, catálogo 71/71 y 74/74, bloqueo 51/51, privilegios 23/23, admin-participante 87/87. E2E reales con sesiones sintéticas: clásico 32/32 y tickets 24/24 (rankings y listados legítimos siguen funcionando).
- Pendiente: UAT móvil de `AdminView` y `PoolView` en navegador (no ejecutado) y programación de la purga vía service_role (no habilitada; un cron como `postgres` sería rechazado por la guarda).

## Consecuencias

- Antes de aplicar: UAT de `AdminView` y `PoolView` en navegador (no probado por agentes) y aprobación del propietario.
- Rollback: `down/20261022000100_security_followups.down.sql` restaura la política anterior (probado en rollback).
- Pruebas de aceptación: `supabase/tests/finance-privacy.sql` (44/44 con la migración, según el agente de seguridad; reproducir antes de aplicar).
