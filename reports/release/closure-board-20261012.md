# Tablero de cierre — 2026-10-12 (rama `feat/api-football-connector`)

Informe único del lote de ejecución intensiva. Estados: `DONE_VERIFIED`, `DONE_PENDING_UAT`, `READY_FOR_QA`, `BLOCKED_*`. Todo lo marcado como verificado se ejecutó en esta sesión; lo que dicen los agentes y yo no reproduje se indica como tal.

## Veredicto

**`READY_FOR_MERGE` a `main` (que despliega el entorno QA), condicionado a tu autorización expresa. NO es `READY_FOR_PRODUCTION`.**
Motivos de no producción: UAT móvil autenticada sin ejecutar, F-05 y F-06 sin cerrar, D22 (baja de tenants/PII) pendiente, sin autorización de release. Condiciones antes de promover: UAT del checklist `docs/testing/UAT-MOBILE-AUTHENTICATED.md` (en especial `AdminView`/`PoolView` con la RLS nueva de F-04).

## Entornos
- Rama `feat/api-football-connector`; `main` = `origin/main` = `1f2b755`. La rama contiene 8 commits previos + los de esta sesión; 0 por detrás (fast-forward limpio).
- Supabase QA: **24/24 migraciones sincronizadas** (nueva: `20261022000100_security_followups`, aplicada con tu autorización, solo QA). Producción: nada aplicado. Vercel: nada desplegado.
- Propuestas **sin aplicar** (`supabase/proposed/`): `20261020000100` (solicitud de quiniela, ADR-017), `20261021000100` (Elo+Poisson, ADR-019), `20261023000100` (acceso/cuota de `sports-sync`, ADR-021).

## Pruebas ejecutadas por mí (reales)
| Prueba | Resultado |
| --- | --- |
| `npm ci` real | 194 paquetes; `source-map-js` efectivo **1.2.2** |
| `npm audit` / `--omit=dev` | **0 vulnerabilidades** / 0 |
| `npm run typecheck` | sin errores |
| `npm test` | **74 archivos / 659 tests PASS** (inicio de sesión: 59 / 453) |
| `npm run verify:bundle` | build OK; sin dataset de vista previa; **sin UI de Superadmin en el bundle** |
| `git diff --check` | sin errores |
| SQL en QA tras aplicar (rollback, 0 filas persistidas) | `security-followups` 68/68, `finance-privacy` 44/44, Fase 06 95/95, tickets 72/72, Fase 08 24/24, catálogo 71/71 y 74/74, bloqueo 51/51, privilegios 23/23, admin-participante 87/87 = **609/609** |
| E2E real (sesiones de usuario sintéticas) | clásico **32/32**; tickets con concurrencia **24/24** |
| Retención `fixture_sync_log` en QA | dry-run y ejecución real OK, registradas en `maintenance_runs`; tabla vacía (0 filas afectadas) |

**Reportado por agentes, no reproducido por mí:** solicitud de quiniela 138/138, Elo+Poisson 115/115, F-05 157/157 (todas en rollback sobre QA), `down` de 20261022 13/13, vitest dirigidos de PWA (26), CSP report (26) y sports-sync-access (67). Los vitest ya están dentro de los 659.
**No ejecutado:** navegador/dispositivo (UAT móvil), Lighthouse, concurrencia real entre dos sesiones para las propuestas, despliegues.

## Estado por hallazgo de seguridad (`reports/security/security-review-20261012.md`)
| Id | Sev. | Estado |
| --- | --- | --- |
| F-04 finanzas legibles por todo miembro | Media | **Corregido y aplicado en QA** (ADR-020 Accepted para QA); producción pendiente de autorización |
| F-05 cuota del proveedor | Media | **Corregido en código/SQL (propuesto)**: credencial interna, cuotas atómicas global/tenant, solo service_role. Sin aplicar, sin desplegar; `auto_results` apagado |
| F-06 cabeceras/CSP | Media | Cabeceras activas en `vercel.json` + CSP **Report-Only** + receptor `csp-report` (sin desplegar). **NO CERRADO** hasta desplegar y verificar |
| F-01/F-02/F-03 | Baja | Corregidos en la migración aplicada en QA (F-01b: excepción justificada, revisión 2026-11-15) |
| F-07/F-08/F-10 | Baja | Aceptados/documentados |
Críticos: 0. Altos: 0 (el único alto, `source-map-js`, está corregido).

