# ENCARGO MAESTRO V2 — EJECUCION INTENSIVA Y CIERRE INTEGRAL DE SPORTLEAGUES

**Tipo:** orden operativa de ejecucion para agentes de IA en VS Code; autonomia alta, cierre integral y entregables comprobables  
**Alcance:** arquitectura, logica de quinielas, roles, UX/UI, seguridad, limpieza, QA, cierre de fases y preparacion para produccion.  
**Estado inicial:** cambios de conector deportivo en `feat/api-football-connector` reportados pero no integrados; tickets gratuitos reportados en `main`/Vercel QA; comprobar contra el repositorio y entornos reales antes de asumirlo.

## MODO OPERATIVO PRIORITARIO: EJECUTAR HASTA CERRAR, NO SOLO ANALIZAR

**ORDEN DEL PROPIETARIO:** deja de convertir cada hallazgo en una nueva fase teorica. Debes **auditar lo indispensable y luego implementar, integrar, probar, reparar y cerrar TODO el alcance funcional y tecnico autorizado** en este documento. No te detengas al completar un inventario, una matriz, un informe, una pantalla o una fase. Usa el inventario como herramienta de trabajo, no como entregable final.

1. **Autonomia alta:** decide detalles tecnicos ordinarios de estructura, componentes, validaciones, nombres, pruebas y refactor que no cambien contratos, roles o datos sensibles; no pidas confirmacion por decisiones menores. No abuses de la frase «requiere aprobacion».
2. **Ejecucion continua:** aplica un ciclo repetible `inspeccionar brevemente -> implementar -> ejecutar pruebas -> corregir -> repetir -> actualizar estado -> siguiente tarea`. No solicites una nueva instruccion entre lotes tecnicamente desbloqueados.
3. **Resolver, no enumerar:** si encuentras un bug, arréglalo y demuestra la correccion. Si faltan tests, crealos. Si una vista esta inconclusa, terminala. Si el codigo esta desordenado, refactoriza con regresion. Si un test falla, investiga y repara antes de proclamar exito.
4. **Paralelizar inteligentemente:** usa especialistas en frontend, data/RLS, dominio, seguridad, QA y release sobre archivos no superpuestos; integra resultados con un responsable de arquitectura que resuelva conflictos y ejecute los gates. No hagas cambios concurrentes en la misma zona sin handoff.
5. **Prioriza MVP terminado:** no abras nuevas iniciativas, funcionalidades de lujo o experimentos mientras haya flujos del MVP rotos o pendientes. Reutiliza codigo existente, evita reconstruir. Preserva la logica real de quinielas.
6. **Bloqueo localizado:** si algo requiere acceso humano, aceptacion de ADR, pago, credenciales, envio de invitacion o UAT autenticada, marca SOLO esa tarea como bloqueada, registra una peticion de decision concreta y **continua todas las demas**. No uses un bloqueo puntual para suspender el proyecto entero.
7. **Cero simulaciones:** no afirmes que navegaste, desplegaste, limpiaste cuentas, enviaste invitaciones o corriste pruebas si no lo hiciste realmente. Distingue `DONE_VERIFIED`, `DONE_PENDING_UAT` y `BLOCKED`.
8. **Cierre visible:** conserva un tablero de tareas con responsables, evidencia, dependencias, prioridad y siguiente accion. Una tarea no se considera cerrada solo porque compile; debe cumplir los criterios de aceptacion descritos mas abajo.
9. **No generar burocracia:** ADR solo para decisiones que lo requieren; handoffs condensados y estado del proyecto en una fuente unica. No crees documentos duplicados para justificar inaccion.
10. **Preservar limites de seguridad:** autonomia alta **no** autoriza borrar usuarios reales, hacer cambios irreversibles en datos compartidos, publicar pagos o resultados automaticos, exponer secretos, promover roles sin aprobacion ni desplegar produccion comercial sin autorizacion expresa. Los gates de `AGENTS.md` siguen vigentes.

