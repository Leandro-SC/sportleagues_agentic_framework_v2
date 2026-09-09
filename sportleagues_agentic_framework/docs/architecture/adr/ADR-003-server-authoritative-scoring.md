# ADR-003 — Locks y scoring autoritativos en servidor

- Estado: Accepted

## Decisión

El cierre de pronósticos, validación de resultados y cálculo/recalculo de puntos se ejecutan en PostgreSQL/RPC transaccional. La UI solo refleja el estado.

## Razón

Evita manipulación del reloj/cliente y divergencias de puntaje.
