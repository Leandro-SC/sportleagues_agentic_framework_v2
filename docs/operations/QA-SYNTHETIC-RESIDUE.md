# Residuo sintético en Supabase QA (`juoftaofzepxbrrxbkhx`)

Inventario al 2026-10-11 (tras la remediación H1–H6 y la migración de Fase 06). No es producción. Todo lo listado es sintético y **no se puede borrar** por diseño (H2/ADR-015: partidos, participantes, pronósticos, resultados, `audit_log` y exclusiones son inmutables o append-only). Eliminarlo exigiría desactivar guardas de integridad: no se hace.

| Concepto | Cantidad | Cómo reconocerlo |
| --- | --- | --- |
| Usuarios de Auth sintéticos | 194 | `email LIKE '%@example.test'` (sin contraseña conocida; los de `concurrency.mjs` usan una aleatoria no guardada) |
| Usuarios reales (se conservan) | 5 | `email LIKE '%@gmail.com'`; incluye el único `platform_admin` real |
| Tenants | 41 (2 de semilla: «Tenant A/B») | nombres `L10…`, `A20…`, `S6…`, `M…`, `C-xxxxxxxx`, `X…` |
| Quinielas / partidos / pronósticos | 110 / 35 / 33 | cuelgan de los tenants sintéticos |
| `audit_log` | ~1 375 filas | append-only; incluye eventos de pruebas |
| `legacy_admin_conflicts` | 2 abiertos (owner-a, owner-b: conflictos heredados reales de la semilla, D18) + 3 regularizados (suite 30) | |
| `platform_admins` sintéticos | 6, todos revocados (`revoked_at`) | |

## Origen y regla para evitar más residuo

El residuo proviene de las suites históricas con helpers (`10`, `20`, `30`) ejecutadas **en modo commit** y de `concurrency.mjs`.

1. **Toda suite SQL nueva** corre con `node scripts/qa/run-sql-suite.mjs <suite.sql> [--with-migration <archivo>]`: una transacción que termina en excepción controlada (rollback). Resultado verificado: 0 filas persistidas. Las suites `10`, `20`, `30` y `phase-06-sports-foundation` ya usan este modo.
2. Las suites `phase-03…05bis` usan `BEGIN … ROLLBACK` propio.
3. Solo `scripts/qa/remediation/concurrency.mjs` persiste datos (necesita sesiones reales de Auth). Se ejecuta lo imprescindible (cambios en locks/inscripción) y cada ejecución se anota aquí: 2026-10-11, 4 ejecuciones adicionales del caso LOCK (`ONLY=c5`) al corregir `20261013000200` (≈1 tenant + 2 usuarios por ejecución).
4. No crear nunca datos sin etiqueta reconocible (`@example.test`, nombre de tenant con prefijo de suite).

## Producción
D22 (baja/offboarding de tenants y supresión de PII) sigue **pendiente** como requisito previo a producción comercial: `docs/operations/D22-TENANT-OFFBOARDING-DRAFT.md`. Este residuo no se migra: producción se crea desde cero con las migraciones.

## Ejecuciones registradas de E2E real (`scripts/qa/e2e/mvp-flow.mjs`)

2026-10-11: 3 ejecuciones (tenants `E2E-xxxxxxxx` y `E2E-xxxxxxxx-B`, 5 usuarios `e2e-*@example.test` cada una). Totales de arriba no actualizados: sumar ≈ 6 tenants y 15 usuarios.

2026-10-11 (bloque Fase 07/08): +2 ejecuciones de `mvp-flow.mjs` (total 5): ≈ 10 tenants `E2E-*` y 25 usuarios `e2e-*@example.test` en conjunto.

2026-10-11 (Fase 08 stats): +1 ejecución de `mvp-flow.mjs` (total 6).

2026-10-11 (tickets Etapa 1): +1 ejecución de `scripts/qa/e2e/tickets-flow.mjs` (tenant `TKE-*`, 6 usuarios `tke-*@example.test`).

2026-10-11/12 (tickets): +2 ejecuciones de `tickets-flow.mjs` y +1 de `mvp-flow.mjs` (total: tickets-flow 2, mvp-flow 7).

2026-10-12 (catálogo híbrido): +1 ejecución de `catalog-flow.mjs` (tenants `CAE-*`, 5 usuarios `cae-*@example.test`), +1 de `mvp-flow.mjs` y +1 de `tickets-flow.mjs` (regresión). `catalog-concurrency.mjs` limpia su propio registro de `catalog_import_jobs` (una ejecución previa dejó un registro `conc-test:*` que se eliminó manualmente). El catálogo cargado en QA (`provider='wikidata'`) es dato real de fuente abierta, no residuo.

2026-10-12 (verificación posterior a `20261022000100`, por decisión del propietario): +1 ejecución de `mvp-flow.mjs` (tenants `E2E-14c8af65` y `-B`, 5 usuarios `e2e-*@example.test`) y +1 de `tickets-flow.mjs` (tenant `TKE-b2ba4334`, 6 usuarios `tke-*@example.test`). Resultado 32/32 y 24/24. Totales: mvp-flow 8, tickets-flow 3. Las suites SQL de regresión corrieron en modo rollback (0 filas persistidas).

## Identidades fijas y prueba integral (`scripts/qa/e2e/full-lifecycle.mjs`)

