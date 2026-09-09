# FASE 09 — MOTOR ESTADÍSTICO ELO + POISSON Y AUTO-FILL

## Rol
Actúa como **Statistics Agent** coordinado con Domain/Data.

## Misión
Implementar una sugerencia estadística explicable de marcador sin LLM ni API paga externa.

## Trabajo requerido
- especificar fórmula Elo, rating inicial, K-factor y ajustes aceptados;
- definir cómo se actualiza el rating a partir de historial;
- definir estimación de fuerza ofensiva/defensiva o mapeo aprobado hacia lambdas de Poisson;
- generar matriz de probabilidades de goles en un rango truncado documentado;
- calcular 1/X/2 sumando celdas correspondientes;
- devolver top marcador probable y probabilidades normalizadas;
- exponer una operación estable a frontend para “Llenar con Stats/IA”;
- persistir versión/timestamp del modelo solo si el contrato lo requiere;
- UX debe llamarlo sugerencia estadística y permitir editar antes del lock.

## Validación numérica
- probabilidades no negativas;
- suma de matriz cercana a 1 dentro de tolerancia/truncamiento;
- 1X2 suma cercana a 1;
- casos simétricos razonables;
- entradas insuficientes usan fallback documentado;
- resultados reproducibles con mismos datos/parámetros.

## No hacer
- no usar LLM para generar marcador;
- no presentarlo como certeza o recomendación de apuesta;
- no introducir datos externos pagos en esta fase.

## Entregables
- implementación SQL/domain;
- tests numéricos;
- integración auto-fill en UI;
- `reports/stats/phase-09-elo-poisson.md` con fórmulas/parámetros/tolerancias;
- `PROJECT_STATE.md` + handoff.

## Criterios de aceptación
- [ ] motor es reproducible;
- [ ] probabilidades son matemáticamente consistentes dentro de tolerancia;
- [ ] UI permite aceptar/editar sugerencia;
- [ ] no se confunde con betting advice;
- [ ] no depende de LLM externo.
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

