import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import PoolTicketsAdmin from './PoolTicketsAdmin.vue'
import { usePoolTicketsAdmin } from '../composables/usePoolTicketsAdmin'
import type { SportsAdminClient } from '../composables/useSportsAdmin'

const h = vi.hoisted(() => ({ a: {} as Record<string, unknown> }))
vi.mock('../composables/usePoolTicketsAdmin', async (orig) => ({ ...(await orig<typeof import('../composables/usePoolTicketsAdmin')>()), usePoolTicketsAdmin: () => h.a }))

const setup = (o: Record<string, unknown> = {}) => {
  h.a = { rounds: ref([{ roundId: 'r1', roundName: 'Fecha 1', sortOrder: 1, max: 1 }]), loading: ref(false), saving: ref(false), error: ref(''), load: vi.fn(), enable: vi.fn().mockResolvedValue(null), setLimit: vi.fn().mockResolvedValue(null), ...o }
}
const fn = (n: string) => h.a[n] as ReturnType<typeof vi.fn>

describe('PoolTicketsAdmin', () => {
  it('habilitar exige confirmar que es irreversible y envía el máximo elegido', async () => {
    setup()
    const w = mount(PoolTicketsAdmin, { props: { poolId: 'p1', ticketingMode: 'none', archived: false } })
    const enable = w.findAll('button').find((b) => b.text() === 'Habilitar tickets')!
    expect(enable.attributes('disabled')).toBeDefined()
    await w.get('input[type="number"]').setValue('3')
    await w.get('input[type="checkbox"]').setValue(true)
    await enable.trigger('click'); await flushPromises()
    expect(fn('enable')).toHaveBeenCalledWith('p1', 3)
    expect(w.emitted('changed')).toHaveLength(1)
  })

  it('valida el máximo en cliente y muestra el rechazo del servidor', async () => {
    setup({ enable: vi.fn().mockResolvedValue('Esta quiniela ya tiene pronósticos: los tickets solo se habilitan antes del primer pronóstico.') })
    const w = mount(PoolTicketsAdmin, { props: { poolId: 'p1', ticketingMode: 'none', archived: false } })
    await w.get('input[type="checkbox"]').setValue(true)
    await w.get('input[type="number"]').setValue('0')
    await w.findAll('button').find((b) => b.text() === 'Habilitar tickets')!.trigger('click'); await flushPromises()
    expect(w.get('[role="alert"]').text()).toContain('entre 1 y 20')
    expect(fn('enable')).not.toHaveBeenCalled()
    await w.get('input[type="number"]').setValue('1')
    await w.findAll('button').find((b) => b.text() === 'Habilitar tickets')!.trigger('click'); await flushPromises()
    expect(w.get('[role="alert"]').text()).toContain('ya tiene pronósticos')
  })

  it('una quiniela archivada no ofrece habilitar', () => {
    setup()
    const w = mount(PoolTicketsAdmin, { props: { poolId: 'p1', ticketingMode: 'none', archived: true } })
    expect(w.text()).toContain('archivada')
    expect(w.findAll('button')).toHaveLength(0)
  })

  it('con tickets habilitados lista las jornadas y guarda el máximo por jornada', async () => {
    setup()
    const w = mount(PoolTicketsAdmin, { props: { poolId: 'p1', ticketingMode: 'tickets', archived: false } })
    await flushPromises()
    expect(fn('load')).toHaveBeenCalledWith('p1')
    expect(w.text()).toContain('Fecha 1')
    await w.get('input[type="number"]').setValue('4')
    await w.findAll('button').find((b) => b.text() === 'Guardar')!.trigger('click'); await flushPromises()
    expect(fn('setLimit')).toHaveBeenCalledWith('p1', 'r1', 4)
  })

  it('sin jornadas vendibles lo dice sin inventar datos', () => {
    setup({ rounds: ref([]) })
    expect(mount(PoolTicketsAdmin, { props: { poolId: 'p1', ticketingMode: 'tickets', archived: false } }).text()).toContain('Aún no hay jornadas vendibles')
  })
})

describe('usePoolTicketsAdmin (traducción de errores)', () => {
  const real = async () => (await vi.importActual<typeof import('../composables/usePoolTicketsAdmin')>('../composables/usePoolTicketsAdmin')).usePoolTicketsAdmin
  const client = (message: string): SportsAdminClient => ({ from: vi.fn(), rpc: vi.fn(async () => ({ data: null, error: { message, code: '42501' } })) }) as unknown as SportsAdminClient

  it('traduce los rechazos del servidor al habilitar y configurar', async () => {
    const use = await real()
    expect(await use(() => client('tickets cannot be enabled on a pool that already has predictions')).enable('p')).toMatch(/ya tiene pronósticos/)
    expect(await use(() => client('the limit cannot be lower than tickets already issued')).setLimit('p', 'r', 1)).toMatch(/menor que los tickets/)
    expect(await use(() => client('ticket sales for this round are closed')).setLimit('p', 'r', 1)).toMatch(/ya cerró/)
  })
})

void usePoolTicketsAdmin
