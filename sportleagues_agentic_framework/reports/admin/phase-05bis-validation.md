# Fase 05-bis — Validación de infraestructura Superadmin (pre-implementación de dashboard)

## Resultado

`VALIDATION_ONLY / NO_CLOUD_CHANGES_APPLIED`. Ninguna migración se aplicó a Supabase Cloud en
esta tarea; ningún Superadmin real fue provisionado. Auditoría estática PASS; pruebas SQL locales
NOT EXECUTED (Docker no disponible).

## 1. Entorno Supabase detectado

- Supabase CLI está autenticado (`npx supabase projects list` responde) y el proyecto local está
  **enlazado** (`supabase link`) a un único proyecto:
  - `project_ref`: `juoftaofzepxbrrxbkhx`
  - nombre en el dashboard: `plataforma_bet`
  - estado: `ACTIVE_HEALTHY`, Postgres `17.6.1.166`, región `us-east-2`
- `apps/platform/.env.local` apunta a `https://juoftaofzepxbrrxbkhx.supabase.co` — coincide con
  el proyecto enlazado (no hay una URL de otro proyecto configurada en el frontend).
- **No existe un segundo proyecto** (staging vs. production separados) en esta organización de
  Supabase: `projects list` devuelve un solo resultado. Los reportes previos usan la frase
  "development/staging" para referirse a este mismo proyecto único, no a un ambiente distinto.
  Esto es relevante para Fase 15 (release): hoy no hay aislamiento real entre "pruebas" y
  "producción" a nivel de proyecto Supabase; es una decisión pendiente a registrar, no algo para
  resolver en esta tarea.
- No se imprimió ni se registró anon key, service role, password ni tokens en ningún paso.

## 2. Migraciones pendientes

`npx supabase migration list --linked` (solo lectura, no aplica nada):

| Migración | Aplicada en Cloud |
| --- | --- |
| `20260908000100_phase_03_tenant_foundation.sql` | Sí |
| `20260912000100_phase_05_admin_rpc.sql` | Sí |
| `20260913000100_phase_04_join_pool_approval_status_fix.sql` | Sí |
| `20260913000200_phase_05_pool_and_branding_entitlements.sql` | **No** |
| `20260915000100_phase_05_branding_asset_lifecycle.sql` | **No** |
| `20260915000200_phase_05_pending_branding_asset_lookup.sql` | **No** |
| `20260915000300_phase_05_branding_reconciliation.sql` | **No** |
| `20260915000400_phase_05bis_platform_admin_foundation.sql` | **No** |

Confirmado también con `supabase db push --linked --dry-run` (solo vista previa): las cinco
migraciones pendientes son exactamente esas, en ese orden. Ninguna se aplicó.

Es decir: **las cuatro migraciones de branding de Fase 05 (incluida la reconciliación) siguen sin
aplicarse**, tal como ya advertía `reports/admin/phase-05-admin.md`. La de Superadmin (05-bis) es
la última de la cola, no la única pendiente.

## 3. Auditoría de la migración 05-bis

Re-revisada línea por línea contra `docs/architecture/adr/ADR-008-...md`. Sin cambios de diseño
(no se detectó ningún error que lo justificara):

- **FK hacia `auth.users`**: `user_id` y `granted_by` referencian `auth.users(id)`, igual que
  `profiles.id` en Fase 03. Correcto.
- **RLS**: habilitada (`enable row level security`) sin ninguna policy para `authenticated`/
  `anon`. Correcto y, además, reforzado: no hay ningún `grant` sobre la tabla para esos roles, así
  que aunque alguien agregara una policy por error, seguiría sin poder leer/escribir sin el
  `grant` correspondiente (doble barrera).
- **Ausencia de policies de lectura directa**: confirmada. Ningún `create policy` toca
  `platform_admins`.
- **`is_platform_admin()`**: sin argumentos, `language sql stable security definer`,
  `set search_path = public, auth`. Coincide exactamente con el patrón ya validado de
  `is_tenant_admin(tenant_id)` de Fase 03, salvo que este no recibe parámetro — correcto, es el
  punto central del diseño (el llamador nunca elige qué identidad se verifica).
