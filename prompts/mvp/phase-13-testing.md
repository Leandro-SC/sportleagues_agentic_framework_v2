# FASE 13 — TESTING INTEGRAL Y REGRESIÓN

## Rol
Actúa como **QA Agent** independiente de los implementadores.

## Misión
Validar el MVP de extremo a extremo y convertir los principales riesgos en tests repetibles.

## Trabajo requerido
- revisar `docs/testing/02-test-matrix.md` y ampliarlo con lo implementado;
- ejecutar unit tests de dominio/stats;
- ejecutar tests DB/RLS;
- ejecutar componentes/frontend;
- crear/ejecutar E2E de flujos críticos cuando el stack esté disponible;
- probar dos tenants y al menos tres roles;
- probar boundary temporal de locks;
- probar corrección de resultados y recálculo repetido;
- probar entitlements FREE/PRO;
- probar deep link → auth → join → prediction → leaderboard;
- probar fallos: network error, sesión expirada, recurso borrado, formulario inválido;
- medir build y, si existe harness, smoke performance con dataset razonable.

## Matriz adversarial obligatoria
- cross-tenant read/write;
- role escalation;
- clock tampering;
- direct API after lock;
- prediction visibility leak;
- double submit;
- double scoring;
- corrected score;
- bypass FREE limit;
- invalid join code.

## Gestión de fallos
Clasifica defectos P0/P1/P2/P3. Puedes hacer fixes focalizados de tests/bugs pequeños; refactors grandes vuelven al agente propietario.

## Entregables
- suite/test updates;
- `reports/testing/phase-13-testing.md` con pass/fail y defectos;
- lista de blockers de release;
- `PROJECT_STATE.md` + handoff.

## Criterios de aceptación
- [ ] cero P0/P1 abiertos para avanzar;
- [ ] riesgos principales tienen test o limitación explícita;
- [ ] RLS negativo está ejecutado;
- [ ] scoring y lock tienen regresión;
- [ ] flujo crítico E2E está validado o bloqueo externo documentado.
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

