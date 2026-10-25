# Matriz UI + permisos (admin / user)

Estado: derivada del código en `apps/platform/src` (rama `feat/api-football-connector`). Fuentes: `router.ts`, `lib/navigation-guards.ts`, `lib/role-navigation.ts`, `components/BottomNav.vue`, políticas RLS de `supabase/migrations/`. Reglas: ADR-008 (con ADR-018), ADR-015, ADR-017 (propuesto), `docs/agents/ENCARGO_MAESTRO_SPORTLEAGUES.md` §2-§3.

**Principio.** Hay solo dos experiencias visibles: `user` (participante) y `admin` (organizador). «Modo organizador» es otra vista de la **misma cuenta**, no un rol nuevo ni un permiso: el guard del router solo decide la UX; la autoridad real es RLS/RPC en la base de datos. Ocultar un botón nunca es autorización. No existe una tercera experiencia: la UI de Superadmin no forma parte de la app principal (ADR-018).

Leyenda de estado: **implementada** / **parcial** / **no disponible**.

## 1. Rutas

| Ruta | Nombre | Quién accede (UX) | Guard del router | Autoridad real (RLS / RPC) | Estado |
| --- | --- | --- | --- | --- | --- |
| `/` | `home` | Visitante (login/registro) y usuario (inicio) | ninguno | Supabase Auth; lecturas por RLS (`participants`, `pools` vía `useMyPools`) | implementada |
| `/auth/callback` | `auth-callback` | Retorno de Google/confirmación | ninguno | Supabase Auth | implementada |
| `/auth/reset` | `reset-password` | Usuario con sesión de recuperación | `protectedRouteRedirect`: sin sesión → `home` | Supabase Auth | implementada |
| `/onboarding` | `onboarding` | Usuario con sesión sin perfil | sin sesión → `home` | `profiles` RLS `id = auth.uid()` | implementada |
| `/j/:code` | `join` | Usuario (los visitantes se redirigen a iniciar sesión conservando el código) | ninguno (la vista pide sesión) | RPC `join_pool` (código, aprobación, límite Free, **rechaza administradores de la quiniela** `42501`, ADR-015) | implementada |
| `/p/:poolId` | `pool` | Participante; también el administrador de esa quiniela en **solo lectura** | sesión + perfil | RLS `pools`/`participants`/`pool_matches`; `save_prediction`, tickets (`create_ticket`, `submit_ticket`…) con lock server-side; `can_read_prediction` oculta pronósticos ajenos hasta el lock | implementada |
| `/perfil` | `profile` | Usuario y admin | sesión + perfil | `profiles` RLS; solicitud «Crear mi propia quiniela» vía RPC (ver §3) | implementada (solicitud: depende de ADR-017, no aplicado a QA) |
| `/mis-puntos` | `points` | Usuario y admin (otras quinielas) | sesión + perfil | RPC `my_points_summary`, `pool_leaderboard` | implementada |
| `/mis-tickets` | `my-tickets` | Usuario y admin (otras quinielas) | sesión + perfil | RPC `list_my_tickets` y tickets con RLS del propietario | implementada |
| `/partidos` | `matches` | Usuario y admin | sesión + perfil | Catálogo público de solo lectura; sin datos de ejemplo en QA/producción muestra estado vacío | parcial (datos de vista previa solo con `VITE_PREVIEW_DATA`/DEV) |
| `/ligas` | `leagues` | Usuario y admin | sesión + perfil | `useMyPools` bajo RLS | implementada |
| `/ligas/unirme` | `league-join` | Usuario y admin (otras quinielas) | sesión + perfil | RPC `join_pool` | implementada |
| `/ligas/:leagueId` | `league` | Usuario y admin | sesión + perfil | Catálogo público (solo lectura) | parcial (igual que `/partidos`) |
| `/equipos/:teamId` | `team` | Usuario y admin | sesión + perfil | Catálogo público (solo lectura); «seguir equipo» es preferencia local | parcial |
| `/organizador` | `organizer-dashboard` | Solo admin (owner/admin activo) | `tenantAdminRedirect`: consulta `tenant_memberships` activas con rol owner/admin (`useTenantAdminAccess`); si no → `home` | RLS `is_tenant_admin(tenant_id)` en cada tabla/RPC administrativa | implementada (Reportes: **no disponible**) |
| `/admin` | `admin` | Solo admin | idem | RPC `manage_pool`, `approve_participant`, `set_participant_payment_status`, `publish_pool_rules`, `create_pool_join_code`, branding (`update_tenant_branding`, `begin_branding_asset`); límites Free/PRO server-side | implementada |
| `/admin/parrilla` | `admin-fixture` | Solo admin | idem | RPC `upsert_tournament/team/round/match`, `set_pool_match`, `publish_official_result`, `set_tournament_results_mode`, `import_catalog_*`; RLS por tenant | implementada |
| `/admin/ingresos` | `admin-income` («Mis finanzas») | Solo admin | idem | Solo lectura de `tenant_memberships`, `tenants`, `pools`, `participants` bajo RLS; el selector sale únicamente de las membresías admin activas del usuario autenticado, nunca de la URL | implementada (sin importes: no existen en el MVP) |
| `/superadmin` | `superadmin` | **Nadie** en la app principal | La ruta no se registra (ADR-018); solo con `VITE_ENABLE_SUPERADMIN_UI=true` (nunca en QA/producción) existe con `platformAdminRedirect` + `is_platform_admin()` | `platform_admins`, `is_platform_admin()`, `register_platform_intervention` (ADR-008, se conservan en BD) | no disponible |
| cualquier otra | `not-found` | Todos | comodín: redirige a `home` sin ejecutar guards de autorización | n/a | implementada |