**Mandato de comportamiento:** si el usuario ya expreso una prioridad y el repositorio permite avanzar, **haz el trabajo**. No cierres una respuesta con «puedo continuar cuando me lo indiques» mientras existan tareas habilitadas. Cuando alcances el limite real de herramientas o contexto de una sesion, deja un punto de reanudacion preciso y verificable para que la siguiente ejecucion retome automaticamente la siguiente tarea.

## 0. Contrato de ejecucion y fuentes de verdad

Actua como un equipo coordinado de arquitectura, Vue 3/TypeScript, Supabase/PostgreSQL/RLS, seguridad, UX/UI mobile-first, QA y release. Trabaja sobre el repositorio **actual** (no asumas que el ZIP o un informe anterior son la version mas reciente). Lee antes de editar:

- `AGENTS.md`, `PROJECT_CONFIG.md`, `PROJECT_STATE.md`, `README.md`.
- ADRs aceptados en `docs/architecture/adr/`, especialmente ADR-002, ADR-003, ADR-005, ADR-008, ADR-011, ADR-012, ADR-014 y ADR-015; sus revisiones y anexos.
- `docs/product/PRD-MVP.md`, `docs/product/AMPLIACION-QUINIELAS-ROLES-INGRESOS.md`, `docs/product/ROADMAP-MOVIL-TICKETS-PRONOSTICOS-APIS.md`.
- `docs/requirements/`, `docs/operations/`, `docs/testing/`, handoffs en `docs/agents/`, `reports/` y `references/legacy-quiniela/`.
- Implementacion real en `apps/platform/src/`, `supabase/migrations/`, `supabase/tests/` y el resto de modulos existentes.

**Precedencia:** respeta el orden de fuentes de verdad de `AGENTS.md`. Las decisiones de producto expresas de este encargo son nuevos requerimientos; si chocan con un ADR aceptado o un contrato de autorizacion, redacta el ADR/cambio necesario y detente **solo en la parte bloqueada**, sin hacer un cambio silencioso. No uses codigo heredado como autoridad frente a ADRs y reglas actuales.

Al comenzar, comprueba `git status`, ramas, SHAs, diferencias contra `main`, migraciones locales/remotas, entorno Supabase, Vercel y secretos expuestos solo por nombre (nunca mostrar valores). Distingue hechos observados de afirmaciones previas de otro agente. Antes de cada modificacion declara los archivos y el alcance. No modifiques archivos de otro agente simultaneamente sin coordinacion.

## 1. Objetivo principal y criterio de producto

**Consolidar el producto existente, no reconstruirlo desde cero.** El resultado debe ser una aplicacion sencilla, estable, segura, mantenible, con dos experiencias visibles (`admin` y `user`), quinielas completas, finanzas privadas por administrador y fases tecnicas cerradas en la medida en que exista evidencia real. Prioriza correcciones, integracion, UX/UI, seguridad y pruebas sobre incorporar funciones nuevas innecesarias.

No confundir roles de interfaz con capacidades internas. Pueden mantenerse permisos granulares, `tenant_memberships`, `pool_staff`, `pool_admin_exclusions` y restricciones de base de datos cuando sean necesarios. Ningun cambio de nomenclatura de rol puede debilitar RLS o borrar excepciones historicas.

## 2. Dos experiencias visibles y separacion del Superadministrador

### `admin` — administrador de sus quinielas

Puede gestionar **solo** las ligas/quinielas sobre las que tiene capacidades legitimas: panel, equipos, catalogo, competiciones, jornadas, partidos, participantes, invitaciones, codigos, resultados oficiales, rankings, configuracion, branding segun plan, reportes y **sus propias finanzas** cuando existan. Los modulos no desarrollados se muestran como no disponibles o se ocultan; no simular operatividad.

### `user` — participante

Puede registrar/iniciar sesion, explorar quinielas, solicitar acceso/unirse, consultar sus ligas, crear y gestionar sus tickets y pronosticos segun reglas, ver resultados/rankings/historial, editar perfil y **solicitar crear su propia quiniela** desde `Mi perfil`.

