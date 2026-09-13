# Fase 04 - Auth, onboarding, memberships y join

## Resultado

`PARTIAL / IMPLEMENTED / CLOUD_E2E_PASS_BUILD_GATE_PENDING`.

La aplicacion Vue implementa el flujo de Auth, perfil minimo y join por deep link conforme a los contratos de Fase 03. Google OAuth y Magic Link fueron validados manualmente con exito contra Supabase Cloud. El join de `ALPHA1` expuso un defecto SQL de tipo enum; el hotfix forward-only ya esta aplicado en Cloud y requiere revalidacion E2E.

## Implementacion

- `apps/platform/src/lib/supabase.ts` es el unico adaptador Supabase y solo lee `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
- Auth usa flujo `implicit` explicito con `detectSessionInUrl: true`. `completeCallback` no intercambia codigos: restaura/verifica de forma idempotente la sesion que Supabase detecta desde la URL, evitando mezclar PKCE e implicit.
- `useJoinPool` llama exclusivamente a `rpc('join_pool', { p_code })`. No inserta memberships, no autoriza roles y no decide tenant.
- `/j/:code` valida y guarda en `sessionStorage` solo el codigo opaco normalizado. El callback y onboarding lo consumen una vez; no se almacenan `tenant_id`, `pool_id`, rol ni claims del cliente.
- La navegacion hacia `/p/:poolId` usa el valor devuelto por el RPC. PoolView ejecuta una lectura minima `pools(id,name)` por `id`, sin enviar `tenant_id`; si RLS devuelve cero filas muestra `No tienes acceso a esta quiniela`. El guard de UX exige sesion y perfil, pero RLS/RPC siguen siendo la autoridad.
- Los errores de codigo invalido/expirado/quiniela no abierta, falta de autenticacion, perfil incompleto y aprobacion pendiente se muestran de manera explicita.

## Dependencias de Fase 03

- `profiles` y sus policies self-only para onboarding.
- RPC `join_pool(p_code text)`, que deriva identidad con `auth.uid()`, resuelve tenant y pool del lado servidor, crea/reutiliza membership/participant idempotentemente y devuelve el participante autorizado.
- RLS de memberships, pools y participantes. Ningun `tenant_id` recibido desde URL o storage se usa como autorizacion.

## Validacion ejecutada

| Verificacion | Resultado |
| --- | --- |
| `npm.cmd run typecheck` | PASS |
| `npm.cmd test` | PASS: 11 pruebas de intent, callback implicit idempotente, guard, join RPC y acceso RLS de PoolView. |
| `npm.cmd run build` | PASS: bundle de produccion generado. |
| `git diff --check` | PASS |
| Revision de secretos en frontend | PASS: solo se permiten las dos variables publicas Vite; no hay service role, password ni URI de pooler. |
| Preflight compatible con Windows | PASS: se verificaron los mismos archivos requeridos por `scripts/preflight.sh`; el runner Bash/WSL no esta disponible. |
| Variables Vite de `apps/platform/.env.local` | PASS: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` existen y no estan vacias; no se leyeron sus valores. |
| Rutas PWA por HTTP | PASS: `/`, `/auth/callback`, `/onboarding`, `/j/ALPHA1`, `/j/BRAVO1`, `/j/ZZZZZZ` y `/p/<pool-id>` responden HTTP 200. |
| Google OAuth (evidencia manual) | PASS: autenticacion completada contra Supabase Cloud. |
| Magic Link (evidencia manual) | PASS: envio, enlace e inicio de sesion completados contra Supabase Cloud. |
| Join `/j/ALPHA1` (evidencia manual) | PASS posterior al hotfix: el usuario abrio `http://127.0.0.1:5173/j/ALPHA1` y llego a `/p/aaaaaaaa-0000-0000-0000-000000000001`; la UI muestra `Pool A` y `Acceso confirmado`. La evidencia visual no contiene secretos. |
| Codigo invalido `/j/ZZZZZZ` (evidencia manual) | PASS: la UI muestra `El código no es válido, expiró o la quiniela no está disponible.` sin acceso autorizado. |
| Acceso directo Tenant A a Pool B (evidencia manual) | PASS: `/p/bbbbbbbb-0000-0000-0000-000000000001` muestra `No tienes acceso a esta quiniela.`; no se modifico RLS. |
| Pool A directo despues de join (evidencia manual) | PASS posterior a la correccion: al abrir `/p/aaaaaaaa-0000-0000-0000-000000000001` la vista muestra `Pool A`. |
| Correccion PoolView | PASS: se sustituyo la carga unica `onMounted` por un `watch` inmediato de `route.params.poolId`; `usePoolAccess` ahora inicia en loading y lleva toda excepcion o respuesta a un estado terminal (`pool`, `denied` o `error`). Esto conserva la lectura `pools(id,name)` y RLS como unica autoridad. |
| Join repetido, onboarding pendiente y logout protegido (evidencia manual) | PASS: el usuario confirma que los tres escenarios restantes de la checklist E2E fueron ejecutados correctamente. |
| Revision de causa raiz | PASS: `participants.approval_status` es `public.participant_approval_status`; el `CASE` de `join_pool` usa literales inferidos como `text`. No hay trigger involucrado. |
| Migracion correctiva | PASS: `20260913000100_phase_04_join_pool_approval_status_fix.sql` reemplaza solo `join_pool`, con ramas `CASE` casteadas a `public.participant_approval_status` y `payment_status` casteado a su enum. Es compatible con datos existentes: no modifica tablas, datos, RLS ni constraints. |
| `npx.cmd supabase db push --linked` | PASS: aplico en Cloud development/staging, en orden, `20260912000100_phase_05_admin_rpc.sql` y `20260913000100_phase_04_join_pool_approval_status_fix.sql`. |
| `npx.cmd supabase migration list` | PASS: `20260908000100`, `20260912000100` y `20260913000100` estan sincronizadas Local/Remote. |
| `npx.cmd supabase db push --linked --dry-run` | PASS: `Remote database is up to date`; sin migraciones pendientes. |
| Prueba SQL regresiva de join | PREPARADA: `supabase/tests/phase-04-join-pool.sql` prueba join, idempotencia y codigo invalido dentro de `BEGIN`/`ROLLBACK`. No ejecutada: la URI Session Pooler no esta disponible en esta sesion del agente. |
| Regresion frontend posterior | Typecheck PASS previo. Tests PASS previo: `npm.cmd test`, 6 archivos / 15 pruebas; se agregaron casos de pool visible, denegacion por cero filas RLS, error de consulta y carga que siempre termina. `npm.cmd run build` y las reejecuciones de test iniciadas para el gate final no completan en este host por contencion de procesos Node; no se registran como PASS final. `git diff --check` PASS previo. |
| E2E Auth/Join contra Supabase Cloud | NO EJECUTADO: requiere sesion de navegador, correo/OAuth y configuracion de redirect URLs/proveedores del proyecto remoto. |
| Google OAuth (evidencia manual) | PENDING_REVALIDATION: antes respondio `400 validation_failed`, `Unsupported provider: provider is not enabled`; el usuario confirma que el provider ya fue habilitado en Cloud. Falta reintento real en navegador. |
| Envio de Magic Link (evidencia manual) | PASS: el correo de confirmacion se envio y llego al correo de prueba. Falta validar apertura/callback para cerrar E2E-03. |
| Logout (evidencia manual) | PASS: cierre de sesion correcto. Falta comprobar ruta protegida para cerrar E2E-12. |

