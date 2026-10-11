import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { resetFollowedTeamsForTests } from '../composables/useFollowedTeams'
import { resetSportsCatalogForTests } from '../composables/useSportsCatalog'
import JoinLeagueView from './JoinLeagueView.vue'
import LeagueView from './LeagueView.vue'
import LeaguesView from './LeaguesView.vue'
import MatchesView from './MatchesView.vue'
import ProfileView from './ProfileView.vue'
import TeamView from './TeamView.vue'

const hasAdminAccess = vi.hoisted(() => ({ value: false }))

vi.mock('../composables/useAuth', () => ({
  useAuth: () => ({
    state: { profile: { id: 'u1', display_name: 'Ana Pérez' }, user: { id: 'u1', email: 'ana@example.com' } },
    isAuthenticated: { value: true },
    signOut: async () => null,
  }),
}))

vi.mock('../composables/useMyPools', () => ({
  useMyPools: () => ({ pools: ref([]), loading: ref(false), error: ref(''), load: async () => {} }),
}))

vi.mock('../composables/useTenantAdminAccess', () => ({
  useTenantAdminAccess: () => ({
    hasTenantAdminAccess: ref(hasAdminAccess.value),
    loading: ref(false),
    error: ref(''),
    checkAccess: async () => hasAdminAccess.value,
  }),
}))

const Blank = { template: '<div />' }
const routeNames = ['home', 'matches', 'leagues', 'profile', 'league-join', 'pool', 'admin', 'join', 'onboarding']

async function mountAt(path: string, component: object, pattern: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      ...routeNames.filter((name) => `/${name}` !== pattern).map((name) => ({ path: `/${name}`, name, component: Blank })),
      ...[{ path: '/ligas/:leagueId', name: 'league' }, { path: '/equipos/:teamId', name: 'team' }]
        .filter((stub) => stub.path !== pattern)
        .map((stub) => ({ ...stub, component: Blank })),
      { path: pattern, name: 'under-test', component },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [router] }, attachTo: document.body })
  return { wrapper, router }
}

function useEnv(preview: 'true' | 'false'): void {
  vi.stubEnv('VITE_PREVIEW_DATA', preview)
  resetSportsCatalogForTests()
  resetFollowedTeamsForTests()
  localStorage.clear()
  hasAdminAccess.value = false
}

afterEach(() => {
  vi.unstubAllEnvs()
  resetSportsCatalogForTests()
  document.body.innerHTML = ''
})

describe('screens with preview data disabled (QA/production)', () => {
  beforeEach(() => useEnv('false'))

  it('Matches shows an honest empty state, no example matches and no preview badge', async () => {
    const { wrapper } = await mountAt('/partidos', MatchesView, '/partidos')
    await flushPromises()
    expect(wrapper.text()).toContain('Aún no hay partidos cargados')
    expect(wrapper.text()).not.toContain('Vista previa')
    expect(wrapper.findAll('article')).toHaveLength(0)
  })

  it('League and Team report not found instead of inventing content', async () => {
    const league = await mountAt('/ligas/liga-mx', LeagueView, '/ligas/:leagueId')
    await flushPromises()
    expect(league.wrapper.text()).toContain('No encontramos esta liga')
    league.wrapper.unmount()

    const team = await mountAt('/equipos/america', TeamView, '/equipos/:teamId')
    await flushPromises()
    expect(team.wrapper.text()).toContain('No encontramos este equipo')
  })

  it('Join a league offers only the real invitation-code flow', async () => {
    const { wrapper } = await mountAt('/ligas/unirme', JoinLeagueView, '/ligas/unirme')
    await flushPromises()
    expect(wrapper.text()).toContain('código de invitación de 6 caracteres')
    expect(wrapper.text()).not.toContain('Ligas recomendadas')
    expect(wrapper.find('button[aria-label^="Unirse a"]').exists()).toBe(false)
  })

  it('Profile shows empty activity and placeholder stats instead of example numbers', async () => {
    const { wrapper } = await mountAt('/perfil', ProfileView, '/perfil')
    await flushPromises()
    expect(wrapper.text()).toContain('Sin actividad todavía')
    expect(wrapper.text()).not.toContain('Nivel Pro')
    expect(wrapper.findAll('dd').map((node) => node.text())).toEqual(['0', '–', '–'])
  })
})

describe('screens with preview data enabled (demo)', () => {
  beforeEach(() => useEnv('true'))

  it('shows a loading state first, never "not found", then the example content with a badge', async () => {
    const { wrapper } = await mountAt('/ligas/liga-mx', LeagueView, '/ligas/:leagueId')
    expect(wrapper.find('[role="status"][aria-label="Cargando"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('No encontramos esta liga')

    await vi.waitFor(() => expect(wrapper.text()).toContain('Tabla de posiciones'))
    expect(wrapper.text()).toContain('Vista previa')
    expect(wrapper.text()).toContain('Liga MX CL 2020')
  })

  it('Matches lists example matches marked as preview', async () => {
    const { wrapper } = await mountAt('/partidos', MatchesView, '/partidos')
    await vi.waitFor(() => expect(wrapper.findAll('article').length).toBeGreaterThan(0))
    expect(wrapper.text()).toContain('Vista previa')
  })

  it('Team follow toggles and persists locally', async () => {
    const { wrapper } = await mountAt('/equipos/america', TeamView, '/equipos/:teamId')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Seguir equipo'))
    await wrapper.get('button[aria-pressed]').trigger('click')
    expect(wrapper.get('button[aria-pressed]').text()).toContain('Siguiendo')
    expect(JSON.parse(localStorage.getItem('sportleagues.followed-teams')!)).toContain('america')
  })

  it('Team tabs expose tab semantics and the roster is explained as unavailable', async () => {
    const { wrapper } = await mountAt('/equipos/america?tab=plantilla', TeamView, '/equipos/:teamId')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Plantilla no disponible'))
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.attributes('aria-selected'))).toEqual(['false', 'true', 'false'])
  })
})

describe('permissions with simulated clients', () => {
  beforeEach(() => useEnv('false'))

  it('Create league sends a non-admin to an explanation, not to /admin', async () => {
    hasAdminAccess.value = false
    const { wrapper, router } = await mountAt('/ligas', LeaguesView, '/ligas')
    await wrapper.findAll('button').find((button) => button.text().includes('Crear liga'))!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('under-test')
    expect(document.body.textContent).toContain('Las ligas las crean los organizadores')
  })

  it('Create league sends an owner/admin to /admin', async () => {
    hasAdminAccess.value = true
    const { wrapper, router } = await mountAt('/ligas', LeaguesView, '/ligas')
    await wrapper.findAll('button').find((button) => button.text().includes('Crear liga'))!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('admin')
  })

  it.each([
    [false, false],
    [true, true],
  ])('Profile settings offer the admin panel only to owner/admin (admin=%s)', async (admin, visible) => {
    hasAdminAccess.value = admin
    const { wrapper } = await mountAt('/perfil', ProfileView, '/perfil')
    await flushPromises()
    await wrapper.get('button[aria-label="Ajustes de la cuenta"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent?.includes('Panel de administración')).toBe(visible)
    expect(document.body.textContent).toContain('Cerrar sesión')
  })
})
