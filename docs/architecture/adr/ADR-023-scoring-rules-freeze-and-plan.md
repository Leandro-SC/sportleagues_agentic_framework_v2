# ADR-023 — Reglas de puntuación congeladas al primer lock y puntuación estándar en FREE

- Estado: **Accepted para QA** (2026-10-24, autorización completa del propietario para aplicar las correcciones del diagnóstico). Migración `supabase/migrations/20261024000100_scoring_rules_integrity.sql`, aplicada en QA (28/28); reversión en `supabase/proposed/down/20261024000100_scoring_rules_integrity.down.sql`. Producción: nada aplicado.
- Origen: diagnóstico del proyecto del 2026-10-24 (hueco de integridad del scoring frente a AGENTS.md §6 y entitlement FREE/PRO del PRD).
- Relacionados: ADR-003 (scoring en servidor), ADR-005 (scoring reconstruible), ADR-006 (entitlements en servidor), ADR-011 (autoridad del lock), ADR-012 (revisión de resultados y recálculo idempotente), ADR-015 (integridad de la quiniela).
- Impacto AGENTS.md §12: modifica reglas de scoring. No cambia esquema, autorización ni API pública (la firma de `publish_pool_rules` se conserva; se añaden `pool_rules_policy` y `rescore_pool`).

## Contexto

1. `publish_pool_rules` permitía publicar una versión nueva en cualquier momento, también con partidos ya cerrados o puntuados.
   `_recalculate_match_scoring` puntúa con la regla vigente **al publicar cada resultado**: tras un cambio a mitad de torneo,
   los partidos ya puntuados conservaban la versión anterior y los nuevos usaban la nueva. El ranking mezclaba versiones.
2. El PRD reserva la puntuación personalizable a PRO («FREE: scoring estándar»), pero el servidor no lo imponía.
3. Al crear una quiniela no se creaba ninguna regla. Una quiniela abierta sin reglas publicadas puntuaba 0 en silencio, porque
   el `join` con la regla vigente no devolvía filas.
4. `bonus_rules` se guardaba, pero ningún motor lo usa.

## Decisión

1. **Congelación.** La versión vigente no puede sustituirse una vez alcanzado el primer lock de la quiniela
   (`_first_lock_passed`) o publicado cualquier resultado oficial de sus partidos. La RPC responde `42501` con la pista
   `RULES_FROZEN`. Republicar exactamente la regla vigente es idempotente y no crea versión. Como defensa, un trigger en
   `pool_rules` impide la misma operación por DML directo (también a `service_role`/propietario) y hace inmutables las filas
   publicadas, salvo retirar la vigente antes de la congelación. La primera versión siempre se admite.
2. **Plan.** FREE solo publica la puntuación estándar (exacto 3, resultado 1). Otros puntos devuelven `42501`/`PRO_SCORING_REQUIRED`.
   El desempate es elegible en ambos planes. Bajar de PRO a FREE no altera reglas ya publicadas.
3. **Validación.** Puntos entre 0 y 1000 (igual que la UI) y exacto ≥ resultado. Se rechazan las bonificaciones
   (`BONUS_RULES_UNSUPPORTED`) hasta que exista un motor y otro ADR.
4. **Reglas por defecto.** Al pasar a `open` sin versión vigente, la quiniela recibe la estándar. La migración rellena una única
   vez la estándar en las quinielas no-borrador que no tenían ninguna regla.
5. **Coherencia histórica.** `rescore_pool(pool)` (solo `service_role`) re-puntúa con la versión vigente los partidos con
   resultado. Es idempotente por la clave (predicción, revisión, versión). La migración lo ejecuta una vez sobre las quinielas
   cuyos eventos mezclaban versiones.
6. **UI.** `pool_rules_policy(pool)` (solo administradores del tenant) devuelve `editable` y `custom_allowed`. `/admin` muestra
   las reglas fijas tras el lock, bloquea los puntos en FREE y traduce los rechazos. Si la RPC no existe, la UI no bloquea y el
   servidor sigue decidiendo.

## Alternativas descartadas

- **Permitir el cambio y recalcular toda la quiniela:** es coherente, pero deja que quien organiza reescriba la tabla después de ver pronósticos y resultados.
- **Congelar al abrir la quiniela:** impide corregir errores de configuración antes de que nadie haya podido pronosticar con información del partido.

## Consecuencias

- Las suites que versionaban reglas sobre la quiniela fija persistida en QA (`phase-05-admin-rpc.sql`) usan ahora una quiniela propia sin partidos.
- El E2E de ciclo de vida verifica el rechazo FREE y deriva los puntos esperados de la regla vigente.
- Evidencia: `scoring-rules-integrity.sql` 27/27 en rollback; regresión de 15 suites (1.079 casos) en verde con la migración; 6 suites históricas exit 0 tras aplicarla; en QA, 0 quinielas abiertas sin reglas y 0 con versiones mezcladas sin resolver.
