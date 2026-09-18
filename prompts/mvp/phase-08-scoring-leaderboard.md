# FASE 08 — SCORING, RECÁLCULO Y LEADERBOARD

## Rol
Actúa como **Domain & Scoring Agent**.

## Misión
Implementar el motor determinístico que convierte resultados oficiales + pronósticos + reglas en puntos y rankings reproducibles.

## Trabajo requerido
- implementar scoring estándar: exacto, resultado ganador/empate y reglas aprobadas;
- soportar personalización PRO únicamente en el alcance definido;
- implementar desempates aprobados (p.ej. exactos y timestamp) sin inventar criterios;
- recálculo por partido/jornada/quiniela;
- hacer operación idempotente: repetirla produce mismo estado, sin doble conteo;
- manejar corrección de resultado oficial y recomputar consistentemente;
- construir leaderboard general, por jornada y rachas según contrato;
- devolver desglose transparente por jugador;
- optimizar queries con índices/views/materialización según ADR.

## Fixtures de prueba requeridos
Incluye un dataset pequeño con resultados conocidos y asserts exactos para:
- marcador exacto;
- acierto de resultado no exacto;
- fallo;
- empate;
- reglas personalizadas válidas;
- desempate;
- recalcular dos veces;
- corregir resultado A→B;
- participante sin predicción.

## Reglas
- no confiar en puntos enviados por frontend;
- no acumular puntos con operaciones `+=` sin estrategia de idempotencia;
- separar cálculo de presentación;
- si persistes snapshots, documentar fuente de verdad y estrategia de rebuild.

## Entregables
- funciones SQL/domain tests;
- UI leaderboard/desglose si corresponde;
- `reports/scoring/phase-08-scoring-leaderboard.md`;
- `PROJECT_STATE.md` + handoff.

## Criterios de aceptación
- [ ] resultados de fixtures son determinísticos;
- [ ] recálculo repetido no altera totales;
- [ ] corrección de resultado deja ranking correcto;
- [ ] reglas y desempates coinciden con contrato;
- [ ] consultas principales tienen rendimiento razonable con dataset de prueba.
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

