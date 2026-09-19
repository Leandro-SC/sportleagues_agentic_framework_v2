# Workflow multiagente

El workflow debe ser proporcional al riesgo.

Cambios pequeños deben ser ágiles.

Cambios críticos deben ser exhaustivos.

El objetivo es evitar dos extremos:

* burocracia innecesaria para cambios simples;
* implementación apresurada para cambios sensibles.

---

### Cambios frontend

Toda implementación frontend nueva debe revisar primero:

- `docs/design/DESIGN-SYSTEM.md`
- `docs/design/reference/sportleagues-ui-reference.png`
- `apps/platform/src/styles.css`

El Design System vigente es obligatorio para features nuevas.

No aprobar una tarea frontend si introduce estilos inconsistentes o vuelve al diseño legacy.

# 1. Inicio

Leer siempre:

1. `AGENTS.md`
2. `PROJECT_CONFIG.md`
3. `PROJECT_STATE.md`

Después cargar únicamente la documentación relacionada con la tarea:

* PRD;
* requirements;
* ADRs;
* reportes;
* handoffs;
* prompts de fase;
* prompts de rol.

No leer todo el repositorio innecesariamente.

No asumir el estado del proyecto por memoria.

---

# 2. Intake

Consultar:

`change-intake.md`

Clasificar la solicitud.

Determinar:

* objetivo;
* usuario;
* alcance;
* fase;
* riesgo;
* agentes necesarios;
* contratos potencialmente afectados.

Clasificar el cambio como:

* mejora UI/UX;
* bug;
* nueva función;
* cambio de negocio;
* backend/datos;
* seguridad;
* performance;
* arquitectura;
* release;
* documentación.

---

# 3. Validación de producto

Si la solicitud agrega funcionalidad nueva:

usar Product Owner / PRD.

Definir:

* problema;
* usuario;
* comportamiento;
* permisos;
* datos;
* reglas;
* UX;
* aceptación;
* dependencias;
* fase.

Clasificar como:

* `MVP`
* `MEJORA_COMPATIBLE`
* `POST_MVP`
* `REQUIERE_ADR`

No implementar automáticamente una función `POST_MVP`.

No implementar una función `REQUIERE_ADR` antes de resolver la decisión arquitectónica.

Para mejoras visuales pequeñas usar mini-spec en lugar de Definition Ready completa.

---

# 4. Definir ownership

Asignar:

* un agente líder;
* los revisores mínimos necesarios.

Evitar ownership ambiguo.

El líder implementa.

Los revisores validan únicamente su especialidad.

No activar todos los agentes por defecto.

---

# 5. Definir alcance

Antes de modificar código, declarar:

* objetivo;
* comportamiento esperado;
* archivos o módulos probablemente afectados;
* criterios de aceptación;
* fuera de alcance.

Mantener cambios pequeños y auditables.

Si durante la implementación aparece un impacto fuera del alcance, reevaluar antes de continuar.

---

# 6. Inspección

Antes de editar:

* buscar implementación existente;
* revisar patrones ya usados;
* revisar componentes reutilizables;
* revisar composables/services;
* revisar tests;
* revisar contratos;
* revisar migraciones si aplica;
* revisar políticas RLS si aplica;
* revisar documentación relacionada.

No duplicar:

* servicios;
* componentes;
* helpers;
* funciones SQL;
* reglas de negocio;
* tipos.

Preferir extender patrones existentes cuando sean correctos.

---

# 7. Diseño

Diseñar únicamente lo necesario para implementar correctamente la tarea.

## UI/UX

Definir:

* usuario;
* objetivo;
* flujo;
* jerarquía;
* acción primaria;
* componentes;
* responsive;
* estados;
* accesibilidad;
* feedback;
* copy funcional.

Considerar cuando aplique:

* loading;
* empty;
* error;
* success;
* disabled;
* confirmaciones;
* prevención de errores.

---

## Frontend

Definir:

* vista/componente;
* composables;
* routing;
* contratos de datos;
* estados cliente;
* manejo de errores;
* reutilización;
* validaciones de UX.

No convertir lógica de autorización frontend en frontera de seguridad.

---

## Backend

Definir:

* datos;
* schema;
* contrato;
* autorización;
* RLS;
* RPC;
* Edge Function si aplica;
* transacción;
* mínimo privilegio;
* estrategia de migración.

No editar migraciones históricas ya aplicadas.

---

## Dominio

Definir:

