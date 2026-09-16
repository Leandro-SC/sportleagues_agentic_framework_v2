# Fase 05-bis — Checklist manual de aislamiento Superadmin / Tenant Admin / Member

## Propósito y alcance

Verificar, contra Supabase Cloud real (no Docker/local), que las tres experiencias del producto
quedan aisladas tanto en frontend como en backend: Superadmin (`/superadmin`), organizador
(`/admin`) y participante. No cubre dashboard, listado de tenants, planes ni métricas: esa
superficie no existe todavía.

Prerrequisitos antes de ejecutar esta checklist:

1. La migración `20260915000400_phase_05bis_platform_admin_foundation.sql` (y las demás
   migraciones de Fase 05 pendientes) aplicadas en el proyecto Cloud usado para pruebas.
2. Un primer Superadmin provisionado siguiendo `docs/operations/PLATFORM-ADMIN-PROVISIONING.md`.
3. Al menos tres cuentas de prueba distintas (no de producción):
   - **Cuenta A — Platform Admin**: tiene fila activa en `platform_admins`. Para probar el caso
     "sin tenant", que NO tenga ninguna fila en `tenant_memberships`.
   - **Cuenta B — Tenant owner/admin**: `tenant_memberships.role in ('owner','admin')` en algún
     tenant, sin fila en `platform_admins`.
   - **Cuenta C — Member**: `tenant_memberships.role = 'member'` (o participante vía `join_pool`),
     sin fila en `platform_admins`.

## Matriz esperada

| Cuenta | `/superadmin` | `/admin` | Experiencia participante |
| --- | --- | --- | --- |
| A — Platform Admin (sin tenant) | Acceso permitido | Denegado (sin membership admin) | N/A si no tiene participaciones |
| B — Tenant owner/admin | Denegado | Acceso permitido a sus tenants | Puede participar si además tiene `participants` |
| C — Member | Denegado | Denegado | Acceso normal a `/p/:poolId` propios |

La fila crítica es A: confirma que ser Superadmin **no** otorga `/admin`, y que `/admin` para A
depende exclusivamente de si además tiene una `tenant_memberships` con rol admin/owner (ver
sección 9 de la tarea de diseño, ADR-008).

## Cómo registrar evidencia

Igual que `reports/auth/phase-04-e2e-manual-checklist.md`: captura de UI sin datos sensibles, URL
final, Console/Network sin errores no explicados, y confirmación de que ninguna respuesta expuso
el contenido de `platform_admins` (ni la lista de otros Superadmins) a una cuenta sin ese rol.

| ID | Resultado | Evidencia | Observación |
| --- | --- | --- | --- |
| SA-01 | PENDIENTE | | Cuenta A entra a `/superadmin`. |
| SA-02 | PENDIENTE | | Cuenta A, sin tenant membership, es rechazada en `/admin`. |
| SA-03 | PENDIENTE | | Cuenta B es rechazada en `/superadmin`. |
| SA-04 | PENDIENTE | | Cuenta B accede normalmente a `/admin`. |
| SA-05 | PENDIENTE | | Cuenta C es rechazada en `/superadmin` y en `/admin`. |
| SA-06 | PENDIENTE | | Refresh directo (F5) en `/superadmin` con Cuenta A no muestra flash de contenido con Cuenta B/C. |
| SA-07 | PENDIENTE | | Escribir `/superadmin` manualmente en la URL con Cuenta B/C no otorga acceso. |
| SA-08 | PENDIENTE | | Revocar a Cuenta A (`update platform_admins set revoked_at = now()...`) y, sin cerrar sesión, reintentar entrar a `/superadmin` navegando de nuevo: debe ser rechazada. |
| SA-09 | PENDIENTE | | Cuenta A puede ser simultáneamente Superadmin y tenant admin de un tenant (agregar membership de prueba): accede a ambas rutas de forma independiente. |
| SA-10 | PENDIENTE | | `select * from platform_admins` vía REST/PostgREST autenticado como Cuenta B/C falla (403 / permission denied), no devuelve `[]` silencioso ni datos. |

## Escenarios

### SA-01 — Platform Admin entra a `/superadmin`

- **Precondiciones:** Cuenta A provisionada y con sesión iniciada (Google/Magic Link).
- **Pasos:** navega a `/superadmin`.
- **Esperado/PASS:** carga `SuperadminView` con el layout oscuro aislado; confirma "Sesión
  verificada como Superadmin."; no aparece ningún dato de otros tenants/usuarios.
- **FAIL:** redirect a home, error visible, o contenido de `/admin` mezclado.

### SA-02 — Cuenta A sin tenant es rechazada en `/admin`

- **Precondiciones:** Cuenta A sin ninguna fila en `tenant_memberships`.
- **Pasos:** navega a `/admin`.
- **Esperado/PASS:** `useAdmin().load()` no encuentra memberships administrables; se muestra el
  `EmptyState` "Sin acceso administrativo" ya existente (comportamiento de Fase 05, sin cambios).
