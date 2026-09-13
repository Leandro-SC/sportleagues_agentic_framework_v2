# HANDOFF - Fase 04: Auth, onboarding, memberships y join

- Agente: Auth & Membership Agent
- Estado: PARTIAL / CLOUD_E2E_PASS_BUILD_GATE_PENDING

## Objetivo

Implementar cliente Auth seguro, onboarding de perfil y join por codigo/deep link sin trasladar autorizacion al frontend.

## Archivos modificados

- `apps/platform/**` - shell Vue/Vite, adaptador Supabase, composables, rutas, consulta RLS minima de PoolView y tests unitarios.
- `.env.example` y `.gitignore` - solo variables Vite publicas y exclusion de entornos locales.
- `package.json` y `package-lock.json` - toolchain Vue/Vite/Tailwind/Supabase/Vitest.
- `reports/auth/phase-04-auth-memberships.md` - evidencia y pendientes.
- `PROJECT_STATE.md` - estado de la fase.

## Contratos/API afectados

Se consume `join_pool(p_code text)`. La correccion forward-only `20260913000100_phase_04_join_pool_approval_status_fix.sql` reemplaza la funcion para tipar explicitamente las ramas de su `CASE` como `public.participant_approval_status`. La aplicacion no ejecuta mutaciones directas de `tenant_memberships` o `participants`.

## Decisiones

- Auth usa implicit flow explicito y callback idempotente de restauracion; no ejecuta `exchangeCodeForSession`.
- El unico estado persistido para join es el codigo opaco y se elimina al consumirlo o al logout.
- La ruta de destino se deriva de la respuesta del RPC autorizado.
- PoolView consulta solo `pools(id,name)` por id y representa cero filas de RLS como denegacion; los guards solo mejoran UX y RLS/RPC son la frontera de seguridad.

## Tests ejecutados

- Typecheck, build y `git diff --check` posteriores al hotfix: PASS.
- Vitest posterior al hotfix: PASS, 5 archivos / 11 pruebas. La configuracion usa pool `forks` y un worker para que `npm.cmd test` sea estable en este equipo.
- Google OAuth y Magic Link: PASS por evidencia manual Cloud.
- Join `ALPHA1`: PASS posterior al hotfix; la evidencia manual llega a Pool A y muestra `Acceso confirmado` en la ruta autorizada.
- Codigo invalido y acceso directo cross-tenant: PASS por evidencia manual Cloud, con mensajes controlados.
- PoolView: PASS posterior a la correccion; Pool A se muestra al abrir la ruta autorizada.
- Join repetido, onboarding pendiente y logout protegido: PASS por confirmacion manual del usuario.
- `db push --linked`: PASS; aplico `20260912000100_phase_05_admin_rpc.sql` y `20260913000100_phase_04_join_pool_approval_status_fix.sql` en Cloud development/staging.
- `migration list` y `db push --linked --dry-run`: PASS; las tres migraciones locales estan sincronizadas con Remote y no hay pendientes.

## Riesgos / limitaciones

El join requiere revalidacion manual contra Cloud. La prueba SQL regresiva `supabase/tests/phase-04-join-pool.sql` esta preparada y hace rollback, pero no se ejecuto porque la URI Session Pooler no esta disponible en esta sesion. Provisioning de tenant requiere un contrato server-side aprobado. El ZIP padre contiene un `.env.local` administrativo y debe regenerarse sin él antes de distribuirse.

## Bloqueos

No hay bloqueo de implementacion ni de despliegue. Todos los escenarios Cloud E2E estan confirmados. Falta el gate tecnico final porque el build y reejecuciones de test quedan sin salida final mientras existen procesos Node de desarrollo activos. No se leyeron ni registraron secretos.

## Proximo paso permitido

Detener temporalmente Vite y ejecutar los cuatro comandos de regresion antes de cerrar Fase 04 y habilitar Fase 05.
