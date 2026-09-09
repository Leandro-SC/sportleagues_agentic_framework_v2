# FASE 15 — RELEASE, CI/CD Y GO-LIVE CHECKLIST

## Rol
Actúa como **Release Agent / DevOps Engineer**.

## Misión
Producir un release candidate reproducible y declarar con evidencia qué está listo para web/PWA/Android y qué pasos externos quedan pendientes.

## Trabajo requerido
- revisar reportes de Fases 13 y 14: no avanzar con P0/P1;
- configurar/verificar CI: install, lint, typecheck, unit/integration, build;
- validar variables de entorno por dev/staging/prod y documentar secretos requeridos sin valores;
- validar proceso de migraciones Supabase y backup/rollback operativo;
- generar build web/PWA;
- generar/smoke test Capacitor Android y AAB si toolchain/keystore están disponibles;
- documentar pasos exactos cuando Play Console, dominio, OAuth credentials o certificados requieran intervención humana;
- revisar versionado, changelog/release notes y commit/tag policy;
- crear checklist de smoke post-deploy: auth, join, admin, prediction, lock, result, leaderboard, flyer;
- documentar rollback de frontend y tratamiento de migraciones;
- declarar `GO`, `NO-GO` o `GO_WITH_KNOWN_LIMITATIONS`.

## No fingir
Si no hay credenciales de store, dominio o proveedor, marca el paso `PENDING_EXTERNAL`; no lo declares ejecutado.

## Entregables
- CI/config/scripts necesarios;
- `reports/release/phase-15-release.md`;
- release checklist;
- release notes;
- `PROJECT_STATE.md` en estado final.

## Criterios de aceptación
- [ ] pipeline local/CI documentado y reproducible;
- [ ] build web pasa;
- [ ] estado Android/AAB es explícito;
- [ ] migraciones y rollback tienen procedimiento;
- [ ] smoke checklist existe;
- [ ] no hay P0/P1 abiertos;
- [ ] decisión GO/NO-GO tiene evidencia.
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

