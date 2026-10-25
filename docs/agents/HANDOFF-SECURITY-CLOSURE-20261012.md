# HANDOFF — Cierre de seguridad F-04, roles, solicitud de quiniela, Elo+Poisson, PWA (2026-10-12)

- Agente: coordinador/arquitecto + frontend, data/RLS, domain, mobile y security (subagentes)
- Estado: **DONE_PENDING_UAT** (código y pruebas cerrados; UAT móvil humana pendiente). Informe único: `reports/release/closure-board-20261012.md`.

## Objetivo
Ejecutar el Encargo Maestro: cerrar riesgos de seguridad, terminar la app de dos roles y preparar las fases 09/11/12, sin aplicar a QA nada no autorizado ni desplegar.

## Archivos modificados (por dominio)
- **Seguridad/BD:** `supabase/migrations/20261022000100_security_followups.sql` (aplicada solo en QA); `supabase/proposed/down/20261022000100_*.down.sql`; suites `supabase/tests/{security-followups,security-followups-down,finance-privacy}.sql`; `reports/security/*`; `vercel.json`; `supabase/functions/csp-report/**`; `scripts/qa/{purge-fixture-sync-log,qa-accounts}.mjs`; `package-lock.json`; `scripts/verify-preview-bundle.mjs`.
- **F-05 (propuesto):** `supabase/proposed/20261023000100_provider_access_and_quota.sql` (+down), `supabase/tests/provider-access-quota.sql`, `supabase/functions/sports-sync/**`, `supabase/functions/_shared/sports/**`, `supabase/config.toml` (comentario).
- **Solicitud de quiniela (propuesto):** `supabase/proposed/20261020000100_pool_creation_requests.sql` (+down), `supabase/tests/pool-creation-requests.sql`, runbook de operador.
- **Elo+Poisson (propuesto):** `supabase/proposed/20261021000100_stats_elo_poisson.sql` (+down), `supabase/tests/stats-elo-poisson.sql`, `docs/architecture/STATS-ENGINE-CONTRACT.md`.
- **Frontend:** `apps/platform/src/{router.ts,lib/*,composables/*,components/*,views/*,test-support/*}`, `main.ts`, `index.html`, imágenes optimizadas (`assets/`).
- **PWA/móvil:** `apps/platform/public/{manifest.webmanifest,sw.js,offline.html,icons/}`, `lib/pwa.ts`, `mobile/**`.
- **Docs:** ADR-017…021, `docs/product/{FUNCTIONAL-MATRIX-QUINIELAS,UI-PERMISSIONS-MATRIX}.md`, `docs/testing/{MOBILE-FIRST-ACCEPTANCE,UAT-MOBILE-AUTHENTICATED}.md`, runbooks, `PROJECT_STATE.md`, `docs/agents/RESUME_STATE.md`.

## Contratos/API afectados
- RLS: `participants` solo legible por fila propia, admin del tenant o capacidad `finance` de esa quiniela (aplicado en QA). `anon` sin SELECT en `participants`/`audit_log`.
- Nuevas RPC (propuestas, sin aplicar): `request_pool_creation`, `my_pool_creation_request`, `cancel_pool_creation_request`, `review_pool_creation_request` (solo service_role), `suggest_scoreline`, `rebuild_team_ratings` (solo service_role), `provider_reserve`/`provider_settle` (solo service_role). Aplicada: `purge_fixture_sync_log` (solo service_role, firma nueva).
- `/superadmin` ya no existe en la app principal (ADR-018).

## Decisiones
ADR-018 Accepted; ADR-020 Accepted para QA; ADR-017/019/021 Proposed. Límites de cuota de F-05 y política de enfriamiento de la solicitud: pendientes de validación del propietario.

## Tests ejecutados
Ver el tablero de cierre: typecheck, 74 archivos / 659 tests, build, `verify:bundle`, `npm audit` 0, 609/609 SQL en QA (rollback) y E2E reales 32/32 + 24/24.

## Riesgos / limitaciones
Sin UAT móvil; concurrencia real de las propuestas sin probar; `service_role` es confianza total; el cron de la purga no puede correr como `postgres` (guarda por claim); residuo sintético de QA documentado.

## Bloqueos
Autorizaciones de merge, aplicación de propuestas, despliegues y producción; compilación Android (SDK/JDK); inventario de `auth.users` (PII, denegado por el clasificador) e invitación externa.

## Próximo paso permitido
Ninguna tarea técnica desbloqueada sin autorización; ejecutar UAT humana y decidir sobre las autorizaciones del tablero.