## Módulos
| Módulo | Estado | Evidencia |
| --- | --- | --- |
| Aislamiento tenant/finanzas (SQL) | DONE_VERIFIED en QA | suites 609/609, E2E 56/56 |
| Dos experiencias visibles + Superadmin fuera de la UI (ADR-018) | DONE_PENDING_UAT | router `buildRoutes`, tests de router, `verify:bundle` |
| Mis finanzas (solo lectura, sin dinero) | DONE_PENDING_UAT | `useAdminFinance` + tests; selector solo desde membresías |
| Solicitud «Crear mi propia quiniela» | READY_FOR_QA (BD sin aplicar) | UI degrada con «Función aún no disponible»; SQL 138/138 (agente) |
| Auto-fill Elo+Poisson | READY_FOR_QA (BD sin aplicar) | botón oculto si falta el RPC; SQL 115/115 (agente); tests de UI |
| PWA | DONE_PENDING_UAT (parcial) | manifest, SW seguro (26 tests), build; Lighthouse/dispositivo no ejecutados |
| Capacitor/Android | BLOCKED_EXTERNAL | sin Android SDK; JDK 23 (se pide 21) |
| Observabilidad (Fase 12) | PARCIAL | logger con depuración de PII + receptor CSP; colector externo BLOCKED_DECISION (ADR) |
| Rendimiento móvil | Mejorado | imágenes 1,4 MB→75 KB y 1,2 MB→393 KB; chunk de entrada 173→87 kB |
| UAT móvil autenticada | **PENDING** | checklist de 19 casos |

## Bloqueos reales y autorizaciones indispensables (lista única)
1. **Merge de la rama a `main`** (despliega QA en Vercel).
2. **Aplicar a QA** `20261020` (solicitud), `20261021` (Elo+Poisson, más la primera `rebuild_team_ratings`) y `20261023` (F-05) — cada una por separado.
3. **Decisiones:** límites de cuota de F-05 (free 0/0, pro 20/300, global 100/3000), enfriamiento de 7 días de la solicitud, si aprobar crea el tenant automáticamente, appId/dominio/huella de Android, estrategia OAuth nativa, `vite-plugin-pwa`, colector de errores.
4. **Despliegues:** función `csp-report` (+ `verify_jwt=false` en `config.toml` + `report-uri`), `sports-sync` con su secreto y proceso llamador; después, verificar cabeceras con `curl -sI`/navegador real.
5. **UAT móvil humana** y limpieza de cuentas QA (lista exacta + respaldo; las tablas append-only impiden borrar las sintéticas sin desactivar guardas). Inventario de `auth.users` e invitación a `quinielasvilla@gmail.com`: usar `scripts/qa/qa-accounts.mjs` con credenciales del operador (envío externo).
6. **Producción:** nada hasta resolver D22 y recibir autorización de release.

## Rollback
- BD QA: `supabase/proposed/down/20261022000100_security_followups.down.sql` (probado en rollback); respaldo de definiciones en `reports/security/qa-pre-apply-20261022-definitions.json`.
- Frontend: revertir el merge (`git revert -m 1 <merge>`) o promover el despliegue anterior en Vercel.
- Propuestas sin aplicar: no requieren rollback.

## Próximo lote ejecutable (sin autorización adicional)
Nada técnico queda desbloqueado y pendiente salvo UAT humana; el siguiente avance depende de las autorizaciones 1–4.