- **FAIL:** cualquier dato de un tenant visible para A sin membership real.

### SA-03 — Tenant owner/admin (Cuenta B) rechazada en `/superadmin`

- **Pasos:** con sesión de Cuenta B, navega a `/superadmin` (por UI, si existiera enlace, y
  también escribiendo la URL directamente).
- **Esperado/PASS:** redirect a `/` antes de que se monte cualquier contenido; ningún parpadeo de
  layout de Superadmin.
- **FAIL:** se monta `SuperadminView`, aunque sea brevemente, o el mensaje revela detalles
  técnicos/de la tabla `platform_admins`.

### SA-04 — Cuenta B accede a `/admin` con normalidad

- **Esperado/PASS:** sin regresión respecto a Fase 05: ve sus tenants administrables.

### SA-05 — Member (Cuenta C) rechazada en ambas rutas administrativas

- **Esperado/PASS:** `/superadmin` redirige a home; `/admin` muestra el `EmptyState` de sin
  acceso administrativo (o redirige, según el flujo actual de Fase 05).

### SA-06 — Refresh directo en `/superadmin`

- **Pasos:** con Cuenta A autenticada en `/superadmin`, presiona F5.
- **Esperado/PASS:** puede haber una pantalla en blanco breve mientras se resuelve
  `auth.restore()` + `is_platform_admin()`, pero nunca aparece contenido de otra cuenta ni un
  "flash" del layout antes de confirmar autorización.
- **FAIL:** aparece brevemente cualquier contenido antes de la validación.

### SA-07 — URL manual sin permisos

- **Pasos:** con Cuenta B o C, escribe `/superadmin` directamente en la barra de direcciones.
- **Esperado/PASS:** idéntico a SA-03/SA-05: rechazo antes de montar contenido.

### SA-08 — Revocación durante sesión activa

- **Pasos:** con Cuenta A en cualquier pantalla de la app (no necesariamente `/superadmin`),
  revoca su acceso en Cloud (`update platform_admins set revoked_at = now() where user_id = ...`).
  Sin cerrar sesión ni refrescar el JWT, navega (o vuelve a navegar) a `/superadmin`.
- **Esperado/PASS:** el guard vuelve a invocar `is_platform_admin()` en esa navegación y la
  rechaza inmediatamente — no depende de que expire el JWT.
- **FAIL:** sigue teniendo acceso porque el frontend cacheó el resultado anterior.
- **Nota:** si la Cuenta A ya estaba *dentro* de `/superadmin` sin volver a navegar, no hay
  ningún efecto inmediato porque la vista actual no repite llamadas — es un límite conocido y
  aceptable mientras `/superadmin` no exponga datos sensibles ni mutaciones (ver Riesgos).

### SA-09 — Doble rol (Superadmin + tenant admin)

- **Pasos:** agrega a Cuenta A una fila en `tenant_memberships` con rol `owner` o `admin` en un
  tenant de prueba, sin tocar su fila en `platform_admins`.
- **Esperado/PASS:** Cuenta A accede a `/superadmin` (por ser platform admin) y también a
  `/admin` (por la membership), de forma independiente; ninguno de los dos permisos se infiere
  del otro.

### SA-10 — PostgREST no expone `platform_admins` a cuentas sin el rol

- **Pasos:** con sesión de Cuenta B o C, desde DevTools Network o un cliente REST, intenta
  `GET {SUPABASE_URL}/rest/v1/platform_admins?select=*` con el token de esa sesión.
- **Esperado/PASS:** respuesta de error de permisos (HTTP 401/403 o mensaje Postgres
  `permission denied for table platform_admins`), nunca `[]` silencioso que sugiera "tabla vacía"
  ni, mucho menos, filas reales.

## Controles de seguridad

- [ ] Ninguna respuesta de red expone el contenido de `platform_admins` a una cuenta sin el rol.
- [ ] El mensaje de acceso denegado en `/superadmin` es genérico (no menciona la tabla, RLS, ni
      quién es Superadmin).
- [ ] `is_platform_admin()` nunca se invoca con un parámetro de usuario (confirmar en Network que
      el RPC se llama sin body/args).
- [ ] `/superadmin` nunca redirige a `/admin` como fallback.
- [ ] Revocar a un Superadmin activo bloquea el acceso en la siguiente navegación, sin esperar
      expiración de JWT.

## Cierre

Esta checklist se marca `PASS` solo cuando las diez filas de la tabla tengan evidencia real
contra Supabase Cloud (no simulada). Hasta entonces, Fase 05-bis permanece `PARTIAL` en
`PROJECT_STATE.md`. No inicia dashboard/tenants/planes de Superadmin hasta este cierre.