- **`SECURITY DEFINER`**: presente; la función corre con los privilegios del propietario
  (el rol que aplica migraciones), lo que le permite leer `platform_admins` pese a que
  `authenticated` no tiene ningún `grant` sobre la tabla. Es el único camino de lectura, como se
  diseñó.
- **`search_path` fijo**: `set search_path = public, auth` en la función, previene un ataque de
  "search_path hijacking" (crear un `public.platform_admins` o función homónima en otro esquema
  para que la función definer resuelva mal el nombre). Correcto.
- **GRANT/REVOKE**: `revoke all on public.platform_admins from authenticated, anon;` sobre la
  tabla; `revoke all on function ... from public` + `grant execute ... to authenticated` sobre la
  función (nada para `anon`). Correcto y consistente con el resto del esquema.
- **`revoked_at`**: se evalúa en cada llamada (`revoked_at is null`), no se cachea. La revocación
  es inmediata a nivel PostgreSQL, no depende de que expire un JWT — cumple el requisito.
- **Bootstrap con `granted_by NULL`**: documentado en el ADR y en el runbook; no se inserta
  ningún valor en la migración, solo se permite el `NULL` en el schema.
- **Comportamiento si el usuario Auth es eliminado**: `user_id` tiene `on delete cascade` — si se
  borra la cuenta de `auth.users`, su fila en `platform_admins` desaparece automáticamente (no
  queda un Superadmin "huérfano"). `granted_by` **no** tiene `on delete cascade` (queda en el
  valor por defecto `NO ACTION`): si un Superadmin activo otorgó acceso a otro y luego se intenta
  borrar la cuenta del primero de `auth.users`, Postgres rechazará ese `DELETE` por violación de
  FK mientras exista una fila que lo referencie como `granted_by`. **No es una falla de
  seguridad** (más bien evita perder silenciosamente el rastro de quién otorgó un acceso vigente)
  pero sí es una fricción operativa real a tener en cuenta el día que se borre la cuenta de un
  Superadmin que otorgó accesos a otros. No se modificó sin tu autorización porque el diseño
  aprobado no lo contemplaba como error — se deja como nota para decidir en la fase donde se
  construya la gestión de Superadmins.
- **Privilege escalation**: no se detectó ningún camino. La función es de solo lectura
  (`stable`), no existe todavía ninguna función de escritura sobre `platform_admins` expuesta a
  `authenticated` (ni `grant_platform_admin` ni similar — eso es explícitamente una fase
  posterior). `auto_expose_new_tables` en `supabase/config.toml` está sin fijar (por defecto
  `true` en proyectos nuevos), lo que significa que `platform_admins` sí aparece en el catálogo de
  PostgREST (`/rest/v1/platform_admins` "existe" como ruta), pero eso no otorga acceso: sin
  `grant`, cualquier intento devuelve error de permisos de Postgres a través de PostgREST, nunca
  datos. Confirmarlo en vivo es el escenario SA-10 de la checklist de aislamiento.

**Conclusión de la auditoría: sin cambios de diseño. Un solo hallazgo operativo no bloqueante**
(FK `granted_by` sin `on delete cascade`), documentado arriba, sin tocar el archivo.

## 4. Resultado de tests SQL

`supabase/tests/phase-05bis-platform-admin.sql`: **NOT EXECUTED — local Supabase unavailable**
(`docker info` falla: `failed to connect to the docker API ... dockerDesktopLinuxEngine: the
system cannot find the file specified`). Docker Desktop no está corriendo en este entorno; no se
intentó iniciarlo. No se marcó ningún test como PASS.

## 5. Plan exacto de aplicación Cloud (NO ejecutado — pendiente tu autorización)

1. **Entorno destino**: el único proyecto Supabase Cloud enlazado, `plataforma_bet`
   (`juoftaofzepxbrrxbkhx`), el mismo referenciado por `apps/platform/.env.local`.
2. **Project ref**: `juoftaofzepxbrrxbkhx`.
3. **Comando exacto**: `npx supabase db push --linked` (sin `--dry-run`). Requiere confirmación
   interactiva de la CLI o `--yes` si se ejecuta sin TTY; no usar `--yes` a la ligera — mejor
   confirmar interactivamente para poder abortar si el resumen no coincide con lo esperado.
