const PROFILE_REQUIRED = new Set(['pool', 'profile'])

export function protectedRouteRedirect(routeName: string, authenticated: boolean, hasProfile: boolean): 'home' | 'onboarding' | null {
  if (!['onboarding', ...PROFILE_REQUIRED].includes(routeName)) return null
  if (!authenticated) return 'home'
  if (PROFILE_REQUIRED.has(routeName) && !hasProfile) return 'onboarding'
  return null
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
