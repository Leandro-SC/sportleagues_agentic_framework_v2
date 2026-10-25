import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import ProfileView from './ProfileView.vue'

const h = vi.hoisted(() => ({ access: {} as Record<string, unknown>, signOut: undefined as unknown as (() => Promise<string | null>) & { mock?: unknown } }))
vi.mock('../composables/useAuth', () => ({ useAuth: () => ({ state: { profile: { id: 'me', display_name: 'Ana Pérez' }, user: { id: 'me', email: 'ana@example.com' } }, signOut: () => h.signOut() }) }))
vi.mock('../composables/useMyPools', () => ({ useMyPools: () => ({ pools: ref([]), loading: ref(false), error: ref(''), load: async () => {} }) }))
vi.mock('../composables/useFollowedTeams', () => ({ useFollowedTeams: () => ({ ids: ref([]) }) }))
vi.mock('../composables/useSportsCatalog', () => ({
  useSportsCatalog: () => ({ catalog: ref({ activity: [], followedTeamIds: [], profileStats: null }), loading: ref(false), failed: ref(false), retry: () => {}, now: ref(new Date()), team: () => undefined, competition: () => undefined }),
}))
vi.mock('../composables/useTenantAdminAccess', () => ({ useTenantAdminAccess: () => h.access }))

function access(overrides: { has?: boolean; loading?: boolean; error?: string } = {}) {
  h.access = { hasTenantAdminAccess: ref(overrides.has ?? false), loading: ref(overrides.loading ?? false), error: ref(overrides.error ?? ''), checkAccess: vi.fn().mockResolvedValue(overrides.has ?? false) }
}

async function mountProfileWithRouter() {
  const Blank = { template: '<div />' }
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/perfil', name: 'profile', component: ProfileView },
    ...['home', 'points', 'my-tickets', 'admin', 'organizer-dashboard', 'matches', 'leagues'].map((name) => ({ path: name === 'home' ? '/' : `/${name}`, name, component: Blank })),
  ] })
  await router.push('/perfil'); await router.isReady()
  const wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [router], stubs: { PoolCreationRequestCard: { template: '<section data-test="request-card">Crear mi propia quiniela</section>' } } } })
  await flushPromises()
  return { wrapper, router }
}
async function mountProfile() { return (await mountProfileWithRouter()).wrapper }

beforeEach(() => { access(); h.signOut = vi.fn(async () => null) })

describe('ProfileView «Crear mi propia quiniela»', () => {
  it('shows the request CTA to a user without admin access', async () => {
    const wrapper = await mountProfile()
    expect(wrapper.find('[data-test="request-card"]').exists()).toBe(true)
  })

  it('hides it for an authenticated user who administers an organization', async () => {
    access({ has: true })
    const wrapper = await mountProfile()
    expect(wrapper.find('[data-test="request-card"]').exists()).toBe(false)
  })

  it('hides it while the admin check is running or if it failed (cannot confirm the user is not an admin)', async () => {
    access({ loading: true })
    expect((await mountProfile()).find('[data-test="request-card"]').exists()).toBe(false)
    access({ error: 'No fue posible verificar el acceso administrativo.' })
    expect((await mountProfile()).find('[data-test="request-card"]').exists()).toBe(false)
  })

  it('the account settings offer Modo organizador only with admin access, never a global/platform entry', async () => {
    const plain = await mountProfile()
    await plain.get('button[aria-label="Ajustes de la cuenta"]').trigger('click')
    expect(document.body.textContent).not.toContain('Modo organizador')
    expect(document.body.textContent).not.toMatch(/superadmin|plataforma/i)
    plain.unmount()
    access({ has: true })
    const admin = await mountProfile()
    await admin.get('button[aria-label="Ajustes de la cuenta"]').trigger('click')
    expect(document.body.textContent).toContain('Modo organizador')
    expect(document.body.textContent).not.toMatch(/superadmin|plataforma/i)
  })
})

describe('ProfileView cerrar sesión (FE-06)', () => {
  it('sale a Inicio aunque el servidor no confirme el cierre, sin mostrar texto crudo del error', async () => {
    h.signOut = vi.fn(async () => 'Cerramos tu sesión en este dispositivo, pero no pudimos confirmarlo con el servidor.')
    document.body.innerHTML = '' // las hojas (teleport) de pruebas anteriores siguen en el body
    const { wrapper, router } = await mountProfileWithRouter()
    await wrapper.get('[aria-label="Ajustes de la cuenta"]').trigger('click')
    await flushPromises()
    ;[...document.body.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Cerrar sesión')!.click()
    await flushPromises()
    expect(h.signOut).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('home'))
    expect(wrapper.text()).not.toContain('Failed to fetch')
  })
})
