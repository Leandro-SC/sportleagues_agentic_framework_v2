import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import PoolTicketsPanel from './PoolTicketsPanel.vue'
import ClosingSoonBanner from './ClosingSoonBanner.vue'
import type { FixtureItem } from '../composables/usePoolPlay'

const h = vi.hoisted(() => ({ t: {} as Record<string, unknown> }))
vi.mock('../composables/usePoolTickets', () => ({ usePoolTickets: () => h.t }))

const now = new Date('2026-10-12T12:00:00Z')
const fx = (o: Partial<FixtureItem> = {}): FixtureItem => ({ poolMatchId: 'pm1', matchId: 'm1', roundId: 'r1', roundName: 'Fecha 1', roundOrder: 1, homeName: 'Alianza', awayName: 'Cristal', homeShort: null, awayShort: null,
  startsAt: '2026-10-12T13:00:00Z', lockAt: '2026-10-12T12:45:00Z', status: 'scheduled', mine: null, result: null, points: null, ...o })
const ticket = (o: Record<string, unknown> = {}) => ({ ticket_id: 't1', pool_id: 'p', pool_name: 'Liga', round_id: 'r1', round_name: 'Fecha 1', display_no: 1, status: 'draft', eligibility: 'pending', created_at: '', submitted_at: null,
  selections: 0, round_matches: 1, results_count: 0, points: 0, is_best: false, max_tickets: 2, sales_closes_at: null, ...o })

function setup(o: Record<string, unknown> = {}) {
  h.t = {
    tickets: ref([ticket()]), selections: ref({ t1: { pm1: { home: 2, away: 1, points: null } } }), roundLimits: ref({ r1: 2 }), loading: ref(false), busy: ref(''), error: ref(''),
    load: vi.fn(), createTicket: vi.fn().mockResolvedValue(null), saveSelection: vi.fn().mockResolvedValue(null), submitTicket: vi.fn().mockResolvedValue(null), cancelTicket: vi.fn().mockResolvedValue(null), ...o,
  }
}
const mountPanel = async (props: Record<string, unknown> = {}) => {
  const w = mount(PoolTicketsPanel, { props: { poolId: 'p', profileId: 'me', fixture: [fx()], timezone: 'America/Lima', now, canPredict: true, ...props } })
  await flushPromises()
  return w
}
const fn = (name: string) => h.t[name] as ReturnType<typeof vi.fn>
const button = (w: Awaited<ReturnType<typeof mountPanel>>, label: string) => w.findAll('button').find((b) => b.text().includes(label))!

describe('PoolTicketsPanel', () => {
  beforeEach(() => setup())

  it('muestra la venta con el cierre del servidor, el cupo y el estado del ticket', async () => {
    const w = await mountPanel()
    expect(w.text()).toContain('La venta cierra en 45 min')
    expect(w.text()).toContain('1/2 tickets')
    expect(w.text()).toContain('Borrador · sin enviar')
    expect((w.get('#ph-m1').element as HTMLInputElement).value).toBe('2')   // la selección del ticket activo
    expect((w.get('#pa-m1').element as HTMLInputElement).value).toBe('1')
  })

  it('crea un ticket nuevo por la RPC cuando hay cupo', async () => {
    const w = await mountPanel()
    await button(w, 'Nuevo ticket').trigger('click'); await flushPromises()
    expect(fn('createTicket')).toHaveBeenCalledWith('r1')
  })

  it('sin cupo no ofrece crear y lo explica', async () => {
    setup({ tickets: ref([ticket(), ticket({ ticket_id: 't2', display_no: 2 })]) })
    const w = await mountPanel()
    expect(w.text()).not.toContain('Nuevo ticket')
    expect(w.text()).toContain('Alcanzaste el máximo de tickets')
  })

  it('con la venta cerrada no ofrece crear, enviar ni cancelar, y avisa que el borrador no compite', async () => {
    const w = await mountPanel({ fixture: [fx({ lockAt: '2026-10-12T11:00:00Z' })] })
    expect(w.text()).toContain('Venta cerrada')
    expect(w.text()).not.toContain('Nuevo ticket')
    expect(w.text()).not.toContain('Enviar ticket')
    expect(w.text()).not.toContain('Cancelar ticket')
    expect(w.text()).toContain('no compite')
  })

  it('guarda una selección en el ticket elegido', async () => {
    const w = await mountPanel()
    await w.get('#ph-m1').setValue('3'); await w.get('#pa-m1').setValue('0')
    await w.get('form').trigger('submit'); await flushPromises()
    expect(fn('saveSelection')).toHaveBeenCalledWith('t1', 'm1', 3, 0)
  })

  it('envía y cancela el ticket y muestra el rechazo del servidor', async () => {
    setup({ submitTicket: vi.fn().mockResolvedValue('La venta de tickets de esta jornada ya cerró.') })
    const w = await mountPanel()
    await button(w, 'Enviar ticket').trigger('click'); await flushPromises()
    expect(fn('submitTicket')).toHaveBeenCalledWith('t1')
    expect(w.get('[role="alert"]').text()).toContain('ya cerró')
    await button(w, 'Cancelar ticket').trigger('click'); await flushPromises()
    expect(fn('cancelTicket')).toHaveBeenCalledWith('t1')
  })

  it('un ticket enviado y elegible no ofrece enviar de nuevo; muestra su puntuación real', async () => {
    setup({ tickets: ref([ticket({ status: 'submitted', eligibility: 'eligible', results_count: 1, points: 7, is_best: true })]) })
    const w = await mountPanel()
    expect(w.text()).not.toContain('Enviar ticket')
    expect(w.text()).toContain('7 pts')
    expect(w.text()).toContain('★ mejor')
  })

  it('jornada sin tickets habilitados: estado honesto y ninguna acción', async () => {
    setup({ tickets: ref([]), roundLimits: ref({}) })
    const w = await mountPanel()
    expect(w.text()).toContain('Tickets no habilitados')
    expect(w.text()).not.toContain('Nuevo ticket')
  })

  it('el administrador (no puede pronosticar) ve los tickets sin acciones', async () => {
    const w = await mountPanel({ canPredict: false })
    expect(w.text()).not.toContain('Nuevo ticket')
    expect(w.find('form').exists()).toBe(false)
  })

  it('avisa del cierre próximo cuando la jornada aún no tiene ticket enviado', async () => {
    const w = await mountPanel({ fixture: [fx({ lockAt: '2026-10-12T12:20:00Z' })] })
    expect(w.text()).toContain('Un cierre próximo')
    expect(w.text()).toContain('aún sin ticket enviado')
  })

  it('muestra el error de carga', async () => {
    setup({ error: ref('No fue posible cargar tus tickets.') })
    const w = await mountPanel()
    expect(w.get('[role="alert"]').text()).toContain('No fue posible')
  })
})

describe('ClosingSoonBanner', () => {
  const items = [{ key: 'a', label: 'A', closesAt: '2026-10-12T12:10:00Z' }, { key: 'b', label: 'B', closesAt: '2026-10-12T15:00:00Z' }, { key: 'c', label: 'C', closesAt: '2026-10-12T11:00:00Z' }]
  it('solo avisa de cierres dentro de la ventana y futuros', () => {
    const w = mount(ClosingSoonBanner, { props: { items, now } })
    expect(w.text()).toContain('A · cierra en 10 min')
    expect(w.text()).not.toContain('B ·')
    expect(w.text()).not.toContain('C ·')
  })
  it('no se muestra si no hay cierres próximos', () => {
    expect(mount(ClosingSoonBanner, { props: { items: [items[1]!], now } }).find('aside').exists()).toBe(false)
  })
})
