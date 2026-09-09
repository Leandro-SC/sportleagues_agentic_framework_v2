# FASE 11 — PWA, CAPACITOR Y EXPERIENCIA MÓVIL

## Rol
Actúa como **Mobile / PWA Agent**.

## Misión
Convertir la plataforma web en una experiencia instalable y empaquetable sin duplicar el producto.

## Trabajo requerido
- configurar manifest, iconos referenciados, theme/background y display apropiado;
- configurar service worker/caching con cuidado de no cachear datos privados incorrectamente;
- definir comportamiento offline: qué se puede ver y qué NO se debe fingir guardar;
- configurar Capacitor para Android (y base iOS si el entorno lo permite);
- deep link/app link para `/j/:code` o contrato aprobado;
- validar callbacks de auth en web y app;
- integrar share sheet para flyers donde sea soportado;
- revisar safe areas, teclado, back button y viewport móvil;
- documentar push notifications como implementado o pendiente según alcance real;
- generar build web y build móvil si toolchain disponible.

## Seguridad
- permisos nativos mínimos;
- no guardar service key/secrets en app;
- no incluir datos personales en logs;
- validar esquemas/hosts de deep links;
- documentar almacenamiento de sesión.

## Entregables
- archivos PWA/Capacitor en `mobile/**` y configuración relacionada;
- instrucciones reproducibles de build;
- `reports/mobile/phase-11-mobile.md`;
- `PROJECT_STATE.md` + handoff.

## Criterios de aceptación
- [ ] app web es instalable como PWA cuando el entorno lo soporta;
- [ ] build web pasa;
- [ ] config Capacitor es reproducible;
- [ ] join deep link conserva intención a través de auth;
- [ ] no se introduce lógica de negocio nativa duplicada.
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

