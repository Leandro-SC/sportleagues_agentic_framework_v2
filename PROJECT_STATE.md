# PROJECT_STATE.md

## Estado general (actualizado 2026-10-24)

- Entorno QA/UAT: Supabase Cloud `plataforma_bet` (`juoftaofzepxbrrxbkhx`), **34/34 migraciones** sincronizadas (las 6 de `20261024*` se
  aplicaron hoy con dry-run previo). Edge Functions activas en QA: `branding-asset`, `branding-reconciler`, `delete-account`, `csp-report`.
  `sports-sync` sigue sin desplegar (Premium futuro). Web QA: `https://sportleagues-qa.vercel.app` (despliega `main`). **No hay producción.**
- Estado de módulos: código, SQL y E2E cerrados en QA; **máximo `DONE_PENDING_UAT`** hasta la UAT humana en dispositivo
  (`docs/testing/MOBILE-FIRST-ACCEPTANCE.md`).
- Hallazgo 001: `CLOSED / VALIDATED`. F-04 aplicado en QA. F-05 aplicado en QA (`sports-sync` sin desplegar). **F-06 en observación**
  (`csp-report` desplegado y `report-uri` activo; falta observar los reportes y decidir la CSP impuesta).
- Informe del lote 2026-10-24: `reports/release/diagnostico-final-20261024.md`. **Pendientes: `docs/operations/PENDIENTES-20261024.md`** (incluye UAT-01 y UAT-03 altos, merge a `main` y bloqueos del propietario).

## MVP — fases

Estados: `DONE_PENDING_UAT` = implementado y probado (unitarias, SQL en rollback, E2E reales contra QA), sin UAT humana en dispositivo.

- [x] 01 — Auditoría y normalización de requisitos
- [x] 02 — Arquitectura + ADRs base
- [x] 03 — Modelo de datos + multi-tenancy + RLS
- [x] 04 — Auth, onboarding y memberships (correo/contraseña + Google, ADR-013)
- [~] 05 / 05-bis — Admin y Superadmin: `DONE_PENDING_UAT`. Falta la evidencia humana de los happy paths HTTP de branding y la
      validación manual de `/admin` y `/superadmin` (UI de Superadmin fuera de la app principal, ADR-018).
- [~] 06 — Torneos, jornadas y partidos (catálogo central y resultados híbridos, ADR-016): `DONE_PENDING_UAT`
- [~] 07 — Pronósticos, locks y privacidad: `DONE_PENDING_UAT`
- [~] 08 — Scoring, recálculo y leaderboards: `DONE_PENDING_UAT`; reglas congeladas al primer lock y FREE con puntuación estándar
      (ADR-023); tabla en vivo por Realtime.
- [~] 09 — Elo + Poisson + auto-fill: `DONE_PENDING_UAT`; ratings reconstruidos en QA y recalculados por `pg_cron` cada 30 min.
- [~] 10 — Flyers HD + QR + Web Share: `DONE_PENDING_UAT`; centro para compartir por WhatsApp, QR local, marca de agua FREE,
      white-label PRO, nombre de plataforma y ajuste inteligente del logo (ADR-024).
- [~] 11 — PWA + Capacitor + deep links + notificaciones base: `DONE_PENDING_UAT`; App Links `/j/` y `/p/` (host QA, huella debug),
      Google oculto en el wrapper, notificaciones de resultados en la app (ADR-025). Push del sistema operativo: etapa 2 (ADR pendiente).
- [~] 12 — Observabilidad y entitlements: entitlements en servidor completos; telemetría local sin PII y reportes CSP. Colector
      externo de errores: `BLOCKED_DECISION` (proveedor).
- [~] 13 — Testing: 87 archivos / 812 pruebas unitarias aisladas de la red; suites SQL en rollback; E2E reales; CI en GitHub Actions.
      UAT de navegador automatizada: ver `reports/testing/uat-browser-20261012.md`.
- [~] 14 — Auditoría de seguridad y RLS: revisiones independientes del 2026-10-11/12 cerradas en QA; nuevas tablas con RLS y pruebas
      negativas (notifications, brand name, account deletion).
- [ ] 15 — Release web/Android: `BLOCKED_EXTERNAL`/`BLOCKED_DECISION`. Faltan proyecto de producción, dominio, keystore de release,
      ficha de Play, identidad legal y revisión de textos, `VITE_LEGAL_CONTACT_EMAIL` y D22.

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

## Alineación visual con la referencia (2026-09-19)

Se actualizó la experiencia móvil de acceso, inicio, quiniela, unión y perfil para aplicar la
jerarquía visual de la referencia aprobada: héroes deportivos oscuros, acentos verde neón/cian,
cards redondeadas y navegación inferior Inicio/Partidos/Ligas/Perfil. El hero usa una fotografía
local de estadio con licencia Unsplash y atribución documentada, bajo capas de contraste. Magic Link, Google OAuth,
unión por código, administración y cierre de sesión mantienen sus contratos existentes.

