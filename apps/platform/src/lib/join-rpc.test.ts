import { describe, expect, it, vi } from 'vitest'
import { requestJoinPool } from './join-rpc'

const existingParticipant = { id: 'participant-a', tenant_id: 'tenant-a', pool_id: 'pool-a', approval_status: 'approved' as const }

describe('join_pool client boundary', () => {
  it('rejects an invalid code before RPC and never inserts memberships directly', async () => {
    const rpc = vi.fn()
    await expect(requestJoinPool({ rpc }, 'not-a-code')).resolves.toEqual({ data: null, error: 'El código de unión no es válido.' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('uses only join_pool and preserves a repeated server result', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: existingParticipant, error: null })
    await expect(requestJoinPool({ rpc }, 'alpha1')).resolves.toEqual({ data: existingParticipant, error: null })
    await expect(requestJoinPool({ rpc }, 'ALPHA1')).resolves.toEqual({ data: existingParticipant, error: null })
    expect(rpc).toHaveBeenNthCalledWith(1, 'join_pool', { p_code: 'ALPHA1' })
    expect(rpc).toHaveBeenNthCalledWith(2, 'join_pool', { p_code: 'ALPHA1' })
  })
})
