# Matriz funcional de quinielas — código real vs. legado (2026-10-12)

Construida a partir del código y las migraciones del repositorio (rama `feat/api-football-connector`, 23 migraciones sincronizadas en QA) y de `references/legacy-quiniela/` (PHP, solo lectura). No sustituye a los ADR. Estados: **IMPL** (implementada y probada), **PARCIAL**, **PENDIENTE**, **FUERA_MVP**.

## 1. Núcleo de quinielas

| Función | Reglas clave | Dónde (SQL / UI) | Pruebas | Estado | Acción |
| --- | --- | --- | --- | --- | --- |
| Registro/acceso a ligas | Código de 6 caracteres, aprobación, retirada | `join_pool`, `pool_join_codes`, `JoinView`, `JoinLeagueView` | `phase-04-join-pool.sql`, Vitest, E2E mvp | IMPL | Mantener |
| Administración de quinielas/participantes | Capacidad por tenant/`pool_staff`, `manage_pool`, `approve_participant` | `AdminView`, RPC Fase 05 | `phase-05-admin-rpc.sql` | IMPL | Mantener |
| Estado manual de pago | `participants.payment_status` (manual, sin dinero) | `set_participant_payment_status` | `phase-05-admin-rpc.sql`, `finance-privacy.sql` (nuevo) | IMPL (solo estado) | Mantener; «Mis finanzas» solo lectura |
| Catálogo y equipos | Catálogo central Wikidata, inscripción equipo-torneo, banderas MIT, sin escudos de clubes | `catalog_*`, `import_catalog_*`, `CatalogTeamPicker` | SQL catálogo 71+74, E2E catálogo 41/41 | IMPL | Mantener |
| Jornadas, partidos, horarios | `upsert_round/match`, `set_pool_match`, lock persistido | `AdminFixtureView` (`/admin/parrilla`) | Fase 06 95/95, lock 51/51 | IMPL (falta UAT móvil) | Mantener |
| Cierre/lock servidor | Hora del servidor; sin DML de `authenticated` sobre calendario | `tg_pool_matches_set_lock`, ADR-011 | lock 51/51, E2E | IMPL | Mantener |
| Pronósticos y privacidad | `save_prediction`, ocultos hasta el lock (`can_read_prediction`) | `PoolView`, `PredictionMatchCard` | E2E 27/27 | IMPL | Mantener |
| Tickets gratuitos | Cupo por jornada, borrador/envío/cancelación, idempotencia, concurrencia | `create_ticket`, `submit_ticket`, `cancel_ticket`, `PoolTicketsPanel` | tickets 72/72, E2E 24/24 | IMPL | Mantener (ADR-014 etapa 1) |
| Resultados oficiales y recálculo | Revisión más reciente; idempotente; 409 por revisión obsoleta | `publish_official_result`, `_recalculate_match_scoring` | Fase 06, E2E | IMPL | Mantener |
| Resultados híbridos | Manual por defecto; `auto_results` apagado; el proveedor nunca pisa un resultado manual | `results_mode`, `provider_*`, `sports-sync` (no desplegada) | SQL 74, E2E catálogo | IMPL (inactivo por decisión) | Mantener apagado |
| Scoring configurable | `pool_rules` exacto/resultado/desempate/bonos, versionado | `publish_pool_rules`, `scoring_events` | Fase 06/08 | IMPL | Mantener |
| Rankings | General/jornada/rachas; mejor ticket elegible; excluye admins y retirados | `pool_leaderboard`, `pool_ticket_leaderboard` | Fase 08 24/24 | IMPL | Mantener |
| Estadísticas del jugador | Evolución, «Mis puntos» | `pool_points_evolution`, `my_points_summary`, `PointsView` | Fase 08 | IMPL | Mantener |
| Admin ≠ participante | Incompatibilidad histórica (ADR-015) | `participation_competes`, `pool_admin_exclusions` | admin-participante 87/87 | IMPL | Mantener; verificar en UI |
| Auditoría | `audit_log` append-only | `tg_audit_row_change` | privilegios 23/23 | IMPL | Mantener |
| Planes Free/PRO y branding | Entitlements server-side, activos privados | `tenant_entitlements`, Edge Functions de branding | Fase 05 | IMPL (Edge Functions desplegadas en QA) | Mantener |
| Flyers y compartir | Canvas nativo, Web Share con descarga de respaldo | `lib/flyer.ts`, `ShareFlyerButton` | `flyer.test.ts`, `share.test.ts` | IMPL (falta UAT móvil) | Mantener |
| Elo + Poisson y auto-fill | `team_ratings`/`model_predictions` existían sin lógica | `20261021000100` (propuesta) | suite propia en rollback | PARCIAL → ver informe | En curso |
| Solicitud «Crear mi propia quiniela» | Sin autoelevación (ADR-017) | `20261020000100` (propuesta) + perfil | suite propia en rollback | PARCIAL → ver informe | En curso |
| PWA + Capacitor | Service worker manual, sin cachear datos privados | `public/`, `mobile/` | Vitest dirigido | PARCIAL (build nativo BLOCKED_EXTERNAL) | En curso |

## 2. Comparación con el legado PHP

| Concepto legado | Legado | Producto actual | Diferencia / decisión |
| --- | --- | --- | --- |
| Pronóstico | Solo `L/E/V` por partido | Marcador exacto, puntos por exacto y por resultado, configurable | El 1X2 sigue derivándose del marcador. **No** se reintroduce L/E/V suelto; dobles/triples no aprobados. |
| Puntuación | 1 punto por acierto | `exact_points` / `outcome_points` / bonos por quiniela, versionado | Mejora aprobada (ADR-003/005). |
| Solo tickets pagados cuentan | `PAID` | Etapa 1 gratuita: cuentan los tickets `submitted` elegibles | El cobro automático queda **FUERA_MVP**; el estado manual de pago no condiciona el ranking hoy. Decisión de producto pendiente (fase comercial D13). |
| Ganadores y premios | 1.º/2.º con porcentaje sobre lo recaudado | No existe; no hay dinero en el MVP | **FUERA_MVP** (escrow/wallet/pagos). Sin cifras ficticias. |
| Desempate | Orden de creación del ticket | Regla `tie_breaker` configurable por quiniela + criterios del ranking | Mantener los contratos implementados; no cambiar sin ADR (§12 AGENTS). |
| Recalcular | Borra y reinserta `round_ticket_scores` | `scoring_events` versionados, idempotentes por revisión | Mejor: sin duplicar puntos. |
| Múltiples tickets por usuario y jornada | Sí | Sí, con cupo `max_tickets_per_participant` | Equivalente. |
| Estados de ticket | `PENDING/PAID/REJECTED/CANCELLED` | `draft/submitted/cancelled` (ADR-014) | No se inventan estados de pago. |
| Panel y verificador | Panel global PHP | Panel de organizador por tenant con RLS | Sin panel global en la app principal (ADR-018). |
| CSRF/autorización por sesión PHP | Sesión/CSRF | JWT + RLS + RPC `SECURITY DEFINER` | No se copia nada del legado. |
