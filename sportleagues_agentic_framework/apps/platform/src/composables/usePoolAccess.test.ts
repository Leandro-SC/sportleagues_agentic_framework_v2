import { describe, expect, it, vi } from 'vitest'
import { usePoolAccess, type PoolAccessClient } from './usePoolAccess'

function clientReturning(result: { data: { id: string; name: string } | null; error: { message: string } | null }): PoolAccessClient {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue(result) })),
      })),
    })),
  }
}

describe('usePoolAccess', () => {
  it('loads and exposes a pool visible through RLS', async () => {
    const client = clientReturning({ data: { id: 'pool-a', name: 'Pool A' }, error: null })
    const access = usePoolAccess(() => client)

    const pending = access.load('pool-a')
    expect(access.loading.value).toBe(true)
    await pending

    expect(access.loading.value).toBe(false)
    expect(access.pool.value).toEqual({ id: 'pool-a', name: 'Pool A' })
    expect(access.denied.value).toBe(false)
  })

  it('shows denied when RLS returns zero rows', async () => {
    const access = usePoolAccess(() => clientReturning({ data: null, error: null }))

    await access.load('pool-b')

    expect(access.loading.value).toBe(false)
    expect(access.pool.value).toBeNull()
    expect(access.denied.value).toBe(true)
  })

  it('exposes a query error and always clears loading', async () => {
    const access = usePoolAccess(() => clientReturning({ data: null, error: { message: 'network error' } }))

    await access.load('pool-a')

    expect(access.loading.value).toBe(false)
    expect(access.error.value).toBe('network error')
    expect(access.denied.value).toBe(false)
  })

  it('settles loading when the client throws before returning a response', async () => {
    const access = usePoolAccess(() => { throw new Error('client unavailable') })

    await access.load('pool-a')

    expect(access.loading.value).toBe(false)
    expect(access.error.value).toBe('No fue posible verificar el acceso a la quiniela.')
  })
})
