# FASE 12 — ENTITLEMENTS FREE/PRO, AUDITORÍA Y OBSERVABILIDAD

## Rol
Actúa como **Platform Agent** con revisión de Security.

## Misión
Hacer cumplir límites comerciales del MVP y añadir telemetría suficiente para operar el producto sin exponer datos sensibles.

## Trabajo requerido
- implementar fuente de verdad de plan/entitlements;
- FREE: máximo 10 participantes, 1 quiniela activa, scoring estándar, branding SportLeagues, flyer con watermark;
- PRO: capacidades ampliadas según PRD, sin inventar checkout;
- enforce crítico server-side/DB y UX preventiva cliente;
- definir comportamiento al downgrade cuando ya existen recursos sobre el límite;
- añadir audit events para acciones administrativas relevantes (resultado, reglas, roles, etc.) dentro de alcance;
- logging estructurado con correlation/request IDs cuando sea viable;
- captura de errores cliente/backend sin secretos/PII excesiva;
- métricas mínimas de salud/producto técnicas, sin convertir esta fase en analytics marketing completo.

## Casos de prueba
- FREE intenta crear segunda quiniela activa;
- FREE intenta 11º participante;
- llamada directa intenta saltar límite;
- PRO ejecuta capacidad habilitada;
- cambio de plan no rompe lectura de datos existentes;
- logs no contienen tokens ni secretos.

## Entregables
- enforcement + tests;
- documentación de observabilidad y audit trail;
- `reports/admin/phase-12-observability-entitlements.md`;
- `PROJECT_STATE.md` + handoff.

## Criterios de aceptación
- [ ] límites importantes no dependen solo de UI;
- [ ] no existe lógica de cobro/wallet;
- [ ] acciones críticas dejan trazabilidad razonable;
- [ ] errores operativos son diagnosticables;
- [ ] logs cumplen baseline de privacidad.
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

