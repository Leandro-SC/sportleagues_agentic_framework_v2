# ADR-008 — Autorización global de Superadmin de plataforma

- Estado: Accepted
- Fecha: 2026-09-15
- Decisores: Architecture Agent

## Contexto

El MVP define tres experiencias: participante, organizador (`owner`/`admin` de un tenant) y, ahora, **Superadmin de plataforma**: un actor global de SportLeagues que administra tenants, planes, estados de cuenta y auditoría cross-tenant, y que debe poder existir sin ninguna `tenant_membership`. El modelo actual (`tenant_role` enum `owner|admin|member` + `tenant_memberships` + `is_tenant_admin(tenant_id)`) es *tenant-scoped por diseño*: toda fila de `tenant_memberships` está atada a un `tenant_id`, y `is_tenant_admin` solo responde "¿es admin/owner de este tenant?". No hay ningún concepto de rol sin tenant, y reutilizar `owner`/`admin` para representar un superadmin exigiría o bien un tenant ficticio "plataforma" (contamina el modelo multi-tenant y las RLS existentes) o bien un `tenant_id` nulo especial (rompe los `not null` y los índices actuales). Ninguna alternativa es aceptable.

## Decisión

1. **Tabla global nueva**, fuera del árbol tenant-scoped: `platform_admins (user_id uuid primary key references auth.users(id), granted_by uuid references auth.users(id), granted_at timestamptz not null default now(), revoked_at timestamptz, note text)`. Sin `tenant_id`. Un registro con `revoked_at is null` implica superadmin activo.
2. **Función server-side** `public.is_platform_admin() returns boolean language sql stable security definer set search_path = public, auth` que evalúa `exists (select 1 from platform_admins where user_id = auth.uid() and revoked_at is null)`. Sin argumentos (a diferencia de `is_tenant_admin(tenant_id)`), porque el rol no depende de ningún tenant.
3. Toda RLS/RPC de alcance global usa `is_platform_admin()`; toda RLS/RPC tenant-scoped sigue usando `is_tenant_admin(tenant_id)`. Los dos helpers no se combinan con OR salvo que una operación puntual y documentada lo requiera explícitamente.
4. Frontend: guard de router `requirePlatformAdmin` separado de `requireTenantAdmin`, layout y árbol de rutas `/superadmin/**` independiente de `/admin`. El router nunca es la autoridad; solo evita parpadeos de UI.
5. Sin custom claims en el JWT para este rol. Se consulta la tabla vía `security definer` en cada request/RLS check (igual patrón que `is_tenant_admin`), no se cachea en el token.
6. Provisioning del primer superadmin: operación SQL manual controlada ejecutada directamente en Supabase Cloud (SQL editor con service-role, fuera de migraciones versionadas y sin credenciales en el repo), documentada como runbook. No hay seed automático en production ni email/UUID hardcodeado en código o migraciones versionadas.

## Alternativas consideradas

- **Custom claims / app_metadata en Supabase Auth**: descartado como única fuente de verdad. Requiere refrescar el JWT tras cada cambio de rol (revocación no es inmediata mientras el token viejo siga vigente), no es consultable con SQL/RLS directo sin `auth.jwt()` parsing frágil, y no deja rastro de auditoría (quién otorgó, cuándo, por qué) sin tablas adicionales — en cuyo caso la tabla ya es la fuente real y el claim es una copia redundante y potencialmente desincronizada.
- **Combinación tabla + claim**: aporta un `is_platform_admin` "gratis" en el cliente para UX, pero introduce dos fuentes de verdad que pueden desincronizarse (revocar en la tabla no invalida el claim hasta refresh) y complica el modelo sin necesidad real, dado que el proyecto ya paga el costo de una llamada RPC/RLS por request para `is_tenant_admin`. Se descarta por inconsistencia con el patrón ya validado.
- **Reutilizar `owner`/`admin` con un tenant "plataforma"**: descartado (ver Contexto) — mezclaría el modelo de autorización global con el multi-tenant, forzando a todo superadmin a tener una membership ficticia y arriesgando fugas de RLS tenant-scoped.
- **Hardcodear email/UUID en frontend o migración**: descartado explícitamente por el usuario y por esta arquitectura — viola "nunca confiar en el cliente para autorizar" y no es auditable ni revocable sin un deploy.

## Consecuencias

