# Fase 04 — Checklist E2E manual contra Supabase Cloud

## Propósito y alcance

Esta guía permite cerrar la Fase 04 desde Windows y un navegador real, usando el proyecto Supabase Cloud de **desarrollo/staging**. No usa Docker, Supabase local, `service_role`, URI de pooler ni SQL para simular memberships. Registra resultados reales de Auth, onboarding, deep links y `join_pool` antes de iniciar la Fase 05.

Los escenarios críticos para PASS son: **E2E-01 o E2E-02, E2E-03, E2E-05, E2E-07, E2E-08, E2E-09, E2E-11 y E2E-12**.

## Preparación

1. Sitúate en la raíz del repositorio y crea `apps/platform/.env.local` (Vite usa `apps/platform` como raíz; no reutilices un `.env.local` administrativo de la raíz):

   ```env
   VITE_SUPABASE_URL=<Project URL de Supabase Cloud>
   VITE_SUPABASE_ANON_KEY=<anon/publishable key de Supabase Cloud>
   ```

   Solo se admiten esas dos variables en el frontend. Nunca incluyas `service_role`, password de base de datos, `SUPABASE_SESSION_POOLER_URI`, tokens de gestión ni otras credenciales privilegiadas. Si existe un `.env.local` administrativo con `PG*`, mantenlo fuera de ZIPs/commits y de `apps/platform`.

2. Comprueba que el archivo no se versionará:

   ```powershell
   git check-ignore -v apps/platform/.env.local
   ```

   Debe indicar una regla de `.gitignore`. Verifica también que `git status --short` no liste `.env.local`.

3. En Supabase Dashboard → Authentication → URL Configuration, usa en staging:

   - Site URL: `http://127.0.0.1:5173`
   - Redirect URL: `http://127.0.0.1:5173/auth/callback`

4. En Supabase Dashboard → Authentication → Providers, habilita Google OAuth y registra el Client ID/secret **solo en la configuración de Supabase**, nunca en el frontend. En Authentication → Email, confirma que Magic Link está habilitado y que el correo de prueba puede recibirlo.

   Si al iniciar Google aparece `400 validation_failed` con `Unsupported provider: provider is not enabled`, clasifícalo como `BLOCKED_EXTERNAL_PROVIDER_CONFIGURATION`: el provider no está habilitado en Cloud. No impide continuar E2E-03 a E2E-12 mediante Magic Link. Tras habilitarlo, repite E2E-01 y E2E-02 antes de considerar Google validado.

5. Inicia la PWA:

   ```powershell
   npm.cmd run dev -- --host 127.0.0.1
   ```

   Abre `http://127.0.0.1:5173` en una ventana normal o privada. Usa DevTools → Console y Network, preservando el log. No captures tokens, cookies, encabezados Authorization ni claves en screenshots.

6. Fixtures de staging:

   - Código abierto Tenant A: `ALPHA1`.
   - Código abierto Tenant B: `BRAVO1`.
   - Código inválido: `ZZZZZZ`.
   - Para E2E-10 se necesita un pool de staging ya documentado con `requires_approval = true` y un código vigente. El seed de Fase 03 no lo trae; si no existe, marca E2E-10 como **N/A — fixture ausente**, no como PASS.

7. Prepara cuentas separadas: una nueva, una recurrente con perfil, y dos cuentas que pertenezcan respectivamente a Tenant A y Tenant B. No uses usuarios de producción.

## Cómo registrar evidencia

Para cada caso conserva: captura de la UI sin datos sensibles, URL final, Console/Network sin errores relevantes, identidad de prueba (alias no sensible), estado de sesión/perfil, resultado de membership/participant y verificación de que no se escribió fuera del tenant. Si hay un error, anota mensaje, endpoint/RPC, código HTTP/PostgREST y capa probable.

