# Diagnóstico y lote de correcciones — 2026-10-24

Rama `feat/api-football-connector`, con autorización completa del propietario. QA: Supabase `juoftaofzepxbrrxbkhx` y Vercel `sportleagues-qa.vercel.app`. **No existe producción.**

## 1. Brechas del diagnóstico y estado final

| Brecha | Estado | Evidencia |
| --- | --- | --- |
| 21 commits solo locales | **Resuelto**: rama en `origin` | `git push -u origin feat/api-football-connector` |
| `main` (QA web) desalineado de la BD | Resuelto con el merge a `main` (sección 5) | — |
| Reglas cambiables a mitad de torneo; FREE con puntuación libre; quinielas sin reglas puntuaban 0 | **Resuelto** (ADR-023) | `scoring-rules-integrity.sql` 27/27; regresión SQL 1.079 casos; 6 históricas OK |
| Flyers sin QR, marca de agua, ganador ni próxima jornada | **Resuelto** (ADR-024) | `flyer-growth.test.ts` (el QR se decodifica con `jsqr`) |
| Branding PRO invisible para jugadores | **Resuelto** (ADR-024) y ampliado con el nombre de plataforma | `tenant-brand-name.sql` 15/15; `useTenantBranding.test.ts` |
| Deep links sin cablear; Google roto en el APK | **Resuelto para QA**; producción requiere dominio y keystore | `pwa.test.ts` (coherencia manifest/assetlinks/hosts); `AuthForm.test.ts` |
| Sin notificaciones | **Resuelto en la app** (ADR-025); push del sistema operativo pendiente de ADR y proveedor | `result-notifications.sql` 19/19; avisos reales generados por los E2E |
| Sin páginas legales ni baja de cuenta | **Resuelto** (ADR-026); falta revisión legal e identidad del responsable | `account-deletion.sql` 13/13; E2E real 8/8 |
| Sin CI | **Resuelto** | `.github/workflows/ci.yml` |
| F-06 `csp-report` sin desplegar | **En observación** | función en QA 204/405/400; `report-uri` activo |
| Elo sin reconstrucción inicial | **Resuelto** + recálculo programado | 19 tenants / 29 partidos / 46 equipos; `stats-rebuild-schedule.sql` 5/5 |
| UAT de navegador a medias | Ver sección 4 | `reports/testing/uat-browser-20261012.md` |
| Documentación desactualizada | **Resuelto** | `PROJECT_STATE.md`, `README.md`, ADR-022, runbooks |
| Dependabot vite | **Superado** (vite 8.3.5 vía `npm audit fix`) | `npm audit` 0 (raíz) |

Pedidos añadidos durante el lote, todos implementados:

- nombre y logo propios del organizador, visibles para los jugadores;
- logo sin deformar y ajuste inteligente;
- compartir avanzado por WhatsApp;
- notificaciones de cambio de resultado;
- tabla que se actualiza sola.

## 2. Migraciones aplicadas a QA (cada una con prueba en rollback, dry-run y aplicación por separado)

| Migración | Contenido | Reversión |
| --- | --- | --- |
| `20261024000100_scoring_rules_integrity` | ADR-023 | `proposed/down/…000100…` |
| `20261024000200_tenant_brand_name` | nombre de plataforma + auditoría de `tenant_branding` | `…000200…` |
| `20261024000300_result_notifications` | notificaciones + Realtime | `…000300…` |
| `20261024000400_account_deletion` | baja lógica | `…000400…` |
| `20261024000500_stats_rebuild_schedule` | `pg_cron` y recálculo de Elo | `…000500…` |
| `20261024000600_realtime_results` | `official_results`/`matches` en Realtime | `…000600…` |

Edge Functions desplegadas en QA: `delete-account` y `csp-report`.

## 3. Pruebas ejecutadas

| Prueba | Resultado |
| --- | --- |
| Vitest (aislado de la red) | **87 archivos / 812 pruebas PASS** |
| `npm run typecheck` / `git diff --check` | PASS (typecheck también en un worktree limpio del estado commiteado, tras `npm ci`) |
| `verify:bundle` | Interrumpido al detener el lote: en el árbol de trabajo lo rompía el trabajo ajeno de ADR-027 y la repetición limpia se detuvo |
| SQL en rollback (QA) | 15 suites, 1.079 casos con la migración de scoring; suites nuevas 27 + 15 + 19 + 13 + 5; regresiones relacionadas 870 casos con el trigger de avisos; todo PASS |
| SQL históricas (BEGIN/ROLLBACK) | `phase-03-rls`, `04`, `05-admin-rpc`, `05-branding-assets`, `05-branding-asset-security-regression`, `05bis`: exit 0 |
| E2E reales | `mvp-flow` 32/32, `tickets-flow` 24/24, `account-deletion` 8/8 |
| `npm audit` | raíz 0; `mobile/` 3 moderadas en la CLI de Capacitor (dependencia `uuid` de `xcode`, solo desarrollo e iOS; la «solución» degrada la CLI): **riesgo aceptado** |

## 4. UAT de navegador

Arnés completado (bloques b1–b5, Chrome headless por CDP contra la app compilada y QA). Resultado: **88 PASS / 45 FAIL / 3 NOT_RUN** (`reports/testing/uat-browser-20261012.md`).

- Funcional, sesión, seguridad, rendimiento y PWA: 33 PASS / 8 FAIL / 3 NOT_RUN.
- Matriz táctil de 17 pantallas × 320/390/430: 21 PASS / 30 FAIL; todos los fallos son objetivos menores de 44 px. Sin desbordes horizontales ni errores de consola.
- Accesibilidad: 34 PASS / 7 FAIL.

9 defectos de producto (**UAT-01 y UAT-03 altos**). Ninguno se corrigió porque el propietario pidió detener el lote. Detalle y corrección propuesta de cada uno en `docs/operations/PENDIENTES-20261024.md` §1; para UAT-01 hay un borrador de RPC en `supabase/proposed/`.

## 5. Publicación

La rama `feat/api-football-connector` está publicada en `origin` con todos los commits del lote. **No se hizo merge a `main`** (Vercel QA sigue en `1f2b755`): el propietario pidió detener el lote. Además conviene corregir antes UAT-01 y UAT-03 y aislar el trabajo ajeno de ADR-027. Pasos en `docs/operations/PENDIENTES-20261024.md` §2.

## 6. Lo que sigue bloqueado (requiere al propietario)

1. **Producción:** proyecto Supabase y Vercel de producción, dominio propio y política de backups.
2. **Android release:** keystore y su huella (se añade a `assetlinks.json` y al intent-filter del dominio final), ficha de Play Console y URL web de baja.
3. **Legal:** identidad del responsable, jurisdicción, revisión de `/privacidad` y `/terminos`, `VITE_LEGAL_CONTACT_EMAIL` y D22 (baja de organizaciones).
4. **ADR-022** (OAuth nativo con PKCE): decisión sobre el cambio de comportamiento de la recuperación y cliente Android en Google Cloud.
5. **Push del sistema operativo:** proveedor (Web Push/FCM) y ADR.
6. **Colector externo de errores:** proveedor y ADR.
7. **UAT humana en dispositivo** (checklist `docs/testing/UAT-MOBILE-AUTHENTICATED.md`): hasta entonces el máximo es `DONE_PENDING_UAT`.
8. **Trabajo ajeno detectado** (ADR-027, migración `20261024000700`, vistas de planes y aceptación legal): sin commit ni aplicar; al cierre rompía el typecheck. Debe terminarlo y revisarlo su autor.
