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
