# UAT móvil autenticada en navegador real — Supabase QA (2026-10-24)

> El nombre del archivo se mantiene (`-20261012`) por continuidad con el plan; la ejecución es del **2026-10-24/25 (UTC)**.

- Rama: `feat/api-football-connector`, HEAD `d6af695`. El build se hizo **una sola vez al inicio** (23:31 UTC del 24-10), cuando `apps/platform/` no tenía cambios sin confirmar; las ediciones concurrentes posteriores de otro ingeniero (p. ej. `PlansView.vue`, `LegalAcceptanceView.vue`, migración `20261024000700`) **no** están en el build probado.
- Entorno: app construida localmente (`vite build` en un `outDir` propio fuera del repo) servida con `vite preview` en `http://127.0.0.1:4391`, apuntando a **Supabase QA** `juoftaofzepxbrrxbkhx` (`apps/platform/.env.local`). Nunca producción.
- Navegador: Google Chrome instalado, `--headless=new`, controlado por CDP con el cliente propio `scripts/qa/uat/cdp.mjs` (WebSocket nativo de Node 24, **sin dependencias nuevas**). Emulación móvil: UA Android/Chrome, DPR 3, eventos táctiles reales (`Input.dispatchTouchEvent`), `prefers-reduced-motion: reduce`. Un solo Chrome a la vez.
- Identidades: solo las 5 fijas `qa-*@example.test` vía `ensureQaIdentities()` (contraseñas aleatorias en memoria; no se imprimieron ni guardaron; SEC.b verifica que tampoco quedan en almacenamiento, IndexedDB, consola ni URL). Autorización del propietario: `QA_OWNER_AUTHORIZED=yes`, datos sintéticos.
- Capturas y `results.json`: `C:\Users\Acer\AppData\Local\Temp\claude\uat-out\` (fuera del repo, **no se versionan**; contienen solo datos sintéticos).

## 1. Método

Cada caso ejecuta el flujo **por la UI real** (toques, escritura con `Input.insertText`) y afirma comportamiento observable: texto/estado del DOM, peticiones RPC reales registradas por CDP (sin contar las OPTIONS de CORS), cuerpos de respuesta, filas en la BD (lectura de verificación con `service_role`, nunca escritura salvo lo indicado en §6), IndexedDB, Cache Storage del SW, scroll horizontal, tamaño de objetivos táctiles, contraste computado y errores de consola. Lo que no se puede hacer localmente se marca `NOT_RUN` con su motivo.

Técnicas específicas:
- **Hora del servidor vs. dispositivo** (P2, T1.aviso): se desplaza el reloj del dispositivo inyectando un `Date` desplazado antes de cargar el documento (`setDeviceClock` en `lib.mjs`); la BD sigue usando su hora.
- **Privacidad** (P3) y **escalada** (SEC.d/e): además del DOM, consultas REST/RPC hechas **desde la página** con el JWT que la app guardó (`restInPage`); el token no sale de la página.
- **Red**: `Network.emulateNetworkConditions` (sin red; 1,5 s de latencia; «4G lenta» 150 ms/1,6 Mbps) y CPU 4x (`Emulation.setCPUThrottlingRate`).
- **Calidad móvil** (b4): auditoría DOM `scripts/qa/uat/audit.mjs` (no Lighthouse) en 17 pantallas × 320/390/430 px.
- Para poder medir pantallas de organizador pese a UAT-01 se reescribe **solo** la URL del embed roto (`Fetch.continueRequest` quita `,profiles(display_name)`); se indica en cada caso donde se usa.

Bloques (`scripts/qa/uat/`): `b1` organizador · `b2` participante · `b3` sesión/caché/seguridad · `b4` calidad móvil por pantalla y viewport · `b5` rendimiento y PWA.

## 2. Resultado global

| | PASS | FAIL | NOT_RUN |
| --- | --- | --- | --- |
| Casos funcionales, sesión, seguridad, rendimiento y PWA (tabla §3) | 33 | 8 | 3 |
| Matriz de calidad móvil `Q.*` (17 pantallas × 3 anchos) | 21 | 30 | 0 |
| Accesibilidad `A11Y.*` (documento, contraste, texto 200 %, foco) | 34 | 7 | 0 |
| **Total** | **88** | **45** | **3** |

Incluye **P1** (FAIL) de la ejecución de 2026-10-24T23:53Z (archivo `results-ejecucion-p1-20261025.json`): la espera de aprobación solo puede observarse una vez por identidad y ya no queda identidad libre (ver §5). El resto procede de la ejecución completa de 2026-10-25 00:10–00:27Z más la repetición de `b1`, `b3` y `b4` tras corregir defectos del arnés (00:27–00:45Z) — `results.json`.

## 3. Casos funcionales, sesión, seguridad, rendimiento y PWA

| Caso | Estado | Evidencia observada (resumen) |
| --- | --- | --- |
| A1 Admin: navegación | PASS | Barra «Panel, Quinielas, Parrilla, Finanzas, Perfil»; franja «Modo participante · Volver a Inicio» 44 px; 0 enlaces superadmin/plataforma. |
| A2 Ruta global | PASS | `/superadmin` → `/`, sin texto de plataforma. |
| A3.a Parrilla: crear | PASS | Jornada y partido creados desde la UI (1 fila, `scheduled`). |
| A3 Publicar/corregir | PASS | 2-1 → rev 1; corrección 0-0 → rev 2, 1 fila (sin duplicar); 2 llamadas RPC; sin scroll horizontal (390/390). Recálculo con pronósticos: cubierto por el E2E de API (paso 10). |
| FE-01.parrilla | PASS | Solo local «2» → 0 llamadas a `publish_official_result`, mensaje «Revisa el marcador de la visita…», 0 filas. |
| FE-02.panel / FE-02.branding | PASS / PASS | Campos vacíos no llaman a `manage_pool`/`publish_pool_rules`; branding Free deshabilitado, 0 llamadas, colores sin cambios (rama PRO no ejecutable: no hay tenant PRO en QA). |
| F1 Finanzas propias | PASS | Sin cifras monetarias; aviso «no cobra ni procesa pagos»; UI 8 participantes/4 pagados = BD 8/4. |
| F2 Finanzas ajenas | PASS | Con ids de la organización B en la URL: sin rastro de B en DOM, un solo selector propio. |
| F3 Participante y finanzas | PASS | `/admin/ingresos`, `/organizador`, `/admin`, `/admin/parrilla` → `/` sin barra de organizador; en su liga la pantalla solo recibió su propia fila de `participants`. |
| P1 Inscripción y aprobación | **FAIL** | Código → «Tu inscripción está pendiente…», 0 campos, BD `pending`; qa-admin-b aprueba desde `/admin` (BD `approved`); **al volver a abrir la app sigue «pendiente» y sin formulario, con 0 lecturas de `/participants`** (caché privada fresca) → UAT-02. |
| P1.aprobado | PASS | qa-outsider (aprobado) en dispositivo sin caché: re-inscripción idempotente (1 fila), formulario visible. |
| P2 Pronósticos y cierre | PASS | Guardar 1-0 y editar 2-1 → 1 fila en BD. Cerrado con reloj real: sin formulario, «Pronósticos cerrados». Con el reloj del dispositivo atrasado la UI ofrece el formulario, `save_prediction` → HTTP 403 `42501`, mensaje «El pronóstico ya está cerrado o no estás habilitado…», 0 filas. |
| P3 Privacidad | PASS | qa-user1 tiene 5 pronósticos en el partido abierto (9-8): la pantalla de qa-user2 no lo muestra; 0 filas ajenas en respuestas; consulta directa con la sesión de qa-user2: abierto → 0 filas de qa-user1; cerrados → 6/6 visibles. |
| P4 Admin ≠ participante | PASS | Propia: 0 formularios ni botones de ticket; ajena (inscrito): 2 campos y «Guardar pronóstico». |
| T1 Tickets | PASS | Cupo 2/2: sin «Nuevo ticket» y aviso de máximo; selecciones guardadas y envío; cancelar → 1/2 y reaparece el botón; reemitir → 2/2; sin red el intento falla sin crear nada; reintento con 1,5 s de latencia y doble toque → exactamente 1 ticket nuevo; nunca > cupo. |
| T1.aviso | PASS | Reloj del dispositivo a 30 min del cierre: banner «Un cierre próximo · aún sin ticket enviado · cierra en 30 min» y «La venta cierra en 30 min». |
| T1.reintento | **FAIL** | Tras el fallo sin red el panel entero pasa a «Algo salió mal · No fue posible cargar tus tickets.» **sin acción de reintento**; al volver la red sigue así hasta salir y volver a la pestaña → UAT-05. |
| R1 Rankings | PASS | Tabla general y por jornada idénticas a `pool_leaderboard` (posición, nombre, puntos, «N exactos · racha N»); organizadores no figuran; fila propia resaltada. |
| S1 Solicitud de quiniela | PASS | Envío con doble toque → 1 solicitud `pending`, «Solicitud pendiente», sin botón para reenviar; sin acceso de organizador (Inicio sin acceso, `/admin` → `/`, 0 membresías). |
| S1.cancelar | PASS | Cancelación desde la UI → 0 pendientes (QA queda sin solicitudes vivas de qa-user1). |
| X1 Auto-fill | PASS | «Sugerir marcador» rellena 1-1, «(ya cargada; no está guardada)», 3 probabilidades, «no es una certeza ni una recomendación de apuesta»; 1 llamada `suggest_scoreline`, 0 `save_prediction`, BD sin cambios. |
| C1 Cierre de sesión y caché | PASS | Mismo documento sin recargar: IndexedDB `u:qa-user1` → `{}` tras cerrar sesión → solo `u:qa-user2`; tabla resalta qa-user2; «Tu posición» = RPC; 0 peticiones con ids de qa-user1 tras el cambio. |
| C2 Conexión | **FAIL** | Sin red, Inicio → Atrás a la liga: ≥6 s en «Verificando acceso…», sin datos guardados ni aviso. Recarga sin red: la app va a **`/onboarding` «Completa tu perfil»**. Con la red de vuelta 12 s, sigue en onboarding. BD sin cambios → UAT-03 y UAT-04. |
| SEC.a Bundle | PASS | 38 chunks (610 KB): JWT incrustados solo con rol `anon` (4); 0 patrones de secreto; 0 «service_role». |
| SEC.b Credenciales/PII | PASS | 1 clave de sesión de auth; contraseña ausente de almacenamiento/IndexedDB/consola/URL; ningún JWT fuera de la clave de auth; correo no aparece en consola. |
| SEC.c Acceso cruzado por URL | PASS | Quiniela de B y uuid inexistente → mismo texto «No tienes acceso a esta quiniela.»; GET `pools` → `[]`. |
| SEC.d Escalada (participante) | PASS | Desde la página con el JWT de qa-user1: pago, aprobar, publicar resultado y crear quiniela → 403/42501; códigos y auditoría → 0 filas; participantes ajenos 0; BD sin cambios. |
| SEC.e tenant_id manipulado (organizador) | PASS | qa-requester con ids de B: `manage_pool` create/pause, `upsert_tournament`, `create_pool_join_code` → 403/42501; quinielas/torneos de B 4→4. |
| SEC.f Tras cerrar sesión | PASS | 0 claves de sesión, IndexedDB vacío, «Atrás» → `/` sin datos; URL directa sin sesión → `/`. |
| PERF.visitante | **FAIL** | 4G lenta + CPU 4x: FCP 1448 ms, **LCP 4120 ms** (> 2500), CLS 0,022, TBT 142 ms; 753 KB; mayor recurso `logo_app_tablo.png` 384 KB → UAT-09. (Ejecución aislada previa: LCP 6584 ms, TBT 735 ms; la medida varía con la carga de la máquina.) |
| PERF.quiniela | **FAIL** | FCP 2380 ms, **LCP 3912 ms**, CLS 0, TBT 154 ms; 53 peticiones (32 a Supabase); mayor `stadium-night-alex-simpson.jpg` 182 KB → UAT-09. |
| PERF.js | PASS | Portada: 2 JS, 401 KB / **123 KB gzip** (≤ 170); PoolView/AdminView/… no se cargan en la portada. |
| PERF.img | PASS | Sin `<img>` visibles sin dimensiones ni `loading=lazy` en la quiniela (los fondos son CSS). |
| W1.manifest | PASS | Chrome sin errores; `standalone`, `start_url=/`, iconos 192/512 + maskable con tamaño real correcto. |
| W1.sw | PASS | `/sw.js` activado, alcance `/`, controla la página tras recargar. |
| W1.instalable | PASS | `Page.getInstallabilityErrors` = `[]`. |
| W1.cache-privada | PASS | Solo `sl-shell-v1`/`sl-static-v1`: `/`, `/offline.html`, manifest, iconos, imagen y 25 activos; nada de Supabase/REST/auth; ningún documento con tokens/correo/nombre tras navegar con sesión. |
| W1.offline | **FAIL** | Sin red `/` muestra el shell de Inicio, pero `/ligas` acaba en `/onboarding` a los 8 s (misma causa que UAT-03); `/offline.html` está en caché. |
| W1 | **FAIL** | Agregado: falla por W1.offline. |
| UAT-01 (comprobación de b1) | **FAIL** | `/organizador` y `/admin`: «No fue posible cargar la configuración.»; GET `participants?select=…,profiles(display_name)` → HTTP 400 `PGRST200` → UAT-01. |
| P1.repeticion | NOT_RUN | Ver §5. |
| H1 | NOT_RUN | Ver §5. |
| LIGHTHOUSE | NOT_RUN | Ver §5. |

## 4. Matriz de calidad móvil (b4)

Criterio `Q.*` (por ancho): sin scroll horizontal ni desbordes, objetivos táctiles ≥ 44×44 px, controles con nombre accesible, `<img>` con `alt`, sin errores de consola. **Todas las pantallas pasan scroll horizontal, nombres, `alt` y consola en los tres anchos**; todos los FAIL de `Q.*` son por objetivos táctiles < 44 px. Contraste, texto 200 % y foco se miden a 390 px.

| Pantalla | 320 | 390 | 430 | Contraste (390) | Texto 200 % | Foco |
| --- | --- | --- | --- | --- | --- | --- |
| visitante | PASS | PASS | PASS | PASS | PASS | PASS |
| acceso | PASS | PASS | PASS | PASS | PASS | PASS |
| inicio | FAIL (1 <44px) | FAIL (1 <44px) | FAIL (1 <44px) | PASS | PASS | PASS |
| partidos | FAIL (3 <44px) | FAIL (3 <44px) | FAIL (3 <44px) | PASS | PASS | — |
| ligas | PASS | PASS | PASS | PASS | PASS | — |
| unirme | PASS | PASS | PASS | PASS | PASS | — |
| quiniela-resumen | FAIL (3 <44px) | FAIL (3 <44px) | FAIL (3 <44px) | PASS | PASS | — |
| quiniela-tickets | FAIL (3 <44px) | FAIL (3 <44px) | FAIL (3 <44px) | FAIL (3.76:1) | PASS | PASS |
| quiniela-tabla | FAIL (3 <44px) | FAIL (3 <44px) | FAIL (3 <44px) | FAIL (4.11:1) | PASS | — |
| puntos | PASS | PASS | PASS | PASS | PASS | — |
| mis-tickets | FAIL (4 <44px) | FAIL (4 <44px) | FAIL (4 <44px) | PASS | PASS | — |
| perfil | FAIL (3 <44px) | FAIL (3 <44px) | FAIL (3 <44px) | PASS | PASS | — |
| quiniela-clasica | FAIL (3 <44px) | FAIL (3 <44px) | FAIL (3 <44px) | FAIL (3.76:1) | PASS | PASS |
| org-panel* | PASS | PASS | PASS | PASS | FAIL (445/390 px) | — |
| org-quinielas* | FAIL (8 <44px) | FAIL (8 <44px) | FAIL (8 <44px) | PASS | FAIL (456/390 px) | PASS |
| org-parrilla* | FAIL (10 <44px) | FAIL (10 <44px) | FAIL (10 <44px) | FAIL (3.76:1) | FAIL (441/390 px) | — |
| org-finanzas* | PASS | PASS | PASS | PASS | PASS | — |

\* Con la reescritura de UAT-01. `A11Y.documento` (lang `es`, título, viewport sin bloqueo de zoom): PASS. Capturas: `shots/b4-<pantalla>-<ancho>.png` y `shots/b4-<pantalla>-texto200.png`.

## 5. NOT_RUN y límites (no afirmado)

| Caso | Motivo |
| --- | --- |
| P1.repeticion | La espera de aprobación solo se observa una vez por identidad. qa-user2 (ejecución 23:24Z: mismo síntoma «pendiente» tras aprobar, pero con el arnés aún defectuoso, ver §7) y qa-outsider (23:53Z, resultado P1 vigente) quedaron aprobados en la quiniela B; con 5 cuentas fijas no hay otra libre. |
| H1 Cabeceras/CSP | Salen de `vercel.json` y solo las sirve Vercel; `vite preview` no las aplica. Pendiente `curl -sI https://sportleagues-qa.vercel.app` y consola sobre el despliegue. |
| LIGHTHOUSE | No instalado y prohibido añadir dependencias; PERF.* es una aproximación con PerformanceObserver. |

