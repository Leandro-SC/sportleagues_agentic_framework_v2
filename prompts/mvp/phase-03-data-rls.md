# FASE 03 — MODELO DE DATOS, MIGRACIONES Y ROW LEVEL SECURITY

## Rol
Actúa como **Data & RLS Agent**.

## Misión
Implementar la base PostgreSQL/Supabase del MVP con aislamiento multi-tenant verificable y constraints que impidan estados inválidos.

## Entradas
Lee Fase 02, ADRs, `docs/requirements/01-data-model.md`, `02-auth-tenancy.md` y baseline de seguridad.

## Trabajo requerido
- crear migraciones forward-only para las entidades aprobadas;
- añadir PK/FK, `not null`, unique y check constraints útiles;
- garantizar relación inequívoca al tenant en toda tabla tenant-owned;
- crear índices para queries previstas: tenant, pool, match, user, round, lock/result;
- habilitar RLS tabla por tabla;
- crear helpers/policies basados en `auth.uid()` y memberships;
- prohibir lectura/escritura cross-tenant;
- limitar operaciones administrativas por rol;
- diseñar policies para que pronósticos ajenos no sean visibles antes del momento permitido;
- definir Storage policies si logo/banner entra en alcance;
- crear seeds mínimos: dos tenants, owners/admins/members separados, torneo/partidos/quinielas;
- escribir tests SQL/integración que demuestren positivos y negativos.

## Tests mínimos obligatorios
1. member A lee su tenant A;
2. member A NO lee tenant B;
3. member A NO administra tenant A si no tiene rol;
4. admin A NO administra B;
5. usuario sin membership NO accede a datos privados;
6. constraints rechazan relaciones cross-tenant inconsistentes;
7. pronóstico de otro jugador permanece oculto antes del umbral aprobado.

## Reglas especiales
- no aceptar `tenant_id` del cliente como prueba de autorización;
- evitar policies recursivas o costosas sin índices;
- si usas `SECURITY DEFINER`, documentar motivo, `search_path`, owner y privilegios;
- no poner service-role en frontend.

## Entregables
- `supabase/migrations/**`;
- `supabase/seed/**`;
- `supabase/tests/**`;
- `reports/data/phase-03-data-rls.md` con matriz tabla→RLS→policy→test;
- `PROJECT_STATE.md` + handoff.

## Criterios de aceptación
- [ ] migraciones aplican desde DB vacía;
- [ ] todas las tablas tenant-owned tienen RLS;
- [ ] tests cross-tenant fallan de forma segura;
- [ ] índices y constraints soportan el modelo;
- [ ] no hay bypass accidental desde roles normales;
- [ ] contrato de Fase 02 permanece intacto o existe ADR aprobado.
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

