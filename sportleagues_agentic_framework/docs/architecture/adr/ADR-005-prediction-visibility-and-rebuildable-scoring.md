# ADR-005 - Revelacion de pronosticos y scoring reconstruible

- Estado: Accepted
- Fecha: 2026-09-08
- Decisores: Architecture Agent

## Contexto

El baseline no fijaba si los pronosticos ajenos se revelaban al inicio o al lock. El MVP exige lock autoritativo, privacidad previa y recalculo idempotente.

## Decision

Lock y revelacion son `match.starts_at - pool.lock_offset`. Desde ese instante inclusive, participantes autorizados pueden leer pronosticos ajenos; antes solo el propietario lee el suyo. RLS/RPC aplican la condicion con tiempo PostgreSQL. Resultados, predicciones y regla versionada son inputs; scoring events es proyeccion reconstruible reemplazada en transaccion por alcance, sin acumulacion incremental. Leaderboards se derivan por query/view hasta que evidencia justifique snapshots.

## Consecuencias

Fase 03 prueba fuga negativa de privacidad y unicidad. Fase 08 prueba recalc repetido y correccion de resultado. Cambiar umbral o materializar ranking requiere ADR.