La portada pública se ajustó además a la composición exacta aprobada usando los assets internos
`fondo_app_tablo.png` y `logo_app_tablo.png`; sus botones llevan al formulario Auth existente y no
alteran permisos ni autenticación.

Partidos y Tabla son indicadores no interactivos de Fase 06/08; no se añadieron rutas, datos,
notificaciones, búsqueda ni resultados ficticios. Gates de frontend: `npm run typecheck`, `npm
test` (10 archivos / 49 tests) y `npm run build`: PASS; revisión visual local de la pantalla
pública y `git diff --check`: PASS. Esta mejora no modifica el bloqueo de cierre de Fase 05/05-bis
ni inicia Fase 06.

## Preparación del cierre formal de Fase 05/05-bis (2026-10-05)

Se prepararon los happy paths HTTP pendientes como scripts que ejecuta el operador, sin exponer
secretos: `scripts/qa/branding-asset-happy-path.sh` (11 pasos con JWT real de Admin 2: CORS,
401/403/404/415/409 y carga, activación y verificación WebP) y
`scripts/qa/branding-reconciler-happy-path.sh` (5 pasos: 405/401 y dos corridas autorizadas).
Runbook y resultados esperados: `docs/operations/PHASE-05-HTTP-HAPPY-PATHS.md`. Fixture:
`supabase/tests/fixtures/branding/qa-logo-512.png`. Se añadió `.gitattributes` para fijar los `.sh`
en LF.

`branding-asset-happy-path.sh` respalda y verifica el logo activo antes de cualquier cambio y lo
restaura al terminar, también ante errores intermedios o interrupción. Como el lifecycle no permite
reactivar un asset reemplazado, el original se vuelve a cargar como asset nuevo con la misma imagen,
o se retira el logo de prueba si no había logo previo.

Ambos scripts se validaron contra un servidor local simulado con estado que replica el lifecycle
(happy paths PASS; también PASS los casos de JWT expirado/mal formado, plan no PRO, tenant sin logo,
respaldo corrupto, corte de red tras A9 y fallo de restauración con respaldo conservado).
**Todavía no se ejecutaron contra QA:** el operador los ejecutará y devolverá solo códigos y
resultados. `supabase db query --linked` agotó el tiempo de conexión desde este entorno, así que no se pudo confirmar desde aquí que Tenant B tenga plan `pro`;
el paso A7 lo detecta. Fase 05/05-bis no está ACCEPTED hasta recibir esa evidencia y la validación
manual de `/admin` y `/superadmin`. Fase 06 no inicia.

## Rediseño UI pre-acceptance (2026-10-05) — rama `prep/ui-redesign-pre-acceptance`

QA de Supabase no está disponible (pausado o sin DNS), así que los happy paths HTTP siguen sin
ejecutarse. **Fase 05/05-bis siguen sin ACCEPTED y Fase 06 no se inicia formalmente.**

Mientras tanto se implementaron, como trabajo de preparación en la rama
`prep/ui-redesign-pre-acceptance` (sin merge a `main` ni push), las 8 pantallas de la referencia:

- portada;
- Inicio;
- Partidos;
- detalle de liga;
- ficha de equipo;
- Ligas;
- Unirme a una liga;
- Perfil.

**Datos reales:**

- perfil;
- "Mis ligas" (`participants` + `pools` bajo RLS);
- unión por código (`join_pool`);
- acceso admin solo para owner/admin.

**Datos de ejemplo:** partidos, tablas y actividad. Son **preparación técnica / draft de Fase 06**:
solo se muestran con `VITE_PREVIEW_DATA` o en `npm run dev`, siempre marcados como "Vista previa",
y quedan desactivados en cualquier build.

No se tocaron migraciones, RLS, RPC, Edge Functions ni Auth.

Gates:

- `npm run typecheck`: PASS.
- `npm test` (20 archivos / 98 tests): PASS.
- `npm run build`: PASS.
- `git diff --check`: PASS.
- Revisión visual a 390 px: PASS.
- **NO EJECUTADO:** validación contra QA real.

Detalle: `docs/agents/HANDOFF-UI-REDESIGN-PRE-ACCEPTANCE-20261005.md`.

### Iteración 2 (2026-10-06) — pre-acceptance / draft técnico

Tres commits adicionales en la misma rama (sin push ni merge a `main`):

- los datos de ejemplo se cargan de forma diferida y ya no viajan en el bundle de QA/producción;
  `npm run verify:bundle` lo comprueba;
- refinamiento mobile-first verificado a 320/390/430 px (objetivos táctiles de 44 px, estados de
  carga y error, pestañas y tarjetas que caben en pantallas estrechas);
- **borrador técnico** del contrato de datos del frontend para Fase 06 (adaptador, fuente Supabase
  no conectada y ayudas de lock/marcador), con sus brechas documentadas en
  `docs/design/PHASE-06-FRONTEND-DATA-CONTRACT-DRAFT.md`. **No es el inicio formal de Fase 06**:
  no hay migraciones, RLS, RPC ni Edge Functions nuevas y no se conectó a la app.

