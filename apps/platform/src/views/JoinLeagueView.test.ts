import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import JoinLeagueView from './JoinLeagueView.vue'

vi.mock('../composables/useAuth', () => ({
  useAuth: () => ({ state: { profile: { id: 'p', display_name: 'Ana Pérez' }, user: { id: 'p' } }, isAuthenticated: { value: true } }),
}))

const Blank = { template: '<div />' }

async function mountView(path = '/ligas/unirme') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/ligas/unirme', name: 'league-join', component: JoinLeagueView },
      { path: '/ligas', name: 'leagues', component: Blank },
      { path: '/j/:code', name: 'join', component: Blank },
      { path: '/', name: 'home', component: Blank },
      { path: '/partidos', name: 'matches', component: Blank },
      { path: '/perfil', name: 'profile', component: Blank },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

describe('JoinLeagueView', () => {
  it('routes a typed invitation code to the real join flow', async () => {
    const { wrapper, router } = await mountView()
    await wrapper.get('#league-search').setValue('#ab12cd')
    expect(wrapper.text()).toContain('#AB12CD')

    const join = wrapper.findAll('button').find((button) => button.text() === 'Unirme')!
    await join.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('join')
    expect(router.currentRoute.value.params.code).toBe('AB12CD')
  })

  it('never joins an example league from the recommended list; it explains how to join instead', async () => {
    const { wrapper, router } = await mountView()
    await wrapper.get('button[aria-label="Unirse a La 12"]').trigger('click')
    expect(router.currentRoute.value.name).toBe('league-join')
    expect(wrapper.get('[role="status"]').text()).toContain('es una liga de ejemplo')
  })

  it('filters recommended leagues by name from the q parameter', async () => {
    const { wrapper } = await mountView('/ligas/unirme?q=barrio')
    const names = wrapper.findAll('li button[aria-label^="Unirse a"]').map((button) => button.attributes('aria-label'))
    expect(names).toEqual(['Unirse a Amigos del Barrio'])
  })
})
