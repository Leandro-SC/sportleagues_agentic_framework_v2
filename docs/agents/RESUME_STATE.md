# RESUME_STATE — punto de reanudación (checkpoint preventivo)

Actualizado: 2026-10-12 (cierre del lote; todos los agentes terminaron). Ver reports/release/closure-board-20261012.md. Sin secretos.

## Regla permanente: aplicación móvil (mobile-first)
SportLeagues es una app móvil, no una web de escritorio adaptada. Criterio de cierre en `docs/testing/MOBILE-FIRST-ACCEPTANCE.md`: ningún módulo es `DONE_VERIFIED` con problemas móviles importantes; sin validación visual en dispositivo el máximo es `DONE_PENDING_UAT`. Aplicar en cada módulo/fase, también tras reanudar.

## Repositorio
- Rama: `feat/api-football-connector` · último commit: `e3caa24` · **nada confirmado en esta sesión** (todo sin commit).
- Respecto a `main` (`1f2b755`, = `origin/main`): 8 commits por delante, 0 por detrás (fast-forward limpio).
- QA Supabase: 23/23 migraciones sincronizadas. **Ninguna migración nueva aplicada.** Nada desplegado.

## Línea base verificada al inicio de la sesión
`npm run typecheck` PASS · `npm test` 59 archivos / 453 tests PASS (antes de cualquier cambio de esta sesión).

## Completado en esta sesión (verificado salvo que se indique)
- ADR-017 (solicitud de quiniela, Proposed) y ADR-018 (UI Superadmin fuera de la app principal, Accepted por instrucción del propietario).
- `docs/product/FUNCTIONAL-MATRIX-QUINIELAS.md` (matriz código real vs. legado PHP).
- `apps/platform/src/lib/telemetry.ts` + test: 5/5 PASS (dirigido). **Falta conectarlo en `main.ts`** (`installGlobalErrorHandlers()`), cuando termine el agente MOBILE.
- `scripts/qa/qa-accounts.mjs` (inventario agregado + invitación oficial con `--execute`; no ejecutado).

## Agentes lanzados en paralelo (resultados AÚN NO recibidos ni verificados)
| Agente | Zona | Entregables esperados |
| --- | --- | --- |
| FRONTEND | `apps/platform/src/**` (salvo `main.ts`, PWA) | flag Superadmin off, navegación admin, «Mis finanzas», CTA «Crear mi propia quiniela» (`usePoolCreationRequest`), `docs/product/UI-PERMISSIONS-MATRIX.md` |
| DATA solicitud | `supabase/proposed/20261020000100_*`, `supabase/tests/pool-creation-requests.sql` | RPC `request_pool_creation`, `my_pool_creation_request`, `cancel_pool_creation_request`, `review_pool_creation_request` (solo service_role) |
| DOMAIN estadística | `supabase/proposed/20261021000100_*`, `supabase/tests/stats-elo-poisson.sql`, `docs/architecture/STATS-ENGINE-CONTRACT.md` | `suggest_scoreline`, `rebuild_team_ratings`, funciones puras Elo/Poisson |
| MOBILE | `apps/platform/public/**`, `index.html`, `main.ts` (solo SW), `lib/pwa.ts`, `mobile/**` | manifest, `sw.js`, iconos, Capacitor config, runbook, informe fase 11 |
| SECURITY | `reports/security/security-review-20261012.md`, `supabase/proposed/20261022000100_*`, suites `security-followups`/`finance-privacy` | 3 hallazgos bajos, finanzas privadas, `npm audit`, secretos, Edge Functions |

