# Fase 05 / 05-bis — Validación post-migración en QA/UAT (`plataforma_bet`)

## Resultado

`MIGRATIONS_APPLIED / SCHEMA_VALIDATED / CRITICAL_FINDING_OPEN / SUPERADMIN_NOT_PROVISIONED`.

Las 5 migraciones pendientes fueron aplicadas manualmente por el usuario al proyecto QA/UAT
(`plataforma_bet`, `juoftaofzepxbrrxbkhx`) fuera de esta sesión. Esta tarea valida el resultado
mediante consultas de solo lectura (y un puñado de pruebas autocontenidas en transacciones con
`rollback`) — **ninguna migración se aplicó en esta tarea, ningún Superadmin fue provisionado,
ninguna Edge Function fue desplegada, no hubo commit ni push.**

Se encontró un **hallazgo de seguridad real** (no hipotético, confirmado con una prueba de
concepto autocontenida): ver `reports/security/finding-001-record-verified-branding-asset-authorization-gap.md`.
No se corrigió — solo se documentó, como se pidió.

## 1. Estado de `migration list`

`npx supabase migration list --linked`: las 8 migraciones (las 3 previas + las 5 nuevas) muestran
`local == remote`. `npx supabase db push --linked --dry-run` confirma `"upToDate": true,
"migrations": []` — no queda ninguna migración pendiente.

## 2. Migraciones confirmadas aplicadas

1. `20260913000200_phase_05_pool_and_branding_entitlements.sql`
2. `20260915000100_phase_05_branding_asset_lifecycle.sql`
3. `20260915000200_phase_05_pending_branding_asset_lookup.sql`
4. `20260915000300_phase_05_branding_reconciliation.sql`
5. `20260915000400_phase_05bis_platform_admin_foundation.sql` (incluye el fix `granted_by on delete set null` del hardening previo)

## 3. Tablas confirmadas

`platform_admins`, `branding_assets`, `tenant_branding` existen en `public`, las tres con
`relrowsecurity = true` (RLS activa).

## 4. RPCs confirmadas (existencia + firma)

Todas existen con la firma esperada (`pg_get_function_identity_arguments`):

- Branding: `manage_pool`, `update_tenant_branding`, `begin_branding_asset`,
  `get_pending_branding_asset_for_upload`, `record_verified_branding_asset`,
  `activate_branding_asset`, `remove_branding_asset`, `get_active_branding_assets`.
- Reconciliación: `claim_branding_assets_for_reconciliation`,
  `release_branding_asset_reconciliation_claim`, `complete_branding_asset_reconciliation`,
  `get_branding_asset_for_reconciliation`, `record_branding_reconciliation_issue`.
- Superadmin: `is_platform_admin()`.

## 5. GRANT/REVOKE confirmados

- `platform_admins`: `has_table_privilege` en `SELECT/INSERT/UPDATE/DELETE` es `false` tanto para
  `anon` como para `authenticated`. Confirmado también en vivo: `select * from platform_admins`
  como `authenticated` falla con `permission denied for table platform_admins`.
- `is_platform_admin()`: ejecutable por `authenticated` (`has_function_privilege = true`); como
  `anon` real (`set role anon`) devuelve `false` de forma segura, sin error ni fuga.
- **Hallazgo relevante para este punto** (detallado en el reporte de seguridad dedicado): el
  proyecto tiene privilegios por defecto de esquema que otorgan `EXECUTE` en toda función nueva a
  `anon`, `authenticated` **y** `service_role` automáticamente al crearla. Esto significa que
  `revoke all on function ... from public` (usado en todas las migraciones de este proyecto) **no
  es suficiente** para restringir una función a un rol específico — hace falta revocar
  explícitamente de los roles concretos. La mayoría de las RPCs del proyecto no dependen de esto
  para su seguridad porque validan `auth.uid()`/`is_tenant_admin`/`auth.role()` internamente; una
  sí depende exclusivamente del GRANT (`record_verified_branding_asset`) y por eso es explotable.
  Las 5 funciones de reconciliación tienen el mismo GRANT permisivo pero están protegidas por
  `assert_branding_reconciler_service_role()` internamente — confirmado que rechazan
  correctamente a un llamador `authenticated` con `request.jwt.claim.role` real.

## 6. RLS confirmada