* invariantes;
* estados;
* transiciones;
* reglas;
* edge cases;
* idempotencia;
* comportamiento ante concurrencia;
* fuente autoritativa.

Las reglas críticas deben permanecer server-authoritative.

---

## Seguridad

Definir:

* actor;
* recurso;
* permiso;
* frontera de autorización;
* casos negativos;
* acceso cross-tenant;
* mínimo privilegio;
* exposición de datos.

Añadir pruebas negativas cuando corresponda.

---

## Performance

Definir solo si existe riesgo relevante:

* consultas;
* N+1;
* payload;
* listas;
* render;
* índices;
* agregaciones;
* assets;
* caching;
* paginación.

No optimizar prematuramente.

---

## QA

Definir:

* happy path;
* inputs inválidos;
* edge cases;
* regresiones;
* autorización;
* cross-tenant;
* responsive;
* accesibilidad;
* estados de error.

La profundidad de QA debe ser proporcional al riesgo.

---

# 8. Implementación

Aplicar el cambio mínimo completo.

No:

* hacer refactors masivos fuera del alcance;
* cambiar stack sin ADR;
* añadir librerías innecesarias;
* modificar archivos ajenos a la tarea sin razón;
* desactivar controles para hacer pasar tests;
* dejar TODO como cierre;
* duplicar lógica existente;
* implementar funciones de fases futuras sin dependencia aprobada.

Mantener TypeScript estricto y patrones existentes.

---

# 9. Migraciones

Si el cambio requiere schema, RLS, RPC o índices:

crear una nueva migración incremental.

No editar migraciones históricas ya aplicadas.

Verificar:

* orden;
* permisos;
* GRANT/REVOKE;
* RLS;
* seguridad multi-tenant;
* compatibilidad con estado actual.

---

# 10. Review

Aplicar revisiones según riesgo.

## Code Review

Revisar:

* correctness;
* tipos;
* nullability;
* errores;
* complejidad;
* duplicación;
* nombres;
* límites de módulos;
* deuda introducida.

No exigir refactors cosméticos fuera del alcance.

---

## Security

Obligatorio cuando toca:

* auth;
* memberships;
* roles;
* RLS;
* tenant;
* RPC;
* Edge Functions;
* uploads;
* storage;
* secrets;
* admin;
* superadmin;
* PII;
* operaciones privilegiadas.

Revisar especialmente:

* cross-tenant;
* escalación de privilegios;
* IDOR;
* service_role;
* permisos excesivos.

---

## UI/UX

Obligatorio si cambia interfaz.

Revisar:

* claridad;
* jerarquía;
* consistencia;
* responsive;
* estados;
* interacción;
* accesibilidad.

---

## Performance

Revisar si existen:

* listas grandes;
* consultas frecuentes;
* renders costosos;
* agregaciones;
* leaderboards;
* scoring;
* assets grandes;
* múltiples requests.

Si el cuello está en PostgreSQL, involucrar Database Performance.

---

# 11. Tests

Ejecutar según disponibilidad y alcance:

```bash
npm run typecheck
npm test
npm run build
```

Añadir cuando corresponda:

* SQL tests;
* RLS tests;
* RPC tests;
* cross-tenant tests;
* component tests;
* composable tests;
* integration tests;
* manual browser checklist;
* responsive checks;
* accessibility checks.

Si existe Git, considerar:

```bash
git diff --check
```

No declarar un test aprobado sin resultado verificable.

---

# 12. Fallos de entorno

Distinguir:

* fallo del producto;
* fallo del entorno;
* dependencia faltante;
* binario incompatible;
* configuración externa.

Si un gate no puede ejecutarse:

documentar:

* causa;
* impacto;
* evidencia;
* alternativa de validación;
* pendiente exacto.

No marcarlo como aprobado.

---

# 13. Correcciones

Si QA, Security o Code Review encuentra problemas:

volver al agente dueño.

El agente dueño corrige.

Luego repetir únicamente los gates afectados más la regresión necesaria.

No reiniciar todo el proceso si no es necesario.

---

# 14. Documentación

Cada agente registra:

* qué hizo;
* archivos;
* decisiones;
* tests;
* resultado;
* riesgos;
* pendientes.

Documentation Agent u Orchestrator consolida el estado global.

No permitir ediciones concurrentes de `PROJECT_STATE.md`.

Consultar:

`state-management.md`

---

# 15. Cierre de tarea

