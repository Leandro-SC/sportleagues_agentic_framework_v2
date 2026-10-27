# HANDOFF — Despliegue aislado de SportLeagues Control

- Agente: Codex
- Estado: DONE_PENDING_UAT

## Objetivo

Publicar la consola de plataforma en un proyecto Vercel separado y revisar los controles de exposición relevantes.

## Archivos modificados

- `.gitignore`: incorpora `.vercel/` para no versionar metadatos locales del enlace.
- `PROJECT_STATE.md`: registra la configuración y el estado del despliegue.
- `apps/superadmin/src/App.vue` y `styles.css`: login de cuenta única y dashboard responsive premium con datos reales.
- `supabase/migrations/20261027032944_superadmin_single_email_access.sql`: protección de operador único en servidor.
- `supabase/tests/superadmin-single-email-access.sql`: prueba positiva y denegaciones del guard.
- `docs/architecture/adr/ADR-029-single-operator-control-console.md` y `ADR-030-superadmin-control-plane-scope.md`: decisiones de autorización y alcance.
- `supabase/migrations/20261027040000_superadmin_operational_read_models.sql` y `ADR-031-superadmin-operational-read-models.md`: lecturas operativas globales minimizadas y auditadas.

## Contratos/API afectados

Se incorporó una función de autorización de consola, sin cambiar el acceso tenant ni contratos públicos. El proyecto
Vercel usa RPCs de Superadmin y las variables públicas `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.

## Decisiones

- Proyecto aislado: `theonix/sportleagues-control-qa`.
- Build: Node 22, `npm ci`, `npm run build:superadmin`, salida `apps/superadmin/dist`.
- No se configuró `SUPABASE_SERVICE_ROLE_KEY` ni credenciales privadas en Vercel.
- `platform_console_guard()` exige rol global activo y el correo único definido en ADR-029.
- Las visualizaciones usan agregados reales por RPC; ADR-030 veta datos inventados, tablas globales y controles destructivos no diseñados.
- Usuarios, actividad, partidos y monitor se consultan mediante RPCs protegidas; no se devuelven emails de Auth, cuerpos de notificaciones ni metadata sin filtrar.
- Se mantiene la creación automática de deploys Git desactivada hasta fijar la rama correcta: activar con
  `main` publicaría una rama que no contiene la consola.

## Tests ejecutados

- `npm test`, typecheck, build de plataforma, build de Superadmin, `verify:bundle` y `git diff --check`: exit 0
  durante la revisión local anterior.
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilidades en raíz y `mobile/`.
- Despliegue Vercel `dpl_DMXYB6oBHyPcobG1ZzkYoxFTLTPg`: `Ready`; la URL canónica muestra la pantalla de login.
- La migración de operador único se aplicó a QA tras dry-run; `superadmin-single-email-access.sql`: **3/3 PASS** en rollback.
- La migración operativa se aplicó a QA tras dry-run; la misma suite volvió a dar **3/3 PASS** y ejecuta el monitor con el operador autorizado.
- Despliegue Vercel `dpl_2B1TGpmm5dUA5duYPwfreMWEpqq2`: **Ready**, aliases canónicos de Control actualizados.
- Renovación visual sin neón: paleta B2B clara, sidebar institucional, tarjetas y tablas más legibles; build y `git diff --check` OK antes de `dpl_71SmswmwqjE1gaCMHqeR48t1u12Q`.
- `20261027042014_superadmin_observability_and_growth_metrics.sql` y ADR-032: presencia autenticada, errores saneados y KPIs de negocio. QA dry-run/aplicación OK; suite 3/3 PASS. Despliegue de Control `dpl_3SECiF257Cbfguq4Ce7dTtejN6wP`: Ready.
- Filtros UI completos: texto contextual, fechas, rangos rápidos, estados y restablecimiento, con diseño responsive. `build:superadmin` y `git diff --check`: PASS; despliegue `dpl_Fasb42KcAcebCekqxAEgjGNKptoi`: Ready.
- Dependabot móvil: se fijó `xcode → uuid` a `11.1.1` mediante `overrides`, sin degradar Capacitor. `npm audit` móvil: 0 vulnerabilidades; carga `xcode+uuid` y `cap doctor`: PASS.

## Riesgos / limitaciones

- `mobile/` conserva 3 vulnerabilidades moderadas solo de desarrollo en la cadena
  `@capacitor/cli → xcode → uuid`; no aplicar `npm audit fix --force` sin revisar el cambio rompiente.
- La CI ya construye `build:superadmin`; falta incorporar la suite SQL en un entorno aislado de CI.
- La CSP permanece `Report-Only` hasta revisar telemetría y promoverla a enforcement.

## Bloqueos

- Falta configurar en el panel de Vercel el Branch Tracking de Production a
  `feat/superadmin-control-plane`; la CLI/API oficial no expuso ese ajuste.
- Falta UAT humana: inicio correcto como operador y rechazo visual de una cuenta ordinaria. La autorización de servidor sí fue cubierta por la suite SQL.
- Falta desplegar separadamente la aplicación de jugadores con `platform-observability.ts`; hasta entonces, las tarjetas de presencia y errores mostrarán el histórico disponible (posiblemente vacío).

## Próximo paso permitido

Autenticar en el panel Vercel, fijar la rama de producción y habilitar Git deployments. Después, comprobar
el acceso con una cuenta de plataforma y una cuenta ordinaria antes de asignar un dominio aislado.