Otros límites: Chrome headless en Windows emulando Android (no iOS Safari ni dispositivo físico); el diálogo nativo «Instalar app» y Capacitor no existen en headless (W1.instalable usa el criterio de Chrome); el modo avión se emula por CDP; la rama PRO de branding no se probó (no hay tenant PRO); flyers/compartir no forman parte de este checklist; el recálculo de puntos con pronósticos tras corregir resultado lo cubre el E2E de API, no esta UAT.

## 6. Defectos de producto (no corregidos; zona de otros agentes)

Las líneas citadas corresponden al código construido (HEAD `d6af695`); varios de esos archivos se están editando en paralelo y pueden haberse desplazado.

| Id | Severidad | Defecto | Pistas (archivo:línea) | Reproducción |
| --- | --- | --- | --- | --- |
| UAT-01 | **Alta** (bloquea al organizador) | `/organizador` y `/admin` muestran «No fue posible cargar la configuración.»: la lectura de participantes pide el embed `profiles(display_name)` y PostgREST responde 400 `PGRST200` (no hay FK `participants`→`profiles`). Sin la reescritura no se puede aprobar ni marcar pagos desde la UI. | `apps/platform/src/composables/useAdmin.ts:200`; relación/lectura de nombres según ADR-020 (`docs/architecture/adr/ADR-020-participants-read-scoping-and-finance-privacy.md`) | qa-requester → Panel u `/admin`. Captura `b1-03b-defecto-admin.png`. |
| UAT-02 | Media | Tras la aprobación, la quiniela sigue mostrando «Tu inscripción está pendiente» y sin formulario hasta que caduca la caché privada (hasta 10 min): con entrada fresca `usePoolPlay.load` pinta la instantánea y **no revalida** (0 lecturas de `/participants`). El estado de participación (permisos de UI) vive en la caché como un dato de lectura más. | `apps/platform/src/composables/usePoolPlay.ts:169` (`if (hit.fresh) … return`), `poolCacheTtlMs` (l. 35-38) | Unirse con código a una quiniela con aprobación → el organizador aprueba → reabrir la app en el mismo dispositivo antes de 10 min. Captura `b2-12-p1-aprobado.png`. |
| UAT-03 | **Alta** | Abrir/recargar la app **sin conexión** con sesión válida lleva a `/onboarding` «Completa tu perfil» (y ahí sigue al volver la red): el fallo de red al leer `profiles` deja `profile=null` y el guard lo trata como «sin perfil». | `apps/platform/src/composables/useAuth.ts:40-44` (`loadProfile`), `apps/platform/src/lib/navigation-guards.ts:17-22` (`protectedRouteRedirect` → `onboarding`) | Con sesión, visitar una liga; modo avión; recargar o abrir `/ligas`. Capturas `b3-07-c2-sin-red-recarga.png`, `b3-08-c2-red-recuperada.png`, `b5-04-pwa-sin-conexion.png`. |
| UAT-04 | Media | Sin conexión, volver a una liga ya visitada (navegación interna) se queda ≥6 s en «Verificando acceso…» y nunca muestra lo guardado: `usePoolAccess.load` (sin caché) debe responder antes de `play.load`, así que el aviso «Sin conexión: mostrando lo último guardado» es inalcanzable con la red caída; si la consulta devuelve error se muestra `queryError.message` crudo. | `apps/platform/src/views/PoolView.vue` (`loadPool`, l. 107-110), `apps/platform/src/composables/usePoolAccess.ts:33-38` | Liga visitada → modo avión → Inicio → Atrás. Captura `b3-06-c2-sin-red-navegacion.png`. |
| UAT-05 | Media | Una acción de ticket fallida sin red recarga la lista, esa recarga falla y el panel entero se sustituye por un error **sin «Reintentar»**; al volver la red no se recupera hasta salir y volver a la pestaña (criterio móvil 6). | `apps/platform/src/composables/usePoolTickets.ts:69-79` (`act` → `load` → `error`), `apps/platform/src/components/PoolTicketsPanel.vue:92` (`ErrorState` sin acción) | Pestaña Partidos de una quiniela con tickets → modo avión → «Nuevo ticket». Captura `b2-05a-t1-sin-red.png`. |
| UAT-06 | Media | Objetivos táctiles < 44 px en 10 pantallas: pestañas `SegmentedTabs` subrayadas 36 px (Resumen/Partidos/Tabla, Mi actividad/Equipos/Logros), «píldora» 37,5 px (Hoy/Mañana/Esta semana) y «chip» 35,5-36 px (parrilla); «Ver todos» 16 px de alto; nombres de quiniela en Mis tickets 24 px; selector de quinielas y «+ Nueva» del panel 38 px; casilla «En la quiniela» 20 px. | `apps/platform/src/components/SegmentedTabs.vue:38` (pill), `:44` (underline) y variante chip; `components/SectionHeader.vue:12`; `views/MyTicketsView.vue:47`; `views/AdminView.vue:230-231`; `views/AdminFixtureView.vue:285` | Matriz §4 (`Q.*`), evidencias con tamaños medidos. |
| UAT-07 | Baja | Contraste insuficiente: `text-text-faint` #5c7889 sobre #071b29 = 3,76:1 («vs» de las tarjetas de partido, «Cierre estimado…» de la parrilla); detalle de la fila propia del ranking #8fa6b5 sobre #124841 = 4,11:1 (mín. 4,5:1). | `components/PredictionMatchCard.vue:51`, `views/AdminFixtureView.vue:279`, `components/RankingRow.vue:32` | `A11Y.contraste.*`. |
| UAT-08 | Baja | Con el texto al 200 % aparece scroll horizontal en las pantallas de organizador (`/organizador` 445/390, `/admin` 456/390, `/admin/parrilla` 441/390); las de participante no. | `views/OrganizerDashboardView.vue`, `views/AdminView.vue:229` (fila de quinielas), `views/AdminFixtureView.vue` | `A11Y.texto200.org-*`, capturas `b4-org-*-texto200.png`. |
| UAT-09 | Media | LCP por encima de 2,5 s en frío con red 4G lenta y CPU 4x: portada 4,1 s (logo PNG de 384 KB, `src/assets/branding/logo_app_tablo.png`), quiniela 3,9 s (`public/images/stadium-night-alex-simpson.jpg`, 182 KB). JS inicial correcto (123 KB gzip). | assets citados; criterio móvil 8 | `PERF.visitante`, `PERF.quiniela`. |