Fase 05/05-bis siguen sin ACCEPTED. Nada se ejecutó contra Supabase QA.

## Bloqueo operativo de Edge Functions (2026-09-17)

`BRANDING_RECONCILER_SECRET` está configurado en QA con un valor criptográficamente seguro
generado en memoria; su valor no se registró. La inspección de `PROJECT_CONFIG.md`,
`PROJECT_STATE.md`, los `.env.example`, configuración Vite y documentación no identifica ningún
origen HTTPS real del frontend QA: solo URL de Supabase y hosts locales. Por tanto,
`CORS_ALLOWED_ORIGINS` permanece sin configurar y `branding-asset`/`branding-reconciler` no se
desplegaron ni invocaron. Falta proporcionar el origen QA documentado y autorizado.

## Cambio de autenticación (2026-10-10) — rama `feat/password-google-auth` (sin commit, sin merge)

Por instrucción del operador se reemplazó Magic Link por **correo + contraseña** (registro con nombre
completo, confirmación de correo, recuperación) y **Google OAuth** (ADR-013, Accepted). Sin
migraciones ni cambios de RLS/RPC/Edge Functions; el perfil se crea en la primera sesión con el nombre
de `user_metadata` (`ON CONFLICT DO NOTHING`). Cuentas antiguas de Magic Link: transición por
"¿Olvidaste tu contraseña?". Detalle: `docs/agents/HANDOFF-AUTH-PASSWORD-GOOGLE-20261010.md`.

Gates: `npm run typecheck`, `npm test` (33 archivos / 216 tests), `npm run build`, `verify:bundle` y
`git diff --check`: PASS. QA volvió a estar accesible: 11/11 migraciones sincronizadas y las 5 suites
SQL (`phase-03-rls`, `phase-05-admin-rpc`, `phase-05-branding-assets`, `…-security-regression`,
`phase-05bis-platform-admin`) terminaron con exit 0 en transacciones con rollback.
**BLOCKED_HUMAN / NO EJECUTADO:** happy paths HTTP (faltan `ADMIN2_JWT` y la credencial del
reconciliador), registro/recuperación reales contra QA (envían correos), revisión de Redirect URLs,
SMTP y plantillas en el Dashboard, y validación manual de `/admin` y `/superadmin`.
Fase 05/05-bis siguen sin ACCEPTED; Fase 06 no inicia.

### Iteración de verificación y correcciones de auth (2026-10-11)

Correcciones: la recuperación de contraseña ya no se queda activa al cancelar ni tras otro login
(`clearRecovery`, detección solo en `/auth/callback`); errores de callback con mensajes amigables;
la invitación a una quiniela pasa a `localStorage` con caducidad de 24 h (+ ingreso manual en Ligas);
creación de perfil con un solo intento automático y reintento desde `/onboarding` con nombre
prellenado. Sin migraciones; `/admin` y `/superadmin` sin cambios de permisos (nuevos tests de router).
PKCE: solo evaluado (`docs/security/PKCE-MIGRATION-ASSESSMENT.md`).

QA (solo lectura): `scripts/qa/auth-config-probe.mjs` → 8 PASS, 0 FAIL, 1 BLOCKED (Redirect URLs, requiere
Dashboard). Tenant B tiene plan `pro`. Pendiente humano: `docs/operations/AUTH-QA-CONFIGURATION.md`.
Escenarios E1–E19 preparados en `docs/testing/AUTH-E2E-SCENARIOS.md`: **ninguno ejecutado en navegador**.
Happy paths de Fase 05: BLOCKED (requieren credenciales del operador; ver `scripts/qa/login-admin2.sh`).
Fase 05/05-bis siguen sin ACCEPTED; Fase 06 no inicia.

## Despliegue QA del nuevo sistema de auth y rediseño (2026-10-11)

`feat/password-google-auth` se fusionó en `main` (merge `b4be40f`, sin force-push) y Vercel
(`theonix/sportleagues-qa`, integración Git, rama de producción `main`) publicó en
`https://sportleagues-qa.vercel.app`. Incluye auth con correo/contraseña + Google (ADR-013, sin Magic
Link), el rediseño pre-acceptance y la conservación de la invitación ante fallos de red. Sin
migraciones ni cambios de RLS/privilegios. Gates sobre `main`: typecheck, `npm test` (35 archivos /
235 tests), build, `verify:bundle` y `git diff --check`: PASS. Comprobaciones automáticas del sitio en
vivo: el bundle no contiene Magic Link ni el dataset de vista previa, solo referencia al Supabase QA y
las rutas SPA responden 200. **NO EJECUTADO:** escenarios E1–E19 (`docs/testing/AUTH-E2E-SCENARIOS.md`),
revisión visual en navegador, happy paths de Fase 05 y la configuración de Dashboard pendiente
(`docs/operations/AUTH-QA-CONFIGURATION.md`). Rollback: revertir el merge (`git revert -m 1 b4be40f`)
o promover de nuevo el despliegue anterior (`ef2daf9`) desde Vercel. Fase 05/05-bis siguen sin
ACCEPTED; Fase 06 no inicia.

