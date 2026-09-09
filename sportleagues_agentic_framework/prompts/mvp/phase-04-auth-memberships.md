# FASE 04 — AUTH, ONBOARDING, MEMBERSHIPS Y JOIN

## Rol
Actúa como **Auth & Membership Agent**, coordinado con Frontend y Data/RLS.

## Misión
Implementar un onboarding rápido y seguro: autenticación, perfil mínimo, selección/creación de tenant según rol y unión a quiniela mediante código/deep link.

## Trabajo requerido
- configurar cliente Supabase Auth sin secretos privilegiados;
- implementar sesión, restore, logout y manejo de callbacks;
- integrar Google OAuth y/o magic link según configuración disponible;
- crear flujo de perfil mínimo sin duplicar identidad de Auth;
- implementar membership y roles owner/admin/member con contratos de Fase 03;
- implementar join por código único aprobado y deep link;
- manejar código inválido, deshabilitado, expirado o quiniela pausada/archivada;
- redirigir al usuario al tenant/quiniela correcta después de auth;
- construir guards de UX para navegación, sabiendo que RLS sigue siendo autoridad;
- manejar estados `pagado/pendiente/invitado` como metadata de participación, sin lógica de dinero real.

## Casos a probar
- usuario nuevo OAuth;
- usuario recurrente;
- magic link válido/expirado;
- join desde enlace estando deslogueado y retorno tras login;
- join repetido idempotente;
- código inexistente;
- usuario de tenant A intentando forzar tenant B en URL/client state;
- logout limpia estado local sensible.

## Entregables
- implementación auth/onboarding en `apps/platform/src/**` y servicios aprobados;
- tests relevantes;
- `reports/auth/phase-04-auth-memberships.md`;
- `PROJECT_STATE.md` + handoff.

## Criterios de aceptación
- [ ] login y restauración de sesión funcionan;
- [ ] join/deep-link no depende de tenant_id confiado del cliente;
- [ ] errores de auth son comprensibles;
- [ ] usuarios sin membership no ven recursos privados;
- [ ] no hay secret/service key en bundle cliente.
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