Observaciones sin fallo: (1) tras salir y volver a la pestaña de tickets se genera una nueva clave de idempotencia (2 claves en el reintento); no duplica porque la petición sin red nunca llegó al servidor. (2) La vista de Inicio de qa-user2 lista en «Mis ligas» solo dos quinielas archivadas (captura `b3-ERROR.png` de un intento anterior); no se evaluó como caso.

## 7. Defectos del arnés encontrados y corregidos (no son de producto)

`prep.mjs` (orden de jornada calculado solo con las de la quiniela → choque de `unique(tournament_id, sort_order)`); `cdp.mjs` (captura en blanco con la página desplazada; `waitFor` trataba expresiones `[...]`/`/re/` como selector CSS); `lib.mjs` (conteos de RPC duplicados por las OPTIONS de CORS; `settle()` daba por cargada una pantalla vacía o en «Verificando tus permisos…»); `audit.mjs` (`focusProbe` medía durante la transición y no veía `:focus-within` → falsos FAIL de foco en acceso/Inicio/panel); `b1.mjs` (FE-01 tocaba el «Publicar» de otra fila; la expresión de dinero confundía «4 Pendiente» con «4 PEN»); `b2/b3/b5` (etiqueta «Enviar una nueva solicitud», toque en la barra inferior, la clave anon pública del bundle contaba como dato privado en la caché del SW). En la ejecución de 23:24Z (qa-user2) P1 quedó invalidada por estos fallos; en la de 23:53Z (qa-outsider) las sub-medidas «recargando» y «tras borrar la entrada de caché» se tomaron antes de terminar de cargar (fallo de `settle()`) y **se descartan**; la observación concluyente es la primera reapertura (captura `b2-12-p1-aprobado.png`, 0 lecturas de `/participants`).

