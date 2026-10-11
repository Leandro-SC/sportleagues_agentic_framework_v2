import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import AdminFixtureView from './AdminFixtureView.vue'

const h = vi.hoisted(() => ({ sports: {} as Record<string, unknown>, admin: {} as Record<string, unknown> }))

vi.mock('../composables/useAuth', () => ({
  useAuth: () => ({ state: { profile: { id: 'p', display_name: 'Ana Pérez' }, user: { id: 'p' } }, isAuthenticated: { value: true } }),
}))
vi.mock('../composables/useAdmin', () => ({ useAdmin: () => h.admin }))
vi.mock('../composables/useSportsAdmin', () => ({ useSportsAdmin: () => h.sports }))

const started = new Date(Date.now() - 3600_000).toISOString()
const future = new Date(Date.now() + 86_400_000).toISOString()

function setup(overrides: Record<string, unknown> = {}) {
  h.admin = {
    tenants: ref([{ tenant_id: 'tenant-1234', role: 'admin', plan_code: 'free' }]), selectedTenantId: ref('tenant-1234'), selectedPoolId: ref('pool-1'),
    selectedPool: ref({ id: 'pool-1', name: 'Quiniela A', lock_offset: '00:15:00' }), loading: ref(false), error: ref(''), load: vi.fn(),
  }
  h.sports = {
    timezone: ref('America/Lima'), tournaments: ref([{ id: 'to-1', name: 'Liga', season_label: '2026' }]), selectedTournamentId: ref('to-1'),
    selectedTournament: ref({ id: 'to-1', name: 'Liga' }), teams: ref([{ id: 'a', name: 'Alianza', short_name: null }, { id: 'b', name: 'Cristal', short_name: null }]),
    enrolledTeamIds: ref(['a', 'b']), enrolledTeams: ref([{ id: 'a', name: 'Alianza' }, { id: 'b', name: 'Cristal' }]),
    rounds: ref([{ id: 'r1', tournament_id: 'to-1', name: 'Fecha 1', sort_order: 0 }]),
    matches: ref([
      { id: 'm1', tournament_id: 'to-1', round_id: 'r1', home_team_id: 'a', away_team_id: 'b', starts_at: started, status: 'scheduled' },
      { id: 'm2', tournament_id: 'to-1', round_id: 'r1', home_team_id: 'b', away_team_id: 'a', starts_at: future, status: 'scheduled' },
    ]),
    results: ref({}), poolMatchIds: ref([]), loading: ref(false), saving: ref(false), error: ref(''), teamName: (id: string) => (id === 'a' ? 'Alianza' : 'Cristal'),
    loadCatalog: vi.fn(), loadTournament: vi.fn(), loadPoolMatches: vi.fn(), saveTournament: vi.fn().mockResolvedValue(null), addTeamsInBulk: vi.fn().mockResolvedValue(null),
    setEnrolled: vi.fn().mockResolvedValue(null), saveRound: vi.fn().mockResolvedValue(null), reorderRounds: vi.fn().mockResolvedValue(null),
    saveMatch: vi.fn().mockResolvedValue(null), removeMatch: vi.fn().mockResolvedValue(null), setPoolMatch: vi.fn().mockResolvedValue(null),
    publishResult: vi.fn().mockResolvedValue(null), ...overrides,
  }
}

async function mountView() {
  const Blank = { template: '<div />' }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/parrilla', name: 'admin-fixture', component: AdminFixtureView }, { path: '/admin', name: 'admin', component: Blank }, { path: '/', name: 'home', component: Blank },
      { path: '/partidos', name: 'matches', component: Blank }, { path: '/ligas', name: 'leagues', component: Blank }, { path: '/mis-puntos', name: 'points', component: Blank }, { path: '/perfil', name: 'profile', component: Blank },
    ],
  })
  await router.push('/admin/parrilla'); await router.isReady()
  const wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}
const matchForm = (wrapper: ReturnType<typeof mount>) => wrapper.findAll('form').find((form) => form.text().includes('Crear partido'))!
const sports = () => h.sports as Record<string, ReturnType<typeof vi.fn>>