## Integración del paquete v2 (roles, puntos, ingresos) — rama `integration/v2-roles-tickets-income` (2026-10-11)

El ZIP `SportLeagues_movil_roles_arquitectura_quinielas_v2` ya estaba aplicado en el árbol de trabajo
(comparación byte a byte, ignorando fin de línea: 342 archivos idénticos, 0 nuevos, 0 distintos). Se
integró sobre `main` (`8f6bbcd`): rutas `/mis-puntos`, `/organizador`, `/admin/ingresos`; pestaña
«Puntos» en la navegación inferior; acceso «Modo organizador» en Inicio solo con membresía
administrativa activa; guard de `/organizador` y `/admin/ingresos` con `useTenantAdminAccess`
(la elección de experiencia no concede permisos; RLS sigue siendo la autoridad); siete referencias PHP
como texto no ejecutable en `references/legacy-quiniela/`. Corrección de la integración: los routers de
prueba de `catalog-states`/`JoinLeagueView` no registraban `points` (15 fallos); se añadieron pruebas de
regresión (guard `points`, `tenantAdminRedirect`, entrada organizador en Inicio). Sin migraciones, RLS,
tablas financieras ni secretos. **Pendiente (propuesto, sin implementar):** tickets/pagos/ingresos,
pronósticos, scoring/rankings, equipos dinámicos y APIs deportivas (ver
`docs/product/ROADMAP-MOVIL-TICKETS-PRONOSTICOS-APIS.md`); requieren ADR antes de tocar esquema/RLS.
Gates: typecheck, `npm test` (37 archivos / 247 tests), build, `verify:bundle` y `git diff --check`:
PASS. **NO EJECUTADO:** revisión visual en navegador/dispositivo y E2E contra Supabase. Fases 05/05-bis
siguen sin ACCEPTED; Fase 06 no inicia.

## ADR-014 tickets multi-tenant (2026-10-11) — solo diseño

Redactado `ADR-014` (estado **Proposed**) y su anexo técnico: modelo `pool_rounds/tickets/payments/ledger_entries`,
estados separados, RPC idempotentes, RLS, ingresos solo desde ledger, amenazas, migraciones M1–M5, pruebas y
decisiones D1–D13 pendientes de aprobación. Sin migraciones, RLS, pagos ni inicio de Fase 06. Handoff:
`docs/agents/HANDOFF-ADR-014-TICKETS-20261011.md`. Tests: no aplican (documentación).

## ADR-014 revisión 2 (2026-10-11) — sigue Proposed

Dictámenes independientes de Security (rechazar → aprobar con cambios) y Data (aprobar con cambios) sobre el DDL real,
más Backend y Product. D1–D5, D7, D9, D10, D12 aprobadas; D6 rediseñada (elegibilidad congelada al sello); D7 por
quiniela con `pool_staff`. Hallazgos existentes de Fase 03 que bloquean tickets: el admin puede editar `lock_offset`/
`starts_at`/`pool_matches` por DML directo; `audit_log` sin inmutabilidad ni revoke de `TRUNCATE` (inferido, sin comprobar);
`ON CONFLICT` de `save_prediction` y FK en cascada. Detalle: `docs/architecture/ADR-014-REVIEW-20261011.md`.
Sin migraciones, RLS, código ni pruebas. Fases sin cambio de estado.

## Auditoría de seguridad de solo lectura sobre QA (2026-10-11)

Auditoría de catálogos de Supabase QA (sin leer datos ni escribir): `reports/security/qa-readonly-audit-20261011.md`.
**H1 CONFIRMED (crítico, bloqueante de la apertura pública):** un organizador-participante puede subir/bajar `lock_offset`
(`manage_pool`) o mutar `matches.starts_at/status` para leer pronósticos ajenos antes del lock y reabrir la edición;
H2 (borrado en cascada de predicciones) y H3 (acciones administrativas sin auditoría) también confirmadas. `TRUNCATE/
REFERENCES/TRIGGER` están concedidos a `anon`/`authenticated`, pero no explotables por la API pública. Remediación R1–R6
**propuesta, no aplicada**; explotación no ejecutada (requiere autorización). Sin migraciones, RLS ni código cambiados.
Se suspende el avance de tickets/pronósticos/Fase 06 hasta aprobar R1. ADR-014 sigue Proposed.

## Regla de producto aprobada: administrar o competir (2026-10-11) — solo diseño

Un perfil con capacidad administrativa sobre una quiniela (owner/admin del tenant o colaborador) no puede participar,
emitir tickets, pronosticar ni figurar en el ranking de esa quiniela, ni antes ni después de perder el rol (incompatibilidad
histórica desde `opened_at`); sí en otras quinielas. Fuente única: `ADR-015` (Proposed), que también recoge la remediación
H1–H6 de la auditoría (no sustituida). PRD, requisitos 02/03, matriz de pruebas, prompts de fases 05–08 y ADR-014 enlazan a ella.
D14 de ADR-014 resuelta. Pendientes: D17–D20. Los datos de QA ya contienen conflictos (el seed hace participante al owner).
Sin migraciones, RLS, permisos ni despliegues. Fases sin cambio de estado.

