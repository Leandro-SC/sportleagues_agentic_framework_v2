import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'

// Compatibilidad del nuevo login (contraseña/Google) con los guards de /admin y /superadmin:
// los guards dependen solo de la sesión y de las comprobaciones server-side, no del método de login.
// ADR-018: `/superadmin` solo existe en un build con la bandera encendida; en la app principal
// (bandera apagada) cae en el comodín hacia home sin consultar is_platform_admin().
const session = vi.hoisted(() => ({ authenticated: false, platformAdmin: false, tenantAdmin: false, loading: false, platformChecks: 0 }))

vi.mock('./composables/useAuth', () => ({
  useAuth: () => ({
    state: { get loading() { return session.loading }, user: session.authenticated ? { id: 'u1' } : null, profile: session.authenticated ? { id: 'u1' } : null },
    isAuthenticated: { get value() { return session.authenticated } },
    restore: async () => {},
  }),
}))
vi.mock('./composables/useSuperadmin', () => ({ useSuperadmin: () => ({ checkAccess: async () => { session.platformChecks += 1; return session.platformAdmin } }) }))
vi.mock('./composables/useTenantAdminAccess', () => ({ useTenantAdminAccess: () => ({ checkAccess: async () => session.tenantAdmin }) }))

import { createAppRouter, router as mainRouter } from './router'

type AppRouter = ReturnType<typeof createAppRouter>

async function visit(target: AppRouter, path: string): Promise<string> {
  await target.replace('/auth/callback') // posición neutra
  await target.push(path)
  return String(target.currentRoute.value.name)
}

beforeEach(() => { Object.assign(session, { authenticated: false, platformAdmin: false, tenantAdmin: false, loading: false, platformChecks: 0 }) })

describe('route guards with the password / Google session (Superadmin UI enabled by build flag)', () => {
  const flagged = () => createAppRouter({ superadminUi: true, history: createMemoryHistory(), superadminView: async () => ({ template: '<div />' }) })

  it('blocks /admin and /superadmin without a session', async () => {
    const target = flagged()
    expect(await visit(target, '/admin')).toBe('home')
    expect(await visit(target, '/superadmin')).toBe('home')
  })

  it('a signed-in user with no privileges reaches neither area', async () => {
    session.authenticated = true
    const target = flagged()
    expect(await visit(target, '/admin')).toBe('home')
    expect(await visit(target, '/superadmin')).toBe('home')
  })

  it('/admin depends only on tenant admin access and /superadmin only on platform admin access', async () => {
    session.authenticated = true; session.tenantAdmin = true
    const target = flagged()
    expect(await visit(target, '/admin')).toBe('admin')
    expect(await visit(target, '/superadmin')).toBe('home')
    session.tenantAdmin = false; session.platformAdmin = true
    expect(await visit(target, '/superadmin')).toBe('superadmin')
    expect(await visit(target, '/admin')).toBe('home')
  })
})

describe('route guards in the main app (Superadmin UI disabled, the default and only public build)', () => {
  it('the exported app router has no /superadmin route', () => {
    expect(mainRouter.getRoutes().map((route) => String(route.name))).not.toContain('superadmin')
    expect(mainRouter.resolve('/superadmin').name).toBe('not-found')
  })

  it('/superadmin resolves to home and never calls is_platform_admin(), even for a platform admin', async () => {
    session.authenticated = true; session.platformAdmin = true
    expect(await visit(mainRouter, '/superadmin')).toBe('home')
    expect(await visit(mainRouter, '/superadmin/tenants')).toBe('home')
    expect(session.platformChecks).toBe(0)
  })

  it('a platform admin without tenant membership still gets neither /admin nor /superadmin (ADR-008 section 9)', async () => {
    session.authenticated = true; session.platformAdmin = true; session.tenantAdmin = false
    expect(await visit(mainRouter, '/admin')).toBe('home')
    expect(await visit(mainRouter, '/superadmin')).toBe('home')
    expect(session.platformChecks).toBe(0)
  })

  it('/admin keeps depending only on tenant admin access', async () => {
    expect(await visit(mainRouter, '/admin')).toBe('home')
    session.authenticated = true
    expect(await visit(mainRouter, '/admin')).toBe('home')
    session.tenantAdmin = true
    expect(await visit(mainRouter, '/admin')).toBe('admin')
    expect(await visit(mainRouter, '/organizador')).toBe('organizer-dashboard')
    expect(await visit(mainRouter, '/admin/ingresos')).toBe('admin-income')
  })

  it('the password reset screen needs a session and never grants admin access', async () => {
    expect(await visit(mainRouter, '/auth/reset')).toBe('home')
    session.authenticated = true
    expect(await visit(mainRouter, '/auth/reset')).toBe('reset-password')
    expect(await visit(mainRouter, '/admin')).toBe('home')
  })
})

describe('the real router fails closed for a route nobody classified (FE-04)', () => {
  it('a newly added, unclassified route requires a session and a profile instead of passing through', async () => {
    const target = createAppRouter({ superadminUi: false, history: createMemoryHistory() })
    target.addRoute({ path: '/ruta-nueva', name: 'ruta-nueva', component: { template: '<div />' } })
    expect(await visit(target, '/ruta-nueva')).toBe('home') // sin sesión
    session.authenticated = true
    expect(await visit(target, '/ruta-nueva')).toBe('ruta-nueva') // sesión + perfil
  })

  it('public routes stay reachable without a session', async () => {
    const target = createAppRouter({ superadminUi: false, history: createMemoryHistory() })
    expect(await visit(target, '/j/AB12CD')).toBe('join')
    expect(await visit(target, '/')).toBe('home')
  })
})
