import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import PointsView from './PointsView.vue'

const h = vi.hoisted(() => ({ stats: {} as Record<string, unknown> }))
vi.mock('../composables/useAuth', () => ({ useAuth: () => ({ state: { profile: { id: 'me', display_name: 'Ana' }, user: { id: 'me' } }, isAuthenticated: { value: true } }) }))
vi.mock('../composables/usePoolStats', () => ({ usePoolStats: () => h.stats }))

const setup = (o: Record<string, unknown> = {}) => { h.stats = { summary: ref([]), loading: ref(false), error: ref(''), loadSummary: vi.fn(), ...o } }

async function mountView(component: object, name: string) {
  const Blank = { template: '<div />' }
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/x', name, component }, { path: '/', name: 'home', component: Blank }, { path: '/ligas', name: 'leagues', component: Blank }, { path: '/p/:poolId', name: 'pool', component: Blank },
    { path: '/partidos', name: 'matches', component: Blank }, { path: '/perfil', name: 'profile', component: Blank }, ...(name === 'points' ? [] : [{ path: '/mis-puntos', name: 'points', component: Blank }]) ] })
  await router.push('/x'); await router.isReady()
  const wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

describe('PointsView', () => {
  beforeEach(() => setup())

  it('lista por quiniela la posición y los puntos reales del servidor, sin sumarlas', async () => {
    setup({ summary: ref([{ pool_id: 'p1', pool_name: 'Liga A', rank: 2, participants: 9, points: 31, exact_hits: 4, current_streak: 2 }, { pool_id: 'p2', pool_name: 'Liga B', rank: 1, participants: 3, points: 8, exact_hits: 1, current_streak: 0 }]) })
    const { wrapper } = await mountView(PointsView, 'points')
    expect(wrapper.text()).toContain('Liga A')
    expect(wrapper.text()).toContain('#2 de 9')
    expect(wrapper.text()).toContain('31')
    expect(wrapper.text()).toContain('Racha 2')
    expect(wrapper.text()).not.toContain('39')
  })

  it('sin participaciones muestra un estado vacío honesto', async () => {
    const { wrapper } = await mountView(PointsView, 'points')
    expect(wrapper.text()).toContain('Todavía no tienes puntos')
  })

  it('muestra el error del servidor', async () => {
    setup({ error: ref('No fue posible cargar tus puntos.') })
    const { wrapper } = await mountView(PointsView, 'points')
    expect(wrapper.get('[role="alert"]').text()).toContain('No fue posible')
  })

  it('abre la quiniela al tocar una fila', async () => {
    setup({ summary: ref([{ pool_id: 'p1', pool_name: 'Liga A', rank: 1, participants: 2, points: 5, exact_hits: 1, current_streak: 1 }]) })
    const { wrapper, router } = await mountView(PointsView, 'points')
    await wrapper.findAll('button').find((b) => b.text().includes('Liga A'))!.trigger('click'); await flushPromises()
    expect(router.currentRoute.value.params.poolId).toBe('p1')
  })
})
