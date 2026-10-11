# HANDOFF — Fase 06: base deportiva

- Agente: Orchestrator (sportleagues-dev) con Data/RLS, Domain, Frontend, QA, Security
- Estado: PARTIAL (falta UAT manual de la UI)

## Objetivo
Desbloquear Fase 06: aceptar ADR-015 y ADR-009–012, y construir equipos dinámicos, jornadas, fixtures, horarios, resultados y compatibilidad con APIs futuras.

## Archivos modificados
- Migraciones: `supabase/migrations/20261013000100_phase_06_sports_foundation.sql`, `20261013000200_h1_lock_transition_clock_after_row_lock.sql`.
- Pruebas: `supabase/tests/phase-06-sports-foundation.sql` (nueva), `supabase/tests/proposed/{00-readonly-baseline,10,30}`, `scripts/qa/run-sql-suite.mjs` (nuevo, modo rollback), `scripts/qa/remediation/concurrency.mjs`.
- Frontend: `lib/sports-admin.ts(+test)`, `composables/useSportsAdmin.ts(+test)`, `views/AdminFixtureView.vue(+test)`, `router.ts`, `router.test.ts`, `views/AdminView.vue`.
- Docs: ADR-009/010/011/012/015 (aceptados), `docs/operations/QA-SYNTHETIC-RESIDUE.md`, `reports/admin/phase-06-tournaments-matches.md`, `PROJECT_STATE.md`.

## Contratos/API afectados
Nuevas RPC listadas en el reporte de fase (todas `SECURITY DEFINER`, `search_path=''`, autorización owner/admin del tenant, sin EXECUTE para `anon`). Clientes pierden INSERT/UPDATE/DELETE sobre `tournaments`, `teams`, `rounds` (ya perdidos en `matches`/`pool_matches`). Regla nueva: ambos equipos de un partido deben estar inscritos en su torneo y la jornada pertenecer al torneo.

## Decisiones
Migración incremental sobre las 14 existentes; ADR-014 sigue Proposed; D22 pendiente para producción comercial; el historial de `scoring_events` se conserva por revisión (Fase 08 lee la más reciente); escudos propios y estados cancelado/pospuesto diferidos.

## Tests ejecutados
Ver `reports/admin/phase-06-tournaments-matches.md` (todo ejecutado realmente contra QA o Vitest).

## Riesgos / limitaciones
UI sin UAT manual; ciclo `down/` no validado; sin proyecto descartable no hay prueba de instalación limpia; `concurrency.mjs` deja residuo (registrado).

## Bloqueos
Ninguno que impida continuar.

## Próximo paso permitido
UAT manual de `/admin/parrilla` en QA; luego Fase 07 (pronósticos y locks desde la UI del jugador, `ActiveContext`). No implementar tickets/pagos (ADR-014 Proposed).
