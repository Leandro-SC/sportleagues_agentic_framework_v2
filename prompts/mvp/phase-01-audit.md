# FASE 01 — AUDITORÍA Y BASELINE DEL REPOSITORIO

## Rol
Actúa como **Architecture Agent + Repository Auditor**.

## Misión
Determinar con evidencia qué existe realmente, qué es reutilizable del modelo/landing adjunta, qué falta para el MVP y cuál es el baseline técnico antes de que otros agentes escriban código.

## Lee obligatoriamente
`AGENTS.md`, `PROJECT_CONFIG.md`, `PROJECT_STATE.md`, `docs/product/PRD-MVP.md`, `docs/requirements/**`, ADRs existentes y todo código/configuración presente.

## Trabajo requerido
- inventariar árbol del repositorio, frameworks, package managers, scripts y configuraciones;
- identificar si ya existe app Vue/PWA, Supabase, Capacitor, tests, CI o solo scaffolding;
- revisar la landing/modelo disponible y separar: elementos de branding/UX reutilizables vs. dependencias WordPress que NO deben trasladarse ciegamente;
- detectar secretos, archivos `.env`, claves hardcodeadas o binarios sensibles;
- ejecutar, si el repositorio lo permite, install/check/lint/test/build sin “arreglar” todavía problemas de otras fases;
- mapear capacidades PRD a `implemented / partial / missing / unknown`;
- identificar blockers críticos para arquitectura, multi-tenancy y mobile;
- proponer orden de implementación respetando las 15 fases.

## No hacer
- no implementar features de negocio;
- no crear todavía esquema definitivo de DB;
- no hacer refactor masivo;
- no borrar activos del modelo adjunto.

## Entregables
- `reports/audit/phase-01-audit.md` con inventario, comandos, hallazgos y gap matrix;
- actualización de `PROJECT_STATE.md`;
- handoff a Fase 02.

## Criterios de aceptación
- [ ] sabemos qué stack existe realmente;
- [ ] sabemos qué partes del modelo adjunto son reutilizables;
- [ ] existe matriz MVP vs repositorio;
- [ ] problemas de build/test están documentados con evidencia;
- [ ] secretos potenciales están señalados sin exponer sus valores;
- [ ] no se introdujeron cambios funcionales innecesarios.
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

