# FASE 02 — ARQUITECTURA, CONTRATOS Y ADRS

## Rol
Actúa como **Principal Architecture Agent**.

## Misión
Cerrar las decisiones necesarias para que Data, Frontend, Domain, Stats y Mobile puedan desarrollar en paralelo sin inventar contratos incompatibles.

## Entradas
Lee el reporte de Fase 01, PRD, requirements, `AGENTS.md` y ADRs existentes.

## Trabajo requerido
- definir topología real del repositorio y responsabilidades de `apps/platform`, `packages/domain`, `packages/ui`, `supabase`, `mobile`;
- modelar actores: owner/admin/member y relaciones tenant/membership;
- definir entidades principales: tenant, profile, membership, pool/quiniela, tournament, round, team, match, prediction, scoring_rule, standing/snapshot o estrategia equivalente, participant_status, branding y audit event;
- documentar qué datos son tenant-owned y cómo se deriva acceso;
- definir RPCs/operaciones críticas que deben ser server-authoritative: join, save prediction, publish result, recalc scoring, etc.;
- definir state machines para quiniela y partido (`open/locked/live/final` o equivalente);
- definir contrato de lock usando tiempo DB;
- definir estrategia de corrección de resultado + recálculo idempotente;
- definir límites FREE/PRO y dónde se hacen cumplir;
- definir estrategia de deep links y navegación web/mobile;
- producir diagramas Mermaid de contexto, componentes y flujo de pronóstico/scoring;
- crear/actualizar ADRs necesarios.

## Decisiones que deben quedar explícitas
- IDs (UUID), timestamps y zona horaria;
- estrategia de membership/roles;
- visibilidad de pronósticos ajenos;
- cómo se representa scoring configurable;
- si leaderboard es view/materialized table/computado y por qué;
- boundaries entre SQL y TypeScript;
- estrategia de storage para logos/banners/flyers.

## Entregables
- `reports/architecture/phase-02-architecture.md`;
- actualizaciones en `docs/architecture/**` y ADRs;
- contratos que Fase 03 pueda implementar sin ambigüedad;
- `PROJECT_STATE.md` + handoff.

## Criterios de aceptación
- [ ] ownership de datos y RLS son inequívocos;
- [ ] operaciones críticas tienen contrato;
- [ ] estados y transiciones están definidos;
- [ ] no hay dos fuentes de verdad para scoring/lock;
- [ ] decisiones estructurales están en ADR;
- [ ] agentes siguientes pueden trabajar sin inventar interfaces.
## Instrucciones generales de ejecución

1. **Inspecciona antes de editar.** Lee los archivos relacionados y el historial/reportes existentes.
2. Enumera brevemente los archivos que planeas modificar y por qué.
3. Implementa código real y mínimo para cumplir la fase; no dejes pseudocódigo como entrega final.
4. No cambies decisiones estructurales aceptadas sin ADR.
5. Ejecuta los tests/comandos pertinentes y registra salida resumida real.
6. Si algo no puede ejecutarse por falta de credenciales/servicios, separa claramente `NO EJECUTADO` de `FALLÓ`.
7. Actualiza `PROJECT_STATE.md`.
8. Crea el reporte de fase indicado y un handoff usando `docs/agents/HANDOFF-TEMPLATE.md`.
9. Termina al completar esta fase. No ejecutes la siguiente.

## Formato obligatorio de la respuesta final del agente

### Resultado
`COMPLETED | PARTIAL | BLOCKED_ADR | BLOCKED_EXTERNAL`

### Cambios realizados
- archivo — cambio

### Validación ejecutada
- comando/test — resultado

### Criterios de aceptación
- [x]/[ ] criterio

### Riesgos o deuda restante
- ...

### Handoff
- siguiente agente/fase permitida
- dependencias o bloqueos

