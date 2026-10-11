import { describe, expect, it, vi } from 'vitest'
import { useMyPools, type MyPoolsClient } from './useMyPools'

type Result<T> = { data: T | null; error: { message: string } | null }

function fakeClient(participants: Result<Array<{ pool_id: string; approval_status: 'pending' | 'approved' }>>, pools: Result<Array<{ id: string; name: string; status: 'open' | 'archived' }>>) {
  const participantEq = vi.fn().mockResolvedValue(participants)
  const poolsIn = vi.fn().mockResolvedValue(pools)
  const client = {
    from: vi.fn((table: string) => table === 'participants'
      ? { select: vi.fn(() => ({ eq: participantEq })) }
      : { select: vi.fn(() => ({ in: poolsIn })) }),
  } as unknown as MyPoolsClient
  return { client, participantEq, poolsIn }
}

describe('useMyPools', () => {
  it('loads the session user participations and their pools, sorted by name', async () => {
    const { client, participantEq, poolsIn } = fakeClient(
      { data: [{ pool_id: 'p2', approval_status: 'pending' }, { pool_id: 'p1', approval_status: 'approved' }], error: null },
      { data: [{ id: 'p2', name: 'Zeta', status: 'open' }, { id: 'p1', name: 'Alfa', status: 'open' }], error: null },
    )
    const myPools = useMyPools(() => client)
    await myPools.load('profile-1')

    expect(participantEq).toHaveBeenCalledWith('profile_id', 'profile-1')
    expect(poolsIn).toHaveBeenCalledWith('id', ['p2', 'p1'])
    expect(myPools.pools.value).toEqual([
      { id: 'p1', name: 'Alfa', status: 'open', approval_status: 'approved' },
      { id: 'p2', name: 'Zeta', status: 'open', approval_status: 'pending' },
    ])
    expect(myPools.error.value).toBe('')
  })

  it('does not query pools when the user has no participations', async () => {
    const { client, poolsIn } = fakeClient({ data: [], error: null }, { data: [], error: null })
    const myPools = useMyPools(() => client)
    await myPools.load('profile-1')
    expect(poolsIn).not.toHaveBeenCalled()
    expect(myPools.pools.value).toEqual([])
    expect(myPools.loading.value).toBe(false)
  })

  it('drops pools that RLS hides even if a participant row exists', async () => {
    const { client } = fakeClient(
      { data: [{ pool_id: 'visible', approval_status: 'approved' }, { pool_id: 'hidden', approval_status: 'approved' }], error: null },
      { data: [{ id: 'visible', name: 'Visible', status: 'open' }], error: null },
    )
    const myPools = useMyPools(() => client)
    await myPools.load('profile-1')
    expect(myPools.pools.value.map((pool) => pool.id)).toEqual(['visible'])
  })

  it('shows a generic error without leaking the database message', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'permission denied for table participants' } }, { data: [], error: null })
    const myPools = useMyPools(() => client)
    await myPools.load('profile-1')
    expect(myPools.error.value).toBe('No pudimos cargar tus ligas. Inténtalo de nuevo.')
    expect(myPools.pools.value).toEqual([])
  })

  it('does nothing without a session user', async () => {
    const factory = vi.fn()
    const myPools = useMyPools(factory)
    await myPools.load(null)
    expect(factory).not.toHaveBeenCalled()
  })
})
