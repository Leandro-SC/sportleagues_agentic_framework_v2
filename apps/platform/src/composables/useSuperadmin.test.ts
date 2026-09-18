import { describe, expect, it, vi } from 'vitest'
import { useSuperadmin, type SuperadminClient } from './useSuperadmin'

function clientReturning(result: { data: boolean | null; error: { message: string } | null }): { client: SuperadminClient; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn().mockResolvedValue(result)
  return { client: { rpc }, rpc }
}

describe('useSuperadmin', () => {
  it('grants access when the RPC confirms an active platform admin', async () => {
    const { client } = clientReturning({ data: true, error: null })
    const superadmin = useSuperadmin(() => client)

    const allowed = await superadmin.checkAccess()

    expect(allowed).toBe(true)
    expect(superadmin.isPlatformAdmin.value).toBe(true)
    expect(superadmin.loading.value).toBe(false)
    expect(superadmin.error.value).toBe('')
  })

  it('denies access for a signed-in user who is not a platform admin', async () => {
    const { client } = clientReturning({ data: false, error: null })
    const superadmin = useSuperadmin(() => client)

    const allowed = await superadmin.checkAccess()

    expect(allowed).toBe(false)
    expect(superadmin.isPlatformAdmin.value).toBe(false)
  })

  it('fails closed on a backend error without leaking technical detail', async () => {
    const { client } = clientReturning({ data: null, error: { message: 'permission denied for table platform_admins' } })
    const superadmin = useSuperadmin(() => client)

    const allowed = await superadmin.checkAccess()

    expect(allowed).toBe(false)
    expect(superadmin.isPlatformAdmin.value).toBe(false)
    expect(superadmin.error.value).not.toContain('platform_admins')
  })

  it('fails closed when the client throws before returning a response', async () => {
    const superadmin = useSuperadmin(() => { throw new Error('client unavailable') })

    const allowed = await superadmin.checkAccess()

    expect(allowed).toBe(false)
    expect(superadmin.isPlatformAdmin.value).toBe(false)
    expect(superadmin.error.value).toBe('No fue posible verificar el acceso.')
  })

  it('never asks about an identity other than the current session (no user id parameter exists to pass)', async () => {
    const { client, rpc } = clientReturning({ data: true, error: null })
    const superadmin = useSuperadmin(() => client)

    await superadmin.checkAccess()

    expect(rpc).toHaveBeenCalledWith('is_platform_admin')
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