## Política sin Docker y remediación H1–H6 preparada (2026-10-11) — nada aplicado

**Política aprobada:** sin Docker ni servicios locales; todo en la nube (`docs/operations/CLOUD-ONLY-TESTING-POLICY.md`; pruebas SQL clases A/B/C).
**Remediación H1–H6 + incompatibilidad administrador/participante** (D17–D21 cerradas; D22 baja de tenants/PII pendiente de ADR/legal):
migraciones en `supabase/proposed/` (+ `down/`), pruebas en `supabase/tests/proposed/`, ejecutores `scripts/qa/remediation/`, diseño en ADR-015 §13–§20 e
informe `reports/security/remediation-h1-h6-review-20261011.md`. Dictámenes independientes de Security y Data (estáticos): aprobar con cambios → corregidos en diseño;
falta segunda revisión con evidencia Cloud. Se retiraron los bypasses runtime `sl.lock_maint`, `sl.fixture_sync` y `sl.withdrawal`;
el calendario/locks no admiten DML de `authenticated` y el feed usa `apply_fixture_update` de `service_role`. **Verificado:** sintaxis local del runner y línea base clase A en QA (3 PASS / 11 FAIL = remediación no aplicada). **BLOCKED:** suites C, concurrencia,
reproducción y rollback hasta autorizar un proyecto Supabase descartable. Sin migraciones aplicadas, RLS/permisos modificados ni despliegues; ADR-014/015 siguen Proposed; Fase 06 no inicia.


## Remediación H1–H6 APLICADA a QA (2026-10-11)

El propietario autorizó reconstruir QA; el inventario (5 cuentas Gmail reales, 1 platform_admin real) mostró que bastaba una **migración incremental sin borrar nada**. Aplicadas `20261012000100/200/300` (historial 14/14 sincronizado). Línea base 14/14; suites lock 51/51, privilegios/auditoría 23/23, admin-participante 87/87, concurrencia 10/10, 6 suites históricas OK tras adaptar fixtures; typecheck, 247 tests y verify:bundle OK. Residuo sintético no borrable por diseño documentado. ADR-014/015 siguen Proposed; Fase 06 puede planificarse. Detalle: `docs/agents/HANDOFF-QA-HARDENING-APPLIED-20261011.md`.


## Fase 06 — base deportiva (2026-10-11) — PARTIAL

ADR-015 aceptado (con evidencia y limitaciones); ADR-009–012 aceptados con ajustes; **ADR-014 sigue Proposed**; **D22 pendiente** para producción comercial. Aplicadas a QA `20261013000100` (catálogo deportivo, inscripción equipo-torneo, `external_refs`, RPC de calendario y `publish_official_result` con recálculo idempotente) y `20261013000200` (corrección real de la carrera del lock al pasar a live). 16/16 migraciones sincronizadas. Pruebas reales: Fase 06 95/95, lock 51/51, privilegios 23/23, admin-participante 87/87, línea base 14/14, históricas 6/6, typecheck, 274 tests, verify:bundle. Nuevas suites SQL corren en modo rollback (`scripts/qa/run-sql-suite.mjs`) sin dejar datos; residuo registrado en `docs/operations/QA-SYNTHETIC-RESIDUE.md`. UI `/admin/parrilla` implementada y probada con Vitest; **falta UAT manual**. Fase 07 no inicia. Detalle: `reports/admin/phase-06-tournaments-matches.md`.

## Fase 07 (experiencia del participante) y núcleo de Fase 08 (ranking) — 2026-10-11

Aplicadas a QA `20261013000300` (conflicto de revisión como HTTP 409 `PT409`: con `40001` la petición REST colgaba hasta timeout; hallazgo del E2E real) y `20261014000100` (`pool_leaderboard`: general/por jornada/rachas; puntos de la revisión más reciente; excluye retirados y administradores; desempate por regla; solo miembros del tenant). 18/18 migraciones sincronizadas.
App: `PoolView` con pestañas Resumen/Partidos/Tabla; `usePoolPlay` (lectura bajo RLS, lock del servidor, `save_prediction`, tabla); `PredictionMatchCard` (cierre mostrado desde `lock_at` del servidor, rechazos traducidos, sin formulario para administradores/no inscritos).
**E2E real contra QA (sesiones de usuario, `scripts/qa/e2e/mvp-flow.mjs`): 27/27** — organizador crea torneo→equipos→jornada→partidos→quiniela→código; administrador no puede inscribirse; jugadores pronostican/editan; ocultación hasta el cierre y revelado tras él; rechazo tras el cierre; publicación, idempotencia, corrección y revisión obsoleta; tabla; aislamiento cross-tenant. SQL: Fase 06 95/95, Fase 08 15/15 (rollback). Frontend: typecheck, 43 archivos / 296 tests, verify:bundle. Los tests de componente/vista son unitarios con mocks, **no** E2E de navegador (no hay navegador automatizado en el proyecto).
**Pendiente:** merge de Fase 06 a `main` + despliegue Vercel (bloqueado: el push a `main` fue denegado por el control de permisos y `vercel` no tiene sesión); UAT manual móvil de `/admin/parrilla` y `/p/:poolId`; tickets (ADR-014 sigue Proposed con decisiones obligatorias abiertas); D22 pendiente para producción comercial.

