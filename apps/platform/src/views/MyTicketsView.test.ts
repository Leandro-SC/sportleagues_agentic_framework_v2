import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import MyTicketsView from './MyTicketsView.vue'

const h = vi.hoisted(() => ({ history: {} as Record<string, unknown> }))
vi.mock('../composables/useAuth', () => ({ useAuth: () => ({ state: { profile: { id: 'me', display_name: 'Ana' }, user: { id: 'me' } }, isAuthenticated: { value: true } }) }))
vi.mock('../composables/usePoolTickets', () => ({ useMyTicketsHistory: () => h.history }))

const ticket = (o: Record<string, unknown>) => ({ ticket_id: 't', pool_id: 'p1', pool_name: 'Liga A', round_id: 'r1', round_name: 'Fecha 1', display_no: 1, status: 'submitted', eligibility: 'eligible',
  created_at: '', submitted_at: '', selections: 2, round_matches: 2, results_count: 2, points: 10, is_best: true, max_tickets: 2, sales_closes_at: null, ...o })
const setup = (o: Record<string, unknown> = {}) => { h.history = { tickets: ref([]), loading: ref(false), error: ref(''), load: vi.fn(), ...o } }

async function mountView() {
  const Blank = { template: '<div />' }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/mis-tickets', name: 'my-tickets', component: MyTicketsView }, { path: '/', name: 'home', component: Blank },
    { path: '/ligas', name: 'leagues', component: Blank }, { path: '/p/:poolId', name: 'pool', component: Blank }, { path: '/partidos', name: 'matches', component: Blank },
    { path: '/mis-puntos', name: 'points', component: Blank }, { path: '/perfil', name: 'profile', component: Blank }] })
  await router.push('/mis-tickets'); await router.isReady()
  const wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

describe('MyTicketsView', () => {
  beforeEach(() => setup())

  it('sin tickets muestra un estado vacío honesto, sin cifras de ejemplo', async () => {
    const { wrapper } = await mountView()
    expect(wrapper.text()).toContain('Todavía no tienes tickets')
    expect(wrapper.text()).not.toMatch(/\bpts\b/)
  })

  it('agrupa por quiniela y jornada con estado, avance y puntos reales; marca el mejor', async () => {
    setup({ tickets: ref([
      ticket({ ticket_id: 'a', display_no: 1, points: 7, is_best: false }), ticket({ ticket_id: 'b', display_no: 2, points: 10 }),
      ticket({ ticket_id: 'c', display_no: 1, status: 'cancelled', eligibility: 'ineligible', points: 0, is_best: false, round_id: 'r2', round_name: 'Fecha 2', results_count: 0 }),
      ticket({ ticket_id: 'd', pool_id: 'p2', pool_name: 'Liga B', status: 'draft', eligibility: 'pending', points: 0, results_count: 0, is_best: false, selections: 1 }),
    ]) })
    const { wrapper } = await mountView()
    const text = wrapper.text()
    expect(text).toContain('Liga A'); expect(text).toContain('Liga B'); expect(text).toContain('Fecha 1'); expect(text).toContain('Fecha 2')
    expect(text).toContain('7 pts'); expect(text).toContain('10 pts')
    expect(text).toContain('Enviado · elegible'); expect(text).toContain('Cancelado'); expect(text).toContain('Borrador · sin enviar')
    expect(text).toContain('1/2 pronósticos')
    expect(wrapper.findAll('[aria-label="Mejor ticket"]')).toHaveLength(1)   // solo el ticket b
  })

  it('abre la quiniela desde su nombre', async () => {
    setup({ tickets: ref([ticket({})]) })
    const { wrapper, router } = await mountView()
    await wrapper.findAll('button').find((b) => b.text() === 'Liga A')!.trigger('click'); await flushPromises()
    expect(router.currentRoute.value.params.poolId).toBe('p1')
  })

  it('muestra el error del servidor', async () => {
    setup({ error: ref('No fue posible cargar tus tickets.') })
    const { wrapper } = await mountView()
    expect(wrapper.get('[role="alert"]').text()).toContain('No fue posible')
  })
})
