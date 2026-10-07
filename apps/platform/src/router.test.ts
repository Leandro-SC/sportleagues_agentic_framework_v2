import { describe, expect, it } from 'vitest'
import { protectedRouteRedirect } from './lib/navigation-guards'
import { router } from './router'

// Rutas públicas o con guard propio (asíncrono) en router.ts; todo lo demás es una pantalla de la
// app que exige sesión + perfil. Si alguien añade una ruta nueva y olvida protegerla, este test falla.
const PUBLIC_OR_SELF_GUARDED = new Set(['home', 'auth-callback', 'join', 'onboarding', 'admin', 'superadmin'])

describe('route table', () => {
  const names = router.getRoutes().map((route) => String(route.name))

  it('registers the four bottom-navigation sections and the redesign detail screens', () => {
    for (const name of ['home', 'matches', 'leagues', 'profile', 'league-join', 'league', 'team', 'pool']) {
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
  })
})