- Nueva frontera de autorización totalmente aislada del modelo tenant-scoped: un usuario puede ser superadmin sin membership alguna, u owner/admin de N tenants sin ser superadmin. Ambos permisos se evalúan de forma independiente y se muestran en layouts/rutas separados.
- Toda funcionalidad futura de `/superadmin` (fase posterior) debe exponerse vía RPC `security definer` que valide `is_platform_admin()` internamente, nunca vía grants directos de tabla a `authenticated`, análogo a como Fase 05 protegió `manage_pool`/`publish_pool_rules`.
- Se requiere una tabla de auditoría (`platform_admin_audit_log` o extensión del `audit_log` existente) para registrar altas/bajas de superadmin y, más adelante, acciones ejecutadas desde `/superadmin`. Se diseña en la fase de implementación, no en este ADR.
- Esta fase (documentación) no crea la tabla, la función, ni las rutas. La implementación (migración + RPC de gestión de superadmins + UI `/superadmin`) es una fase posterior explícita, no parte del cierre de Fase 05.

## Seguridad / privacidad

- `platform_admins` se declara con RLS habilitada y **sin políticas de lectura para `authenticated`**: solo `security definer` functions pueden leerla (mismo patrón usado para `tenant_memberships`, que hoy tiene `insert/update/delete` revocado a `authenticated`/`anon`). Ningún cliente puede hacer `select * from platform_admins`.
- `is_platform_admin()` se declara `security definer`, con `revoke all ... from public` y `grant execute ... to authenticated`, igual que `is_tenant_admin`.
- La mutación de `platform_admins` (otorgar/revocar) no se expone como RPC de escritura libre: cuando se implemente, debe exigir que el actor ya sea superadmin (`is_platform_admin()`) y quedar registrada en auditoría — es decir, un superadmin puede crear a otro, pero nadie puede autopromoverse desde cero por este canal.
- Manipular el router, Vue DevTools, la URL o el JS del cliente no otorga acceso: cualquier lectura o mutación global pasa por RLS/RPC que reevalúan `is_platform_admin()` contra `auth.uid()` en cada request. El guard de router es UX, no seguridad.
- Riesgo de escalación de privilegios si una futura RPC global usara `is_tenant_admin(tenant_id)` con un `tenant_id` controlado por el cliente en vez de `is_platform_admin()` sin argumentos: todo endpoint "global" debe auditarse para confirmar que usa el helper correcto.

## Migración / rollback

Implementado en Fase 05-bis: `supabase/migrations/20260915000400_phase_05bis_platform_admin_foundation.sql` crea `platform_admins`, `is_platform_admin()`, RLS y los grants/revokes descritos arriba. No inserta ningún registro real; el primer Superadmin se provisiona después mediante operación manual documentada en `docs/operations/PLATFORM-ADMIN-PROVISIONING.md`. Rollback: `drop function public.is_platform_admin(); drop table public.platform_admins;` es seguro mientras no exista ningún RPC/vista global construido sobre la tabla.

**Detalle de bootstrap (`granted_by`)**: `granted_by` es nullable. Es la única forma limpia de resolver que el primer platform admin no tiene, por definición, otro platform admin que lo otorgue — exigir `not null` forzaría un valor ficticio (auto-referencia o UUID inventado) que sería menos auditable que un `NULL` explícito. `NULL` se documenta como "otorgado por bootstrap manual", verificable porque solo puede ocurrir a través de la operación SQL documentada en el runbook, ejecutada por quien tiene acceso a Supabase Cloud con privilegios administrativos (equivalente a nivel de confianza a poder aplicar migraciones). Todo alta posterior de un segundo+ Superadmin debe ir vía una RPC futura que exija `is_platform_admin()` sobre el actor y registre su `auth.uid()` real en `granted_by`, nunca `NULL`.

**`granted_by` usa `on delete set null`, no el `no action`/`restrict` por defecto.** Detectado durante la validación previa a aplicar en Cloud: con la FK por defecto, borrar la cuenta Auth de un Superadmin que alguna vez otorgó acceso a otro habría quedado bloqueado por Postgres mientras existiera esa fila dependiente — un candado operativo no deseado, no una protección de seguridad real. Se decidió `on delete set null` porque: (1) el registro histórico (`granted_at`, `revoked_at`, `note`) no se pierde, solo se limpia la referencia a una cuenta que ya no existe; (2) nunca debe impedirse borrar una cuenta Auth por este motivo; (3) `is_platform_admin()` no lee `granted_by`, así que esta columna es puramente de auditoría y limpiarla no afecta la autorización de nadie. `NULL` pasa a tener dos lecturas posibles ("bootstrap" u "otorgante eliminado"), distinguibles en la práctica por si existe o no otra fila con `granted_by is null` y `granted_at` anterior, o simplemente por `note`; no se consideró necesario un campo adicional para esto en el MVP de esta frontera.