2026-10-12: a partir de aquí las pruebas E2E/UAT **no crean cuentas nuevas**: reutilizan 5 identidades sintéticas fijas (`scripts/qa/lib/qa-identities.mjs`, contraseña aleatoria nueva por ejecución, en memoria): `qa-requester@example.test`, `qa-admin-b@example.test`, `qa-user1@example.test`, `qa-user2@example.test`, `qa-outsider@example.test` (perfiles `qa-requester`, `qa-admin-b`, `qa-user1`, `qa-user2`, `qa-outsider`). Esas 5 cuentas se crearon en la 1.ª ejecución y no se vuelven a crear. Tampoco se borran (tablas append-only).

| Ejecución | Etiqueta | Resultado | Residuo nuevo |
| --- | --- | --- | --- |
| 1 (2026-10-12) | `LIFE-79c250f5` | 143/143 PASS | 5 cuentas (únicas), tenants `LIFE-79c250f5` (organizador `qa-requester`, aprobado por el operador) y `LIFE-79c250f5-B` (`qa-admin-b`), 3 solicitudes (2 aprobadas, 1 rechazada de `qa-user2` con cooldown de 7 días vigente), 2 torneos, 2 jornadas, 5 partidos, 2 quinielas, 3 participaciones, 4 tickets (1 cancelado), 9 pronósticos, 1 resultado (2 revisiones, 6 eventos de puntos), 3 corridas de `stats_rating_runs`, 1 fila de `maintenance_runs` (dry-run) |
| 2 (2026-10-12) | `LIFE-133d7ab8` | 128 PASS, 15 SKIPPED(already organizer), 0 FAIL | 0 tenants/cuentas/solicitudes nuevos (reutiliza ambos tenants; las 2 quinielas de la ejecución 1 quedaron `archived`); 2 torneos, 2 jornadas, 5 partidos, 2 quinielas, 3 participaciones, 4 tickets, 9 pronósticos, 1 resultado, 3 corridas de ratings y 1 fila de `maintenance_runs` |

Totales de esta prueba (verificados con consultas de conteo): 5 cuentas fijas; 2 tenants `LIFE-*`; 4 quinielas, 4 torneos y 10 equipos manuales `LIFE-*` (más 2 selecciones del catálogo vinculadas al tenant del solicitante); 6 participaciones, 8 tickets, 18 pronósticos; `pool_creation_requests` global = 2 aprobadas + 1 rechazada; 5 filas `purge_fixture_sync_log` en `maintenance_runs` (incluye 3 previas). Cada ejecución adicional añade lo de la fila «2» (2 torneos, 5 partidos, 2 quinielas, etc.) y NO añade cuentas ni tenants mientras `qa-requester` y `qa-admin-b` sigan siendo organizadores. Máximo de ejecuciones acordado para esta prueba: 2.

## Eliminación de cuenta (`scripts/qa/e2e/account-deletion.mjs`, ADR-026)

Única excepción a la regla de identidades fijas: probar la baja exige una cuenta que se pueda eliminar. Cada ejecución crea **una** cuenta
`qa-delete-<marca>@example.test` y la elimina con el flujo real. El usuario de Auth queda borrado en modo suave (correo anonimizado,
sesiones revocadas) y su perfil queda como «Usuario eliminado» con `deleted_at`. No pertenece a ningún tenant, así que no deja filas en
`audit_log`.

| Ejecución | Resultado | Residuo nuevo |
| --- | --- | --- |
| 1 (2026-10-24) | 8/8 PASS | 1 usuario de Auth borrado en modo suave + 1 perfil «Usuario eliminado» |

Las suites SQL `scoring-rules-integrity`, `tenant-brand-name`, `result-notifications` y `account-deletion` corren en modo rollback (0 filas).
La migración `20261024000100` añadió en QA, una sola vez, la regla estándar 3/1 a las quinielas abiertas que no tenían reglas, y eventos
de puntos con la versión vigente en las quinielas con versiones mezcladas (dato derivado, no residuo de prueba).

2026-10-24 (regresión tras `20261024000100`–`000600`): +1 `mvp-flow.mjs` (tenants `E2E-bb947e69` y `-B`, 5 usuarios `e2e-*@example.test`,
32/32) y +1 `tickets-flow.mjs` (tenant `TKE-52cc8447`, 6 usuarios `tke-*@example.test`, 24/24). Nuevo residuo derivado: 12 filas de
`notifications` generadas por el trigger (4 en `E2E-bb947e69`, 8 en `TKE-52cc8447`). Totales: mvp-flow 9, tickets-flow 4.

## UAT de navegador (`scripts/qa/uat/**`, 2026-10-24)

Reutiliza las 5 identidades fijas (no crea cuentas). Residuo: jornadas y partidos «UAT R…» y «UAT Jornada …» (un resultado publicado por
cada corrida del bloque b1); tickets de qa-user1 (2 vigentes, el resto cancelados) y sus pronósticos; un pronóstico de qa-user2 en la quiniela
B; qa-user2 y qa-outsider quedaron como participantes de la quiniela B; 3 solicitudes «Crear mi propia quiniela» de qa-user1, canceladas;
unos 5 códigos de unión de la quiniela B. `requires_approval` de la quiniela B se activó temporalmente y se restauró (verificado: false, open).