describe('AdminFixtureView', () => {
  beforeEach(() => setup())

  it('muestra la parrilla con la zona horaria del tenant y el cierre estimado de la quiniela', async () => {
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('America/Lima')
    expect(wrapper.text()).toContain('Alianza vs Cristal')
    expect(wrapper.text()).toContain('Cierre estimado')
    expect(wrapper.text()).toContain('lo confirma el servidor')
  })

  it('rechaza en cliente local = visita sin llamar al servidor', async () => {
    const wrapper = await mountView()
    const selects = matchForm(wrapper).findAll('select')
    await selects[0]!.setValue('r1'); await selects[1]!.setValue('a'); await selects[2]!.setValue('a')
    await wrapper.get('#match-kickoff').setValue('2026-10-20T20:00')
    await matchForm(wrapper).trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('Local y visita deben ser equipos distintos')
    expect(sports().saveMatch).not.toHaveBeenCalled()
  })

  it('crea un partido enviando el inicio en UTC convertido desde la hora local de Lima', async () => {
    const wrapper = await mountView()
    const selects = matchForm(wrapper).findAll('select')
    await selects[0]!.setValue('r1'); await selects[1]!.setValue('a'); await selects[2]!.setValue('b')
    await wrapper.get('#match-kickoff').setValue('2026-10-20T20:00')
    await matchForm(wrapper).trigger('submit')
    await flushPromises()
    expect(sports().saveMatch).toHaveBeenCalledWith({ id: undefined, roundId: 'r1', homeTeamId: 'a', awayTeamId: 'b', startsAtIso: '2026-10-21T01:00:00.000Z' })
  })

  it('traduce y muestra el rechazo del servidor sin ocultarlo', async () => {
    setup({ saveMatch: vi.fn().mockResolvedValue('El calendario de este partido está congelado: ya venció el cierre de una quiniela.') })
    const wrapper = await mountView()
    const selects = matchForm(wrapper).findAll('select')
    await selects[0]!.setValue('r1'); await selects[1]!.setValue('a'); await selects[2]!.setValue('b')
    await wrapper.get('#match-kickoff').setValue('2026-10-20T20:00')
    await matchForm(wrapper).trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('congelado')
  })

  it('solo ofrece publicar resultados de partidos ya iniciados y valida el marcador', async () => {
    const wrapper = await mountView()
    const tab = wrapper.findAll('[role="tab"]').find((t) => t.text() === 'Resultados')!
    await tab.trigger('click')
    expect(wrapper.text()).not.toContain('Cristal vs Alianza')
    expect(wrapper.findAll('button').filter((button) => button.text() === 'Publicar')).toHaveLength(1)

    await wrapper.get('#score-h-m1').setValue('2'); await wrapper.get('#score-a-m1').setValue('-1')
    await wrapper.findAll('button').find((button) => button.text() === 'Publicar')!.trigger('click')
    await flushPromises()
    expect(sports().publishResult).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('marcador')

    await wrapper.get('#score-a-m1').setValue('1')
    await wrapper.findAll('button').find((button) => button.text() === 'Publicar')!.trigger('click')
    await flushPromises()
    expect(sports().publishResult).toHaveBeenCalledWith('m1', 2, 1)
  })

  it('el alta exprés de equipos omite duplicados y llama a la RPC una sola vez', async () => {
    const wrapper = await mountView()
    await wrapper.findAll('[role="tab"]').find((t) => t.text() === 'Equipos')!.trigger('click')
    await wrapper.get('textarea').setValue('Alianza\nMelgar, MEL')
    await wrapper.findAll('button').find((button) => button.text().startsWith('Añadir e inscribir'))!.trigger('click')
    await flushPromises()
    expect(sports().addTeamsInBulk).toHaveBeenCalledWith([{ name: 'Melgar', shortName: 'MEL' }])
  })

  it('muestra el estado sin acceso cuando el usuario no administra ningún tenant', async () => {
    setup()
    ;(h.admin.tenants as { value: unknown[] }).value = []
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('Sin acceso administrativo')
  })
})
