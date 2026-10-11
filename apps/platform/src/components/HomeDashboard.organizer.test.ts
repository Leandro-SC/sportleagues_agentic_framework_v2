import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import HomeDashboard from './HomeDashboard.vue'

const hasAccess = ref(false)

vi.mock('../composables/useAuth', () => ({
  useAuth: () => ({ state: { profile: { id: 'u1', display_name: 'Ana' }, user: { id: 'u1' } }, isAuthenticated: { value: true } }),
}))
vi.mock('../composables/useMyPools', () => ({
  useMyPools: () => ({ pools: ref([]), loading: ref(false), error: ref(''), load: async () => {} }),
}))
vi.mock('../composables/useTenantAdminAccess', () => ({
  useTenantAdminAccess: () => ({ hasTenantAdminAccess: hasAccess, loading: ref(false), error: ref(''), checkAccess: async () => hasAccess.value }),
}))

const Blank = { template: '<div />' }

async function mountHome() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      ...['home', 'matches', 'leagues', 'points', 'profile', 'league-join', 'onboarding', 'organizer-dashboard'].map((name) => ({ path: `/${name}`, name, component: Blank })),
      { path: '/p/:poolId', name: 'pool', component: Blank },
      { path: '/ligas/:leagueId', name: 'league', component: Blank },
      { path: '/equipos/:teamId', name: 'team', component: Blank },
    ],
  })
  await router.push('/home')
  await router.isReady()
  return mount(HomeDashboard, { global: { plugins: [router] } })
}

describe('HomeDashboard organizer entry', () => {
  it('hides the organizer mode entry for users without an active admin membership', async () => {
    hasAccess.value = false
    const wrapper = await mountHome()
    expect(wrapper.find('[aria-label="Cambiar al panel de organizador"]').exists()).toBe(false)
  })

  it('shows the organizer mode entry only when the membership check passes', async () => {
    hasAccess.value = true
    const wrapper = await mountHome()
    expect(wrapper.find('[aria-label="Cambiar al panel de organizador"]').attributes('href')).toBe('/organizer-dashboard')
  })
})
