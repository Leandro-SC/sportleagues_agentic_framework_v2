import { describe, expect, it } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { isSuperadminUiEnabled } from './lib/feature-flags'
import { protectedRouteRedirect } from './lib/navigation-guards'
import { ADMIN_ROUTE_NAMES } from './lib/role-navigation'
import { buildRoutes, createAppRouter, router } from './router'
import routerSource from './router.ts?raw'

// Rutas públicas o con guard propio (asíncrono) en router.ts; todo lo demás es una pantalla de la
// app que exige sesión + perfil. Si alguien añade una ruta nueva y olvida protegerla, este test falla.
// `not-found` es el comodín que redirige a home; `superadmin` solo existe con la bandera ADR-018.
const PUBLIC_OR_SELF_GUARDED = new Set(['home', 'auth-callback', 'join', 'onboarding', 'reset-password', 'admin', 'admin-income', 'admin-fixture', 'organizer-dashboard', 'superadmin', 'not-found'])

describe('route table', () => {
  const names = router.getRoutes().map((route) => String(route.name))

  it('registers the four bottom-navigation sections and the redesign detail screens', () => {
    for (const name of ['home', 'matches', 'leagues', 'points', 'profile', 'league-join', 'league', 'team', 'pool']) {
      expect(names, name).toContain(name)
    }
  })

  it('protects every authenticated app screen with the session + profile guard', () => {
    const appScreens = names.filter((name) => !PUBLIC_OR_SELF_GUARDED.has(name))
    expect(appScreens.length).toBeGreaterThanOrEqual(7)
    for (const name of appScreens) {
      expect(protectedRouteRedirect(name, false, false), `${name} sin sesión`).toBe('home')
      expect(protectedRouteRedirect(name, true, false), `${name} sin perfil`).toBe('onboarding')
      expect(protectedRouteRedirect(name, true, true), `${name} con acceso`).toBeNull()
    }
  })

  it('resolves deep links to the right screen', () => {
    expect(router.resolve('/ligas/liga-mx?tab=tabla').name).toBe('league')
    expect(router.resolve('/equipos/america').params.teamId).toBe('america')
    expect(router.resolve('/ligas/unirme').name).toBe('league-join')
    expect(router.resolve('/j/AB12CD').name).toBe('join')
    expect(router.resolve('/mis-puntos').name).toBe('points')
    expect(router.resolve('/mis-tickets').name).toBe('my-tickets')
    expect(router.resolve('/admin/ingresos').name).toBe('admin-income')
    expect(router.resolve('/admin/parrilla').name).toBe('admin-fixture')
    expect(router.resolve('/organizador').name).toBe('organizer-dashboard')
  })

  it('every route that the admin bottom navigation owns is registered', () => {
    for (const name of ADMIN_ROUTE_NAMES) expect(names, name).toContain(name)
  })
})

describe('Superadmin UI out of the main app (ADR-018)', () => {
  it('the flag is off unless the build sets it to exactly "true"', () => {
    expect(isSuperadminUiEnabled({})).toBe(false)
    expect(isSuperadminUiEnabled({ VITE_ENABLE_SUPERADMIN_UI: '' })).toBe(false)
    expect(isSuperadminUiEnabled({ VITE_ENABLE_SUPERADMIN_UI: 'false' })).toBe(false)
    expect(isSuperadminUiEnabled({ VITE_ENABLE_SUPERADMIN_UI: '1' })).toBe(false)
    expect(isSuperadminUiEnabled({ VITE_ENABLE_SUPERADMIN_UI: 'true' })).toBe(true)
  })

  it('the test/default environment does not enable it', () => {
    expect(isSuperadminUiEnabled()).toBe(false)
  })

  it('does not register /superadmin when the flag is off, and the wildcard sends the visitor home', () => {
    const routes = buildRoutes({ superadminUi: false })
    expect(routes.map((route) => String(route.name))).not.toContain('superadmin')
    expect(routes.some((route) => route.path === '/superadmin')).toBe(false)
    const off = createAppRouter({ superadminUi: false, history: createMemoryHistory() })
    expect(off.resolve('/superadmin').name).toBe('not-found')
    expect(off.resolve('/superadmin/cualquier/cosa').name).toBe('not-found')
    expect(off.resolve('/no-existe').name).toBe('not-found')
    expect(routes.at(-1)).toMatchObject({ name: 'not-found', redirect: { name: 'home' } })
  })

  it('registers /superadmin only when the flag is on', () => {
    const routes = buildRoutes({ superadminUi: true, superadminView: async () => ({ template: '<div />' }) })
    expect(routes.map((route) => String(route.name))).toContain('superadmin')
    expect(createAppRouter({ superadminUi: true, history: createMemoryHistory(), superadminView: async () => ({ template: '<div />' }) }).resolve('/superadmin').name).toBe('superadmin')
  })

  it('the main-app router never exposes the superadmin route', () => {
    expect(router.resolve('/superadmin').name).toBe('not-found')
  })

  it('router.ts imports the Superadmin view only dynamically, behind the build flag, and never the shell', () => {
    const source = routerSource
    expect(source).not.toMatch(/^import\s+.*Superadmin(View|Shell)/m)
    expect(source).not.toContain('SuperadminShell')
    const dynamic = source.match(/import\('\.\/views\/SuperadminView\.vue'\)/g) ?? []
    expect(dynamic).toHaveLength(1)
    expect(source).toMatch(/import\.meta\.env\.VITE_ENABLE_SUPERADMIN_UI === 'true'\s*\n?\s*\? import\('\.\/views\/SuperadminView\.vue'\)/)
  })
})