`platform_admins`, `branding_assets`, `tenant_branding`: `rls_enabled = true` en las tres,
`rls_forced = false` (igual que el resto del esquema, sin cambios). Policies:
`platform_admins` no tiene ninguna (correcto, por diseño). `branding_assets`/`tenant_branding`
tienen sus policies esperadas (`branding_admin_write`, `branding_assets_select_active_member`,
`branding_config_admin_write`, `tenant_branding_select_member`) — no se modificó ninguna policy.

## 7. Suites SQL ejecutadas

- `supabase/tests/phase-05bis-platform-admin.sql`: ejecutada contra QA (`begin ... rollback`,
  fixtures propias, sin tocar datos existentes). Ver resultado detallado abajo.
- `supabase/tests/phase-05-branding-assets.sql`: ejecutada contra QA, se detuvo antes de
  completarse por una dependencia de fixture faltante (ver abajo) — no por un problema de
  seguridad de la ejecución.
- Dos verificaciones adicionales, autocontenidas y autoría propia de esta tarea (no archivos del
  repo), para completar la validación de branding sin depender del fixture faltante: bloqueo
  FREE/member, y la prueba de concepto cross-tenant del hallazgo de seguridad.

Todas se corrieron en transacciones que terminan en `rollback` (explícito o por aborto de
transacción ante un error); no se alteró ningún dato preexistente de QA.

## 8. Resultado de cada suite

### `phase-05bis-platform-admin.sql`

7 de 8 aserciones lógicas confirmadas correctas contra Postgres real en QA:

| Aserción | Resultado |
| --- | --- |
| `granted_by` se limpia a `NULL` al borrar la cuenta otorgante (no bloquea el borrado) | PASS |
| Usuario normal → `is_platform_admin()` false | PASS |
| Platform admin activo sin tenant → true | PASS |
| Platform admin revocado → false inmediato | PASS |
| Tenant owner → no es platform admin | PASS |
| Tenant admin → no es platform admin | PASS |
| `authenticated` no puede leer `platform_admins` directamente | PASS |
| `anon` no puede **ejecutar** `is_platform_admin()` en absoluto | **FALLÓ — pero es un defecto de la aserción, no del producto** |

La última aserción asumía que `anon` no tiene `EXECUTE` sobre la función (por el `revoke ... from
public`). Como se documentó en el punto 5, ese supuesto es incorrecto para este proyecto: `anon`
sí puede ejecutar `is_platform_admin()`, pero de forma segura (devuelve `false`, confirmado en
vivo con `set role anon`). Es un error en el archivo de test heredado de un supuesto equivocado
sobre privilegios de Postgres en este proyecto, no una vulnerabilidad — recomendable corregir la
aserción en una tarea aparte (cambiar la expectativa de "debe fallar con `insufficient_privilege`"
a "debe ejecutar y devolver `false`").

### `phase-05-branding-assets.sql`

**No se completó.** Se detuvo en la sección de Admin B (línea ~33,
`get_pending_branding_asset_for_upload` como Admin B) porque **el perfil `Admin B`
(`88888888-8888-8888-8888-888888888888`) no existe en QA** — el seed de Fase 03 en QA está
incompleto respecto al fixture local (falta también `Pending A`,
`77777777-7777-7777-7777-777777777777`). Esto es un hallazgo de datos de entorno, no de schema:
QA no tiene el mismo set de fixtures que Docker local. La transacción abortó y revirtió
automáticamente al ocurrir el error (nada persistido).

Antes de detenerse, sí se validó correctamente (Owner B, PRO, tenant B): `begin_branding_asset`
deriva el `storage_path` canónico; permite iniciar logo y banner; `get_pending_branding_asset_for_upload`
devuelve el contrato esperado para el propio dueño.

Para no depender del fixture faltante, se corrieron dos verificaciones adicionales autocontenidas
que sí completaron con éxito:

- FREE (tenant A, owner-a) y member (member-a) bloqueados correctamente al intentar
  `begin_branding_asset` (`pro branding is required` / `not authorized` respectivamente).
- **Prueba de concepto del hallazgo de seguridad**: Owner A (tenant A) invocó con éxito
  `record_verified_branding_asset` sobre un asset `pending` de Tenant B, sobrescribiendo su
  metadata. Ver `reports/security/finding-001-record-verified-branding-asset-authorization-gap.md`.

## 9. Suites no ejecutadas y motivo

