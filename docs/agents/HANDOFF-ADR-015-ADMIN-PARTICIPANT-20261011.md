# HANDOFF — ADR-015 integridad e incompatibilidad administrador/participante (diseño)

- Agente: Architect (con Product, Security, Data, Backend)
- Estado: DONE (diseño `Proposed`); implementación BLOCKED hasta aprobar autorizaciones de la auditoría (A–E) y D17–D20

## Objetivo
Registrar la regla aprobada y diseñar controles de servidor, flujos seguros, concurrencia y pruebas, sin sustituir H1–H6.

## Archivos modificados
`docs/architecture/adr/ADR-015-…` (nuevo), `ADR-014` (+ review y anexo, solo referencias), `docs/product/PRD-MVP.md`,
`docs/requirements/02-auth-tenancy.md`, `03-predictions-scoring.md`, `docs/testing/02-test-matrix.md`,
`prompts/mvp/phase-05…08`, `docs/architecture/README.md`, `PROJECT_STATE.md`, este handoff.

## Decisiones
Incompatibilidad actual e histórica por quiniela desde `opened_at`; triggers + bloqueo asesor por `(pool, perfil)`;
exclusiones append-only; retirada solo antes del primer lock; transferencia auditada; sin excepción ni override.

## Tests ejecutados
Ninguno (documentación). Casos INC-01…C4 definidos en ADR-015 §8.

## Riesgos / limitaciones
Dos cuentas del mismo humano no son detectables. Conflictos heredados en QA. Rechazos no auditables dentro de la transacción fallida.

## Bloqueos
D17–D20; autorizaciones A–E del informe de auditoría; sin ejecución en base descartable.

## Próximo paso permitido
Re-revisión Security/Data de ADR-015; con autorización, migración R1–R6 + incompatibilidad como archivos y suite en base descartable.