La solicitud se registra de manera idempotente, con estados `pending/approved/rejected` o equivalentes y auditoria. **Nunca** debe asignarse privilegios de administrador desde el cliente, claims editables o RPC de autoservicio. Diseñar aprobacion segura para un operador autorizado fuera del frontend publico hasta que exista la consola externa; si falta decision de producto, dejar el mecanismo registrado y bloqueado, sin autoaprobar.

### Superadministrador

**No debe existir como tercera experiencia, menu, ruta o panel dentro de la aplicacion principal.** El control global pertenecera a otra aplicacion/entorno protegido en el futuro. Auditar rutas y componentes existentes (incluido `SuperadminShell.vue` si sigue presente) y preparar la separacion. Como existen ADR-008, `platform_admins` y autorizaciones privilegiadas, **no eliminar ni desactivar infraestructura de manera improvisada**: documentar impacto, proponer ADR/migracion de compatibilidad, pruebas y retirada segura de la UI publica. No crear una puerta trasera temporal ni exponer operaciones globales a `admin`.

**Regla de negocio innegociable:** un administrador no puede competir en la quiniela que administra; la incompatibilidad historica y excepciones por quiniela siguen ADR-015. Puede participar en otras quinielas que no administra. No perder esta regla al unificar las experiencias visibles.

## 3. Navegacion y UX/UI por rol

Definir y aplicar una matriz de rutas, menus, acciones y permisos. Propuesta de navegacion, ajustable al codigo existente:

- **Admin:** Dashboard; Mis quinielas; Equipos y competiciones; Jornadas y partidos; Participantes; Resultados; Rankings; Mis finanzas; Configuracion; Mi perfil.
- **User:** Inicio; Explorar quinielas; Mis quinielas/tickets; Mis pronosticos; Resultados y rankings; Historial; Mi perfil. En perfil, CTA visible: **«Crear mi propia quiniela»** (solicitud, no elevacion automatica).

La UI debe ser mobile-first, responsive, accesible y clara; usar componentes compartidos, estados de carga/vacio/error, feedback de permisos y navegacion tipo app movil. Proteger rutas y **tambien** RPC, Edge Functions, SQL y RLS. Ocultar botones no es autorizacion. Un `admin` que participe en otras quinielas debe poder acceder a las vistas de participacion correspondientes sin cambiar a un tercer rol.

## 4. Logica existente de quinielas: inventariar, preservar, completar

Antes de refactorizar, construir una **matriz funcional basada en codigo real**: funcion, reglas, archivo/componente, RPC/SQL, permisos/RLS, pruebas, estado (implementada/parcial/pendiente) y accion (mantener/corregir/completar). No atribuir funcionalidades al producto solo porque figuren en documentos o codigo PHP heredado.

Revisar la logica existente de: registro y acceso a ligas; administracion de quinielas y participaciones; equipos y catalogo; jornadas, encuentros, horarios y cierres; tickets gratuitos y sus limites; pronosticos; resultados manuales; scoring deterministico; ranking; desempates; recalcule por correccion oficial; estadisticas; planes Free/PRO; branding; integraciones; permisos y auditoria.

Conservar especialmente:

- Cierre/lock definido y comprobado en **servidor/DB** con hora confiable; no permitir cambios posteriores.
- Privacidad de pronosticos ajenos hasta el momento aprobado.
- Tickets por jornada con controles server-side de cupo, elegibilidad, borrador/envio/cancelacion, versionado, idempotencia y concurrencia; respetar ADR-014, su revision y la migracion real. No inventar estados/transiciones nuevas.
- Rankings, mejor ticket elegible y criterios de desempate segun contratos implementados; puntos oficiales nunca calculados/autorizados solo por el cliente.
- Recalculo consistente tras revision de resultado, sin duplicar puntuacion ni sobreescribir resultados manuales silenciosamente.
- Incompatibilidad de admin/participante segun ADR-015, incluidos bloqueos historicos y promocion restringida.
- Registros de auditoria, limites Free/PRO y aislamiento por tenant/pool en SQL, no solo UI.
- Funciones estadisticas Elo + Poisson, flyers, PWA y otras fases del MVP que consten en alcance aprobado, verificando cuales estan realmente terminadas.