Una tarea se acepta cuando:

* comportamiento funciona;
* criterios de aceptación están cumplidos;
* tests relevantes pasan;
* seguridad está revisada si aplica;
* QA está aprobado;
* documentación está actualizada;
* no existen bloqueos críticos abiertos.

Clasificar resultado como:

* `ACCEPTED`
* `CHANGES_REQUIRED`
* `BLOCKED_ADR`
* `BLOCKED_EXTERNAL`

---

# 16. Cierre de fase

Antes de marcar una fase completa verificar:

* objetivos;
* acceptance criteria;
* tests;
* seguridad;
* QA;
* documentación;
* handoff;
* bloqueos;
* deuda crítica.

Solo entonces actualizar `PROJECT_STATE.md`.

No cerrar una fase únicamente porque el código principal existe.

---

# 17. Fast Lane

Usar Fast Lane únicamente para cambios pequeños y de bajo riesgo.

Ejemplos:

* spacing;
* copy;
* responsive;
* iconografía;
* componentes visuales;
* accesibilidad menor;
* bug localizado sin impacto contractual.

Flujo:

inspección
→ implementación
→ QA focalizado
→ documentación

No exigir ADR ni análisis completo si no existe cambio estructural.

---

# 18. Fast Lane prohibido

No usar Fast Lane para:

* auth;
* roles;
* memberships;
* RLS;
* tenant isolation;
* RPC privilegiadas;
* service_role;
* scoring;
* locks;
* pagos;
* PII;
* migraciones críticas;
* cambios de arquitectura;
* secretos;
* superadmin.

Estos cambios requieren revisión completa proporcional al riesgo.

---

# 19. Nuevas funciones

Cuando el usuario diga algo como:

* “quiero agregar…”
* “necesitamos una función…”
* “añade…”
* “sería bueno que…”

no comenzar directamente a programar.

Primero:

1. clasificar con Product Owner;
2. validar contra PRD;
3. ubicar fase;
4. definir aceptación;
5. detectar ADR si aplica;
6. enrutar al equipo mínimo.

Después implementar.

---

# 20. Mejoras de interfaz

Cuando el usuario diga algo como:

* “mejora esta pantalla”;
* “hazla más clara”;
* “quiero una mejor experiencia móvil”;
* “simplifica este panel”;

usar:

mini-spec
→ UI/UX
→ Frontend
→ QA

Agregar Performance/Accessibility si el cambio lo amerita.

No involucrar Backend automáticamente.

---

# 21. Performance

Cuando exista problema de rendimiento:

primero identificar dónde está:

* frontend;
* red;
* Supabase;
* PostgreSQL;
* assets;
* arquitectura.

Después enrutar.

Frontend:

Performance Agent.

PostgreSQL:

Database Performance Agent.

No introducir librerías, caching o materialización sin evidencia suficiente.

---

# 22. Conflictos entre agentes

Si dos agentes proponen soluciones incompatibles:

Orchestrator debe resolver usando este orden:

1. seguridad;
2. correctness;
3. PRD/requisitos;
4. arquitectura aceptada;
5. mantenibilidad;
6. performance;
7. simplicidad;
8. preferencia estética.

Si el conflicto requiere decisión estructural:

crear/escalar ADR.

---

# 23. Paralelismo

Permitir agentes en paralelo solo cuando:

* no editan archivos compartidos críticos;
* contratos ya están definidos;
* no existe dependencia secuencial.

Ejemplo válido:

* UI/UX define pantalla;
* Backend implementa contrato ya aprobado.

Ejemplo inválido:

* Frontend y Backend inventan simultáneamente contratos distintos.

---

# 24. Stop rule

Después de completar la tarea:

detenerse.

No empezar automáticamente:

* siguiente feature;
* siguiente fase;
* refactor adicional;
* optimización no solicitada.

Reportar únicamente el siguiente paso permitido.

---

# 25. Resultado final

Entregar al usuario de forma compacta:

## Estado

`ACCEPTED`
`CHANGES_REQUIRED`
`BLOCKED_ADR`
`BLOCKED_EXTERNAL`

## Fase

Fase actual.

## Cambios

Resumen breve.

## Archivos

Archivos principales modificados.

## Validación

Tests y comandos ejecutados.

## Documentación

Archivos actualizados.

## Pendientes

Solo bloqueos o deuda relevante.

## Siguiente

Próxima tarea permitida.

No ejecutarla automáticamente.
