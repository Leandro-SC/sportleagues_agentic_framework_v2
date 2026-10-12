// Una sola fuente para saber qué rutas pertenecen a la experiencia de organizador (`admin`).
// Hay solo dos experiencias visibles: `user` (participante) y `admin` (organizador). El modo
// organizador es una vista distinta de la MISMA cuenta; no concede permisos: el guard del router
// (UX) y RLS/RPC (autoridad) deciden el acceso real.
export const ADMIN_ROUTE_NAMES: ReadonlySet<string> = new Set(['organizer-dashboard', 'admin', 'admin-fixture', 'admin-income'])

export type NavMode = 'user' | 'admin'

export function isAdminRouteName(name: unknown): boolean {
  return typeof name === 'string' && ADMIN_ROUTE_NAMES.has(name)
}

export function navModeForRoute(name: unknown): NavMode {
  return isAdminRouteName(name) ? 'admin' : 'user'
}
