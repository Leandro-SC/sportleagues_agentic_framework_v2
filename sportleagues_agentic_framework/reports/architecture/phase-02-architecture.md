# Fase 02 - Arquitectura, contratos y ADRs

## Resultado

`COMPLETED (PASS)` - 2026-09-08

## Entregables

- Contrato canonicamente implementable para Data/RLS, Auth, Frontend, Domain, Stats y Mobile: `docs/architecture/phase-02-contracts.md`.
- ADR-004: TypeScript y limites de modulos.
- ADR-005: umbral de revelacion, lock DB y scoring reconstruible.
- ADR-006: entitlements server-side y assets de branding privados.
- Indice de arquitectura actualizado y handoff a Fase 03.

## Decisiones cerradas

| Tema | Decision |
| --- | --- |
| Identidad/tiempo | UUID, `timestamptz` UTC, zona IANA de tenant solo para presentar y `now()` PostgreSQL para lock. |
| Tenancy | Toda fila tenant-owned porta `tenant_id`; acceso deriva de `auth.uid()` y membership, nunca de tenant enviado por cliente. |
| Roles | `owner/admin/member`, independiente de estado `paid/pending/invited`. |
| Privacidad | Pronosticos ajenos se revelan desde `lock_at` inclusive; antes solo su propietario los lee. |
| Lock | `now() < match.starts_at - pool.lock_offset`, evaluado dentro de la operacion DB. |
| Scoring | Resultados, pronosticos y regla versionada son fuente; eventos son proyeccion reconstruible y el recalc reemplaza, no acumula. |
| Leaderboard | Query/view derivada inicialmente; snapshots solo con evidencia y ADR. |
| Entitlements | Fuente `tenant_entitlements`; enforcement DB/RPC desde Fase 03 para que UI no sea frontera. |
| Assets | Storage privado tenant-scoped; SVG prohibido hasta sanitizacion; flyers locales no persistidos por defecto. |
| Navegacion | `/j/:code`, intent local no confiable a traves de Auth y `join_pool` autoritativo. |

## Contratos entregados a Fase 03

La Fase 03 puede crear schema, constraints, indices, RLS, Storage policies, seeds y tests usando sin ambiguedad las entidades, ownership, estados y RPCs definidos. Debe implementar y probar como minimo `join_pool`, `save_prediction`, `publish_official_result`, `recalculate_scoring` y el helper de enforcement de entitlements, respetando los DTOs e invariantes del contrato.

Los valores concretos del scoring estandar y los tipos de bonos no estan documentados por el PRD. No se inventaron: el schema debe permitir regla versionada y Fase 08 solo puede habilitar bonos expresamente aprobados. Esto no bloquea Fase 03, pero bloquea fijar valores de producto no especificados.

## Validacion ejecutada

| Comprobacion | Resultado |
| --- | --- |
| Revision de precedencia: AGENTS, ADRs, config, PRD, requisitos, Fase 01 y prompt de Fase 02 | PASS. |
| Revision de ownership/RLS y autorizacion de operaciones criticas contra ADR-002/003 | PASS: todos los flujos derivan actor/tenant server-side. |
| Revision de una sola fuente de verdad para lock y scoring | PASS: tiempo DB y proyeccion reconstruible transaccional. |
| Revision de Mermaid | PASS: tres diagramas con sintaxis de bloques Mermaid. |
| `git diff --check` | PASS: sin errores de whitespace. |
| Tests/build de aplicacion | `NO EJECUTADO`: Fase 01 confirmo que no hay aplicacion, manifest ni suite. |

## Criterios de aceptacion

- [x] Ownership de datos y RLS son inequivocos.
- [x] Operaciones criticas tienen contrato server-authoritative.
- [x] Estados, transiciones, lock y revelacion estan definidos.
- [x] Lock usa solo tiempo DB y scoring tiene una fuente de inputs/proyeccion reconstruible.
- [x] Decisiones estructurales se registraron en ADR-004 a ADR-006.
- [x] Los siguientes agentes tienen limites, entidades, RPCs y diagramas sin interfaces inventadas.

## Riesgos y deuda explicita

- Los valores de regla estandar y bonos configurables requieren decision de producto antes de Fase 08.
- Auth provider concreto, estrategia PWA, hosting, push e iOS siguen pendientes como declara `PROJECT_STATE.md`.
- El modelo de landing/branding externo sigue ausente; no condiciona el contrato de datos.

## Siguiente paso permitido

Fase 03 - Modelo de datos, migraciones y RLS. No se autoriza implementar frontend, Auth UX, scoring ni mobile antes de aceptar su handoff.
