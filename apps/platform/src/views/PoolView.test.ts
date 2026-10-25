import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import PoolView from './PoolView.vue'

const h = vi.hoisted(() => ({ access: {} as Record<string, unknown>, play: {} as Record<string, unknown>, stats: {} as Record<string, unknown>, auth: {} as Record<string, unknown>, playArgs: [] as unknown[][] }))
vi.mock('../composables/useAuth', () => ({ useAuth: () => ({ state: h.auth, isAuthenticated: { value: true } }) }))
vi.mock('../composables/usePoolAccess', () => ({ usePoolAccess: () => h.access }))
vi.mock('../composables/usePoolPlay', () => ({ usePoolPlay: (...args: unknown[]) => { h.playArgs.push(args); return h.play } }))
vi.mock('../composables/usePoolStats', () => ({ usePoolStats: () => h.stats }))

const future = new Date(Date.now() + 3 * 3600_000).toISOString()
const item = { poolMatchId: 'pm1', matchId: 'm1', roundId: 'r1', roundName: 'Fecha 1', roundOrder: 1, homeName: 'Alianza', awayName: 'Cristal', homeShort: null, awayShort: null, startsAt: future, lockAt: new Date(Date.now() + 2 * 3600_000).toISOString(), status: 'scheduled', mine: null, result: null, points: null }

