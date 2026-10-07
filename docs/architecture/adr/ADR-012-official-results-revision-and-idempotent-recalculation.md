# ADR-012 — Resultados oficiales revisables y recálculo idempotente

- Estado: Proposed
- Fecha: 2026-10-06
- Decisores: Architecture (preparación de Fase 06)

## Contexto

La Fase 03 ya tiene `official_results` con resultado único por partido, `revision` y
`scoring_events` único por predicción/revisión/regla. Falta especificar publicación, corrección,
concurrencia, permisos y auditoría para que un resultado no duplique puntaje.

## Decisión propuesta

La única mutación pública será `publish_official_result(match_id, home_score, away_score,
expected_revision)`. La RPC deriva tenant y actor desde el partido y `auth.uid()`, exige
owner/admin activo, bloquea el partido y resultado vigente, valida marcador, y publica o corrige
en una transacción. El primer publish usa revisión esperada 0; una corrección exige la revisión
actual para prevenir una actualización perdida. La fila vigente incrementa `revision` y el partido
queda `final`.

Dentro de la misma transacción llama un recálculo interno sin grant a clientes. El recálculo toma los
`pool_matches` del partido y reemplaza la proyección de `scoring_events`; no usa acumulación `+=`.
Una repetición con la misma operación/revisión es idempotente y no duplica eventos. Una corrección
reconstruye consistentemente para la nueva revisión, sin cambiar pronósticos de usuarios.

Se registra en `audit_log` actor, match, operación, revisión previa/nueva, timestamp DB y resumen
de marcador anterior/nuevo. No se registra JWT ni datos no necesarios. Superadmin no recibe acceso
implícito; cualquier excepción global queda fuera de este ADR.

## Alternativas consideradas

- INSERT/UPDATE directo de `official_results`: rechazado; evita lock, validación, auditoría y recálculo.
- Crear múltiples filas vigentes por corrección: rechazado; complica la lectura y la unicidad actual.
- Recalcular asíncronamente sin estado transaccional: rechazado para MVP; deja ventana de leaderboard
  inconsistente. Un job futuro puede repetir el recálculo como reparación idempotente.
- El cliente envía puntos calculados: rechazado por ADR-003.

## Consecuencias

La fase autorizada necesita función interna con privilegio mínimo, RPC pública con `search_path`
fijo, tests de primer resultado, repetición, corrección, conflicto de revisión, roles y tenants, y
verificación de que los leaderboards no duplican puntos. La política de historial detallado puede
ampliarse después, pero la auditoría de corrección es obligatoria desde el primer release.

## Seguridad / privacidad

Las puntuaciones son inputs validados y los permisos se resuelven server-side. RLS continúa siendo
la frontera de lectura; los grants directos de escritura a resultado/scoring permanecen revocados.

## Migración / rollback

No se modifica ninguna tabla, grant, RLS ni RPC con este ADR. La implementación futura deberá ser
forward-only y conservar la fila de resultado vigente; ante rollback funcional se deshabilita la
UI/RPC pública sin borrar resultados ni eventos existentes.
