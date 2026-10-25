import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { LIVE_DEBOUNCE_MS, LIVE_POLL_MS, usePoolLiveUpdates } from './usePoolLiveUpdates'

function fakeClient() {
  const handlers: Array<{ table: string; cb: () => void; filter: string }> = []
  const calls = { removed: 0, channels: [] as string[] }
  const channel = {
    on: (_e: string, spec: { table: string; filter: string }, cb: () => void) => { handlers.push({ table: spec.table, filter: spec.filter, cb }); return channel },
    subscribe: () => channel,
  }
  const client = { channel: (name: string) => { calls.channels.push(name); return channel }, removeChannel: async () => { calls.removed += 1 } }
  return { client: client as never, handlers, calls, emit: (table: string) => handlers.filter((h) => h.table === table).forEach((h) => h.cb()) }
}

function harness(opts: { tenant?: string | null; active?: boolean } = {}) {
  const fake = fakeClient()
  const tenant = ref<string | null>(opts.tenant === undefined ? 't1' : opts.tenant)
  const active = ref(opts.active ?? true)
  const onChange = vi.fn()
  const wrapper = mount(defineComponent({ setup() { usePoolLiveUpdates({ tenantId: () => tenant.value, active: () => active.value, onChange, clientFactory: () => fake.client }); return () => null } }))
  return { fake, tenant, active, onChange, wrapper }
}

describe('usePoolLiveUpdates', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('se suscribe a resultados y partidos del tenant con filtro (RLS hace el resto)', () => {
    const { fake } = harness()
    expect(fake.handlers.map((h) => [h.table, h.filter])).toEqual([['official_results', 'tenant_id=eq.t1'], ['matches', 'tenant_id=eq.t1']])
  })

  it('agrupa varias señales seguidas en una sola recarga', () => {
    const { fake, onChange } = harness()
    fake.emit('official_results'); fake.emit('matches'); fake.emit('official_results')
    expect(onChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(LIVE_DEBOUNCE_MS)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('sondea solo mientras queden partidos sin resultado final', () => {
    const { onChange, active } = harness()
    vi.advanceTimersByTime(LIVE_POLL_MS)
    expect(onChange).toHaveBeenCalledTimes(1)
    active.value = false
    vi.advanceTimersByTime(LIVE_POLL_MS * 3)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('sin tenant no se suscribe; al cambiar de tenant y al desmontar libera el canal', async () => {
    const { fake, tenant, wrapper } = harness({ tenant: null })
    expect(fake.calls.channels).toEqual([])
    tenant.value = 't2'
    await Promise.resolve()
    expect(fake.calls.channels).toEqual(['pool-live:t2'])
    wrapper.unmount()
    expect(fake.calls.removed).toBe(1)
  })
})
