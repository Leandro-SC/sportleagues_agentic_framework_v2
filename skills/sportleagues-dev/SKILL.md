---
name: sportleagues-dev
description: Coordinar el desarrollo, revisión, evolución y continuidad del proyecto SportLeagues / BetAdmin en VS Code. Usar para retomar fases, implementar nuevas funciones, mejorar interfaces, corregir bugs, revisar arquitectura, UI/UX, frontend, backend Supabase/PostgreSQL/RLS, lógica de negocio, seguridad, rendimiento, QA, release y documentación. Debe trabajar desde el estado real del repositorio, usar el equipo técnico mínimo necesario, respetar PRD/ADRs, mantener el Design System vigente en todo desarrollo frontend y mantener PROJECT_STATE.md y los handoffs sincronizados.
SportLeagues Dev
Actuar como equipo técnico senior multiagente del proyecto SportLeagues / BetAdmin.
El objetivo es desarrollar una aplicación SaaS multi-tenant de alta calidad, mobile-first, segura, rápida, mantenible y coherente con el PRD.
Esta skill coordina especialistas. No reemplaza las fuentes de verdad del repositorio.
---
1. Fuentes de verdad
Antes de modificar código, leer como mínimo:
`AGENTS.md`
`PROJECT_CONFIG.md`
`PROJECT_STATE.md`
Luego, según la tarea:
`docs/product/PRD-MVP.md`
ADRs en `docs/architecture/adr/`
requirements en `docs/requirements/`
reportes relacionados
handoffs existentes
prompts de fase en `prompts/mvp/`
prompts de rol en `prompts/roles/`
para cualquier cambio frontend/UI: `docs/design/DESIGN-SYSTEM.md`
para cualquier cambio frontend/UI: `docs/design/reference/sportleagues-ui-reference.png`
para cualquier cambio frontend/UI: `apps/platform/src/styles.css`
Respetar el orden de precedencia definido por `AGENTS.md`.
`PROJECT_STATE.md` sirve para determinar la fase operativa actual, pendientes y bloqueos. No debe usarse para contradecir un ADR, `AGENTS.md` o `PROJECT_CONFIG.md`.
Nunca asumir la fase por memoria.
---
2. Estado actual
Determinar siempre el estado leyendo `PROJECT_STATE.md`.
No hardcodear una fase dentro de esta skill.
Si existe una fase parcialmente cerrada:
resolver primero bloqueos;
ejecutar sus gates;
actualizar documentación;
cerrar formalmente la fase;
recién después considerar la siguiente.
No saltar fases automáticamente.
---
3. Intake de solicitudes
Cuando el usuario solicite algo nuevo, consultar:
`references/change-intake.md`
Clasificar la solicitud como:
mejora UI/UX;
bug;
nueva función;
cambio de lógica de negocio;
backend/datos;
seguridad;
performance;
arquitectura;
release;
documentación.
Usar siempre el equipo mínimo necesario.
No activar todos los agentes para cambios pequeños.
---
4. Equipo técnico
Cargar únicamente los roles necesarios.
Producto
Product Owner / PRD:
`references/role-product-owner.md`
Coordinación
Orchestrator / Tech Lead:
`references/role-orchestrator.md`
Arquitectura
Architecture:
`references/role-architecture.md`
Experiencia
UI/UX:
`references/role-ui-ux.md`
Desarrollo
Frontend:
`references/role-frontend.md`
Backend / Data / RLS:
`references/role-backend.md`
Domain / Business Logic:
`references/role-domain.md`
Rendimiento
Application Performance & Accessibility:
`references/role-performance.md`
Database Performance:
`references/role-database-performance.md`
Seguridad y calidad
Security:
`references/role-security.md`
QA:
`references/role-qa.md`
Code Review:
`references/role-code-review.md`
Operación
Release / DevOps:
`references/role-release.md`
Documentation / State:
`references/role-documentation.md`
Los prompts ya existentes en `prompts/roles/**` siguen siendo referencias válidas y deben reutilizarse cuando contengan instrucciones más específicas.
---
5. Flujo general
Para cada tarea:
Leer estado y documentación relacionada.
Clasificar la solicitud.
Determinar si pertenece al MVP, mejora compatible, post-MVP o requiere ADR.
Seleccionar agente líder.
Seleccionar únicamente revisores necesarios.
Declarar alcance y archivos potencialmente afectados.
Inspeccionar implementación existente.
Diseñar solución mínima completa.
Implementar.
Ejecutar tests y revisiones.
Corregir hallazgos.
Actualizar documentación.
Consolidar `PROJECT_STATE.md` si corresponde.
Detenerse.
Consultar:
`references/workflow.md`
para el proceso detallado.
---
6. Nuevas funcionalidades
Toda funcionalidad nueva debe pasar primero por Product Owner / PRD.
El Product Owner debe determinar:
problema;
usuario;
objetivo;
comportamiento;
permisos;
datos;
reglas;
UI;
criterios de aceptación;
dependencias;
fase;
compatibilidad con MVP.
Clasificar como:
`MVP`
`MEJORA_COMPATIBLE`
`POST_MVP`
`REQUIERE_ADR`
No implementar una función `POST_MVP` como si perteneciera al MVP sin aprobación explícita.
No implementar una función `REQUIERE_ADR` antes de resolver el ADR.
Si la funcionalidad incluye frontend o UI, debe integrarse obligatoriamente al Design System vigente de SportLeagues. No crear una identidad visual nueva para una feature aislada.
---
7. Mejoras UI/UX
Para una mejora puramente visual o de interacción que no cambie contratos:
Product Owner mini-spec
→ UI/UX
→ Frontend
→ QA
→ Performance/Accessibility si aplica
→ Documentation
Evitar involucrar Backend, Architecture o Security si realmente no son necesarios.
Si durante la revisión se descubre impacto en permisos, datos, contratos o lógica server-side, escalar al rol correspondiente.
Antes de cualquier implementación UI/UX, revisar obligatoriamente:
`docs/design/DESIGN-SYSTEM.md`
`docs/design/reference/sportleagues-ui-reference.png`
`apps/platform/src/styles.css`
componentes compartidos existentes en `apps/platform/src/components/`
---
8. Reglas técnicas permanentes
Mantener:
Vue 3 Composition API;
TypeScript;
Vite;
Tailwind CSS;
Lucide;
Supabase;
PostgreSQL;
Auth;
RLS;
arquitectura multi-tenant;
Capacitor según roadmap.
No cambiar stack sin ADR.
No introducir Pinia, TanStack Query u otra dependencia de estado/query sin ADR, porque `PROJECT_CONFIG.md` mantiene esa decisión pendiente.
---
9. Seguridad
Seguir `AGENTS.md`.
Reglas mínimas:
nunca confiar en `tenant_id` proveniente del cliente para autorizar;
derivar autorización del usuario autenticado y memberships;
mantener RLS activa;
nunca usar `service_role` en frontend;
usar mínimo privilegio;
añadir tests negativos cross-tenant;
validar operaciones críticas server-side;
proteger RPC sensibles internamente además de GRANT/REVOKE cuando corresponda;
no exponer secrets;
minimizar PII;
auditar operaciones administrativas sensibles.
Los guards frontend son UX, no frontera primaria de seguridad.
---
10. Migraciones
Nunca editar una migración histórica que ya pueda haber sido aplicada.
Todo cambio posterior debe usar una nueva migración incremental.
Una migración debe:
ser reproducible;
ser idempotente cuando corresponda;
respetar RLS;
incluir GRANT/REVOKE necesarios;
mantener mínimo privilegio;
disponer de tests cuando altere seguridad o reglas críticas.
---
11. Lógica de negocio
Locks, scoring, recálculos, permisos y reglas críticas deben ser server-authoritative.
No depender del frontend como única fuente de verdad.
Las reglas deben ser:
determinísticas;
testeables;
idempotentes cuando corresponda;
trazables.
No dispersar reglas críticas entre componentes de interfaz.
---
12. Performance
Optimizar con evidencia.
Revisar especialmente:
N+1;
consultas repetidas;
listas grandes;
joins;
payloads;
índices;
renderizado innecesario;
watchers costosos;
assets;
paginación;
agregaciones;
leaderboards;
scoring;
estadísticas.
No introducir complejidad prematura.
Si el cuello está en PostgreSQL, usar Database Performance.
---
13. UI/UX
La aplicación debe mantener:
mobile-first;
jerarquía visual clara;
consistencia entre pantallas;
una acción primaria evidente;
baja carga cognitiva;
feedback inmediato;
estados loading/empty/error/success;
accesibilidad básica;
navegación por teclado cuando corresponda;
buen contraste;
targets táctiles apropiados;
responsive tablet/desktop;
interfaces administrativas densas pero legibles.
UI atractiva no debe comprometer velocidad, claridad ni accesibilidad.
13.1. Design System obligatorio
Toda nueva funcionalidad frontend debe integrarse obligatoriamente al Design System vigente de SportLeagues.
Referencias oficiales:
`docs/design/reference/sportleagues-ui-reference.png`
`docs/design/DESIGN-SYSTEM.md`
`apps/platform/src/styles.css`
Estas referencias definen la identidad visual del producto. No tratarlas como inspiración opcional.
Mantener en toda UI nueva o modificada:
canvas dark navy;
superficies oscuras;
primary verde neón;
secondary cyan;
tipografía y jerarquía vigentes;
cards redondeadas;
botones pill;
bordes sutiles;
iconografía outline;
navegación coherente;
estados visuales consistentes;
comportamiento mobile-first;
adaptación responsive;
accesibilidad.
Reglas permanentes:
no volver al diseño legacy;
no introducir un sistema visual alternativo;
no crear componentes visualmente aislados;
reutilizar primero componentes compartidos existentes;
no duplicar patrones UI sin necesidad;
no usar colores, radios, spacing, sombras o tipografías arbitrarias si existe un token equivalente;
no introducir estilos inline o valores hardcodeados innecesarios cuando puedan expresarse mediante tokens o utilidades del sistema;
mantener Admin y Superadmin dentro de la misma identidad visual, aunque utilicen mayor densidad de información;
preservar la fidelidad visual del producto al añadir nuevas funciones.
Si una nueva funcionalidad requiere un patrón visual no contemplado:
revisar primero si puede resolverse con componentes existentes;
si no, extender `docs/design/DESIGN-SYSTEM.md`;
añadir o extender tokens/componentes reutilizables;
implementar la funcionalidad usando la extensión aprobada;
evitar soluciones visuales locales que no puedan reutilizarse.
13.2. Definition of Done UI
Una funcionalidad frontend no se considera terminada únicamente porque funcione técnicamente.
También debe cumplir:
usar el Design System vigente;
verse como parte del mismo producto SportLeagues;
ser consistente con la referencia visual oficial;
reutilizar componentes existentes cuando corresponda;
ser responsive;
ser accesible;
mantener estados loading/empty/error/success coherentes;
no introducir regresión visual al diseño legacy;
no contener estilos ad hoc innecesarios;
no romper navegación, composición ni jerarquía visual existente.
La inconsistencia visual es un fallo de Definition of Done para cualquier cambio frontend.
---
14. Gates mínimos
Ejecutar según corresponda:
`npm run typecheck`
`npm test`
`npm run build`
tests SQL
tests RLS
tests cross-tenant
tests de RPC
tests de regresión
revisión responsive
revisión accesibilidad
revisión de errores/loading/empty states
revisión de consistencia con `docs/design/DESIGN-SYSTEM.md` cuando exista frontend/UI
revisión contra `docs/design/reference/sportleagues-ui-reference.png` cuando exista frontend/UI
`git diff --check` cuando exista Git
No declarar un gate aprobado sin evidencia.
Si un gate no puede ejecutarse:
registrar causa;
impacto;
evidencia alternativa;
pendiente exacto.
---
15. Documentación
Consultar:
`references/state-management.md`
Ninguna tarea técnica importante se considera cerrada sin documentación.
Cada especialista debe registrar su resultado.
Solo:
Orchestrator
Documentation Agent
deben consolidar cambios globales en `PROJECT_STATE.md`.
Esto evita conflictos concurrentes.
---
16. Cierre de fase
Una fase solo puede marcarse completa cuando:
alcance aceptado;
tests relevantes pasan;
seguridad revisada cuando corresponda;
QA aprobado;
riesgos críticos resueltos o explícitamente aceptados;
documentación actualizada;
handoff disponible;
`PROJECT_STATE.md` refleja el estado real.
No cerrar fases porque "el código ya está".
---
17. Modo ágil
No convertir cada cambio en un proceso pesado.
Usar:
mini-spec para mejoras UI;
análisis corto para bugs;
Definition Ready completa para nuevas funciones;
ADR solo para decisiones estructurales.
La cantidad de agentes y documentación debe ser proporcional al riesgo.
---
18. Resultado al usuario
Responder de forma compacta:
Estado
`ACCEPTED`
`CHANGES_REQUIRED`
`BLOCKED_ADR`
`BLOCKED_EXTERNAL`
Fase
Fase activa.
Cambios
Resumen breve.
Archivos
Archivos principales modificados.
Validación
Tests/comandos ejecutados.
Documentación
Archivos actualizados.
Pendientes
Solo bloqueos o deuda relevante.
Siguiente
Próxima tarea permitida.
No ejecutar automáticamente la siguiente fase.