Ninguna suite fue omitida por razones de seguridad de la ejecución (ambas se consideraron seguras
para correr contra QA: transaccionales, con `rollback`, sin dependencia de usuarios reales más
allá de los fixtures fijos de Fase 03). `phase-05-branding-assets.sql` no se completó por falta de
fixture (Admin B/Pending A), no por decisión de no ejecutarla.

## 10. Validación de Superadmin sin provisioning

Confirmado sin insertar ninguna cuenta real:

- `is_platform_admin()` devuelve `false` para un usuario autenticado no registrado. ✔
- Tenant owner no se convierte automáticamente en platform admin. ✔
- Tenant admin no se convierte automáticamente en platform admin. ✔
- `platform_admins` no es enumerable directamente por `authenticated` ni `anon`. ✔

## 11. Validación de branding

- FREE bloqueado en `begin_branding_asset`: ✔ (confirmado).
- PRO autorizado (Owner B): ✔ (confirmado parcialmente — begin/pending-lookup; activate/remove no
  se re-confirmaron en esta tarea porque ya estaban cubiertos por el resto de la suite antes del
  corte, y no era necesario repetirlos con las verificaciones ad hoc).
- Member bloqueado: ✔ (confirmado).
- Cross-tenant bloqueado: **parcialmente NO** — bloqueado para `begin_branding_asset`/
  `activate_branding_asset` (verifican `is_tenant_admin`), pero **NO bloqueado** para
  `record_verified_branding_asset` (hallazgo de seguridad 001).
- No se probó upload real de imagen (Edge Functions no desplegadas, fuera de alcance).

## 12. Typecheck

**PASS.**

## 13. Tests frontend

**PASS** — 49 pruebas, 10 archivos.

## 14. Build

**PASS.**

## 15. Validación manual de `/admin`

**No realizada por mí en un navegador real** — este entorno de ejecución no tiene una herramienta
de navegador/automatización disponible para hacer clic a través del login real (Google/Magic
Link), que es requisito para probar `/admin` end-to-end. Lo que sí se confirmó:

- El servidor de desarrollo (`npm run dev`) arranca sin errores y responde `HTTP 200` en `/`.
- La lógica de autorización que decide el acceso a `/admin` (`useTenantAdminAccess` +
  `tenantAdminRedirect`) está cubierta por 9 + 3 pruebas unitarias que ya pasan (sección 13).
- La autoridad real (RLS/RPC) para owner/admin/member fue validada exhaustivamente a nivel SQL en
  esta tarea y en las anteriores.

Recomiendo al usuario ejecutar manualmente el flujo de `reports/auth/phase-04-e2e-manual-checklist.md`
más `reports/admin/phase-05bis-e2e-manual-checklist.md` (casos `SA-03`/`SA-04`) contra QA para
cerrar la validación visual — no puedo reclamar ese resultado sin haberlo ejecutado yo mismo.

## 16. Validación manual de `/superadmin`

Misma limitación que el punto 15: no ejecutado en navegador real por mí. La autorización real
(`is_platform_admin()`) fue validada exhaustivamente vía SQL (sección 10); la lógica de guard de
frontend (`platformAdminRedirect`, `useSuperadmin`) tiene su propia cobertura de pruebas unitarias
ya verde. Sin una cuenta Superadmin provisionada (explícitamente no autorizado en esta tarea), no
existe todavía ningún caso positivo que probar en el navegador — solo el caso negativo (cualquier
cuenta real que inicie sesión hoy debe ser rechazada), que tampoco ejecuté por no tener acceso a
un navegador en este entorno.

## 17. Errores encontrados

1. **Hallazgo de seguridad 001 (alto)**: `record_verified_branding_asset` sin autorización interna,
   explotable cross-tenant vía Postgres/PostgREST directo. Ver reporte dedicado. **No corregido.**
2. **Defecto de test (bajo, no de producto)**: la aserción "anon no puede ejecutar
   `is_platform_admin()`" en `phase-05bis-platform-admin.sql` está mal planteada — el producto se
   comporta de forma segura, pero el test asume una mecánica de permisos que no aplica en este
   proyecto Supabase. Recomiendo corregirla en una tarea aparte.