## Fase 08 completada en su alcance actual y experiencia móvil (2026-10-11)

`main` actualizado a `d9445e7` (Fases 06–08 base). Aplicada a QA `20261015000100` (`pool_points_evolution`, `my_pool_stats`, `my_points_summary`); 19/19 migraciones. App: «Mis puntos» con datos reales, bloque «Tu rendimiento» con gráfico de evolución, flyers Canvas nativos (sin dependencias) y compartir con Web Share de archivos (descarga como respaldo), «Mis tickets» con estado vacío honesto. Ranking por organizador entre quinielas **no** se implementa: ADR-010 prohíbe mezclar rankings entre quinielas. E2E real 32/32; SQL Fase 08 24/24; 46 archivos / 317 tests. Tickets: ADR-014 sigue Proposed (ver §9 de su revisión).

## Tickets gratuitos — ADR-014 Etapa 1 (2026-10-11) — rama `feat/tickets-stage1` (sin merge)

Aplicada a QA `20261016000100` (20/20 migraciones; recuperación: `supabase/proposed/down/…tickets_stage1_free.down.sql`, probado en transacción, rechaza si hay tickets). SQL: tickets 72/72 + regresión íntegra (bloqueo 51, privilegios 23, admin-participante 87, Fase 06 95, Fase 08 24, línea base 14/14, 6 históricas). **E2E real con concurrencia 24/24** (cupo exacto bajo 8 emisiones paralelas, misma clave ×10 = un ticket, cancelar+emitir, guardados y envíos paralelos, cierre por servidor, mejor ticket) y E2E clásico 32/32 (regresión). App: panel de tickets por jornada en la quiniela, «Mis tickets» (historial), administración (habilitar/limitar), avisos de cierre. 51 archivos / 354 tests, typecheck, verify:bundle. Pendiente: UAT manual móvil; merge/despliegue (requieren autorización); fase comercial (D13).



## Catálogo central, resultados híbridos y caché móvil — ADR-016 (2026-10-12) — rama `feat/api-football-connector` (sin merge/despliegue)

Tickets Etapa 1 ya integrados en `main` (`1f2b755`; Vercel Production READY; desafío anti-bot impidió la verificación HTTP/visual automatizada). **Decisión de producto:** catálogo central precargado + resultados híbridos; la actualización automática por API deportiva es **Premium futuro** (interruptor `auto_results` APAGADO + plan `pro`, comprobado en BD).
Aplicadas a QA `20261017000100`, `20261018000100` y `20261019000100` (endurecimiento tras revisión de seguridad independiente) (23/23): catálogo global (Wikidata CC0: 200 países, 199 selecciones, 1.433 equipos, 30 competiciones, 424 participaciones; 0 duplicados, carga idempotente), búsqueda paginada, `import_catalog_teams`/`import_catalog_round`, `teams.kind`, `results_mode`, política de conflicto (manual nunca se sobrescribe), cuota/dedupe/propagación del proveedor (inactivos). Sin escudos de clubes (sin licencia verificable); banderas MIT.
App: selector de catálogo en `/admin/parrilla` (local-first, filtros, paginación, offline), panel de modo de resultados (Premium «próximamente»), banderas, caché IndexedDB (catálogo público y quiniela privada por usuario, purga al cerrar sesión, aviso sin conexión). `sports-sync` **no desplegada**.
Pruebas: SQL 71+74 y regresión íntegra OK; E2E real 41/41 (catálogo/híbrido), 5/5 (concurrencia), 32/32 (mvp), 24/24 (tickets); 59 archivos / 453 tests Vitest; typecheck/build/verify:bundle OK. **NO EJECUTADO:** navegador real autenticado (UAT móvil). Detalle: `docs/agents/HANDOFF-CATALOG-HYBRID-RESULTS-20261012.md`.

## Cierre de seguridad F-04, hardening y fases 09/11/12 en preparación (2026-10-12) — rama `feat/api-football-connector` (sin merge/despliegue)

Informe único: `reports/release/closure-board-20261012.md`. **Veredicto: `READY_FOR_MERGE` (a `main`/QA, con tu autorización); NO `READY_FOR_PRODUCTION`.**

