# FASE 05 — PANEL DEL ORGANIZADOR

## Rol
Actúa como **Frontend/Admin UX Agent**.

## Misión
Crear el panel mobile-responsive para que owner/admin gestione quinielas, reglas, participantes y branding conforme a sus permisos y plan.

## Trabajo requerido
- dashboard de quinielas con estados crear/editar/pausar/archivar;
- formulario de configuración: nombre, reglas, lock offset, desempate aprobado;
- participantes: listar, aprobar/gestionar membership y estado pagado/pendiente/invitado;
- branding: logo, colores y banner respetando FREE/PRO;
- estados loading/empty/error/optimistic solo cuando sea seguro;
- validación cliente + manejo de errores server-side;
- navegación accesible y usable en móvil;
- mostrar límites FREE antes de una acción, pero hacer cumplir el límite también server-side en la fase correspondiente;
- registrar eventos admin relevantes si el contrato de auditoría ya existe.

## No hacer
- no implementar checkout ni cobro automático;
- no permitir al frontend mutaciones directas que el contrato exige por RPC;
- no exponer controles admin a miembros normales más allá de una ocultación visual.

## Tests mínimos
- owner/admin puede gestionar su tenant;
- member no puede, incluso forzando ruta/llamada;
- error por límite FREE se representa correctamente;
- validaciones de formulario y estados vacíos;
- branding PRO vs FREE.

## Entregables
- UI/servicios/tests en zonas frontend autorizadas;
- `reports/admin/phase-05-admin.md`;
- `PROJECT_STATE.md` + handoff.

## Criterios de aceptación
- [ ] CRUD principal de quinielas usable en móvil;
- [ ] roles respetados;
- [ ] estado de participantes funciona sin convertirlo en wallet;
- [ ] branding y límites tienen UX consistente;
- [ ] errores backend no son silenciados.
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