Examinar `references/legacy-quiniela/` como **referencia funcional** de tickets, jornadas, rankings y panel; no copiar a ciegas PHP, permisos ni calculos. No introducir dobles/triples ni pagos nuevos si no estan aprobados. Registrar diferencias entre legado, producto actual y pendientes; preservar lo que funciona.

## 5. Finanzas estrictamente privadas por administrador

Auditar `tenant_id`, propiedad de ligas, `pool_staff`, roles y limites de acceso. Cada administrador ve exclusivamente ingresos, pagos manuales registrados, comisiones, saldos, reportes y exportaciones que pertenezcan a **sus** quinielas y para los que tenga capacidad autorizada. Un `admin A` no debe leer, editar, exportar ni inferir las finanzas de `admin B` manipulando URLs, ids, JWT o RPC. No dar acceso global a `admin`.

Probar casos negativos de acceso cruzado para consultas, RPC, funciones `SECURITY DEFINER`, Edge Functions y descargas. Si finanzas reales aun no existen, crear solo vistas de estado coherentes con el codigo, no dinero ficticio ni cobranza automatica. No desplegar pasarelas, wallets, escrow, cobros reales o servicios comerciales sin decision aparte.

## 6. Catalogo, resultados hibridos, API-Football y cache

Preservar el conector y catalogo que esten realmente en `feat/api-football-connector` y validar su diferencia con `main`: paises, selecciones, clubes, competiciones, importacion idempotente, administracion manual, adaptador desacoplado, cuotas y `external_refs`. Reconocer y documentar limites de calidad de Wikidata y derechos de imagen; no añadir escudos sin licencia verificable.

- **Manual** es el modo predeterminado y siempre funcional.
- `auto_results` sigue apagado; no programar ni desplegar `sports-sync` sin aprobacion.
- No comprar plan API-Football ni usar claves en el frontend.
- Nunca sobrescribir silenciosamente un resultado manual; registrar conflictos y auditoria.
- IndexedDB: catalogo publico y cache privada por cuenta; limpiar al cerrar sesion/cambiar de cuenta, aplicar cuotas/TTL y no aceptar cache como autoridad para registrar pronosticos.
- Verificar que las migraciones reportadas `20261017000100`, `20261018000100` y `20261019000100` realmente existan en el repositorio actualizado y esten aplicadas solo donde corresponde; el ZIP anterior termina en `20261016000100`.

## 7. Limpieza de codigo y seguridad integral

Realizar una auditoria del repositorio y refactor incremental: responsabilidades, estructura por dominio, componentes reutilizables, servicios duplicados, imports, dependencias, tipos, SQL, manejo de errores, archivos obsoletos y pruebas fragiles. Evitar reescritura total, breaking changes y cambios esteticos que oculten errores funcionales. No borrar codigo de seguridad o compatibilidad sin prueba de reemplazo.

Revisar y corregir: autenticacion y sesiones, RLS/GRANT/REVOKE, IDOR/cross-tenant, `SECURITY DEFINER`, SQL injection, XSS, CSRF cuando aplique, seguridad de cookies/tokens, controles de roles, rate limits, cuotas de proveedor, logs/PII, secretos, almacenamiento local/IndexedDB, Edge Functions, dependencias y auditoria. Reevaluar los tres hallazgos bajos reportados: orden de bloqueo/autorizacion, `updated_at` y retencion de `fixture_sync_log`; asignar correccion o excepcion justificada con responsable.

Para recomendar lanzamiento: **cero hallazgos criticos o altos conocidos** y ningun hallazgo medio sin correccion o aceptacion formal documentada. No afirmar «cero vulnerabilidades» por haber pasado las pruebas.

## 8. Usuarios de prueba y cuenta de validacion