- **QA:** aplicada `20261022000100_security_followups` por decisión del propietario (24/24 sincronizadas): finanzas privadas (F-04, `participants_select_scoped`, ADR-020 Accepted para QA), autorizar-antes-de-bloquear (F-01), `updated_at` del catálogo (F-02), retención de `fixture_sync_log` con dry-run y `maintenance_runs` (F-03). Regresión posterior 609/609 (rollback) + E2E reales 32/32 y 24/24. Respaldo: `reports/security/qa-pre-apply-20261022-definitions.json`.
- **Propuestas sin aplicar** (`supabase/proposed/`): `20261020` solicitud de quiniela (ADR-017), `20261021` Elo+Poisson (ADR-019), `20261023` acceso/cuota de `sports-sync` (F-05, ADR-021). `auto_results` apagado; `sports-sync` sin desplegar ni programar.
- **Frontend:** UI de Superadmin fuera de la app principal (ADR-018, flag `VITE_ENABLE_SUPERADMIN_UI` apagado; `verify:bundle` lo comprueba), navegación admin/user, «Mis finanzas» de solo lectura sin dinero, CTA «Crear mi propia quiniela» (degrada si el RPC no existe), auto-fill «Sugerir marcador» (oculto si falta el RPC), vistas con carga diferida, imágenes optimizadas, logger de errores sin PII.
- **F-06:** cabeceras de seguridad + CSP **Report-Only** en `vercel.json`; receptor `supabase/functions/csp-report` sin desplegar. **NO CERRADO** hasta desplegar y verificar.
- **Fase 11:** PWA (manifest, service worker seguro) y config Capacitor listas; compilación Android BLOCKED_EXTERNAL. **Fase 12:** parcial (telemetría local + receptor CSP; colector externo requiere ADR).
- **Gates:** `npm ci` real (`source-map-js` 1.2.2), `npm audit` 0, typecheck, `npm test` 74 archivos / 659 tests, build, `verify:bundle`, `git diff --check`: PASS. **NO EJECUTADO:** UAT móvil (checklist `docs/testing/UAT-MOBILE-AUTHENTICATED.md`), Lighthouse, concurrencia real de las propuestas, inventario `auth.users`/invitación a `quinielasvilla@gmail.com` (script de operador `scripts/qa/qa-accounts.mjs`).
- Fases 05/05-bis siguen sin ACCEPTED formal (faltan happy paths HTTP y validación manual); 06–08 y tickets: código y pruebas cerrados, **DONE_PENDING_UAT**.

## Lote de correcciones y mejoras (2026-10-24) — autorización completa del propietario

Rama `feat/api-football-connector` (respaldada en `origin`). Detalle y evidencia: `reports/release/diagnostico-final-20261024.md`.

- **Scoring (ADR-023):** reglas congeladas al primer lock o primer resultado; FREE usa la puntuación estándar 3/1; regla estándar al
  abrir sin reglas; `rescore_pool`; política de reglas para la UI.
- **Marca y compartir (ADR-024):** nombre de plataforma del organizador (todos los planes) visible para los jugadores; logo y banner PRO
  sin deformar; ajuste inteligente del logo en el navegador; centro para compartir por WhatsApp (tabla, por cerrar, resultados, campeón,
  mi resultado, invitación; formato chat o Estado; foto de fondo local; mensaje editable); QR (`uqr`), marca de agua FREE y white-label PRO.
- **Notificaciones y tabla en vivo (ADR-025):** avisos de resultado publicado/corregido con el pronóstico propio y los puntos; Realtime
  más sondeo de respaldo; tabla en vivo; Elo recalculado por `pg_cron`.
- **Privacidad (ADR-026):** eliminación de cuenta desde Perfil (Edge Function `delete-account`, baja lógica); `/privacidad` y `/terminos`
  públicas.
- **Móvil:** App Links `/j/` y `/p/` para el host de QA, `assetlinks.json` (huella debug), Google oculto en el wrapper (ADR-022 sigue Proposed).
- **Seguridad/operación:** `csp-report` desplegado y `report-uri` activo (F-06 en observación); CI de GitHub Actions; `npm audit` 0 (raíz);
  pruebas unitarias aisladas de la red.
- **QA aplicado (dry-run previo en cada una):** `20261024000100`–`000600` (34/34).
- **Trabajo ajeno en curso detectado (no incluido):** ADR-027 (aceptación legal y catálogo de planes), migración
  `20261024000700_legal_acceptance_and_plan_catalog.sql`, `LegalAcceptanceView.vue`, `PlansView.vue`, `usePlanCatalog.ts` y cambios en
  `useAuth.ts`, `AuthForm.vue`, `router.ts`, `navigation-guards.ts`, `usePostSignInNavigation.ts`, `legal-content.ts` y `ProfileView.vue`.
  Quedaron sin commit, sin aplicar y sin tocar; al momento del cierre rompían el typecheck (`acceptLegalDocuments`).

## Correcciones UAT y publicación a main (2026-10-24)

