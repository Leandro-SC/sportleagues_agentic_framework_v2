# HANDOFF — Remediación H1–H6 e incompatibilidad administrador/participante (preparación)

- Agentes: Security, Data, Backend, QA (orquestados)
- Estado: PARTIAL (preparado y revisado estáticamente; ejecución BLOCKED por falta de proyecto descartable)

## Archivos
`supabase/proposed/**`, `supabase/tests/proposed/**`, `scripts/qa/remediation/**`, `docs/operations/CLOUD-ONLY-TESTING-POLICY.md`,
`docs/architecture/adr/ADR-015-*.md`, `reports/security/remediation-h1-h6-review-20261011.md`; referencias en PROJECT_CONFIG, role-qa, plan 05-bis, ADR-014 y repro.

## Decisiones
Lock persistido e inmutable; exclusión histórica materializada (`pool_admin_exclusions`); administración por tenant cuenta siempre como capacidad mientras RLS/RPC usen `is_tenant_admin`;
conflictos heredados se regularizan sin borrar; Superadmin interviene vía `register_platform_intervention`; sin Docker. Los GUC
`sl.*` no autorizan operaciones runtime: se retiraron; DML de calendario/locks se revoca a `authenticated` y el feed es service-only.

## Tests ejecutados
`node --check` de los runners y `git diff --check` PASS; línea base clase A en QA (solo catálogos) 3 PASS/11 FAIL esperado;
las suites SQL/Cloud no ejecutadas siguen BLOCKED.

## Riesgos / limitaciones
Sin ejecución real; sesión de la Management API sin verificar; propietario/superusuario puede deshabilitar triggers; D22 requiere ADR/legal;
semilla y pruebas de Fases 03–05 requieren adaptación a D20. La concurrencia transaccional requiere dos conexiones PostgreSQL directas,
no solamente la Management API.

## Próximo paso permitido
Autorizar proyecto descartable → `run-suite.mjs all` + `concurrency.mjs` → segunda revisión → solicitar autorización para promover/aplicar a QA.