En **Supabase QA solamente**, identificar todas las identidades persistentes y distinguir: cuentas sinteticas, cuenta real de validacion, usuarios reales y cuentas tecnicas. Objetivo: **maximo 5 cuentas humanas persistentes usadas para QA en total**, incluyendo `quinielasvilla@gmail.com` si se usa como cuenta de validacion; las identidades tecnicas estrictamente necesarias se inventarian aparte. Preferir fixtures transaccionales/efimeras para pruebas automatizadas.

1. Inventariar Auth, perfiles, memberships, participaciones, tickets, predicciones, auditoria, pagos y otras FK; identificar duplicados y residuo sintetico.
2. Definir cuales conservar (cobertura minima: admin A, admin B, usuario, cuenta solicitada y una adicional solo si hace falta).
3. Preparar respaldo, impacto FK, plan de restauracion y lista exacta de eliminacion. **Nunca eliminar usuarios reales, datos de produccion o registros financieros/auditoria obligatorios**; si la identidad o propiedad son dudosas, bloquear solo ese borrado y pedir aprobacion sobre la lista.
4. Eliminar exclusivamente cuentas QA inequivocamente sinteticas que no se necesiten, despues de salvaguardas y verificaciones; no modificar directamente `auth.users` evitando los mecanismos oficiales de Supabase. Verificar integridad tras cada lote.

Para `quinielasvilla@gmail.com`: buscar cuenta existente sin duplicar; si falta, emitir invitacion oficial sin contraseña fija y sin omitir verificacion de correo. Asignar **solo** experiencia `user`, comprobar que tenga acceso como participante a las **ligas de prueba QA autorizadas** (no ligas reales/privadas ajenas); registrar membresias idempotentes y documentar si la invitacion queda pendiente de aceptacion. No divulgar credenciales, tokens ni UUIDs en informes.

## 9. Cierre de fases y plan de ejecucion

Reconstruir el estado real de cada fase de `PROJECT_STATE.md` con evidencia de codigo, pruebas, migraciones y despliegue; el estado documental puede ser historico o contradictorio. Clasificar: COMPLETE, PARTIAL, BLOCKED_SECURITY, BLOCKED_EXTERNAL, BLOCKED_DECISION. Cerrar en secuencia las tareas **tecnicamente desbloqueadas**; no acumular diagnosticos sin implementar correcciones posibles. Trabajar en lotes pequenos, cada uno con cambios, tests y handoff.

Orden prioritario:

1. **P0:** compatibilidad `main`/rama/QA; autorizacion, seguridad, roles, finanzas y regresiones de tickets.
2. **P1:** matriz funcional, UI por rol, solicitud de quiniela, catalogo, modulos incompletos, limpieza controlada de QA y acceso del usuario invitado.
3. **P2:** cerrar fases MVP faltantes, rendimiento, accesibilidad, PWA/movil, observabilidad y preparacion release segun dependencias reales.

Respetar ADR y permisos para migraciones estructurales, cambio de modelo de autorizacion o esquema central. **No ejecutar merge a `main`, despliegue Vercel, push de nuevas migraciones a base compartida, cambios en produccion ni acciones irreversibles no verificadas sin autorizacion expresa.** Se autoriza inspeccionar, refactorizar en rama, implementar y probar localmente o en entornos de prueba aislados; los cambios que puedan afectar a QA compartido requieren control del impacto y permisos existentes. No contratar proveedores ni activar pagos o resultados automaticos. No marcar una fase COMPLETE si falta UAT humana autenticada o un gate obligatorio.

## 10. Pruebas y aceptacion

Ejecutar las pruebas relevantes ya existentes (typecheck, unitarias, SQL/RLS, E2E HTTP con sesiones autorizadas, build, bundle, `git diff --check`), ampliandolas para roles y finanzas. Casos minimos:

- `admin A` administra su liga y no accede ni a datos privados ni a finanzas de `admin B`.
- `user` no accede a rutas, RPC, acciones administrativas ni privilegios globales, incluso manipulando solicitudes.
- `admin` no participa en su propia quiniela, incluidas exclusiones historicas; si puede competir en otra autorizada.
- Solicitud «Crear mi propia quiniela» persiste, no se duplica y no se autoaprueba.
- Catalogo, importacion concurrente, partidos manuales, tickets y pronosticos respetan locks/limites.
- Resultados corregidos recalculan scoring de forma idempotente; el ranking refleja la regla vigente.
- Cache privada no se filtra entre usuarios y no autoriza escrituras.
- Invitacion/membresias QA de `quinielasvilla@gmail.com` se verifican sin acceder indebidamente a una cuenta ajena.
- Navegador real en movil con usuario autenticado, paneles de ambos roles, formularios, errores, estados vacios y responsive.

Si no hay cuenta/sesion o navegador para UAT, entregar checklist reproducible y marcarla **PENDING**, nunca PASS simulado. Si Vercel bloquea sondeos automaticos, no inventar SHA publicado: verificar por medios oficiales autorizados o dejar evidencia del bloqueo.

## 11. Entregables y formato de respuesta

Crear/actualizar los reportes y handoffs pertinentes, sin saturar el proyecto de documentos duplicados:

1. SHAs/ramas, `git status`, alcance y entorno realmente observado.
2. Matriz de funcionalidades presentes/parciales/faltantes y comparacion con legado.
3. Matriz **UI + permisos** de `admin`/`user`, diseño de separacion de Superadmin y decisiones/ADR pendientes.
4. Inventario de finanzas y evidencias negativas cross-tenant.
5. Lista de archivos cambiados y proposito; decisiones de refactor.
6. Hallazgos de seguridad con evidencia, severidad y remediacion o excepcion formal.
7. Inventario QA y limpieza efectuada/pediente (sin PII innecesaria), invitacion y acceso a ligas de prueba de `quinielasvilla@gmail.com`.
8. Estado por fase y pruebas ejecutadas, comandos/resultados, fallos y UAT pendiente.
9. Compatibilidad de migraciones y frontend, riesgos, pasos de rollback y condiciones para merge/release.
10. Proximo lote ejecutable y decision solicitada **solo** si realmente necesita autorizacion.

Veredicto final fundamentado: `READY_FOR_MERGE`, `READY_FOR_QA`, `READY_FOR_PRODUCTION`, `CHANGES_REQUIRED`, `BLOCKED_SECURITY` o `BLOCKED_EXTERNAL`. `READY_FOR_PRODUCTION` exige pruebas y UAT criticos completos, seguridad aceptable y autorizaciones de release, no solo build verde.

**Comienza por una inspeccion breve y crea las matrices necesarias; no cierres ahi: ejecuta inmediatamente el primer lote de implementacion y continua con los siguientes lotes desbloqueados. No pidas permiso para refactorizaciones y pruebas seguras ya autorizadas. Ante gates explicitos, registra la decision requerida y sigue por los demas frentes. El producto solo queda declarado terminado cuando cumpla los criterios de cierre integral de las siguientes secciones.**


## 12. PLAN DE ATAQUE OBLIGATORIO: DE PENDIENTES A PRODUCTO TERMINADO

Implementa el siguiente orden **sin convertirlo en una secuencia de aprobaciones artificiales**. Puedes reorganizar dependencias con evidencia, pero debes cubrir el 100% del inventario funcional aprobado:

**Lote A — Estabilizacion y arquitectura (P0)**
- Comprobar ramas, SHA, migraciones, paquetes y entornos reales. Determinar compatibilidad `main`/`feat/api-football-connector`/Supabase QA/tickets desplegados.
- Construir **solo una vez** un inventario de brechas y priorizarlo por impacto y dependencia. No confundir el ZIP previo con el estado actual.
- Corregir primero autorizacion multi-tenant, errores de permisos, fallos de scoring/tickets, problemas de base de datos e inconsistencias UI/API.
- Reducir riesgos de regresion con pruebas nuevas antes de mover logica delicada.

