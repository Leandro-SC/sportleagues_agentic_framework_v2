import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase', () => ({ getSupabaseClient: () => ({ rpc }) }))

import { saveJoinIntent } from '../lib/join-intent'
import { useJoinPool } from './useJoinPool'

const KEY = 'sportleagues.join-code'
const OK = { data: { pool_id: 'p1', tenant_id: 't1', id: 'x', approval_status: 'approved' }, error: null }

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); rpc.mockReset() })

describe('pending invitation after sign-in', () => {
  it('joins with the stored code and removes it once the join succeeds', async () => {
    saveJoinIntent('ab12cd')
    rpc.mockResolvedValue(OK)
    const joiner = useJoinPool()
    expect((await joiner.resumeIntent())?.pool_id).toBe('p1')
    expect(rpc).toHaveBeenCalledWith('join_pool', { p_code: 'AB12CD' })
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('does not join twice with the same invitation', async () => {
    saveJoinIntent('AB12CD')
    rpc.mockResolvedValue(OK)
    const joiner = useJoinPool()
    await joiner.resumeIntent()
    expect(await joiner.resumeIntent()).toBeNull()
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('does nothing without a pending invitation', async () => {
    expect(await useJoinPool().resumeIntent()).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('keeps the invitation after a transient network failure so it can be retried', async () => {
    saveJoinIntent('AB12CD')
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'TypeError: Failed to fetch' } })
    const joiner = useJoinPool()
    expect(await joiner.resumeIntent()).toBeNull()
    expect(joiner.transientFailure.value).toBe(true)
    expect(JSON.parse(localStorage.getItem(KEY)!).code).toBe('AB12CD')
    rpc.mockResolvedValueOnce(OK)
    expect((await useJoinPool().resumeIntent())?.pool_id).toBe('p1')
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('keeps the invitation when the request throws before reaching the server', async () => {
    saveJoinIntent('AB12CD')
    rpc.mockRejectedValueOnce(new TypeError('network down'))
    expect(await useJoinPool().resumeIntent()).toBeNull()
    expect(localStorage.getItem(KEY)).not.toBeNull()
  })

  it('consumes the invitation even if the join is rejected, so a bad code is never retried in a loop', async () => {
    saveJoinIntent('AB12CD')
    rpc.mockResolvedValue({ data: null, error: { message: 'invalid or expired code', code: 'P0001' } })
    const joiner = useJoinPool()
    expect(await joiner.resumeIntent()).toBeNull()
    expect(joiner.error.value).toMatch(/no es válido|expiró/)
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})
