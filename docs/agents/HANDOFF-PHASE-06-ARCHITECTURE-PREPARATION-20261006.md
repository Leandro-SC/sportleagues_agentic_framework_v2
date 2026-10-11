# HANDOFF — Preparación arquitectónica de Fase 06 (pre-acceptance)

- Agente: Architecture
- Estado: DONE (documentación propuesta; sin implementación de Fase 06)

## Objetivo

Convertir las brechas de torneos, equipos, fixture, lock, resultados y multi-tenancy en decisiones
técnicas revisables, sin tocar base de datos ni conectarse a QA.

## Archivos modificados

- `docs/phase-06/ARCHITECTURE-PREPARATION-DRAFT.md`
- `docs/architecture/adr/ADR-009-tournament-team-catalog-and-crest-policy.md`
- `docs/architecture/adr/ADR-010-pool-scoped-fixture-context.md`
- `docs/architecture/adr/ADR-011-pool-lock-and-schedule-authority.md`
- `docs/architecture/adr/ADR-012-official-results-revision-and-idempotent-recalculation.md`
- Este handoff.

## Contratos/API afectados

Ninguno aplicado. Se proponen, sin crear, `manage_schedule`, `publish_official_result` y un
recálculo interno no expuesto al cliente. No se cambió la fuente Supabase de la UI.

## Decisiones

- Fixture de `/partidos` por pool activo dentro de tenant activo; contexto explícito para usuarios
  con múltiples memberships.
- Equipos tenant-owned y relación explícita `tournament_teams`; no se infiere pertenencia de los partidos.
- `lock_offset` se mantiene en pool conforme a Fase 02/ADR-005; DB conserva la autoridad.
- Resultados con revisión y recálculo transaccional idempotente.
- Escudos generados/propios, nunca logos oficiales sin licencia; futuro bucket privado separado.

## Tests ejecutados

- Inspección de contratos/ADRs y esquema ya versionado: completada.
- `git diff --check`: pendiente de ejecutar tras la escritura documental.
- No se ejecutaron gates npm: no hubo cambios de código, dependencias, configuración ni tests.
- No se ejecutó ningún comando o consulta contra Supabase QA.

## Riesgos / limitaciones

- ADR-009 a ADR-012 están `Proposed`; no sustituyen ADR aceptados ni autorizan migraciones.
- Falta decisión de producto sobre desempate de tabla deportiva y licencia/origen de assets propios.
- La lectura RLS real multi-tenant/pool no se puede validar mientras QA siga inaccesible.

## Bloqueos

Fase 05 y 05-bis siguen sin ACCEPTED por los happy paths HTTP y validación manual pendientes.
Fase 06 no puede iniciarse formalmente hasta aceptación de esos gates y de los ADR pertinentes.

## Próximo paso permitido

Revisar/aceptar o ajustar los ADR propuestos. Cuando QA vuelva y exista autorización: cerrar primero
Fase 05/05-bis, validar RLS real y después diseñar/implementar migraciones/RPC/tests de Fase 06.