**Lote B — Aplicacion de dos roles terminada (P0/P1)**
- Completar flujos de administrador y usuario de principio a fin: login, redireccion, navegacion, dashboard, listas, formularios, detalle, estados de carga/error/vacio, notificaciones, permisos y responsive.
- Eliminar experiencia Superadmin del frontend principal sin destruir autorizaciones de plataforma que deban migrarse por ADR.
- Completar la solicitud «Crear mi propia quiniela» desde el perfil. Registrar flujo de aprobacion seguro y auditable; **no autoelevar** privilegios.
- Garantizar que `admin` pueda participar en otras quinielas, nunca en la que administra, conforme a ADR-015.

**Lote C — Quinielas funcionales de extremo a extremo (P0/P1)**
- Verificar y completar alta/configuracion de quiniela, equipos, catalogo, jornadas, partidos, invitaciones/acceso, participantes, tickets, pronosticos, locks, resultados manuales, scoring y rankings.
- Hacer coincidir UI, contratos TypeScript, RPC, SQL, RLS, estados y mensajes. No dejar botones funcionalmente vacios o pantallas desconectadas.
- Arreglar errores de idempotencia, concurrencia, desbordes de cuota, correcciones de resultado y privacidad. Verificar exclusiones admin/participante.
- Dejar conectores deportivos disponibles como integracion opcional **sin activar resultados automaticos ni proveedores pagos**.

**Lote D — Finanzas, seguridad y QA controlada (P0/P1)**
- Si hay flujos financieros **manuales** en el MVP, terminarlos sin activar cobro real; el administrador solo ve su propia informacion financiera. Si un concepto no existe en el MVP, no inventar dinero ni reportes falsos.
- Completar auditoria de dependencias, secretos, autorizacion, RLS, Edge Functions, RPC y caché. Corregir hallazgos y repetir pruebas negativas entre dos admins y usuarios.
- Inventariar cuentas QA; reducir a cinco cuentas humanas persistentes **solo despues de la autorizacion requerida para el listado de borrado** y el respaldo. Crear o invitar a `quinielasvilla@gmail.com` y dar acceso a ligas QA autorizadas cuando el entorno y los permisos lo permitan.

**Lote E — Calidad visual, pruebas reales y release (P1/P2)**
- Terminar UI/UX mobile-first, accesibilidad, rendimiento, PWA/Capacitor y todos los modulos MVP que figuran en las fuentes de verdad; no declararlos completos por apariencia.
- Ejecutar la bateria de tests y hacer bucle de reparacion hasta que pase, o hasta una limitacion objetiva y documentada.
- Ejecutar UAT con navegadores/sesiones autorizadas cuando existan; si no existen, dejar checklist reproducible y continuar el resto.
- Preparar integracion, changelog, rollback, pipeline y release candidate. Pedir **una autorizacion consolidada** para merge/despliegue si sigue siendo gate obligatorio; no solicitar autorizacion por cada archivo o correccion.

**Prohibido:** finalizar el encargo en fase de «analisis completado», «estructura propuesta», «vistas maquetadas», «esperando siguiente fase» o «listo para empezar» si existen tareas autorizadas no ejecutadas.

## 13. CRITERIOS ESTRICTOS DE DEFINICION DE TERMINADO (DoD)

Una funcionalidad se etiqueta `DONE_VERIFIED` solo cuando cumple conjuntamente:

- Existe codigo real integrado en la rama de trabajo, no pseudocodigo, mocks que sustituyen la funcionalidad de produccion ni `TODO/FIXME` pendientes sobre el camino principal.
- Es utilizable de extremo a extremo con datos validos; tiene estados de carga, error, vacio y permisos cuando aplica.
- Respeta permisos por rol, RLS y aislamiento; los casos de denegacion son probados donde corresponda.
- Tiene cobertura automatizada pertinente y pruebas de regresion de los caminos criticos; typecheck/build/lint si existen pasan.
- Respeta las decisiones de producto y las reglas historicas de tickets, puntuacion, clasificacion y exclusiones.
- No rompe funcionalidades existentes y tiene evidencia de comandos, archivos y resultados.
- Queda reflejada en `PROJECT_STATE.md` y en un unico informe de avance actualizado.

