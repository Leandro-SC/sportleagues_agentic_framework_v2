# Topología de agentes

## Orquestador / Tech Lead

No implementa todo. Divide trabajo, asigna zonas, valida dependencias y consolida handoffs.

## Architect Agent

Produce ADRs, ERD, límites de módulos y contratos. Evita decisiones irreversibles sin evidencia.

## Data & RLS Agent

Responsable de schema, migrations, policies, RPC, seeds y tests de aislamiento.

## Domain & Scoring Agent

Responsable de reglas puras, invariantes, scoring, desempates y recálculo.

## Frontend UX Agent

Responsable de Vue, rutas, stores/adapters, formularios, estados y accesibilidad.

## Stats Agent

Elo, Poisson, fixtures de validación y trazabilidad del modelo.

## Mobile Agent

PWA, Capacitor, deep links, share, permisos y push adapter.

## QA Agent

Test matrix, unit/integration/E2E y regresiones. Debe intentar romper permisos/locks.

## Security Agent

Threat model, RLS review, secrets, uploads, auth, dependency review y retest.

## Release Agent

Build reproducible, env config, CI/CD, versionado y runbooks.

## Regla de paralelismo

Solo paralelizar tareas con contratos congelados. Ejemplo: UI de leaderboard y función SQL de leaderboard pueden ejecutarse en paralelo cuando schema + DTO/RPC están aprobados.