**Actualización (2026-10-12, 22:15 Lima):** MOBILE terminó (PARTIAL, informe recibido; 26 tests dirigidos de PWA, typecheck y `verify:bundle` según el agente; **aún no reverificados por mí**). DATA-solicitud terminó (suite 138/138 en rollback según el agente; **por reverificar**). FRONTEND, DOMAIN-estadística y SECURITY se cortaron por límite de sesión y fueron **reanudados** con `SendMessage` a las 22:14; dejaron archivos parciales (`supabase/proposed/20261021*`, `20261022*`, `docs/architecture/STATS-ENGINE-CONTRACT.md`, `usePoolCreationRequest`, `useAdminFinance`, `PoolCreationRequestCard`). Si la sesión se corta otra vez: leer `git status`, reanudar o rehacer solo lo faltante de cada zona. `package-lock.json` tiene un parche transitivo `source-map-js` 1.2.1→1.2.2 (origen a confirmar en el informe de seguridad).
Hallazgos móviles pendientes para mí: PNG de 1,17 MB (logo) y 1,41 MB (fondo) en el bundle; chunk `EmptyState` de 323 kB; sin timeout de red en la navegación offline del SW.

**Decisión del propietario (2026-10-12, tras el informe de seguridad):**
- F-04: AUTORIZADO aplicar `20261022000100` SOLO a QA tras revisar SQL, pruebas SQL en verde y respaldo/recuperación; ADR-020 pasa a Accepted al aplicarla. Nada en producción.
- F-05: `sports-sync` solo por procesos backend autorizados (credencial interna, cuota global + por tenant según plan, contadores atómicos, registro, pruebas); **sin desplegar ni programar**, `auto_results` apagado, sin Superadmin en la UI. Agente lanzado → `supabase/proposed/20261023000100_provider_access_and_quota.sql`, ADR-021. **No autorizado aún aplicarla a QA.**
- F-06: CSP sigue Report-Only; mecanismo de reportes (`supabase/functions/csp-report`, sin desplegar) + doc `docs/operations/CSP-REPORTING-AND-ENFORCEMENT.md`; F-06 NO cerrado hasta despliegue y verificación.
- Dependencias: `npm ci` AUTORIZADO. Lockfile con `source-map-js` 1.2.2 reaplicado (el agente frontend lo había revertido); `npm ci` verificado en directorio temporal (194 paquetes, `npm audit` 0). El `npm ci` REAL va al final, cuando no haya agentes ejecutando pruebas (borra node_modules).
- Retención de `fixture_sync_log` en QA: autorizada con condiciones (dry-run, registro, conservar conflictos 365 d, solo service_role). Agente de seguridad ajustando la migración (dry-run + `maintenance_runs`).
- UAT móvil: PENDING (sin navegador); checklist en `docs/testing/UAT-MOBILE-AUTHENTICATED.md`. Sin merge a `main`, sin despliegues, sin producción.
Respaldo previo a aplicar: `reports/security/qa-pre-apply-20261022-definitions.json`.
**Orden pendiente:** (1) agente seguridad termina migración ajustada → (2) reproducir suites en rollback → (3) mover a `supabase/migrations/`, `db push --dry-run`, `db push --linked` → (4) regresión post-aplicación + E2E mvp/tickets (`QA_OWNER_AUTHORIZED=yes`, registrar residuo en QA-SYNTHETIC-RESIDUE.md) → (5) ADR-020 Accepted → (6) `npm ci`, `npm audit`, typecheck, `npm test`, build, `verify:bundle`, `git diff --check` → (7) commits por dominio y PROJECT_STATE/informe final.

Al llegar cada informe: **verificar con los comandos reales** (no fiarse del resumen), revisar el diff y luego integrar.

## Siguiente acción concreta (al reanudar)
1. `git status` y `git diff --stat`; leer los informes de los 5 agentes (o comprobar si terminaron mirando sus archivos).
2. Gates secuenciales y NUNCA en paralelo: `npm run typecheck`, `npm test`, `npm run verify:bundle`, `git diff --check`.
3. Conectar `installGlobalErrorHandlers()` en `main.ts`.
4. Fase 09 UI: botón de auto-fill en `PredictionMatchCard` consumiendo `suggest_scoreline` (degradar si el RPC no existe en QA); texto «sugerencia estadística, no certeza».
5. Re-ejecutar en rollback las suites SQL nuevas contra QA: `node scripts/qa/run-sql-suite.mjs <suite> --with-migration <migración>`.
6. Commits locales por dominio (con la línea Co-Authored-By vigente), actualizar `PROJECT_STATE.md` y el informe único `reports/release/closure-board-20261012.md`.