Un modulo solo pasa a `DONE_PENDING_UAT` si el codigo y pruebas automatizadas estan cerrados pero **falta una comprobacion humana/no automatizable**. Un release solo llega a `READY_FOR_PRODUCTION` cuando los gates obligatorios, UAT critico, configuracion y autorizacion de release estan satisfechos; si falta un requisito, mostrar claramente lo que impide publicarlo.

**Meta de cobertura:** cerrar todas las funcionalidades del MVP aprobadas y las brechas tecnicas y de seguridad materialmente relevantes. Si una funcionalidad corresponde expresamente a fase futura o depende de pagos/proveedor, clasificarla `OUT_OF_SCOPE_APPROVED` o `BLOCKED_DECISION` y no usarla para justificar que el MVP esta incompleto.

## 14. AUTOMATIZACION Y DISCIPLINA DE EJECUCION

- Mantener tareas pequenas pero ejecutarlas en **cadena**, no detener la ejecucion para entregar un reporte entre cada una.
- Agrupar cambios por dominio sin generar PRs enormes e imposibles de auditar. Hacer commits locales descriptivos cuando el flujo del repositorio lo permita.
- Delegar en paralelo audit/QA/docs sin colisionar zonas de edicion; el integrador responde por los tests finales.
- Antes de marcar un defecto como `BLOCKED`, investigar al menos el codigo, reproducibilidad, un caso de prueba y una alternativa compatible. Bloqueos reales por credenciales, permisos, ADR o disponibilidad humana se documentan sin fingir su resolucion.
- Cuando el repositorio tenga problemas preexistentes, separarlos de regresiones introducidas por la tarea y corregir los que impidan el MVP.
- Evitar bucles improductivos: no volver a generar la misma matriz cada vez, no ejecutar auditorias identicas sin cambio de codigo/entorno y no repetir resultados de pruebas anteriores como si fueran nuevos.
- Preparar comandos de ejecucion reproducibles para Windows/VS Code y los scripts que ya tiene el proyecto; no incorporar un orquestador nuevo salvo necesidad justificada.
- Toda implementacion debe mantener la compatibilidad de esquema, versiones y aplicaciones cliente dentro del alcance; aplicar migraciones a QA compartido o cambios de permisos centrales solo en condiciones autorizadas por `AGENTS.md` y ADRs.

## 15. FORMATO DEL INFORME FINAL: PRODUCTO, NO PROMESAS

Responde con un cuadro de mando compacto que sea **evidencia de trabajo concluido**, no una lista de intenciones:

| Campo | Evidencia obligatoria |
|---|---|
| Estado general | `DONE_VERIFIED`, `DONE_PENDING_UAT`, `READY_FOR_QA`, `READY_FOR_PRODUCTION` o `BLOCKED` |
| Modulos cerrados | Nombre y prueba real de funcionamiento |
| Modulos no cerrados | Bloqueo concreto, gravedad, dependencia y siguiente accion |
| Seguridad | Hallazgos y tests de aislamiento multi-tenant |
| Interfaz | Vistas `admin` y `user` terminadas/pendientes |
| QA | Tests ejecutados, conteos reales, UAT y evidencia |
| Entornos | Rama, SHA, estado de migraciones y despliegue verificados |
| Usuarios de prueba | Inventario/depuracion, cuenta invitada y membresias QA con estado real |
| Cambios | Archivos/commits/PRs efectivamente creados |
| Release | Checklist, rollback y una unica lista de autorizaciones indispensables |

**ULTIMA ORDEN:** toma la iniciativa y completa todo el trabajo implementable dentro de las restricciones de seguridad. No solicites autorizacion para avanzar de una tarea local segura a otra. Si una decision externa bloquea una parte, ejecuta las restantes, deja la entrega preparada y solicita al propietario solo la aprobacion exacta que falta. No llames «terminado» a lo que no verificaste; no llames «pendiente» a lo que ya puedes implementar.
