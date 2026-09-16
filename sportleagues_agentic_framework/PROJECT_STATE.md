# PROJECT_STATE.md

## Estado general

- Fase actual: `05` / `05-bis`
- Última fase completada: `04 - Auth, onboarding y memberships`
- Estado: `PHASE_05_MIGRATIONS_APPLIED_QA_CRITICAL_FINDING_OPEN_SUPERADMIN_NOT_PROVISIONED`
- Entorno QA/UAT: proyecto Supabase Cloud `plataforma_bet` (`juoftaofzepxbrrxbkhx`). Las 8
  migraciones del proyecto (incluidas las 5 de Fase 05/05-bis) están aplicadas y confirmadas
  (`supabase migration list --linked` sin pendientes). No es producción; producción se creará
  cuando el producto esté validado.
- **Hallazgo de seguridad abierto (alto, no corregido):** `record_verified_branding_asset` no
  tiene autorización interna y es explotable cross-tenant. Ver
  `reports/security/finding-001-record-verified-branding-asset-authorization-gap.md`. No bloquea
  a Superadmin/`/admin`, pero bloquea desplegar las Edge Functions de branding con confianza.

## MVP — fases

- [x] 01 — Auditoría y normalización de requisitos
- [x] 02 — Arquitectura + ADRs base
- [x] 03 — Modelo de datos + multi-tenancy + RLS
- [x] 04 — Auth, onboarding y memberships
- [ ] 05 — Admin: quinielas, branding, reglas y participantes. Schema/RPC/migraciones aplicados y
      validados en QA (`reports/admin/phase-05bis-qa-validation.md`). Bloqueado para cierre por:
      (a) hallazgo de seguridad 001 sin corregir, (b) Edge Functions `branding-asset`/
      `branding-reconciler` sin desplegar, (c) fixture de QA incompleto (falta `Admin B`/
      `Pending A`), (d) validación manual en navegador de `/admin` pendiente (ver
      `reports/admin/phase-05bis-e2e-manual-checklist.md`).
- [ ] 05-bis — Superadmin de plataforma (frontera de autorización global, ver `ADR-008`,
      `reports/admin/phase-05bis-hardening.md` y `reports/admin/phase-05bis-qa-validation.md`):
      infraestructura completa y **validada exhaustivamente contra QA real** (tabla
      `platform_admins`, `is_platform_admin()`, RLS, GRANT/REVOKE, `requireTenantAdmin` +
      `requirePlatformAdmin`, loading, logout — todo con tests unitarios en verde). Sin hallazgos
      de seguridad. Pendiente: provisionar el primer Superadmin de prueba (runbook listo, no
      ejecutado — requiere autorización explícita) y validación manual en navegador de
      `/superadmin`. No requiere corregir el hallazgo 001 para avanzar (áreas independientes).
- [ ] 06 — Torneos, jornadas y partidos
- [ ] 07 — Pronósticos, locks y privacidad previa al partido
- [ ] 08 — Scoring, recálculo y leaderboards
- [ ] 09 — Elo + Poisson + auto-fill estadístico
- [ ] 10 — Flyers HD + QR + Web Share
- [ ] 11 — PWA + Capacitor + deep links + notificaciones base
- [ ] 12 — Analítica/observabilidad y feature entitlements
- [ ] 13 — Testing funcional, E2E, responsive y rendimiento
- [ ] 14 — Auditoría final de seguridad y RLS
- [ ] 15 — Release web/Android y runbook

## Futuro explícitamente fuera del MVP

- [ ] Pagos online / comisión por ticket
- [ ] Escrow / wallet
- [ ] Live sports data provider
- [ ] Chat/badges sociales
- [ ] AdTech/sponsors avanzados
- [ ] Enterprise/DaaS
- [ ] iGaming / free-to-play regulado

## Decisiones pendientes

- proveedor final de notificaciones push;
- estrategia exacta de PWA plugin;
- hosting web final;
- alcance real de iOS para primer release;
- proveedor de datos deportivos si se incorpora después del MVP;
- si se agregan los fixtures faltantes de QA (`Admin B`, `Pending A`) o se documenta el gap como
  permanente entre Docker local y QA.

## Pendientes inmediatos (2026-09-16, tras validación post-migración QA)

Orden sugerido, no obligatorio salvo donde se indica dependencia:

1. **Decidir sobre el hallazgo de seguridad 001** (`record_verified_branding_asset` sin
   autorización interna, cross-tenant) — `reports/security/finding-001-record-verified-branding-asset-authorization-gap.md`.
   Recomendado: preparar y autorizar una migración correctiva (`assert ... service_role` interno,
   igual que las 5 funciones de reconciliación) antes de desplegar Edge Functions de branding.
2. **Corregir la aserción de test `anon` en `supabase/tests/phase-05bis-platform-admin.sql`**
   (defecto de test, no de producto — ver `reports/admin/phase-05bis-qa-validation.md` sección 8):
   cambiar la expectativa de "debe fallar" a "debe devolver `false`".
3. **Provisionar el primer Superadmin de prueba en QA**, siguiendo
   `docs/operations/PLATFORM-ADMIN-PROVISIONING.md` — infraestructura ya validada, solo falta
   autorización explícita para el `insert`.
4. **Validación manual en navegador** (no ejecutable por el agente en este entorno, requiere
   humano o herramienta de browser): `/admin` (owner/admin/member) y `/superadmin` (antes y
   después de provisionar), usando `reports/admin/phase-05bis-e2e-manual-checklist.md` y
   `reports/auth/phase-04-e2e-manual-checklist.md`.
5. **Decidir sobre el fixture de QA incompleto** (`Admin B`/`Pending A` faltantes) para poder
   completar `supabase/tests/phase-05-branding-assets.sql` sin cortes.
6. **Desplegar Edge Functions de branding** (`branding-asset`, `branding-reconciler`) — solo
   después de resolver el punto 1; no desplegado todavía en esta fase.
7. Solo entonces: cerrar Fase 05 y Fase 05-bis formalmente en este archivo y avanzar a Fase 06.