## 8. Comandos ejecutados

```bash
# Build propio (una vez) y servidor local
npx vite build --config apps/platform/vite.config.ts --outDir C:/Users/Acer/AppData/Local/Temp/claude/uat-build/dist --emptyOutDir
npx vite preview --config apps/platform/vite.config.ts --outDir C:/Users/Acer/AppData/Local/Temp/claude/uat-build/dist --port 4391 --host 127.0.0.1 --strictPort   # segundo plano

# Ejecución completa y repeticiones tras corregir el arnés
QA_OWNER_AUTHORIZED=yes UAT_OUT='C:\Users\Acer\AppData\Local\Temp\claude\uat-out' node scripts/qa/uat/run.mjs
QA_OWNER_AUTHORIZED=yes UAT_OUT='C:\Users\Acer\AppData\Local\Temp\claude\uat-out' node scripts/qa/uat/run.mjs --only=b1,b3
QA_OWNER_AUTHORIZED=yes UAT_OUT='C:\Users\Acer\AppData\Local\Temp\claude\uat-out' node scripts/qa/uat/run.mjs --only=b1
QA_OWNER_AUTHORIZED=yes UAT_OUT='C:\Users\Acer\AppData\Local\Temp\claude\uat-out' node scripts/qa/uat/run.mjs --only=b4
# (antes, iteraciones --only=b2 / b3 / b4 / b5 para depurar el arnés)

# Consultas de solo lectura para depurar
QA_OWNER_AUTHORIZED=yes node scripts/qa/uat/data.mjs
QA_OWNER_AUTHORIZED=yes node scripts/qa/uat/q.mjs <tabla> <columnas> [col=valor]
node --check scripts/qa/uat/*.mjs ; git diff --check   # sin hallazgos
```

