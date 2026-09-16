# Fase 05-bis — Hardening previo a Cloud (FK, `requireTenantAdmin`, loading y logout de Superadmin)

## Resultado

`HARDENING_COMPLETE / STILL_NOT_APPLIED_TO_CLOUD`. Cierra los hallazgos de
`reports/admin/phase-05bis-validation.md` que no requerían tocar Cloud. Ninguna migración se
aplicó, ningún Superadmin fue provisionado, `/admin` no fue rediseñado.

## 1. Corrección de `granted_by`

`platform_admins.granted_by` pasó de `references auth.users(id)` (default `NO ACTION`) a
`references auth.users(id) on delete set null`, en la misma migración no aplicada
(`20260915000400_phase_05bis_platform_admin_foundation.sql`) — se editó en el lugar, no se creó
una migración nueva, porque el proyecto no exige append-only para migraciones que todavía no se
aplicaron a ningún ambiente (`npx supabase migration list --linked` confirma `remote: ""` para
ella antes y después del cambio).

**Decisión documentada** (en el archivo y en el addendum de `ADR-008`): `on delete set null` en
vez de `restrict`/`no action`, porque borrar una cuenta Auth nunca debe bloquearse por haber
otorgado acceso a otro Superadmin, y el registro histórico (`granted_at`, `revoked_at`, `note`) no
debe perderse. `NULL` pasa a significar "bootstrap" **o** "cuenta otorgante ya no existe" — ambas
lecturas son equivalentes para `is_platform_admin()`, que nunca lee `granted_by`. No se encontró
ninguna razón fuerte para preferir otra estrategia sobre la solicitada.

Se añadió una aserción nueva en `supabase/tests/phase-05bis-platform-admin.sql` (fixtures ad hoc,
autocontenidas, dentro de la misma transacción que se revierte al final) que borra una cuenta Auth
que otorgó un acceso y confirma que: (a) el borrado no falla, (b) la fila dependiente sobrevive con
`granted_by = null`.

## 2. `requireTenantAdmin` implementado

- `apps/platform/src/composables/useTenantAdminAccess.ts` (nuevo): responde únicamente "¿este
  usuario administra al menos un tenant activo?" consultando `tenant_memberships` y reutilizando
  `canManageTenant()` de `admin-contracts.ts` — la misma función que ya usa `useAdmin.ts` para
  decidir qué es "administrar un tenant". No hay una segunda definición de esa regla.
- `tenantAdminRedirect(authenticated, hasTenantAdminAccess)` en `navigation-guards.ts` (puro,
  testeable, sin email, sin parámetro de Superadmin — estructuralmente no puede considerar
  `is_platform_admin()`).
- `router.ts`: `/admin` ahora tiene su propia rama en `beforeEach`, simétrica a `/superadmin`:
  bloquea la navegación hasta resolver `useTenantAdminAccess().checkAccess(profileId)`, nunca cae
  a `/superadmin`, y usa el mismo mecanismo de `routeAuthCheck` para evitar flash de contenido.
  `admin` se sacó de `GUARDED_ROUTES` (que solo cubre `protectedRouteRedirect`) porque ahora tiene
  su propia rama dedicada.
- **Separación mantenida**: el guard (`useTenantAdminAccess`, consulta mínima) no reemplaza ni
  duplica la carga de datos del panel (`useAdmin.load()`, que trae tenants/pools/participantes/
  branding); RLS/RPC siguen siendo la autoridad real — el guard es solo UX, documentado así en el
  comentario del propio `router.ts`.
- `AdminView.vue` no se modificó: sigue mostrando su propio `EmptyState` si, por cualquier razón,
  se monta sin acceso (defensa en profundidad adicional, no depende de que el guard sea perfecto).

## 3. Resultado de los nuevos tests del guard

`apps/platform/src/composables/useTenantAdminAccess.test.ts` (9 casos) +
`apps/platform/src/lib/navigation-guards.test.ts` (3 casos nuevos para `tenantAdminRedirect`):

