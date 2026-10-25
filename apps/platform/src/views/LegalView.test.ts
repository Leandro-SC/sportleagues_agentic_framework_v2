import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import LegalView from './LegalView.vue'
import { legalContactEmail, PRIVACY, TERMS } from '../lib/legal-content'
import { protectedRouteRedirect } from '../lib/navigation-guards'

async function mountDoc(doc: 'privacy' | 'terms') {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/privacidad', name: 'privacy', component: LegalView, props: { doc: 'privacy' } },
    { path: '/terminos', name: 'terms', component: LegalView, props: { doc: 'terms' } },
    { path: '/', name: 'home', component: { template: '<div />' } },
  ] })
  await router.push(doc === 'privacy' ? '/privacidad' : '/terminos'); await router.isReady()
  const wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('páginas legales', () => {
  it('son públicas: se leen sin sesión (consentimiento de Google y Play Store)', () => {
    expect(protectedRouteRedirect('privacy', false, false)).toBeNull()
    expect(protectedRouteRedirect('terms', false, false)).toBeNull()
  })

  it('la política describe datos, proveedores, retención, baja y que no se procesan pagos', async () => {
    const text = (await mountDoc('privacy')).text()
    for (const fragment of ['Supabase', 'Vercel', 'Google', '180 días', 'Eliminar mi cuenta', 'no cobra ni procesa pagos', 'no se suben']) expect(text).toContain(fragment)
    expect(PRIVACY.sections.length).toBeGreaterThan(5)
  })

  it('los términos aclaran que no es una casa de apuestas', async () => {
    const text = (await mountDoc('terms')).text()
    expect(text).toContain('No es una casa de apuestas')
    expect(TERMS.sections.some((s) => s.title === 'Reglas de las quinielas')).toBe(true)
  })

  it('el correo de contacto solo se muestra si es válido', () => {
    expect(legalContactEmail('privacidad@ejemplo.com')).toBe('privacidad@ejemplo.com')
    expect(legalContactEmail('no-es-correo')).toBeNull()
    expect(legalContactEmail(undefined)).toBeNull()
  })
})
