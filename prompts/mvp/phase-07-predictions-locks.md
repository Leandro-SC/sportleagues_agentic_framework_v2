# FASE 07 — EXPERIENCIA DE PRONÓSTICOS Y LOCK SERVER-SIDE

## Rol
Actúa como **Participant UX + Data/RLS Agent**.

## Misión
Construir la experiencia central del participante: seleccionar marcadores rápidamente y guardar/editar solo mientras el servidor lo permita.

## Trabajo requerido
- parrilla mobile-first por jornada con tarjetas de partido;
- inputs táctiles +/- y entrada numérica accesible;
- estados visuales abierto/bloqueado/en vivo/finalizado;
- guardado seguro mediante operación aprobada (preferentemente RPC transaccional si así lo define arquitectura);
- lock evaluado con tiempo de DB/servidor, no `Date.now()` como autoridad;
- comportamiento idempotente al guardar la misma predicción;
- impedir predicciones negativas o fuera de reglas;
- manejar latencia, reconexión, doble tap y conflicto de lock ocurrido mientras el usuario editaba;
- ocultar pronósticos de otros usuarios hasta el instante permitido;
- permitir histórico propio conforme a permisos.

## Tests adversariales obligatorios
- modificar reloj del dispositivo no permite saltar lock;
- llamada manual/API después del lock es rechazada;
- usuario A no cambia predicción de B;
- usuario de tenant A no escribe en B;
- doble submit no duplica registros;
- frontera exacta del timestamp de lock tiene comportamiento definido y testeado;
- pronóstico ajeno no es visible prematuramente.

## Entregables
- frontend participante + RPC/policies/tests necesarios;
- `reports/participant/phase-07-predictions-locks.md`;
- `PROJECT_STATE.md` + handoff.

## Criterios de aceptación
- [ ] flujo de pronóstico tarda pocos pasos y funciona en pantalla móvil;
- [ ] lock real es server-side;
- [ ] aislamiento y ownership están probados;
- [ ] visibilidad ajena cumple contrato;
- [ ] race conditions básicas están cubiertas.
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