function setup(overrides: Record<string, unknown> = {}, access: Record<string, unknown> = {}) {
  h.auth = reactive({ profile: { id: 'me', display_name: 'Ana' }, user: { id: 'me' } })
  h.playArgs = []
  h.access = { pool: ref({ id: 'p1', name: 'Quiniela A' }), denied: ref(false), error: ref(''), loading: ref(false), offline: ref(false), load: vi.fn().mockResolvedValue(undefined), ...access }
  h.stats = {
    stats: ref({ rank: 1, participants: 3, points: 12, exact_hits: 2, outcome_hits: 1, results_count: 3, played: 3, hit_rate: 1, avg_points: 4, best_round_points: 7, current_streak: 3, best_streak: 3 }),
    evolution: ref([{ round_id: 'r1', round_name: 'R1', sort_order: 1, my_points: 7, my_cumulative: 7, avg_points: 6.33, best_points: 7 }, { round_id: 'r2', round_name: 'R2', sort_order: 2, my_points: 5, my_cumulative: 12, avg_points: 1.67, best_points: 5 }]),
    loadPool: vi.fn().mockResolvedValue(undefined), ...(overrides.stats as object | undefined),
  }
  h.play = {
    tenantTimezone: ref('America/Lima'), ticketMode: ref('none'), participation: ref('participant'), fixture: ref([item]), leaderboard: ref([{ rank: 1, participant_id: 'x', display_name: 'Ana', points: 12, exact_hits: 2, outcome_hits: 1, played: 3, current_streak: 3, best_streak: 3, is_me: true }]),
    rounds: ref([{ id: 'r1', name: 'Fecha 1' }]), loading: ref(false), error: ref(''), savingMatchId: ref(''), suggestAvailable: ref(false), suggestingPoolMatchId: ref(''), suggestScoreline: vi.fn(), myRow: ref({ rank: 1, points: 12 }), canPredict: ref(true), offline: ref(false), updatedAt: ref(null), fromCache: ref(false),
    load: vi.fn().mockResolvedValue(undefined), reset: vi.fn(), loadLeaderboard: vi.fn().mockResolvedValue(undefined), savePrediction: vi.fn().mockResolvedValue(null), ...overrides,
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

  it('sin conexión muestra lo último guardado con su fecha y recuerda que el servidor confirma cada acción', async () => {
    setup({ offline: ref(true), updatedAt: ref(Date.parse('2026-10-12T15:00:00Z')) })
    const wrapper = await mountView()
    const notice = wrapper.get('[data-test="offline-notice"]')
    expect(notice.text()).toContain('Sin conexión')
    expect(notice.text()).toContain('el servidor confirma siempre cada acción')
  })

  it('con conexión no muestra el aviso de sin conexión', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('[data-test="offline-notice"]').exists()).toBe(false)
  })

  it('carga la parrilla del jugador autenticado una vez verificado el acceso', async () => {
    await mountView()
    expect(play().load).toHaveBeenCalledWith('p1', 'me')
  })

  it('el resumen muestra rendimiento real del servidor, evolución y el botón de compartir', async () => {
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('Tu rendimiento')
    expect(wrapper.text()).toContain('100%')
    expect(wrapper.text()).toContain('Racha actual 3')
    expect(wrapper.find('svg[role="img"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Compartir por WhatsApp o redes')
  })

  it('sin estadísticas (no participa) no muestra bloque de rendimiento ni cifras inventadas', async () => {
    setup({ stats: { stats: ref(null) } })
    const wrapper = await mountView()
    expect(wrapper.text()).not.toContain('Tu rendimiento')
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

  it('ADR-015: el administrador de una quiniela con tickets no ve formularios de pronóstico ni botones para emitir/enviar tickets', async () => {
    setup({ ticketMode: ref('tickets'), participation: ref('none'), canPredict: ref(false) })
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('Administras esta quiniela')
    await tab(wrapper, 'Partidos').trigger('click')
    await flushPromises()
    expect(wrapper.find('[aria-label="Tickets de la quiniela"]').exists()).toBe(true)
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Nuevo ticket')
    expect(wrapper.text()).not.toContain('Enviar ticket')
  })

  it('la tabla muestra puntos, exactos y racha, y pide la jornada al servidor', async () => {
    const wrapper = await mountView()
    await tab(wrapper, 'Tabla').trigger('click')
    expect(wrapper.text()).toContain('12 pts')
    expect(wrapper.text()).toContain('2 exactos · racha 3')
    await wrapper.get('select').setValue('r1')
    expect(play().loadLeaderboard).toHaveBeenCalledWith('r1')
  })

  it('en una quiniela con tickets el resumen remite a la pestaña Partidos y esta muestra el panel de tickets', async () => {
    setup({ ticketMode: ref('tickets') })
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('Esta quiniela usa tickets')
    expect(wrapper.find('form').exists()).toBe(false)
    await tab(wrapper, 'Partidos').trigger('click')
    expect(wrapper.find('[aria-label="Tickets de la quiniela"]').exists()).toBe(true)
  })

  it('avisa de los cierres próximos sin pronóstico (quiniela clásica)', async () => {
    const soon = { ...item, lockAt: new Date(Date.now() + 20 * 60_000).toISOString() }
    setup({ fixture: ref([soon]) })
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('Un cierre próximo')
    expect(wrapper.text()).toContain('Alianza vs Cristal sin pronóstico')
  })

  it('niega el acceso con un mensaje y no carga datos', async () => {
    setup({}, { pool: ref(null), denied: ref(true) })
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('No tienes acceso a esta quiniela')
    expect(play().load).not.toHaveBeenCalled()
  })

  it('FE-05: pasa a usePoolPlay un getter de la identidad vigente (para no cachear lecturas con otro JWT)', async () => {
    await mountView()
    const getter = h.playArgs[0]?.[1] as (() => string | null) | undefined
    expect(getter).toBeTypeOf('function')
    expect(getter!()).toBe('me')
    ;(h.auth as { user: { id: string } | null }).user = { id: 'otro' }
    expect(getter!()).toBe('otro')
    ;(h.auth as { user: unknown }).user = null
    expect(getter!()).toBeNull()
  })

  it('FE-05: otra identidad con la vista montada vacía lo mostrado y recarga la quiniela con el id nuevo', async () => {
    await mountView()
    expect(play().load).toHaveBeenCalledTimes(1)
    expect(play().load).toHaveBeenLastCalledWith('p1', 'me')
    ;(h.auth as { user: { id: string } | null }).user = { id: 'otro' }
    await flushPromises()
    expect(play().reset).toHaveBeenCalledTimes(1)
    expect(play().load).toHaveBeenCalledTimes(2)
    expect(play().load).toHaveBeenLastCalledWith('p1', 'otro')
  })

  it('FE-05: si se cierra la sesión con la vista abierta vacía los datos y vuelve a Inicio', async () => {
    const wrapper = await mountView()
    ;(h.auth as { user: unknown }).user = null
    await flushPromises()
    expect(play().reset).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).not.toContain('Tu rendimiento')
  })
})