4. **Migraciones que se aplicarían, en este orden exacto** (el mismo que reportó el dry-run):
   1. `20260913000200_phase_05_pool_and_branding_entitlements.sql`
   2. `20260915000100_phase_05_branding_asset_lifecycle.sql`
   3. `20260915000200_phase_05_pending_branding_asset_lookup.sql`
   4. `20260915000300_phase_05_branding_reconciliation.sql`
   5. `20260915000400_phase_05bis_platform_admin_foundation.sql`
5. **Cambios de schema que introducen** (resumen, no exhaustivo):
   - `manage_pool`, `update_tenant_branding` (entitlements de pool/branding, Fase 05 principal).
   - Ciclo de vida de assets de branding: tablas/funciones de `begin_branding_asset`,
     `get_active_branding_assets`, `remove_branding_asset`, lookup de assets pendientes,
     reconciliación (funciones usadas por las Edge Functions `branding-asset` y
     `branding-reconciler`, que **no** se despliegan con `db push` — ver riesgos).
   - `platform_admins`, `is_platform_admin()` (esta tarea).
6. **Riesgos**:
   - Las migraciones de branding (1-4) dependen de que las Edge Functions `branding-asset` y
     `branding-reconciler` (`supabase/functions/...`) también estén desplegadas
     (`supabase functions deploy`) y de que exista el bucket de Storage `branding-assets` — si
     solo se hace `db push`, el schema queda listo pero el flujo de carga de imágenes no
     funcionará hasta desplegar las funciones. Esto es continuación de Fase 05 principal, no de
     05-bis, pero viaja en el mismo `push` porque comparten la cola de migraciones pendientes.
   - No hay forma de aplicar *solo* `20260915000400` sin aplicar antes las cuatro de branding: la
     CLI aplica migraciones pendientes en orden y no permite saltarlas.
   - Ningún cambio de esta tanda es destructivo (no hay `drop table`/`drop column` sobre datos
     existentes); todas son `create table`/`create function`/`revoke`/`grant` aditivos.
   - Aplicar contra el único proyecto existente significa aplicar contra el mismo ambiente que ya
     tiene datos de prueba de Fases 03/04 (seed de desarrollo) — no hay riesgo de tocar datos de
     usuarios reales porque no hay usuarios reales todavía, pero sí de mezclar fixtures de prueba
     con lo que eventualmente sea producción si no se decide separar proyectos antes de Fase 15.
7. **Rollback / estrategia de recuperación**: cada migración de esta tanda es reversible de forma
   aislada porque solo agrega objetos (no hay `alter`/`drop` sobre objetos preexistentes):
   - `platform_admins`/`is_platform_admin()`: `drop function public.is_platform_admin(); drop
     table public.platform_admins;` (seguro, nada más depende de ellos todavía).
   - Las migraciones de branding tienen su propio rollback documentado implícitamente en sus
     propios archivos (son aditivas sobre `branding_assets`/`tenant_branding`); no se audita aquí
     en detalle porque no son objeto de esta tarea.
   - No existe rollback automático de `supabase db push`: si algo falla a mitad de la tanda,
     recuperación es corregir el archivo de migración que falló y volver a correr `db push`
     (Postgres aplica cada migración en su propia transacción, así que una migración fallida no
     dejaría cambios parciales de sí misma, pero las migraciones anteriores de la tanda sí
     quedarían aplicadas).

**No se ejecutó `supabase db push --linked` ni ningún equivalente. Esperando tu autorización
explícita antes de aplicar.**

## 6. Procedimiento de provisionamiento del primer Superadmin

Documentado paso a paso (localizar UUID sin usar el email como autoridad permanente, insertar con
`granted_by = NULL` solo por bootstrap, verificar `is_platform_admin() = TRUE` y verificar que
sigue sin haber lectura directa) en:

`docs/operations/PLATFORM-ADMIN-PROVISIONING.md`

**No se insertó ningún usuario.** Requiere que la migración 05-bis esté aplicada en Cloud primero
(sección 5).

## 7. Matriz Platform Admin / Tenant Admin / Member

