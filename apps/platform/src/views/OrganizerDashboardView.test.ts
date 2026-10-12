import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import OrganizerDashboardView from './OrganizerDashboardView.vue'

const h = vi.hoisted(() => ({ admin: {} as Record<string, unknown> }))
vi.mock('../composables/useAuth', () => ({ useAuth: () => ({ state: { profile: { id: 'me', display_name: 'Ana' }, user: { id: 'me' } } }) }))
vi.mock('../composables/useAdmin', () => ({ useAdmin: () => h.admin }))

function setupAdmin(overrides: Record<string, unknown> = {}) {
  h.admin = {
    tenants: ref([{ tenant_id: 'aaaaaaaa-1', role: 'owner', plan_code: 'free' }]), pools: ref([{ id: 'p1' }]), selectedTenantId: ref('aaaaaaaa-1'),
    loading: ref(false), error: ref(''), load: vi.fn().mockResolvedValue(undefined), loadPools: vi.fn().mockResolvedValue(undefined), ...overrides,
  }
}

async function mountDashboard() {
  const Blank = { template: '<div />' }
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/organizador', name: 'organizer-dashboard', component: OrganizerDashboardView },
    ...['home', 'admin', 'admin-fixture', 'admin-income', 'profile'].map((name) => ({ path: name === 'home' ? '/' : `/${name}`, name, component: Blank })),
  ] })
  await router.push('/organizador'); await router.isReady()
  const wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

beforeEach(() => setupAdmin())

describe('OrganizerDashboardView', () => {
  it('every tile goes to the screen that really implements it', async () => {
    const { wrapper, router } = await mountDashboard()
    const expected: Record<string, string> = { 'tile-pools': 'admin', 'tile-participants': 'admin', 'tile-fixture': 'admin-fixture', 'tile-finance': 'admin-income' }
    for (const [test, name] of Object.entries(expected)) {
      await router.push('/organizador')
      await wrapper.get(`[data-test="${test}"]`).trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.name, test).toBe(name)
    }
  })

  it('marks Reportes as unavailable and disabled instead of promising it', async () => {
    const { wrapper } = await mountDashboard()
    const reports = wrapper.get('[data-test="tile-reports"]')
    expect(reports.attributes('disabled')).toBeDefined()
    expect(reports.text()).toContain('No disponible')
    expect(wrapper.text()).not.toMatch(/en preparación|se activarán|Próximamente/)
  })

  it('offers no entry to global/platform operations and keeps the organizer navigation with its exit', async () => {
    const { wrapper } = await mountDashboard()
    expect(wrapper.text()).not.toMatch(/superadmin|plataforma|global/i)
    expect(wrapper.find('[data-test="exit-admin-mode"]').exists()).toBe(true)
    expect(wrapper.get('nav [aria-current="page"]').text()).toBe('Panel')
  })

  it('shows loading, error with retry, and empty states', async () => {
    setupAdmin({ loading: ref(true) })
    expect((await mountDashboard()).wrapper.get('[role="status"]').text()).toContain('Verificando')
    const load = vi.fn().mockResolvedValue(undefined)
    setupAdmin({ error: ref('No fue posible cargar la administración.'), load })
    const failed = (await mountDashboard()).wrapper
    expect(failed.get('[role="alert"]').text()).toContain('No fue posible')
    await failed.findAll('button').find((b) => b.text() === 'Reintentar')!.trigger('click')
    expect(load).toHaveBeenCalledTimes(2)
    setupAdmin({ tenants: ref([]) })
    const empty = (await mountDashboard()).wrapper
    expect(empty.text()).toContain('Sin organizaciones administrables')
    expect(empty.text()).toContain('Mi perfil')
  })
})
