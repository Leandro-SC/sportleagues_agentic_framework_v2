import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { resetFollowedTeamsForTests } from '../composables/useFollowedTeams'
import { resetSportsCatalogForTests } from '../composables/useSportsCatalog'
import HomeDashboard from './HomeDashboard.vue'

vi.mock('../composables/useAuth', () => ({
  useAuth: () => ({
    state: { profile: { id: 'u1', display_name: 'Bart Simpson' }, user: { id: 'u1' } },
    isAuthenticated: { value: true },
  }),
}))

vi.mock('../composables/useMyPools', () => ({
  useMyPools: () => ({
    pools: ref([{ id: 'pool-1', name: 'Quiniela Amigos', status: 'open', approval_status: 'approved' }]),
    loading: ref(false),
    error: ref(''),
    load: async () => {},
  }),
}))

const Blank = { template: '<div />' }
const RESULTS = '[aria-label="Resultados de búsqueda"]'

async function mountHome() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      ...['home', 'matches', 'leagues', 'profile', 'league-join', 'onboarding'].map((name) => ({ path: `/${name}`, name, component: Blank })),
      { path: '/p/:poolId', name: 'pool', component: Blank },
      { path: '/ligas/:leagueId', name: 'league', component: Blank },
      { path: '/equipos/:teamId', name: 'team', component: Blank },
    ],
  })
  await router.push('/home')
  await router.isReady()
  const wrapper = mount(HomeDashboard, { global: { plugins: [router] }, attachTo: document.body })
  return { wrapper, router }
}

type Mounted = Awaited<ReturnType<typeof mountHome>>['wrapper']

async function search(wrapper: Mounted, text: string): Promise<void> {
  await vi.waitFor(() => expect(wrapper.text()).toContain('Mis equipos'))
  await wrapper.get('#home-search').setValue(text)
  await flushPromises()
}

describe('HomeDashboard search', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_PREVIEW_DATA', 'true')
    resetSportsCatalogForTests()
    resetFollowedTeamsForTests()
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    resetSportsCatalogForTests()
    document.body.innerHTML = ''
  })

  it('finds the user pool and catalog entries, and ignores one-letter queries', async () => {
    const { wrapper } = await mountHome()
    await search(wrapper, 'a')
    expect(wrapper.find(RESULTS).exists()).toBe(false)

    await search(wrapper, 'quiniela')
    expect(wrapper.get(RESULTS).text()).toContain('Quiniela Amigos')

    await search(wrapper, 'amer')
    expect(wrapper.get(RESULTS).text()).toContain('América')
  })

  it('closes the results with Escape and when tapping outside, and reopens on focus', async () => {
    const { wrapper } = await mountHome()
    await search(wrapper, 'liga')
    expect(wrapper.find(RESULTS).exists()).toBe(true)

    await wrapper.get('#home-search').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find(RESULTS).exists()).toBe(false)

    await wrapper.get('#home-search').trigger('focusin')
    expect(wrapper.find(RESULTS).exists()).toBe(true)

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(wrapper.find(RESULTS).exists()).toBe(false)
  })

  it('opens a team from the results and offers the join screen when nothing matches', async () => {
    const { wrapper, router } = await mountHome()
    await search(wrapper, 'monterrey')
    await wrapper.get(`${RESULTS} button`).trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('team')
    expect(router.currentRoute.value.params.teamId).toBe('monterrey')

    await router.push('/home')
    await search(wrapper, 'zzzz inexistente')
    expect(wrapper.text()).toContain('Sin coincidencias')
    await wrapper.get('form[role="search"]').trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('league-join')
    expect(router.currentRoute.value.query.q).toBe('zzzz inexistente')
  })

  it('greets by first name only', async () => {
    const { wrapper } = await mountHome()
    expect(wrapper.get('h1').text()).toContain('Hola, Bart')
    expect(wrapper.get('h1').text()).not.toContain('Simpson')
  })
})