| ID | Resultado | Evidencia | Observación |
| --- | --- | --- | --- |
| E2E-01 | PASS | Google OAuth Cloud validado manualmente | Usuario nuevo/callback completado. |
| E2E-02 | PASS | Google OAuth Cloud validado manualmente | Sesión recurrente/restauración confirmada. |
| E2E-03 | PASS | Magic Link Cloud validado manualmente | Envío, enlace, callback y sesión completados. |
| E2E-04 | N/A | No se registró un enlace expirado específico | No es escenario crítico cuando el proveedor ya valida tokens. |
| E2E-05 | PASS | `/j/ALPHA1` llega a Pool A | Reanudación de join confirmada. |
| E2E-06 | PASS | Confirmación manual | Onboarding pendiente y reanudación completados. |
| E2E-07 | PASS | Pool A y `Acceso confirmado` | Join mediante RPC validado. |
| E2E-08 | PASS | Confirmación manual | Join repetido no duplicó participación. |
| E2E-09 | PASS | Mensaje visible de código inválido | Sin acceso autorizado. |
| E2E-10 | N/A | Fixture staging ausente | No existe pool documentado que requiera aprobación. |
| E2E-11 | PASS | Pool B muestra `No tienes acceso a esta quiniela.` | RLS impide lectura cross-tenant. |
| E2E-12 | PASS | Confirmación manual | Logout y ruta protegida validados. |

## Escenarios

### E2E-01 — Usuario nuevo con Google OAuth

- **Objetivo:** crear sesión mediante Google y conducir un usuario sin `profiles` a onboarding.
- **Precondiciones:** Google habilitado; cuenta nueva; DevTools abierto.
- **Pasos:** abre `/`; pulsa **Continuar con Google**; autentícate; acepta el retorno a `/auth/callback`; observa la redirección.
- **Esperado/PASS:** el flujo implicit detecta la sesión desde URL y el callback la restaura sin intercambiar un código; ruta `/onboarding` si no existe perfil. Al guardar nombre se crea solo el perfil propio. No hay membership ni tenant creados automáticamente.
- **FAIL:** callback con error, sesión ausente, perfil de otro usuario, error de Console/Network no explicado o escritura de tenant/membership.
- **Evidencia/observaciones:** URL final, UI, evento Auth, respuesta de `profiles`; anota si no hubo llamadas a `join_pool`.

### E2E-02 — Usuario recurrente con Google OAuth

- **Objetivo:** confirmar restore de sesión y perfil existente.
- **Precondiciones:** cuenta Google ya autenticada y con perfil.
- **Pasos:** cierra sesión desde la UI; vuelve a **Continuar con Google**; completa el proveedor; recarga `/`.
- **Esperado/PASS:** vuelve a `/`, muestra identidad/perfil y la sesión se restaura tras recarga; no muestra onboarding ni duplica perfil.
- **FAIL:** bucle de callback, perfil duplicado, sesión perdida tras recarga o errores Auth/Network.
- **Evidencia/observaciones:** URL, UI antes/después de recarga, Console/Network y estado de sesión.

### E2E-03 — Magic link válido

- **Objetivo:** comprobar solicitud, correo y callback por magic link.
- **Precondiciones:** Email/Magic Link habilitado y correo de prueba accesible.
- **Pasos:** sin sesión, introduce el correo y pulsa **Enviar magic link**; abre el enlace más reciente en el mismo navegador; espera `/auth/callback`.
- **Esperado/PASS:** UI inicial confirma envío; el enlace inicia sesión y procesa callback; usuario nuevo va a onboarding y recurrente a `/`. No aparece password ni token en UI/logs.
- **FAIL:** correo no llega, enlace no vuelve al callback permitido, sesión no se crea, o hay error no controlado.
- **Evidencia/observaciones:** timestamp del correo (sin URL/token), URL final, UI y Network Auth.

### E2E-04 — Magic link inválido o expirado

- **Objetivo:** validar un error Auth comprensible y seguro.
- **Precondiciones:** enlace ya usado, caducado o alterado; no reutilizar una URL/token en el reporte.
- **Pasos:** abre el enlace inválido/expirado en navegador privado; observa `/auth/callback`.
- **Esperado/PASS:** no se crea sesión; UI presenta el error de callback; no hay perfil/membership ni escrituras.
- **FAIL:** sesión autenticada de forma inesperada, pantalla vacía, error silencioso o cambios en datos.
- **Evidencia/observaciones:** mensaje visible y código/error Auth sin copiar el enlace ni token.

### E2E-05 — Deep link sin sesión → login → callback → join