No se ejecutó `scripts/qa/e2e/full-lifecycle.mjs` (los datos existían). Al terminar se detuvieron `vite preview` y todos los Chrome lanzados (0 procesos restantes).

## 9. Residuo sintético creado en QA

Todo con las 5 identidades fijas: jornadas «UAT R…» (1 nueva: `UAT Rng48`, 2 partidos) y «UAT Jornada …» desde la parrilla (una por ejecución de b1, con partido y resultado publicado/corregido); 1 partido futuro en la quiniela B (prep); tickets de qa-user1 en `UAT Rng48` (2 vivos, el resto cancelados) y sus selecciones; pronóstico de qa-user2 en B; **qa-user2 y qa-outsider inscritos y aprobados en la quiniela B** (otro tenant; las comprobaciones del E2E sobre qa-outsider usan la quiniela A); 3 solicitudes «Crear mi propia quiniela» de qa-user1, todas canceladas desde la UI; códigos de unión de B (uno por ejecución de b2); `requires_approval` de B activado temporalmente y restaurado (verificado: `false`, `open`). No se borró nada. Registro pendiente en `docs/operations/QA-SYNTHETIC-RESIDUE.md` (zona de otro agente; no editado).

## 10. Archivos

- Nuevos: `scripts/qa/uat/b2.mjs`, `b3.mjs`, `b4.mjs`, `b5.mjs`, este informe.
- Editados (arnés, mismo directorio): `run.mjs` (captura de error), `lib.mjs`, `cdp.mjs`, `audit.mjs`, `prep.mjs`, `b1.mjs`.
- Sin commit. No se tocó `apps/platform`, `supabase`, `mobile` ni `docs`.
