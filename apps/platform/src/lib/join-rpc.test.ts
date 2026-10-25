import { describe, expect, it, vi } from 'vitest'
import { requestJoinPool, SESSION_EXPIRED_MESSAGE } from './join-rpc'

const existingParticipant = { id: 'participant-a', tenant_id: 'tenant-a', pool_id: 'pool-a', approval_status: 'approved' as const }

describe('join_pool client boundary', () => {
  it('rejects an invalid code before RPC and never inserts memberships directly', async () => {
    const rpc = vi.fn()
    await expect(requestJoinPool({ rpc }, 'not-a-code')).resolves.toEqual({ data: null, error: 'El código de unión no es válido.' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('flags a network failure as transient but not a server rejection', async () => {
    const offline = vi.fn().mockResolvedValue({ data: null, error: { message: 'TypeError: Failed to fetch' } })
    await expect(requestJoinPool({ rpc: offline }, 'ALPHA1')).resolves.toMatchObject({ data: null, transient: true })
    const thrown = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(requestJoinPool({ rpc: thrown }, 'ALPHA1')).resolves.toMatchObject({ transient: true })
    const rejected = vi.fn().mockResolvedValue({ data: null, error: { message: 'invalid code', code: 'P0001' } })
    const result = await requestJoinPool({ rpc: rejected }, 'ALPHA1')
    expect(result.transient).toBeUndefined()
    expect(result.error).toBe('El código no es válido, expiró o la quiniela no está disponible.')
  })

  it('never forwards the raw server text: unknown SQL errors become a generic friendly message', async () => {
    const raw = 'duplicate key value violates unique constraint "participants_pool_id_profile_id_key"'
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: raw, code: '23505' } })
    const result = await requestJoinPool({ rpc }, 'ALPHA1')
    expect(result.error).toBe('No fue posible unirse a la quiniela. Inténtalo de nuevo.')
    expect(result.error).not.toContain('participants_pool_id_profile_id_key')
  })

  it.each([
    [{ message: 'JWT expired', code: 'PGRST301' }],
    [{ message: 'authentication required', code: '28000' }],
    [{ message: 'JWT expired' }],
  ])('classifies an expired/missing JWT (%j) as a session problem, not as an invalid code', async (error) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error })
    const result = await requestJoinPool({ rpc }, 'ALPHA1')
    expect(result.sessionExpired).toBe(true)
    expect(result.transient).toBeUndefined()
    expect(result.error).toBe(SESSION_EXPIRED_MESSAGE)
    expect(result.error).not.toMatch(/no es válido/)
  })

  it('maps the known domain rejections to specific friendly messages', async () => {
    const run = async (error: { message: string; code?: string; hint?: string }) => (await requestJoinPool({ rpc: vi.fn().mockResolvedValue({ data: null, error }) }, 'ALPHA1')).error
    expect(await run({ message: 'administrators of a pool cannot participate in it', code: '42501', hint: 'ADMIN_PARTICIPANT_INCOMPATIBLE' })).toBe('Quien administra una quiniela no participa en ella.')
    expect(await run({ message: 'a withdrawn participation cannot be resumed', code: '42501', hint: 'WITHDRAWN' })).toMatch(/retiraste/)
    expect(await run({ message: 'free participant limit reached', code: '22023' })).toMatch(/límite de participantes/)
    expect(await run({ message: 'join code is invalid or expired', code: '22023' })).toMatch(/no es válido/)
    expect(await run({ message: 'permission denied for table x', code: '42501' })).toBe('No tienes autorización para unirte a esta quiniela.')
  })

  it('uses only join_pool and preserves a repeated server result', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: existingParticipant, error: null })
    await expect(requestJoinPool({ rpc }, 'alpha1')).resolves.toEqual({ data: existingParticipant, error: null })
    await expect(requestJoinPool({ rpc }, 'ALPHA1')).resolves.toEqual({ data: existingParticipant, error: null })
    expect(rpc).toHaveBeenNthCalledWith(1, 'join_pool', { p_code: 'ALPHA1' })
    expect(rpc).toHaveBeenNthCalledWith(2, 'join_pool', { p_code: 'ALPHA1' })
  })
})