- **Objetivo:** reanudar solo el código opaco después de autenticar.
- **Precondiciones:** código abierto de staging, por ejemplo `ALPHA1`; usuario sin sesión ni perfil pendiente.
- **Pasos:** abre `http://127.0.0.1:5173/j/ALPHA1`; confirma que pide login; completa E2E-01/02/03; completa onboarding si corresponde.
- **Esperado/PASS:** el flujo conserva únicamente `sportleagues.join-code=ALPHA1` en `sessionStorage`, lo consume una vez y llama a `join_pool`; termina en `/p/<pool_id devuelto por RPC>`. No persiste tenant, rol o pool como autoridad.
- **FAIL:** se pierde el código, se usa un `tenant_id` de URL/storage, no se invoca RPC, o se llega a un pool no devuelto por backend.
- **Evidencia/observaciones:** URL inicial/final, Network de `rpc/join_pool`, estado de `sessionStorage` antes/después (sin tokens) y participant retornado.

### E2E-06 — Perfil incompleto → onboarding → join

- **Objetivo:** comprobar que onboarding bloquea la reanudación hasta crear el perfil propio.
- **Precondiciones:** sesión Cloud de un usuario Auth sin fila `profiles`; código abierto vigente.
- **Pasos:** abre `/j/ALPHA1` con esa sesión; completa el nombre en `/onboarding`; continúa.
- **Esperado/PASS:** solo se inserta/actualiza `profiles` para `auth.uid()`; después se consume el código y `join_pool` devuelve participant. No existe inserción directa de `tenant_memberships` desde el navegador.
- **FAIL:** salta onboarding, modifica perfil ajeno, crea membership con una llamada REST directa o no reanuda join.
- **Evidencia/observaciones:** ruta onboarding, Network de `profiles` y RPC; verifica el único código en `sessionStorage`.

### E2E-07 — Join válido por `join_pool`

- **Objetivo:** validar el camino autorizado de join.
- **Precondiciones:** sesión y perfil completos; código abierto para pool al que no pertenece el usuario.
- **Pasos:** abre `/j/ALPHA1` o introduce el código en inicio; inspecciona Network.
- **Esperado/PASS:** una llamada `rpc/join_pool` con `p_code`; respuesta participant con pool/tenant derivados por backend; membership/participant creados por RPC y navegación a la ruta retornada. No hay POST/INSERT directo a memberships o participants.
- **FAIL:** RPC falla con fixture válido, UI inserta datos directamente, error no mostrado o dato creado en otro tenant.
- **Evidencia/observaciones:** método/endpoint RPC, respuesta sanitizada y consulta de UI/Network que pruebe ausencia de mutación directa.

### E2E-08 — Join repetido

- **Objetivo:** confirmar idempotencia del RPC.
- **Precondiciones:** completar E2E-07 con la misma cuenta/código.
- **Pasos:** vuelve a abrir `/j/ALPHA1`; deja terminar el flujo.
- **Esperado/PASS:** `join_pool` devuelve el participant existente y no aparece un duplicado. La UI vuelve al mismo destino autorizado.
- **FAIL:** error inesperado, nueva membership/participant, cambio de tenant/rol o duplicados visibles.
- **Evidencia/observaciones:** dos respuestas RPC sanitizadas y comprobación de una sola participación para la cuenta/pool.

### E2E-09 — Código inválido o expirado

- **Objetivo:** asegurar denegación clara y sin efectos.
- **Precondiciones:** sesión y perfil completos; `ZZZZZZ` o fixture expirado.
- **Pasos:** abre `/j/ZZZZZZ`.
- **Esperado/PASS:** error visible de código inválido/expirado/no disponible; RPC rechaza; no hay navegación al pool ni membership/participant nuevos.
- **FAIL:** join aceptado, ruta a recursos privados, error silencioso o escritura de datos.
- **Evidencia/observaciones:** respuesta RPC/error SQL traducido por UI, URL y conteo de participaciones sin cambios.

### E2E-10 — Pool que requiere aprobación

