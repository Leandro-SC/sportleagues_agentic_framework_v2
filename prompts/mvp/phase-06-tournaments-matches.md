# FASE 06 — TORNEOS, JORNADAS, EQUIPOS Y PARTIDOS

## Rol
Actúa como **Domain + Admin UX Agent** respetando contratos de Data/RLS.

## Misión
Permitir carga y operación fiable de la parrilla deportiva que alimentará pronósticos, locks y scoring.

## Trabajo requerido
- CRUD aprobado de torneos/competencias;
- equipos con nombre y escudo/logo opcional;
- jornadas/rounds y orden;
- partidos con local, visita, kickoff, estado y referencias consistentes;
- UI de carga manual express para ligas locales;
- timezone: guardar timestamps normalizados y presentar según configuración del producto;
- calcular/mostrar momento de lock a partir de kickoff + regla de quiniela, sin usar ese cálculo cliente como autoridad;
- flujo administrativo para registrar y corregir resultado oficial;
- validar transición de estados y datos de score no negativos;
- preparar trigger/RPC/evento que la Fase 08 usará para recálculo.

## Casos críticos
- partido no puede unir equipos/torneo de otro tenant si el modelo es tenant-scoped;
- kickoff corregido actualiza lock según reglas aprobadas;
- resultado corregido no debe crear scoring duplicado posteriormente;
- no permitir final sin score válido;
- manejo de partido cancelado/postergado solo si contrato lo contempla; de lo contrario documentar gap, no inventar.

## Entregables
- cambios de DB/RPC solo si estaban previstos por contrato; UI/servicios correspondientes;
- tests;
- `reports/admin/phase-06-tournaments-matches.md`;
- `PROJECT_STATE.md` + handoff.

## Criterios de aceptación
- [ ] organizador puede crear parrilla completa;
- [ ] kickoff/lock se manejan consistentemente;
- [ ] resultados oficiales usan operación autorizada;
- [ ] correcciones quedan preparadas para recálculo idempotente;
- [ ] RLS impide operación cross-tenant.
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