- Owner → accede.
- Admin → accede.
- Member → no accede.
- Usuario autenticado sin ningún tenant → no accede.
- "Platform admin sin tenant" → no accede (la consulta nunca mira `platform_admins`; se prueba
  con cero memberships, idéntico a cualquier otro usuario sin tenant, precisamente porque el rol
  de plataforma es irrelevante aquí).
- "Platform admin + owner" → accede (una membership `owner` presente; el resultado no depende de
  si además es Superadmin).
- Error de backend → falla cerrado, sin filtrar el mensaje real de Postgres.
- Excepción del cliente → falla cerrado.
- `loading` pasa a `true` de forma síncrona antes de resolver la promesa (contrato que el guard de
  router usa para bloquear el montaje del componente).

Todos pasan — ver sección de validación general abajo (49 tests totales en el proyecto).

## 4. Loading explícito en `/superadmin` (y `/admin`)

`router.ts` expone `routeAuthCheck` (`'admin' | 'superadmin' | null`), activado justo antes de
esperar el RPC/consulta de rol y limpiado en un `finally`. `App.vue` lo consume: mientras vale
`'superadmin'` muestra un spinner (`LoaderCircle`) centrado sobre fondo `ink-950` (mismo tono que
`SuperadminShell`); mientras vale `'admin'`, spinner sobre `mist-50` (tono ya usado en el resto de
la app). Sin texto, sin skeleton grande, sin nada "decorativo" — un único ícono girando,
consistente con el spinner que ya usa `AdminView` para su propio estado de carga interno. Nunca se
muestra contenido de la ruta destino mientras `routeAuthCheck` está activo.

## 5. Logout desde `/superadmin`

`SuperadminShell.vue` agrega un botón "Cerrar sesión" (icono `LogOut`, mismo lucide-icon que usa
`ProfileView.vue`) en el header, que emite `logout`; `SuperadminView.vue` lo escucha y llama
`useAuth().signOut()` — la misma función que ya usa `ProfileView.vue`, sin lógica de auth
duplicada — y luego `router.replace({ name: 'home' })`, la misma ruta pública a la que ya
redirige el logout existente.

## 6. UI/UX

Sin rediseño de `/admin`. El spinner de `/admin` reutiliza los tonos ya existentes (`mist-50`,
`ink-400`) y el de `/superadmin` los del propio `SuperadminShell` (`ink-950`, `mist-400`); el botón
de logout usa la misma tipografía/peso que el resto de la navegación del shell. No se introdujo
ningún color, gradiente ni patrón nuevo.

## 7. Backend de branding

No se tocó ningún RPC, Edge Function, política de Storage ni lifecycle de branding en esta tarea.

## Validación ejecutada

| Comando | Resultado |
| --- | --- |
| `npm.cmd run typecheck` | PASS |
| `npm.cmd test` | PASS — 49 pruebas en 10 archivos |
| `npm.cmd run build` | PASS |
| `git diff --check` | PASS (solo avisos LF/CRLF) |
| `npx supabase migration list --linked` | Confirma exactamente las mismas 5 migraciones pendientes de antes (el fix de FK no agregó ni quitó ninguna) |
| `npx supabase db push --linked --dry-run` | Mismo resultado que antes del hardening — mismas 5 migraciones, mismo orden; no se ejecutó el push real |
| `supabase/tests/phase-05bis-platform-admin.sql` | NOT EXECUTED — local Supabase unavailable (Docker sigue sin disponibilidad en este entorno) |

## Riesgos restantes

1. La suite SQL sigue sin ejecutarse contra Postgres real (Docker no disponible). El plan de
   despliegue (`docs/operations/PHASE-05BIS-QA-DEPLOYMENT-PLAN.md`) exige que pase antes de
   autorizar el push a QA.
2. `granted_by NULL` sigue teniendo doble lectura ("bootstrap" u "otorgante eliminado") — aceptado
   como parte de la decisión, documentado en el ADR.
3. Ningún cambio de esta tarea se aplicó a Cloud todavía; ver plan de despliegue actualizado para
   los pasos siguientes, pendientes de autorización explícita.

No se aplicó ninguna migración, no se provisionó ningún Superadmin, no hubo commit ni push.
