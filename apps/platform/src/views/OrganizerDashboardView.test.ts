import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import OrganizerDashboardView from './OrganizerDashboardView.vue'

const h = vi.hoisted(() => ({ admin: {} as Record<string, unknown>, auth: {} as Record<string, unknown>, useAdminOptions: [] as unknown[] }))
vi.mock('../composables/useAuth', () => ({ useAuth: () => ({ state: h.auth }) }))
vi.mock('../composables/useAdmin', () => ({ useAdmin: (options?: unknown) => { h.useAdminOptions.push(options); return h.admin } }))

function setupAdmin(overrides: Record<string, unknown> = {}) {
  h.auth = reactive({ profile: { id: 'me', display_name: 'Ana' }, user: { id: 'me' } })
  h.admin = {
    tenants: ref([{ tenant_id: 'aaaaaaaa-1', role: 'owner', plan_code: 'free' }]), pools: ref([{ id: 'p1' }]), selectedTenantId: ref('aaaaaaaa-1'),
    loading: ref(false), error: ref(''), load: vi.fn().mockResolvedValue(undefined), loadPools: vi.fn().mockResolvedValue(undefined), reset: vi.fn(), dispose: vi.fn(), ...overrides,
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

describe('OrganizerDashboardView - ciclo de vida e identidad (FE-03, FE-05)', () => {
  it('FE-03: al desmontar llama a dispose() (detiene cualquier polling del composable)', async () => {
    const { wrapper } = await mountDashboard()
    const dispose = (h.admin as { dispose: ReturnType<typeof vi.fn> }).dispose
    expect(dispose).not.toHaveBeenCalled()
    wrapper.unmount()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('FE-05: si otra pestaña inicia sesión con otro usuario descarta lo cargado y recarga con el nuevo id', async () => {
    await mountDashboard()
    const admin = h.admin as { load: ReturnType<typeof vi.fn>; reset: ReturnType<typeof vi.fn> }
    expect(admin.load).toHaveBeenCalledTimes(1)
    expect(admin.load).toHaveBeenLastCalledWith('me')
    ;(h.auth as { user: { id: string } | null }).user = { id: 'otro' }
    await flushPromises()
    expect(admin.reset).toHaveBeenCalledTimes(1)
    expect(admin.load).toHaveBeenCalledTimes(2)
    expect(admin.load).toHaveBeenLastCalledWith('otro')
  })

  it('FE-05: si se cierra la sesión suelta los datos y vuelve a Inicio', async () => {
    const { router } = await mountDashboard()
    ;(h.auth as { user: unknown }).user = null
    await flushPromises()
    expect((h.admin as { reset: ReturnType<typeof vi.fn> }).reset).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('FE-03: el panel no pide branding (no necesita colores ni imágenes ni polling)', async () => {
    await mountDashboard()
    expect(h.useAdminOptions).toContainEqual({ branding: false })
  })
})
