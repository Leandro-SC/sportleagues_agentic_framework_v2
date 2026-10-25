import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import { relativeTime, useNotifications, type AppNotification } from './useNotifications'

const row = (id: string, read = false): AppNotification => ({ id, pool_id: 'pool-1', match_id: 'm1', kind: 'result_published', title: `Resultado ${id}`, body: 'Liga · Tu pronóstico 2-1: 5 pts', created_at: '2026-10-24T15:00:00Z', read_at: read ? '2026-10-24T15:01:00Z' : null })

function fakeClient(rows: AppNotification[], opts: { rpcError?: boolean } = {}) {
  let live: ((payload: { new: AppNotification }) => void) | null = null
  const calls = { rpc: [] as unknown[], removed: 0, selects: 0 }
  const query: Record<string, unknown> = {}
  for (const m of ['select', 'order']) query[m] = () => query
  query.limit = async () => { calls.selects += 1; return { data: rows, error: null } }
  const channel = { on: (_e: string, _f: unknown, cb: typeof live) => { live = cb; return channel }, subscribe: () => channel }
  const client = {
    from: () => query,
    channel: () => channel,
    removeChannel: async () => { calls.removed += 1 },
    rpc: async (name: string, args: unknown) => { calls.rpc.push([name, args]); return { data: 1, error: opts.rpcError ? { message: 'x' } : null } },
  }
  return { client: client as never, calls, push: (n: AppNotification) => live?.({ new: n }) }
}

function harness(client: never, auth = reactive({ state: { user: { id: 'u1' } as { id: string } | null } })) {
  let api!: ReturnType<typeof useNotifications>
  const wrapper = mount(defineComponent({ setup() { api = useNotifications(() => client, auth as never); return () => null } }))
  return { wrapper, api: () => api, auth }
}

describe('useNotifications', () => {
  it('carga los avisos del usuario y cuenta los no leídos', async () => {
    const fake = fakeClient([row('a'), row('b', true)])
    const { api } = harness(fake.client)
    await flushPromises()
    expect(api().items.value.map((n) => n.id)).toEqual(['a', 'b'])
    expect(api().unread.value).toBe(1)
  })

  it('un aviso nuevo en tiempo real aparece arriba sin duplicarse', async () => {
    const fake = fakeClient([row('a')])
    const { api } = harness(fake.client)
    await flushPromises()
    fake.push(row('c'))
    fake.push(row('c'))
    expect(api().items.value.map((n) => n.id)).toEqual(['c', 'a'])
  })

  it('marcar todo como leído llama a la RPC y actualiza el contador', async () => {
    const fake = fakeClient([row('a'), row('b')])
    const { api } = harness(fake.client)
    await flushPromises()
    await api().markRead()
    expect(fake.calls.rpc).toEqual([['mark_notifications_read', { p_ids: null }]])
    expect(api().unread.value).toBe(0)
  })

  it('si la RPC falla se restaura el estado y se informa', async () => {
    const fake = fakeClient([row('a')], { rpcError: true })
    const { api } = harness(fake.client)
    await flushPromises()
    await api().markRead(['a'])
    expect(api().unread.value).toBe(1)
    expect(api().error.value).toContain('No pudimos marcar')
  })

  it('sin sesión no consulta nada; al cerrar sesión limpia y se desuscribe', async () => {
    const fake = fakeClient([row('a')])
    const { api, auth, wrapper } = harness(fake.client)
    await flushPromises()
    auth.state.user = null
    await flushPromises()
    expect(api().items.value).toEqual([])
    expect(fake.calls.removed).toBe(1)
    wrapper.unmount()
  })

  it('formatea el tiempo relativo en español', () => {
    expect(relativeTime('2026-10-24T14:55:00Z', new Date('2026-10-24T15:00:00Z'))).toBe('hace 5 minutos')
    vi.useRealTimers()
  })
})
