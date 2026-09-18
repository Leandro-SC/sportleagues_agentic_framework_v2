# FASE 10 — GENERADOR DE FLYERS HD Y BUCLE VIRAL

## Rol
Actúa como **Frontend/Canvas Agent**.

## Misión
Generar imágenes compartibles desde el navegador para ranking, próxima jornada y ganador, con QR y branding según plan.

## Trabajo requerido
- crear sistema de plantillas reutilizable;
- flyer Top 5/leaderboard;
- flyer próxima jornada;
- flyer ganador de fecha;
- incluir logo/branding permitido y QR/deep link de acceso;
- FREE: watermark obligatorio;
- PRO: sin watermark y branding básico aprobado;
- render HD mediante Canvas/html2canvas según arquitectura;
- manejo de imágenes remotas/CORS/fuentes/fallbacks;
- exportar PNG/JPEG y usar Web Share API cuando esté disponible, con fallback de descarga;
- diseñar para formatos útiles en WhatsApp/Stories sin inventar integraciones privadas.

## Seguridad/robustez
- sanitizar/limitar contenido de texto y URLs de assets;
- no renderizar HTML no confiable como plantilla arbitraria;
- probar logos ausentes, nombres largos, muchos puntos y caracteres Unicode.

## Tests/QA visual
- snapshots o validaciones de estructura cuando sea viable;
- verificar dimensiones y calidad;
- FREE siempre muestra watermark;
- QR apunta al enlace correcto;
- fallback funciona en navegador sin Web Share.

## Entregables
- componentes/utilidades de flyers;
- tests;
- `reports/flyers/phase-10-flyers.md`;
- `PROJECT_STATE.md` + handoff.

## Criterios de aceptación
- [ ] tres tipos de flyer funcionan;
- [ ] branding FREE/PRO correcto;
- [ ] QR y share/download funcionan;
- [ ] contenido extremo no rompe layout de forma crítica;
- [ ] no hay inyección de HTML arbitrario.
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

