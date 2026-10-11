import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import PoolView from './PoolView.vue'

const h = vi.hoisted(() => ({ access: {} as Record<string, unknown>, play: {} as Record<string, unknown> }))
vi.mock('../composables/useAuth', () => ({ useAuth: () => ({ state: { profile: { id: 'me', display_name: 'Ana' }, user: { id: 'me' } }, isAuthenticated: { value: true } }) }))
vi.mock('../composables/usePoolAccess', () => ({ usePoolAccess: () => h.access }))
vi.mock('../composables/usePoolPlay', () => ({ usePoolPlay: () => h.play }))

const future = new Date(Date.now() + 3 * 3600_000).toISOString()
const item = { poolMatchId: 'pm1', matchId: 'm1', roundId: 'r1', roundName: 'Fecha 1', roundOrder: 1, homeName: 'Alianza', awayName: 'Cristal', homeShort: null, awayShort: null, startsAt: future, lockAt: new Date(Date.now() + 2 * 3600_000).toISOString(), status: 'scheduled', mine: null, result: null, points: null }

function setup(overrides: Record<string, unknown> = {}, access: Record<string, unknown> = {}) {
  h.access = { pool: ref({ id: 'p1', name: 'Quiniela A' }), denied: ref(false), error: ref(''), loading: ref(false), load: vi.fn().mockResolvedValue(undefined), ...access }
  h.play = {
    tenantTimezone: ref('America/Lima'), participation: ref('participant'), fixture: ref([item]), leaderboard: ref([{ rank: 1, participant_id: 'x', display_name: 'Ana', points: 12, exact_hits: 2, outcome_hits: 1, played: 3, current_streak: 3, best_streak: 3, is_me: true }]),
    rounds: ref([{ id: 'r1', name: 'Fecha 1' }]), loading: ref(false), error: ref(''), savingMatchId: ref(''), myRow: ref({ rank: 1, points: 12 }), canPredict: ref(true),
    load: vi.fn().mockResolvedValue(undefined), loadLeaderboard: vi.fn().mockResolvedValue(undefined), savePrediction: vi.fn().mockResolvedValue(null), ...overrides,
  }
}

async function mountView() {
  const Blank = { template: '<div />' }
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/p/:poolId', name: 'pool', component: PoolView }, { path: '/', name: 'home', component: Blank }, { path: '/ligas', name: 'leagues', component: Blank },
    { path: '/partidos', name: 'matches', component: Blank }, { path: '/mis-puntos', name: 'points', component: Blank }, { path: '/perfil', name: 'profile', component: Blank },
  ] })
  await router.push('/p/p1'); await router.isReady()
  const wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}
const tab = (wrapper: Awaited<ReturnType<typeof mountView>>, label: string) => wrapper.findAll('[role="tab"]').find((t) => t.text() === label)!
const play = () => h.play as Record<string, ReturnType<typeof vi.fn>>

describe('PoolView', () => {
  beforeEach(() => setup())

  it('carga la parrilla del jugador autenticado una vez verificado el acceso', async () => {
    await mountView()
    expect(play().load).toHaveBeenCalledWith('p1', 'me')
  })

  it('el resumen muestra la posición propia y los próximos partidos', async () => {
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('#1')
    expect(wrapper.text()).toContain('Alianza')
  })

  it('guarda el pronóstico desde la pestaña Partidos y muestra el rechazo del servidor', async () => {
    setup({ savePrediction: vi.fn().mockResolvedValue('El pronóstico ya está cerrado o no estás habilitado en esta quiniela.') })
    const wrapper = await mountView()
    await tab(wrapper, 'Partidos').trigger('click')
    await wrapper.get('#ph-m1').setValue('2'); await wrapper.get('#pa-m1').setValue('1')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(play().savePrediction).toHaveBeenCalledWith('m1', 2, 1)
    expect(wrapper.get('[role="alert"]').text()).toMatch(/cerrado/)
  })

  it('un administrador (no participante) ve la parrilla sin formulario y con el aviso', async () => {
    setup({ participation: ref('none'), canPredict: ref(false) })
    const wrapper = await mountView()
    await tab(wrapper, 'Partidos').trigger('click')
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.text()).toContain('Administras esta quiniela')
  })

  it('la tabla muestra puntos, exactos y racha, y pide la jornada al servidor', async () => {
    const wrapper = await mountView()
    await tab(wrapper, 'Tabla').trigger('click')
    expect(wrapper.text()).toContain('12 pts')
    expect(wrapper.text()).toContain('2 exactos · racha 3')
    await wrapper.get('select').setValue('r1')
    expect(play().loadLeaderboard).toHaveBeenCalledWith('r1')
  })

  it('niega el acceso con un mensaje y no carga datos', async () => {
    setup({}, { pool: ref(null), denied: ref(true) })
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('No tienes acceso a esta quiniela')
    expect(play().load).not.toHaveBeenCalled()
  })
})