Checklist completo con 10 escenarios (`SA-01`..`SA-10`), incluyendo refresh directo, URL manual,
revocación con sesión activa, doble rol, y verificación de que PostgREST no expone
`platform_admins` a cuentas sin el rol:

`reports/admin/phase-05bis-e2e-manual-checklist.md`

Todas las filas están `PENDIENTE` — requieren cuentas reales contra Cloud, que no existen todavía
sin aplicar la migración y provisionar el primer Superadmin.

## 8. Revisión de seguridad de `/superadmin` (revisión de código, sin ejecutar contra Cloud)

- **Loading**: el guard `router.beforeEach` para `name === 'superadmin'` es `async` y bloquea la
  navegación hasta que `auth.restore()` + `useSuperadmin().checkAccess()` resuelven. Vue Router no
  monta `SuperadminView` hasta que el guard retorna `true`, así que no hay flash de contenido
  privilegiado. En un refresh directo (F5) sobre `/superadmin`, `App.vue` no muestra un spinner
  explícito mientras se resuelve la navegación inicial — puede haber una pantalla en blanco breve
  (mismo comportamiento que ya existe para `/admin`, `/perfil`, `/p/:poolId`; no es una regresión
  introducida por esta fase, pero tampoco se pulió). Anotado como mejora de UX pendiente, no de
  seguridad.
- **Acceso denegado**: `platformAdminRedirect` no distingue "no autenticado" de "autenticado pero
  no Superadmin" en el mensaje — ambos casos redirigen silenciosamente a `/` sin mostrar ningún
  texto técnico, RLS, nombre de tabla, ni indicio de quién sí es Superadmin. Correcto según el
  punto 17 del encargo original.
- **Redirects/loops**: el único destino de redirect es `home`, que no tiene guard propio — no hay
  posibilidad de ciclo.
- **Refresh directo**: cubierto arriba (SA-06). El guard se re-ejecuta en cada navegación,
  incluida la primera carga de la SPA.
- **Logout desde `/superadmin`**: **hallazgo real** — `SuperadminView`/`SuperadminShell` no
  incluyen ningún control de cierre de sesión ni enlace de regreso a la app. Un Superadmin que
  entra directo a `/superadmin` (por ejemplo, por marcador) no tiene forma de cerrar sesión sin
  navegar manualmente a `/perfil` primero. No es una falla de seguridad (el `signOut()` de
  `useAuth` sigue limpiando la sesión igual si se invoca desde cualquier otra vista), pero es una
  laguna de UX que vale la pena resolver cuando se construya el dashboard real. No se implementó
  ahora por estar fuera del alcance de esta tarea (solo validación).
- **Sesión expirada**: el cliente Supabase (`autoRefreshToken: true`) intenta refrescar el token
  en segundo plano; si la sesión ya no es válida, la siguiente navegación a una ruta guardada
  (incluida `superadmin`) volverá a ejecutar `auth.restore()`, que reflejará `isAuthenticated =
  false` y redirigirá a home. Mientras el usuario permanece estático en `/superadmin` sin navegar,
  no hay verificación activa periódica — mismo patrón que el resto de la app (ninguna vista tiene
  polling de expiración), no es una regresión de esta fase.
- **Error de RPC**: `useSuperadmin.checkAccess()` captura cualquier error (`rpcError` o excepción
  del cliente) y devuelve `false` con un mensaje neutro genérico (`'No fue posible verificar el
  acceso.'`), sin exponer el mensaje real de Postgres/PostgREST. Falla en cerrado: un error de red
  o de RPC nunca produce acceso, solo denegación. Confirmado con tests unitarios
  (`useSuperadmin.test.ts`).
- **Cuenta revocada con sesión activa**: cubierto como SA-08. La función SQL reevalúa
  `revoked_at` en cada invocación — no hay caché server-side. El límite real es que el frontend
  solo vuelve a invocar el RPC cuando el router vuelve a ejecutar el guard (nueva navegación), no
  de forma continua mientras el usuario permanece inmóvil en la página; esto es aceptable ahora
  porque `/superadmin` no expone ningún dato sensible ni permite ninguna mutación todavía. Cuando
  exista un dashboard real, cada RPC de lectura/escritura debe re-verificar
  `is_platform_admin()` por sí misma server-side (como ya hace el patrón de `is_tenant_admin` en
  cada RPC administrativo existente), no confiar en que el guard ya lo verificó al entrar.