## Bloqueos registrados (no se resuelven sin el propietario)
- **Aplicar migraciones 20261020/21/22 a QA, merge a `main`, despliegue Vercel:** requieren autorización expresa (una sola solicitud consolidada al cierre).
- **Inventario de `auth.users` e invitación a `quinielasvilla@gmail.com`:** el clasificador denegó la consulta por PII; usar `scripts/qa/qa-accounts.mjs` con credenciales del operador. Invitación = envío externo → autorización.
- **Limpieza de cuentas sintéticas QA:** lista exacta + respaldo + aprobación; además tablas append-only impiden borrar sin desactivar guardas.
- **UAT móvil autenticada, build nativo Android (SDK/JDK), assetlinks/fingerprint, push (proveedor), consola de plataforma:** BLOCKED_EXTERNAL / BLOCKED_DECISION.

## Reanudación automática
No hay mecanismo programado: si la sesión se corta se necesita **un nuevo inicio de ejecución** que lea `AGENTS.md`, el Encargo Maestro, `PROJECT_STATE.md` y este archivo, y verifique el repositorio antes de tocar nada.

## ESTADO FINAL DEL LOTE (supera a las secciones anteriores)
- Todos los agentes terminaron y sus resultados están integrados. Gates PASS (npm ci, audit 0, typecheck, 659 tests, build, verify:bundle). Migración 20261022 aplicada solo en QA (24/24). Propuestas 20261020/21/23 SIN aplicar. Nada desplegado, sin merge.
- Commits locales por dominio creados en esta rama (ver git log). Si quedan cambios sin confirmar, son solo los de este checkpoint.
- **Siguiente acción al reanudar:** esperar autorizaciones listadas en closure-board (merge, aplicar 20261020/21/23 por separado, despliegues, UAT humana). Sin ellas no hay tareas técnicas desbloqueadas; no repetir auditorías ni pruebas ya ejecutadas.

## ORDEN MAESTRA DE DIAGNÓSTICO Y CIERRE (2026-10-12, segunda ronda) — estado en curso
- Autorizado por el propietario: aplicar 20261020/21/23 a QA (hecho), merge a `main` y despliegue SOLO a QA tras los gates (pendiente), invitación a `quinielasvilla@gmail.com` por mecanismo oficial, límites F-05 definitivos (Free 0; Pro 20/300; global 80/2400). NO producción.
- HECHO: suites reproducidas por mí en rollback (pool-creation 138/138, Elo 115/115, F-05 163/163), reversiones verificadas (8/8 y 5/5), migraciones movidas a `supabase/migrations/` y aplicadas con `db push --linked --include-all` → **27/27 sincronizadas en QA**. ADR-021 Accepted. Scripts de operador: `scripts/qa/review-pool-request.mjs`, `qa-accounts.mjs`, `purge-fixture-sync-log.mjs`. Estos cambios están SIN COMMIT (git status).
- AGENTES EN CURSO: Android (APK debug, toolchain en `C:\Users\Acer\tools\android`), revisión de código frontend (`reports/security/frontend-review-20261012.md`), E2E de ciclo de vida completo (`scripts/qa/e2e/full-lifecycle.mjs`, 5 identidades sintéticas fijas `qa-*@example.test`).
- PENDIENTE (mi lista, en orden): regresión SQL post-aplicación (en curso, segundo plano) → UAT de navegador real con Chrome headless emulando móvil + Lighthouse (agente nuevo tras el E2E; reutiliza `scripts/qa/lib/qa-identities.mjs`) → corregir hallazgos del review/UAT → ADR-017/019 a «Accepted para QA» → invitación a quinielasvilla (script operador) → ADR-022 OAuth nativo (Proposed) → gates completos → commits → merge a `main` + push (si el permiso lo deniega, dejarlo documentado) + verificar Vercel QA (cabeceras/CSP) → diagnóstico final obligatorio (informe §13 de la orden) en `reports/release/diagnostico-final-20261012.md`.
- No repetir: auditorías de seguridad ya hechas; pruebas ya reproducidas arriba.