- **Objetivo:** comprobar que `requires_approval` retorna participant `pending`.
- **Precondiciones:** fixture staging documentado con `requires_approval=true`, pool abierto y código vigente. Si no existe, registra N/A — fixture ausente.
- **Pasos:** con usuario nuevo en ese pool, abre el deep link y completa el join.
- **Esperado/PASS:** RPC crea/retorna participant con `approval_status = pending`; UI indica solicitud pendiente; no asigna rol admin/owner ni acceso no autorizado.
- **FAIL:** participant aprobado automáticamente, rol elevado, duplicado o error no manejado.
- **Evidencia/observaciones:** respuesta de `join_pool`, UI y verificación de estado.

### E2E-11 — Acceso directo entre tenants

- **Objetivo:** demostrar que URL/cliente no eluden RLS.
- **Precondiciones:** cuenta miembro de Tenant A y una ruta/ID devuelto por Tenant B (`BRAVO1`) obtenida solo como fixture de staging.
- **Pasos:** con cuenta A inicia sesión; intenta abrir manualmente `/p/<pool_id de Tenant B>` y, desde DevTools Network, observa cualquier petición de datos tenant-owned. No modifiques requests ni JWT.
- **Esperado/PASS:** PoolView consulta únicamente `pools(id,name)` por el `poolId` de ruta; para B, RLS retorna cero filas y la UI muestra `No tienes acceso a esta quiniela`. Para A, muestra solo nombre e id autorizado. No se permite mutar B.
- **FAIL:** se muestra información privada de B, se acepta una mutación o se crea membership por URL.
- **Evidencia/observaciones:** URL, ausencia de datos privados, respuesta RLS/Network y confirmación de cero escrituras cross-tenant. Este caso complementa, no sustituye, la suite RLS de Fase 03.

### E2E-12 — Logout y ruta protegida

- **Objetivo:** comprobar limpieza de estado local y guard de UX.
- **Precondiciones:** sesión, perfil y una ruta `/p/<pool_id>` autorizada.
- **Pasos:** pulsa **Cerrar sesión**; inspecciona UI y `sessionStorage`; abre/reintenta `/p/<pool_id>`.
- **Esperado/PASS:** no hay sesión/perfil visibles; el guard redirige a `/`; no se muestran datos privados. El join code ya consumido no reaparece.
- **FAIL:** la ruta sigue mostrando recurso privado, sesión/profile queda visible, o navegación produce acceso a datos tras logout.
- **Evidencia/observaciones:** URL final, UI, storage sin intención consumida y Console/Network.

## Controles de seguridad

Completa esta lista durante los escenarios:

- [ ] `apps/platform/.env.local` contiene solo `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`; está ignorado por Git.
- [ ] DevTools/Network y bundle no muestran `service_role`, password DB, URI Session Pooler ni otro secreto privilegiado.
- [ ] `localStorage`/`sessionStorage` no usan `tenant_id`, `pool_id`, role ni claims como autorización. Solo puede existir temporalmente `sportleagues.join-code` y debe desaparecer tras consumo.
- [ ] Network muestra join únicamente hacia `rpc/join_pool`; no hay insert directo hacia `tenant_memberships` o `participants`.
- [ ] El `pool_id` de navegación procede de la respuesta del RPC, no de la URL inicial ni storage.
- [ ] RLS/RPC deniegan datos y mutaciones de Tenant B a un miembro de Tenant A; los guards UI no se consideran autorización.
- [ ] No se registraron tokens, URLs de magic link, correos completos ni datos personales en esta checklist/evidencia.

## Cierre

Solo marca Fase 04 como PASS si `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build` y `git diff --check` están PASS, y todos los escenarios críticos se ejecutaron contra Supabase Cloud con OAuth, magic link, callback, join, join repetido, código inválido, onboarding, aislamiento cross-tenant y logout validados. E2E-10 es N/A únicamente si no existe fixture staging documentado.

Si un caso falla, registra causa y capa responsable (`frontend`, `Auth`, `redirect`, `RLS`, `RPC`, `configuración Supabase` o `datos de prueba`), corrige solo esa capa y repite el caso más sus regresiones relacionadas. No marques PASS ni inicies Fase 05 mientras haya fallo de Auth, aislamiento de tenant o join.

**Cuando el usuario complete esta checklist y entregue los resultados, actualizar `PROJECT_STATE.md`, `reports/auth/phase-04-auth-memberships.md` y `reports/auth/phase-04-handoff.md`. Solo entonces marcar Phase 04 como PASS y preparar el handoff a Phase 05.**