**No se detectó ningún hallazgo de seguridad que bloquee el uso de `/superadmin` tal como está.**
Los dos hallazgos (falta de logout visible, ausencia de spinner explícito) son de UX/pulido, no de
autorización, y quedan documentados para una fase posterior.

## 9. Recomendación sobre `requireTenantAdmin`

**Recomiendo implementarlo**, pero no ahora (fuera de alcance de esta tarea de validación).
Razones:

- Hoy `/admin` no tiene ningún guard de router basado en rol: cualquier usuario autenticado con
  perfil puede navegar a `/admin` y el rechazo ocurre recién dentro de `useAdmin().load()`
  (se monta el componente, se ve el `EmptyState` de "sin acceso administrativo"). Esto funciona y
  es seguro (RLS/RPC ya son la autoridad real), pero es asimétrico frente a `/superadmin`, que sí
  bloquea el montaje del componente en el guard.
- Un `requireTenantAdmin` en el router sería puramente defense-in-depth/UX (igual que se pidió
  explícitamente para `requirePlatformAdmin`): evitaría el parpadeo del `EmptyState` y dejaría el
  árbol de rutas simétrico y fácil de razonar («toda ruta administrativa se resuelve en el guard,
  ninguna en el componente»").
- No cambia la superficie de seguridad: seguiría siendo un guard cliente, y RLS/RPC seguirían
  siendo la única autoridad real, exactamente como se dejó explícito para `/superadmin`.
- Costo de implementarlo ahora: bajo, pero toca `/admin`, que el encargo de esta tarea pidió
  explícitamente no tocar salvo error real. Por eso lo dejo como recomendación pendiente de tu
  aprobación, no como cambio ejecutado.

## 10. Riesgos detectados

1. Las cuatro migraciones de branding de Fase 05 siguen sin aplicar en Cloud; aplicar la de
   Superadmin implica aplicar también esas cuatro (la CLI no permite aplicar fuera de orden).
2. Solo existe un proyecto Supabase Cloud (sin separación dev/staging/production) — relevante
   para Fase 15, no urgente ahora.
3. FK `granted_by` sin `on delete cascade`: puede bloquear el borrado de una cuenta que otorgó
   accesos vigentes a otros Superadmins. No es un problema de seguridad, sí operativo a futuro.
4. `platform_admins` es visible como ruta en PostgREST (`auto_expose_new_tables` sin fijar, por
   defecto `true`) aunque sin ningún `grant`; confirmar en vivo (SA-10) que ningún dato se filtra.
5. `/superadmin` no tiene control de logout propio ni indicador de carga explícito en refresh
   directo — hallazgos de UX, no de seguridad, para una fase posterior.
6. Sin pruebas SQL ejecutadas contra Postgres real todavía (Docker no disponible); la única
   validación hasta ahora es estática (lectura del SQL) más 5 tests unitarios de frontend.

## 11. Decisiones que requieren tu autorización

1. **Aplicar `supabase db push --linked`** contra `plataforma_bet` (aplicaría las cinco
   migraciones pendientes, incluida la de Superadmin). No ejecutado.
2. **Provisionar tu cuenta como primer Superadmin** siguiendo el runbook, una vez aplicada la
   migración. No ejecutado; requiere que confirmes tu UUID antes de que se ejecute cualquier
   `insert`.
3. **Si corregir o no** la FK `granted_by` (agregar `on delete cascade` o dejarla como
   `RESTRICT` intencional) — señalado como hallazgo, no corregido sin tu decisión.
4. **Si implementar `requireTenantAdmin`** ahora o en una fase posterior — recomendado, no
   implementado.
5. **Si resolver Docker local** (para poder ejecutar `supabase/tests/phase-05bis-platform-admin.sql`
   antes de tocar Cloud) o proceder directamente a Cloud development/staging aceptando el riesgo
   de no tener corrida la suite SQL localmente primero.

No se aplicó ninguna migración, no se insertó ningún usuario, no se modificó `/admin`, no se
implementó `requireTenantAdmin`, no hubo commit ni push.