3. **Fixture de QA incompleto**: faltan los perfiles/membresías `Admin B`
   (`88888888-8888-8888-8888-888888888888`) y `Pending A` (`77777777-7777-7777-7777-777777777777`)
   del seed de Fase 03 en QA, lo que impidió completar `phase-05-branding-assets.sql` tal cual está
   escrito. No se insertaron esos fixtures en esta tarea (habría sido "adaptar QA para pasar el
   test"). Si se quiere volver a correr esa suite completa contra QA, hace falta decidir
   explícitamente si se agregan esos dos fixtures a QA (y documentarlo) o si se mantiene el gap.
4. Ningún problema de schema, RLS ni de las migraciones aplicadas en sí — el fix de `granted_by`
   del hardening previo quedó confirmado funcionando correctamente en QA real.

## 18. Estado final de QA

- Las 8 migraciones (3 previas + 5 nuevas) están aplicadas; `migration list`/`db push --dry-run`
  confirman que no queda ninguna pendiente.
- Ningún dato de QA fue alterado por esta tarea: todas las consultas de validación fueron de
  solo lectura o corrieron dentro de transacciones que terminaron en `rollback` (explícito o por
  aborto automático ante un error).
- No hay ningún Superadmin provisionado todavía.
- No hay ninguna Edge Function desplegada todavía (`branding-asset`, `branding-reconciler`).
- Existe un hallazgo de seguridad activo y sin corregir (`record_verified_branding_asset`).

## 19. Recomendación sobre si ya es seguro provisionar el primer Superadmin

**Sí, es seguro provisionar el primer Superadmin de prueba en QA ahora mismo, en el sentido
estricto de la frontera de autorización de Superadmin**: `platform_admins`, `is_platform_admin()`,
RLS y grants quedaron validados exhaustivamente y sin ningún hallazgo — el hallazgo de seguridad
001 **no tiene ninguna relación con Superadmin ni con `platform_admins`**, es un problema aislado
en `record_verified_branding_asset` (branding, Fase 05 principal).

Dicho esto, recomiendo **no cerrar Fase 05-bis ni continuar con el despliegue de Edge Functions de
branding** hasta que se decida qué hacer con el hallazgo 001 — no porque bloquee a Superadmin, sino
porque desplegar `branding-asset`/`branding-reconciler` sin corregirlo pondría en producción un
flujo de carga de imágenes con una vía de escritura cross-tenant abierta. Provisionar Superadmin y
corregir el hallazgo 001 son independientes y pueden ordenarse como el usuario prefiera.

No se provisionó ninguna cuenta en esta tarea; queda pendiente de tu autorización explícita.

## 20. Remediación posterior preparada (2026-09-17)

Se agregó `20260917000100_phase_05_branding_asset_service_role_guard.sql` para cerrar el hallazgo
001: protege internamente `record_verified_branding_asset` con `auth.role() = 'service_role'` y
revoca explícitamente `EXECUTE` de `anon` y `authenticated`. También se amplió la regresión SQL
de branding para `anon`, y se corrigió el test de `is_platform_admin()` para esperar `false` en
lugar de un error de privilegios para `anon`.

`supabase db push --linked --dry-run` confirmó que es la única migración pendiente; no se aplicó
en QA. La validación SQL local no pudo ejecutarse porque Docker Desktop no estaba disponible.
Por tanto, el hallazgo 001 sigue abierto hasta aplicar la migración y repetir las regresiones SQL.

## 21. Validación final del fix y de 05-bis (2026-09-17)

La migración correctiva se aplicó en QA y las nueve migraciones están sincronizadas. La regresión
SQL autocontenida de branding pasó contra QA: ACL de `anon`/`authenticated` revocadas, rechazo
interno de ambos actores y acceso conservado para `service_role`, todo dentro de `begin`/`rollback`.
El hallazgo 001 queda cerrado.

También pasó contra QA `supabase/tests/phase-05bis-platform-admin.sql` con la aserción corregida
para `anon`; sus fixtures son transaccionales y se revierten.

## 22. Preparación operativa de Edge Functions (2026-09-17)

`BRANDING_RECONCILER_SECRET` fue configurado en QA desde un valor criptográficamente seguro
generado solo en memoria. Se confirmó su nombre mediante `supabase secrets list`; ningún valor se
registró en el repositorio ni en este reporte.

No se encontró un origen HTTPS real del frontend QA en `PROJECT_CONFIG.md`, `PROJECT_STATE.md`,
`.env.example`, configuración Vite ni documentación: las únicas URLs de frontend documentadas son
hosts locales, y Vercel/Netlify sigue como decisión pendiente. Por la política explícita de no
inventar CORS, no se configuró `CORS_ALLOWED_ORIGINS`; no se desplegaron ni invocaron
`branding-asset` o `branding-reconciler`. El dato faltante es el origen QA exacto y autorizado.
