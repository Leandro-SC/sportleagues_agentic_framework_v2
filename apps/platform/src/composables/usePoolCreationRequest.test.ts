import { describe, expect, it, vi } from 'vitest'
import type { PoolCreationRequestClient, PoolCreationRpcResult } from './usePoolCreationRequest'
import { usePoolCreationRequest } from './usePoolCreationRequest'

const row = (overrides: Record<string, unknown> = {}) => ({ id: 'r1', status: 'pending', created: true, requested_at: '2026-10-12T10:00:00Z', reviewed_at: null, ...overrides })
type Handler = (args?: { p_note: string | null }) => PoolCreationRpcResult | Promise<PoolCreationRpcResult>

function setup(handlers: Partial<Record<'request_pool_creation' | 'my_pool_creation_request' | 'cancel_pool_creation_request', Handler>>) {
  const rpc = vi.fn(async (fn: string, args?: { p_note: string | null }) => {
    const handler = handlers[fn as keyof typeof handlers]
    if (!handler) throw new Error(`rpc inesperado ${fn}`)
    return handler(args)
  })
  const flow = usePoolCreationRequest(() => ({ rpc } as unknown as PoolCreationRequestClient))
  return { rpc, flow }
}
const ok = (data: unknown): PoolCreationRpcResult => ({ data, error: null })
const fail = (code: string, message = ''): PoolCreationRpcResult => ({ data: null, error: { code, message } })

