# HANDOFF — ADR-014 tickets multi-tenant (diseño)

- Agente: Architect (orquestado con sportleagues-dev)
- Estado: DONE (diseño, `Proposed`); implementación BLOCKED hasta aprobar decisiones D1–D13

## Objetivo
Diseñar tickets, pagos manuales y ledger compatibles con quinielas, jornadas, pronósticos, scoring e ingresos.

## Archivos modificados
- `docs/architecture/adr/ADR-014-multi-tenant-tickets-payments-and-ledger.md` (nuevo)
- `docs/architecture/ADR-014-ANNEX-tickets-technical-design.md` (nuevo)
- `docs/architecture/README.md`, `PROJECT_STATE.md`, este handoff

## Contratos/API afectados
Ninguno aplicado. Propuestos: `pool_rounds`, `tickets`, `payments`, `ledger_entries`, `idempotency_keys`, `predictions.ticket_id`, RPC de tickets/pagos/ingresos.

## Decisiones
Ver ADR-014 (selecciones = `predictions` con `ticket_id`; ledger append-only; RPC sin importes del cliente). Contradicciones C1–C8 con resolución propuesta.

## Tests ejecutados
Ninguno (solo documentación). `git diff --check`: ejecutado, ver PROJECT_STATE.

## Riesgos / limitaciones
Alcance por quiniela inexistente en el modelo de roles actual (C8/D7). Capacidad del punto caliente `ticket_seq` sin benchmark. Dinero registrado excede el alcance literal de AGENTS §3 hasta aprobar D1.

## Bloqueos
Aprobación de D1–D13 y aceptación de ADR-009–012 (Fase 06).

## Próximo paso permitido
Revisión Security/Data del ADR; aprobar decisiones; recién entonces Fase 06 (M1). Sin migraciones hasta entonces.
