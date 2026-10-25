import { ADMIN_ROUTE_NAMES } from './role-navigation'

// Clasificación de rutas, FALLA CERRADO (FE-04): una ruta nueva que no figure en ninguna lista exige sesión y perfil.
// Así olvidarla en esta tabla nunca deja una pantalla sin guard; el test del router obliga además a clasificarla.
//
// Públicas (UX): no exigen sesión. `join` pide sesión dentro de la vista y conserva el código; `not-found` redirige a home;
// `privacy` y `terms` son textos legales que deben poder leerse antes de registrarse (Google OAuth y Play Store).
export const PUBLIC_ROUTE_NAMES: ReadonlySet<string> = new Set(['home', 'auth-callback', 'join', 'not-found', 'privacy', 'terms'])
// Con guard asíncrono propio en el router (membresía admin / is_platform_admin): este guard no las decide.
export const SELF_GUARDED_ROUTE_NAMES: ReadonlySet<string> = new Set([...ADMIN_ROUTE_NAMES, 'superadmin'])
// Solo sesión (sin perfil): el perfil se crea aquí o la sesión es la de recuperación de contraseña.
export const SESSION_ONLY_ROUTE_NAMES: ReadonlySet<string> = new Set(['onboarding', 'reset-password'])
// Sesión + perfil.
export const PROFILE_REQUIRED_ROUTE_NAMES: ReadonlySet<string> = new Set(['pool', 'profile', 'points', 'my-tickets', 'matches', 'leagues', 'league-join', 'league', 'team'])

export function protectedRouteRedirect(routeName: string, authenticated: boolean, hasProfile: boolean): 'home' | 'onboarding' | null {
  if (PUBLIC_ROUTE_NAMES.has(routeName) || SELF_GUARDED_ROUTE_NAMES.has(routeName)) return null
  if (!authenticated) return 'home'
  if (SESSION_ONLY_ROUTE_NAMES.has(routeName)) return null
  // Cualquier otra ruta (clasificada como PROFILE_REQUIRED o desconocida) exige perfil.
  return hasProfile ? null : 'onboarding'
}

// Deciding whether `/superadmin` is reachable never looks at tenant role, tenant membership or
// email: `isPlatformAdmin` must come from the server-authoritative `is_platform_admin()` RPC
// (see useSuperadmin). This function only encodes the redirect policy so it stays testable
// without a network call; it is not itself a security boundary — RLS/RPC are.
export function platformAdminRedirect(authenticated: boolean, isPlatformAdmin: boolean): 'home' | null {
  if (!authenticated) return 'home'
  if (!isPlatformAdmin) return 'home'
  return null
}

// Mirrors platformAdminRedirect for `/admin`, deliberately with no third parameter: whether a
// user is a platform admin is irrelevant here on purpose (ADR-008 section 9) — a platform admin
// with no tenant membership does not get `/admin`, and this function has no way to even consider
// that flag. `hasTenantAdminAccess` must come from useTenantAdminAccess (tenant_memberships +
// canManageTenant), never from email or client-editable state. Same as every guard here: UX only,
// RLS/RPC remain the real authorization boundary.
export function tenantAdminRedirect(authenticated: boolean, hasTenantAdminAccess: boolean): 'home' | null {
  if (!authenticated) return 'home'
  if (!hasTenantAdminAccess) return 'home'
  return null
}