## 2. Navegación por experiencia

| Experiencia | Barra inferior (≤ 5 opciones) | Salida / cambio |
| --- | --- | --- |
| `user` | Inicio · Partidos · Ligas · Puntos · Perfil | En Inicio, solo con membresía admin activa, aparece «Modo organizador · Gestionar mis quinielas». En Perfil → Ajustes también «Modo organizador» (misma condición). |
| `admin` (rutas `/organizador` y `/admin/**`; `lib/role-navigation.ts`) | Panel (`/organizador`) · Quinielas (`/admin`) · Parrilla (`/admin/parrilla`) · Finanzas (`/admin/ingresos`) · Perfil | Franja fija sobre la barra: «Modo participante · Volver a Inicio» (≥ 44 px) → `/`. |

- Un `admin` participa en **otras** quinielas desde las vistas de usuario (Ligas, Pool, Mis tickets, Mis puntos) sin cambiar de rol; ninguna de ellas lo bloquea en la UI. En la quiniela que administra, el servidor rechaza inscripción, tickets y pronósticos (ADR-015; `join_pool` → `42501`, triggers en `participants`/`tickets`/`predictions`) y `PoolView` solo muestra la parrilla con el aviso «Administras esta quiniela…», sin formulario ni botones de ticket (tests: `PoolView.test.ts`, «un administrador (no participante) ve la parrilla sin formulario…» y «ADR-015: el administrador de una quiniela con tickets…»).
- Ningún menú ni enlace de la app principal ofrece operaciones globales a un `admin` (`BottomNav.test.ts`, `OrganizerDashboardView.test.ts`, `ProfileView.test.ts`).

## 3. Acciones relevantes

| Acción | user | admin | Autoridad |
| --- | --- | --- | --- |
| Registrarse / iniciar sesión / editar perfil | sí | sí | Supabase Auth; `profiles` RLS |
| Unirse a una quiniela por código | sí | sí, excepto la que administra | `join_pool` |
| Pronosticar / emitir tickets | sí (participante aprobado, antes del lock) | solo en otras quinielas | `save_prediction`, `create_ticket`…, lock en DB (ADR-011) |
| Ver pronósticos ajenos | solo tras el lock | solo tras el lock y si es participante | `can_read_prediction` |
| Solicitar «Crear mi propia quiniela» | sí (CTA en Perfil) | no se muestra (ya administra) | `request_pool_creation`, `my_pool_creation_request`, `cancel_pool_creation_request` (ADR-017, propuesto): idempotente, solo `p_note`; la UI nunca envía tenant ni rol |
| Aprobar/rechazar la solicitud | no | no | `review_pool_creation_request` solo `service_role` (consola de operador futura); no existe en el frontend |
| Gestionar quinielas, parrilla, resultados, participantes, pagos manuales, branding | no | sí, solo de su organización | `is_tenant_admin` en RLS/RPC |
| Ver «Mis finanzas» | no | sí, solo sus organizaciones (conteos de estado manual) | RLS por tenant; sin importes ni cobro automático |
| Operaciones de plataforma (Superadmin) | no | no | fuera de la app principal (ADR-018) |

## 4. Límites conocidos

- La política `participants_select_member` permite a cualquier **miembro** del tenant leer las filas de `participants` (incluido `payment_status`) de su tenant. «Mis finanzas» solo es visible para admins, pero la restricción real a nivel de lectura de pagos queda como seguimiento de Data/RLS (fuera de la zona de Frontend).
- La solicitud de creación de quiniela depende de la migración propuesta (ADR-017), aún sin aplicar a QA: la UI degrada a «Función aún no disponible en este entorno».
- Reportes del organizador: no disponible en el MVP (tile deshabilitado).
- Validación en dispositivo (UAT móvil): PENDING; ver `docs/testing/MOBILE-FIRST-ACCEPTANCE.md`.
