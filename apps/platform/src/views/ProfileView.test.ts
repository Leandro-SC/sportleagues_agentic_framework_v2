import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import ProfileView from './ProfileView.vue'

const h = vi.hoisted(() => ({ access: {} as Record<string, unknown> }))
vi.mock('../composables/useAuth', () => ({ useAuth: () => ({ state: { profile: { id: 'me', display_name: 'Ana Pérez' }, user: { id: 'me', email: 'ana@example.com' } }, signOut: async () => null }) }))
vi.mock('../composables/useMyPools', () => ({ useMyPools: () => ({ pools: ref([]), loading: ref(false), error: ref(''), load: async () => {} }) }))
vi.mock('../composables/useFollowedTeams', () => ({ useFollowedTeams: () => ({ ids: ref([]) }) }))
vi.mock('../composables/useSportsCatalog', () => ({
  useSportsCatalog: () => ({ catalog: ref({ activity: [], followedTeamIds: [], profileStats: null }), loading: ref(false), failed: ref(false), retry: () => {}, now: ref(new Date()), team: () => undefined, competition: () => undefined }),
}))
vi.mock('../composables/useTenantAdminAccess', () => ({ useTenantAdminAccess: () => h.access }))

function access(overrides: { has?: boolean; loading?: boolean; error?: string } = {}) {
  h.access = { hasTenantAdminAccess: ref(overrides.has ?? false), loading: ref(overrides.loading ?? false), error: ref(overrides.error ?? ''), checkAccess: vi.fn().mockResolvedValue(overrides.has ?? false) }
}

async function mountProfile() {
  const Blank = { template: '<div />' }
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/perfil', name: 'profile', component: ProfileView },
    ...['home', 'points', 'my-tickets', 'admin', 'organizer-dashboard', 'matches', 'leagues'].map((name) => ({ path: name === 'home' ? '/' : `/${name}`, name, component: Blank })),
  ] })
  await router.push('/perfil'); await router.isReady()
  const wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [router], stubs: { PoolCreationRequestCard: { template: '<section data-test="request-card">Crear mi propia quiniela</section>' } } } })
  await flushPromises()
  return wrapper
}

beforeEach(() => access())

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