`main` y `origin/main` están en `d21ae18`; las migraciones legales y de participantes de administración quedaron aplicadas en QA. UAT-01 y UAT-03 se corrigieron y cuentan con pruebas focalizadas. UAT-02 a UAT-09 se corrigieron en el siguiente lote pendiente de commit: la participación pendiente se revalida aun con caché fresca; el acceso a una quiniela tiene caché privada offline; los rechazos de tickets mantienen el panel visible; se amplían áreas táctiles, contraste y diseño a 200 %; Inicio prioriza sus imágenes LCP. Evidencia local: typecheck, pruebas focalizadas (29/29), batería Vitest y `verify:bundle` completados sin código de error; queda validación humana de navegador/Vercel QA y revisión de la primera corrida de CI.

## Consola de plataforma aislada en Vercel (2026-10-26)

Se creó `theonix/sportleagues-control-qa`, separado de `sportleagues-qa`, con Node 22, `npm ci`,
`npm run build:superadmin` y salida `apps/superadmin/dist`. Se configuraron solo
`VITE_SUPABASE_URL` y una clave publicable de Supabase para Production/Preview; no se cargó ninguna
service-role ni secreto privado. El primer despliegue de producción quedó listo en
`https://sportleagues-control-qa.vercel.app` y muestra la pantalla de acceso de plataforma.

El repositorio `Leandro-SC/sportleagues_agentic_framework_v2` está conectado, pero los despliegues
automáticos permanecen desactivados: Vercel conserva `main` como rama de producción y esa rama no
contiene la consola. Pendiente de operador: en Settings → Environments → Production → Branch Tracking,
definir `feat/superadmin-control-plane` y habilitar despliegues Git. No asignar dominio público de jugadores.
Handoff: `docs/agents/HANDOFF-VERCEL-CONTROL-20261026.md`.

## Control Plane premium y operador único (2026-10-26)

La migración `20261027032944_superadmin_single_email_access.sql` se aplicó a QA tras dry-run.
`platform_console_guard()` exige un rol activo y el correo de operador aprobado; la suite SQL negativa confirmó
3/3 escenarios (operador permitido, otro platform admin denegado y `anon` sin ejecución). La interfaz elimina la
entrada libre de correo y cierra una sesión ajena en ese origen. El despliegue manual actualizado está listo en
`https://sportleagues-control-qa.vercel.app`.

El dashboard se renovó como Control Plane premium, responsive y basado solo en métricas reales de RPC: señales
operativas, organizaciones con búsqueda, solicitudes y catálogo auditado. ADR-030 delimita estas funciones y prohíbe
tablas globales o acciones destructivas sin un ADR y endpoint protegido adicional.

El incremento operativo `20261027040000_superadmin_operational_read_models.sql` quedó aplicado en QA: usuarios
minimizados, clientes, torneos/partidos, actividad y monitor de sincronización se sirven por RPCs auditadas. ADR-031
confirma que no se exponen emails de Auth, cuerpos de avisos ni metadata libre; las mutaciones globales siguen sujetas
a funciones específicas y confirmación de producto.

El despliegue de este incremento (`dpl_2B1TGpmm5dUA5duYPwfreMWEpqq2`) está `Ready` y tiene los aliases canónicos
`sportleagues-control-qa.vercel.app` y `sportleagues-control-qa-theonix.vercel.app`.

La interfaz del Control Plane se renovó a una estética B2B clara y sobria: se retiraron acentos neón, se adoptaron
superficies neutras, azul marino institucional, jerarquía tipográfica y tablas/tarjetas más legibles en escritorio y móvil.
El build de Superadmin y `git diff --check` pasaron antes del despliegue `dpl_71SmswmwqjE1gaCMHqeR48t1u12Q`.

La migración `20261027042014_superadmin_observability_and_growth_metrics.sql` añadió presencia autenticada de corta
vida, errores de cliente anonimizados, KPIs de adquisición/demanda y lecturas de actividad por usuario. QA: dry-run y
aplicación correctos; suite de autorización 3/3 PASS. El Control Plane publica los módulos Analítica y KPIs, Monitor
en vivo y Errores y logs en `dpl_3SECiF257Cbfguq4Ce7dTtejN6wP`. La presencia comenzará a poblarse tras el siguiente
despliegue separado de la app de jugadores que incorpora el heartbeat y el sumidero de telemetría.

El Control Plane incorpora filtros reutilizables por búsqueda, fechas desde/hasta, rangos rápidos (hoy/7/30 días),
estado contextual y limpieza de criterios en clientes, usuarios, operaciones deportivas, solicitudes, monitor y errores.
El rediseño responsive pasó `build:superadmin` y `git diff --check`; se publicó como
`dpl_Fasb42KcAcebCekqxAEgjGNKptoi`.

Dependabot reportaba una vulnerabilidad moderada solo de desarrollo en el wrapper móvil (`@capacitor/cli → xcode → uuid`).
Se fijó el subárbol de `xcode` a `uuid` 11.1.1 por `overrides`, manteniendo Capacitor 8.5.3. Evidencia: auditoría móvil
0 vulnerabilidades, carga `xcode+uuid` compatible y `cap doctor` confirma Android correctamente.
