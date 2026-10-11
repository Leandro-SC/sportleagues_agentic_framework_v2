import { beforeEach, describe, expect, it, vi } from 'vitest'

// Compatibilidad del nuevo login (contraseña/Google) con los guards de /admin y /superadmin:
// los guards dependen solo de la sesión y de las comprobaciones server-side, no del método de login.
const session = vi.hoisted(() => ({ authenticated: false, platformAdmin: false, tenantAdmin: false, loading: false }))

vi.mock('./composables/useAuth', () => ({
  useAuth: () => ({
    state: { get loading() { return session.loading }, user: session.authenticated ? { id: 'u1' } : null, profile: session.authenticated ? { id: 'u1' } : null },
    isAuthenticated: { get value() { return session.authenticated } },
    restore: async () => {},
  }),
}))
vi.mock('./composables/useSuperadmin', () => ({ useSuperadmin: () => ({ checkAccess: async () => session.platformAdmin }) }))
vi.mock('./composables/useTenantAdminAccess', () => ({ useTenantAdminAccess: () => ({ checkAccess: async () => session.tenantAdmin }) }))

import { router } from './router'

async function visit(path: string): Promise<string> {
  await router.replace('/auth/callback') // posición neutra
  await router.push(path)
  return String(router.currentRoute.value.name)
}

beforeEach(() => { Object.assign(session, { authenticated: false, platformAdmin: false, tenantAdmin: false, loading: false }) })

describe('route guards with the password / Google session', () => {
  it('blocks /admin and /superadmin without a session', async () => {
    expect(await visit('/admin')).toBe('home')
    expect(await visit('/superadmin')).toBe('home')
  })

  it('a signed-in user with no privileges reaches neither area', async () => {
    session.authenticated = true
    expect(await visit('/admin')).toBe('home')
    expect(await visit('/superadmin')).toBe('home')
  })

  it('/admin depends only on tenant admin access and /superadmin only on platform admin access', async () => {
    session.authenticated = true; session.tenantAdmin = true
    expect(await visit('/admin')).toBe('admin')
    expect(await visit('/superadmin')).toBe('home')
    session.tenantAdmin = false; session.platformAdmin = true
    expect(await visit('/superadmin')).toBe('superadmin')
    expect(await visit('/admin')).toBe('home')
  })

  it('the password reset screen needs a session and never grants admin access', async () => {
    expect(await visit('/auth/reset')).toBe('home')
    session.authenticated = true
    expect(await visit('/auth/reset')).toBe('reset-password')
    expect(await visit('/admin')).toBe('home')
  })
})