describe('usePoolCreationRequest', () => {
  it('loads the latest own request and exposes it', async () => {
    const { flow } = setup({ my_pool_creation_request: () => ok(row({ created: undefined })) })
    await flow.load()
    expect(flow.availability.value).toBe('available')
    expect(flow.request.value?.status).toBe('pending')
    expect(flow.hasPending.value).toBe(true)
    expect(flow.canSubmit.value).toBe(false)
  })

  it('a null answer means no request yet and submission is allowed', async () => {
    const { flow } = setup({ my_pool_creation_request: () => ok(null) })
    await flow.load()
    expect(flow.request.value).toBeNull()
    expect(flow.canSubmit.value).toBe(true)
  })

  it('submits only the note: no tenant_id, role or status leaves the client', async () => {
    const { flow, rpc } = setup({ my_pool_creation_request: () => ok(null), request_pool_creation: () => ok(row()) })
    await flow.load()
    expect(await flow.submit('  Mi liga  ')).toBe(true)
    expect(rpc).toHaveBeenCalledWith('request_pool_creation', { p_note: 'Mi liga' })
    const args = rpc.mock.calls.find(([fn]) => fn === 'request_pool_creation')![1] as Record<string, unknown>
    expect(Object.keys(args)).toEqual(['p_note'])
    expect(flow.request.value?.status).toBe('pending')
    expect(flow.notice.value).toBe('Solicitud enviada.')
  })

  it('sends a null note when the user writes none', async () => {
    const { flow, rpc } = setup({ my_pool_creation_request: () => ok(null), request_pool_creation: () => ok(row()) })
    await flow.load()
    await flow.submit('   ')
    expect(rpc).toHaveBeenCalledWith('request_pool_creation', { p_note: null })
  })

  it('does not call the server with an oversized note', async () => {
    const { flow, rpc } = setup({ my_pool_creation_request: () => ok(null), request_pool_creation: () => ok(row()) })
    await flow.load()
    expect(await flow.submit('x'.repeat(501))).toBe(false)
    expect(flow.error.value).toMatch(/500/)
    expect(rpc.mock.calls.filter(([fn]) => fn === 'request_pool_creation')).toHaveLength(0)
  })

  it('blocks resubmission while a request is pending (no second RPC call)', async () => {
    const { flow, rpc } = setup({ my_pool_creation_request: () => ok(row()), request_pool_creation: () => ok(row({ created: false })) })
    await flow.load()
    expect(await flow.submit('otra')).toBe(false)
    expect(rpc.mock.calls.filter(([fn]) => fn === 'request_pool_creation')).toHaveLength(0)
  })

  it('shows the idempotent answer (created:false) honestly', async () => {
    const { flow } = setup({ my_pool_creation_request: () => ok(null), request_pool_creation: () => ok(row({ created: false })) })
    await flow.load()
    expect(await flow.submit('')).toBe(true)
    expect(flow.notice.value).toMatch(/Ya tenías una solicitud pendiente/)
  })

  it('allows a new request after a rejection or cancellation, but not after an approval', async () => {
    for (const [status, allowed] of [['rejected', true], ['cancelled', true], ['approved', false]] as const) {
      const { flow } = setup({ my_pool_creation_request: () => ok(row({ status, reviewed_at: '2026-10-13T10:00:00Z' })) })
      await flow.load()
      expect(flow.canSubmit.value, status).toBe(allowed)
    }
  })

  it('cancels a pending request', async () => {
    const { flow, rpc } = setup({ my_pool_creation_request: () => ok(row()), cancel_pool_creation_request: () => ok(row({ status: 'cancelled', created: undefined })) })
    await flow.load()
    expect(await flow.cancel()).toBe(true)
    expect(rpc).toHaveBeenCalledWith('cancel_pool_creation_request', undefined)
    expect(flow.request.value?.status).toBe('cancelled')
    expect(flow.canSubmit.value).toBe(true)
  })

  it('does not call cancel when there is nothing pending', async () => {
    const { flow, rpc } = setup({ my_pool_creation_request: () => ok(null), cancel_pool_creation_request: () => ok(row({ status: 'cancelled' })) })
    await flow.load()
    expect(await flow.cancel()).toBe(false)
    expect(rpc.mock.calls.filter(([fn]) => fn === 'cancel_pool_creation_request')).toHaveLength(0)
  })

  it('degrades gracefully when the RPC does not exist (PGRST202 and 42883)', async () => {
    for (const code of ['PGRST202', '42883']) {
      const { flow } = setup({ my_pool_creation_request: () => fail(code, 'Could not find the function') })
      await flow.load()
      expect(flow.availability.value).toBe('unavailable')
      expect(flow.unavailableReason.value).toBe('unavailable')
      expect(flow.canSubmit.value).toBe(false)
      expect(flow.error.value).toBe('')
    }
  })

  it('degrades gracefully on a network failure, thrown or reported', async () => {
    const thrown = setup({ my_pool_creation_request: () => { throw new TypeError('Failed to fetch') } })
    await thrown.flow.load()
    expect(thrown.flow.availability.value).toBe('unavailable')
    expect(thrown.flow.unavailableReason.value).toBe('network')
    const reported = setup({ my_pool_creation_request: () => fail('', 'TypeError: Failed to fetch') })
    await reported.flow.load()
    expect(reported.flow.unavailableReason.value).toBe('network')
  })

  it('recovers when a retry after a network failure succeeds', async () => {
    let attempts = 0
    const { flow } = setup({ my_pool_creation_request: () => (attempts++ === 0 ? fail('', 'Failed to fetch') : ok(null)) })
    await flow.load()
    expect(flow.availability.value).toBe('unavailable')
    await flow.load()
    expect(flow.availability.value).toBe('available')
    expect(flow.canSubmit.value).toBe(true)
  })

  it('maps already_organizer (P0001) without enabling resubmission', async () => {
    const { flow } = setup({ my_pool_creation_request: () => ok(null), request_pool_creation: () => fail('P0001', 'already_organizer') })
    await flow.load()
    expect(await flow.submit('x')).toBe(false)
    expect(flow.alreadyOrganizer.value).toBe(true)
    expect(flow.error.value).toMatch(/Ya administras/)
    expect(flow.canSubmit.value).toBe(false)
  })

  it('maps 22023 and 28000 to friendly messages and keeps the function available', async () => {
    for (const [code, pattern] of [['22023', /nota no es válida/], ['28000', /sesión expiró/]] as const) {
      const { flow } = setup({ my_pool_creation_request: () => ok(null), request_pool_creation: () => fail(code, 'raw server text') })
      await flow.load()
      await flow.submit('x')
      expect(flow.error.value).toMatch(pattern)
      expect(flow.error.value).not.toContain('raw server text')
      expect(flow.availability.value).toBe('available')
    }
  })

  it('rejects a malformed submit answer instead of pretending success', async () => {
    const { flow } = setup({ my_pool_creation_request: () => ok(null), request_pool_creation: () => ok({ status: 'approved' }) })
    await flow.load()
    expect(await flow.submit('x')).toBe(false)
    expect(flow.request.value).toBeNull()
    expect(flow.error.value).not.toBe('')
  })

  it('tolerates the extra jsonb fields of the final contract (note, review_note, tenant_id) and never sends them back', async () => {
    const extended = row({ note: 'mi nota', review_note: 'ok', tenant_id: '11111111-1111-1111-1111-111111111111', futuro: 1 })
    const { flow, rpc } = setup({ my_pool_creation_request: () => ok(extended), request_pool_creation: () => ok(extended) })
    await flow.load()
    expect(flow.request.value).toMatchObject({ id: 'r1', status: 'pending' })
    expect(Object.keys(flow.request.value!).sort()).toEqual(['created', 'id', 'requested_at', 'reviewed_at', 'status'])
    expect(rpc).not.toHaveBeenCalledWith('request_pool_creation', expect.anything())
  })

  it('cooldown_active (rejected < 7 days ago): explains it, reads retry_after from the DETAIL and blocks resubmission until then', async () => {
    const retryAfter = new Date(Date.now() + 3 * 86_400_000).toISOString()
    const { flow } = setup({ my_pool_creation_request: () => ok(row({ status: 'rejected' })), request_pool_creation: () => ({ data: null, error: { code: 'P0001', message: 'cooldown_active', details: `retry_after=${retryAfter}` } }) })
    await flow.load()
    expect(flow.canSubmit.value).toBe(true)
    expect(await flow.submit('x')).toBe(false)
    expect(flow.error.value).toMatch(/Podrás enviar otra a partir del/)
    expect(flow.cooldownUntil.value).toBe(retryAfter)
    expect(flow.canSubmit.value).toBe(false)
    expect(flow.availability.value).toBe('available')
  })

  it('cooldown_active without a parsable DETAIL still explains the wait', async () => {
    const { flow } = setup({ my_pool_creation_request: () => ok(null), request_pool_creation: () => fail('P0001', 'cooldown_active') })
    await flow.load()
    await flow.submit('x')
    expect(flow.error.value).toMatch(/en unos días/)
    expect(flow.cooldownUntil.value).toBeNull()
  })

  it('rate_limited shows the generic message', async () => {
    const { flow } = setup({ my_pool_creation_request: () => ok(null), request_pool_creation: () => fail('P0001', 'rate_limited') })
    await flow.load()
    await flow.submit('x')
    expect(flow.error.value).toBe('Demasiados intentos, inténtalo más tarde.')
    expect(flow.availability.value).toBe('available')
  })

  it('profile_required asks to complete the profile', async () => {
    const { flow } = setup({ my_pool_creation_request: () => ok(null), request_pool_creation: () => fail('P0001', 'profile_required') })
    await flow.load()
    await flow.submit('x')
    expect(flow.error.value).toMatch(/Completa tu perfil/)
  })

  it('no_pending_request on cancel refreshes the state from the server', async () => {
    let calls = 0
    const { flow, rpc } = setup({
      my_pool_creation_request: () => (calls++ === 0 ? ok(row()) : ok(row({ status: 'cancelled' }))),
      cancel_pool_creation_request: () => fail('P0001', 'no_pending_request'),
    })
    await flow.load()
    expect(await flow.cancel()).toBe(false)
    expect(rpc.mock.calls.filter(([fn]) => fn === 'my_pool_creation_request')).toHaveLength(2)
    expect(flow.request.value?.status).toBe('cancelled')
    expect(flow.hasPending.value).toBe(false)
    expect(flow.error.value).toBe('')
  })

  it('an approved request only asks the user to reopen the app; it grants nothing by itself', async () => {
    const { flow } = setup({ my_pool_creation_request: () => ok(row({ status: 'approved', tenant_id: 'abc' })) })
    await flow.load()
    expect(flow.request.value?.status).toBe('approved')
    expect(flow.canSubmit.value).toBe(false)
  })
})
