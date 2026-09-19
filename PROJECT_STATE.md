# PROJECT_STATE.md

## Estado general

- Fase actual: `05` / `05-bis`
- Última fase completada: `04 - Auth, onboarding y memberships`
- Estado: `PHASE_05_EDGE_FUNCTIONS_ACTIVE_PARTIAL_QA_AUTH_HAPPY_PATHS_PENDING`
- Entorno QA/UAT: proyecto Supabase Cloud `plataforma_bet` (`juoftaofzepxbrrxbkhx`). Las 11
  migraciones del proyecto (incluidas las 5 de Fase 05/05-bis) están aplicadas y confirmadas
  (`supabase migration list --linked` sin pendientes). No es producción; producción se creará
  cuando el producto esté validado.
- **Hallazgo de seguridad 001 (alto): `CLOSED / VALIDATED`.**
  `20260917000100_phase_05_branding_asset_service_role_guard.sql` está aplicada y la regresión
  QA confirmó ACL revocadas para `anon`/`authenticated`, denegación interna y acceso exclusivo de
  `service_role`. Ver `reports/security/finding-001-record-verified-branding-asset-authorization-gap.md`.

## MVP — fases

- [x] 01 — Auditoría y normalización de requisitos
- [x] 02 — Arquitectura + ADRs base
- [x] 03 — Modelo de datos + multi-tenancy + RLS
- [x] 04 — Auth, onboarding y memberships
- [ ] 05 — Admin: quinielas, branding, reglas y participantes. Schema/RPC/migraciones aplicados y
      validados en QA (`reports/admin/phase-05bis-qa-validation.md`). Bloqueado para cierre por
      happy paths remotos autenticados y QA manual de `/admin`/Magic Link; las fixtures SQL son
      autocontenidas y ya no requieren datos QA preexistentes.
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

1. **Autorizar y aplicar en QA la remediación del hallazgo de seguridad 001**:
   `20260917000100_phase_05_branding_asset_service_role_guard.sql`. Después, ejecutar
   `supabase/tests/phase-05-branding-assets.sql` en una base local disponible o QA con fixture
   suficiente y confirmar las denegaciones `authenticated`/`anon`/cross-tenant. No desplegar las
   Edge Functions de branding antes de este gate.
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

## Actualización operativa (2026-09-17)

Esta actualización reemplaza los pendientes 1 y 2 anteriores: la migración
`20260917000100_phase_05_branding_asset_service_role_guard.sql` está aplicada en QA; las nueve
migraciones están sincronizadas; la regresión SQL focalizada de branding y la suite
`phase-05bis-platform-admin.sql` pasaron contra QA dentro de transacciones con rollback. El
hallazgo de seguridad 001 está `CLOSED / VALIDATED`.

No hay funciones desplegadas porque falta el origen HTTPS QA para configurar
`CORS_ALLOWED_ORIGINS`. `BRANDING_RECONCILER_SECRET` ya está configurado. Provisioning del
Superadmin, fixtures QA faltantes y validaciones manuales de navegador siguen pendientes; Fase 06
continúa bloqueada.

## Recuperación canónica y validación QA (2026-09-19)

Se recuperaron en este repositorio las suites transaccionales autocontenidas
`phase-05-branding-assets.sql` y `phase-05-admin-rpc.sql`, además del ajuste de
`phase-03-rls.sql`. Las tres suites pasaron contra QA dentro de `BEGIN`/`ROLLBACK`.
ADR-002 admite tanto la denegación por privilegio mínimo como el filtrado RLS; el positivo de
admin usa el helper de autorización porque los writes directos se sustituyeron por RPCs en Fase 05.

Las migraciones incrementales `20260918000100` y `20260918000200` están presentes y aplicadas en
QA. El test de Storage verifica la protección efectiva: no hay policy de escritura de branding y
un INSERT de `authenticated` es rechazado por RLS. Las Functions `branding-asset` y
`branding-reconciler` están activas; CORS QA y rechazos de credenciales inválidas fueron validados.

Gates: `npm run typecheck`, `npm test` (10 archivos / 49 tests) y `npm run build`: PASS.
`npx supabase test db --linked`: **BLOCKED_EXTERNAL** por Docker Desktop ausente
(`dockerDesktopLinuxEngine`). No hay cuentas QA persistentes accesibles para los happy paths
manuales; no se registraron JWT ni secretos. Fase 05/05-bis no está ACCEPTED y Fase 06 no inicia.