## Casos Cloud pendientes

1. Detener temporalmente el proceso Vite/Node de desarrollo y ejecutar `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build` y `git diff --check` con salida final verificable.

## Intento de ejecucion E2E Cloud

El intento de esta sesion no pudo iniciar escenarios autenticados. La PWA respondio por HTTP (`200`) y se confirmo la presencia de las dos variables publicas en `apps/platform/.env.local`, pero el entorno de ejecucion no ofrece un navegador utilizable para OAuth, callback o magic link (`Browser is not available`). No se leyeron ni registraron valores de ningun archivo de entorno.

| Escenario | Esperado | Obtenido | Estado |
| --- | --- | --- | --- |
| 1-4. Google OAuth y magic links | Sesion/callback controlados | No ejecutable sin navegador, proveedor y variables publicas disponibles al proceso | NO EJECUTADO |
| 5-6. Deep link, callback y onboarding | Reanuda solo codigo opaco | No ejecutable sin navegador/sesion | NO EJECUTADO |
| 7-10. Join RPC, repeticion, codigo invalido y aprobacion | Backend autoriza/deniega y devuelve participante | No ejecutable sin sesion Cloud/fixture autorizado | NO EJECUTADO |
| 11-12. Aislamiento por URL y logout | Sin datos cross-tenant, sesion limpiada | No ejecutable sin navegador/sesion | NO EJECUTADO |

No hubo llamadas Cloud de Auth/RPC, escrituras de membership ni escritura fuera de tenant durante este intento. La revision estatica conserva la evidencia de que el frontend no contiene `service_role`, password de base de datos, URI de pooler ni credenciales privilegiadas.

## Riesgos y limites

- La creacion administrativa de tenants no tiene un RPC/contrato aprobado en Fase 03. Esta fase no crea tenants ni memberships directas desde el cliente; el flujo implementado cubre onboarding de participante y join autorizado. Incorporar provisioning de tenant requiere contrato/RPC server-side antes de exponerlo en UI.
- Google OAuth y Magic Link ya tienen evidencia manual PASS. No hay bloqueo de infraestructura ni de migracion: las migraciones de soporte RPC de Fase 05 y el hotfix de Fase 04 se aplicaron de forma ordenada en Cloud development/staging. Falta evidencia E2E posterior al hotfix para cerrar Fase 04.
- La raiz contiene `.env.local` administrativo con variables PostgreSQL (`PGHOST`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`). No pertenece al frontend, no fue leido y debe mantenerse fuera de commits, de `apps/platform` y de distribuciones. El ZIP padre actual tambien contiene un `.env.local`; debe regenerarse sin ese archivo antes de compartirse o publicarse.
