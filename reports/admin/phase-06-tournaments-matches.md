# Fase 06 — Torneos, jornadas, equipos y partidos (base deportiva)

Estado: **PARTIAL** — base de datos, RPC y pruebas completas y verificadas en QA; la UI está implementada y probada con Vitest, pero **no se ejecutó un recorrido manual en navegador contra QA** (NO EJECUTADO, no FALLÓ). Rama `integration/v2-roles-tickets-income`. ADRs: 009–012 y 015 aceptados (014 sigue Proposed).

## Migraciones (16/16 sincronizadas en QA)
- `20261013000100_phase_06_sports_foundation.sql`: `sports`; metadatos de torneo/equipo; `tournament_teams` + `matches_enrolment_guard`; `external_refs` (proveedor + id externo, por tenant, para futuras APIs); RPC `upsert_tournament`, `upsert_team`, `set_tournament_team`, `upsert_round`, `reorder_rounds`, `upsert_match`, `delete_match`, `set_pool_match`, `set_external_ref` (también `service_role`), `publish_official_result` + `_recalculate_match_scoring` (interno). Sin DML directo de clientes sobre torneos/equipos/jornadas/partidos/pool_matches/resultados.
- `20261013000200_h1_lock_transition_clock_after_row_lock.sql`: corrige una carrera real del lock (ver ADR-015).

## Criterios de aceptación
- [~] Organizador puede crear parrilla completa: RPC verificadas (95 aserciones) y vista `/admin/parrilla` probada con Vitest; falta UAT manual.
- [x] Kickoff/lock consistentes: lock persistido; reprogramar desplaza el lock; con un lock vencido el calendario se congela.
- [x] Resultados oficiales por operación autorizada con revisión esperada.
- [x] Correcciones con recálculo idempotente (sin duplicar eventos; historial por revisión).
- [x] RLS impide operación cross-tenant (pruebas negativas por rol/tenant/RPC/DML directo).
- [x] Hardening ADR-015 aplicado (lock/horarios inmutables, `audit_log` inmutable).

## Pruebas reales (QA, sin dejar datos)
Fase 06 **95/95**; lock 51/51; privilegios/auditoría 23/23; admin-participante 87/87; línea base 14/14; 6 suites históricas OK; concurrencia caso LOCK 8/8 tras la corrección; `typecheck`, 40 archivos / 274 tests, `verify:bundle` OK.

## Gaps documentados (no inventados)
Partido cancelado/pospuesto no existe en el contrato (`match_status` = scheduled/live/final). Escudos propios (bucket `team-assets`) diferidos (ADR-009 §4). `/partidos` sigue con datos de vista previa hasta Fase 07 (ADR-010). Sincronizador de proveedor externo: solo existen `external_refs` y `apply_fixture_update`; sin proveedor ni Edge Function.