## Ejecución QA desde repositorio canónico (2026-09-19)

`supabase migration list` confirma las 11 migraciones locales y remotas sincronizadas; `supabase db
push --dry-run` devuelve vacío, por lo que no se aplicó ningún cambio remoto adicional.

Suites SQL contra QA enlazado, todas PASS con sus transacciones y rollback:

- `phase-03-rls.sql`
- `phase-05-admin-rpc.sql`
- `phase-05-branding-assets.sql`
- `phase-05-branding-asset-security-regression.sql`
- `phase-05bis-platform-admin.sql`

`supabase test db --linked` permanece **BLOCKED_EXTERNAL**: Docker Desktop no expone
`dockerDesktopLinuxEngine`.

No se provisionaron cuentas QA persistentes ni se ejecutaron happy paths autenticados de
`branding-asset`/`branding-reconciler`: no hay cuatro identidades Auth accesibles (QA User, Admin
A, Admin B y Superadmin), ni JWT de prueba o credencial interna que puedan usarse sin exponer o
rotar secretos. El runbook de Superadmin exige un UUID Auth real escogido por el operador. Fase
05/05-bis sigue sin ACCEPTED y Fase 06 no inicia.

## Provisioning QA y matriz de autorización (2026-09-19)

Se usaron únicamente mecanismos existentes y no se modificó `auth.users`:

- Superadmin: bootstrap manual en `platform_admins`, conforme al runbook de ADR-008.
- Admin 2: membership `admin` activa exclusivamente en Tenant B; su membership previa de Tenant A
  fue desactivada para conservar aislamiento estricto.
- Usuario: membership `member` activa en Tenant A, sin privilegios administrativos ni globales.
- Admin 1: onboarding confirmado y membership `admin` activa exclusivamente en Tenant A.

Matriz SQL contra QA, con las identidades Auth confirmadas y sin registrar UUIDs: Usuario puede
acceder como miembro de Tenant A y no es admin ni superadmin; Admin 2 es admin de Tenant B, no de
Tenant A ni plataforma; Superadmin devuelve `is_platform_admin() = true` y no recibe SELECT directo
en `platform_admins`; Admin 1 es admin de Tenant A, está denegado en Tenant B y no es superadmin.

No se ejecutaron happy paths HTTP con sesión Auth real: faltan credenciales/sesión para obtener un
JWT válido de Admin 2 y la credencial interna del reconciliador no se consulta ni rota. Fase
05/05-bis no está ACCEPTED y Fase 06 no inicia.

## Consolidación final parcial (2026-09-19)

Matriz de autorización QA consolidada: Usuario normal es miembro sin privilegios admin/global;
Admin 1 administra solo Tenant A; Admin 2 administra solo Tenant B; y Superadmin tiene
`is_platform_admin()` verdadero sin acceso directo a la tabla de plataforma. Los negativos
cross-tenant y globales están validados por SQL.

El operador informó evidencia manual PASS para Magic Link y Google OAuth en
`https://sportleagues-qa.vercel.app`. No se automatizó autenticación ni se registraron sesiones.

`npm run typecheck` y `npm test` fueron ejecutados; `npm run build` PASS. `git diff --check` PASS.
`supabase test db --linked` sigue **BLOCKED_EXTERNAL** por `dockerDesktopLinuxEngine` ausente.

No se recomienda ACCEPTED todavía: falta ejecutar el happy path HTTP real de `branding-asset`
con JWT Auth válido y el de `branding-reconciler` mediante su credencial interna autorizada. No se
consultarán, registrarán ni rotarán secretos para suplir esos requisitos.

## Bloqueo operativo de Edge Functions (2026-09-17)

`BRANDING_RECONCILER_SECRET` está configurado en QA con un valor criptográficamente seguro
generado en memoria; su valor no se registró. La inspección de `PROJECT_CONFIG.md`,
`PROJECT_STATE.md`, los `.env.example`, configuración Vite y documentación no identifica ningún
origen HTTPS real del frontend QA: solo URL de Supabase y hosts locales. Por tanto,
`CORS_ALLOWED_ORIGINS` permanece sin configurar y `branding-asset`/`branding-reconciler` no se
desplegaron ni invocaron. Falta proporcionar el origen QA documentado y autorizado.
