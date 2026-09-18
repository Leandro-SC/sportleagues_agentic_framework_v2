import { describe, expect, it, vi } from 'vitest'
import { useTenantAdminAccess, type TenantAdminAccessClient } from './useTenantAdminAccess'

function clientReturning(result: { data: { role: 'owner' | 'admin' | 'member' }[] | null; error: { message: string } | null }): TenantAdminAccessClient {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue(result),
        })),
      })),
    })),
  }
}

describe('useTenantAdminAccess', () => {
  it('grants access for a tenant owner', async () => {
    const access = useTenantAdminAccess(() => clientReturning({ data: [{ role: 'owner' }], error: null }))

    const allowed = await access.checkAccess('profile-owner')

    expect(allowed).toBe(true)
    expect(access.hasTenantAdminAccess.value).toBe(true)
  })

  it('grants access for a tenant admin', async () => {
    const access = useTenantAdminAccess(() => clientReturning({ data: [{ role: 'admin' }], error: null }))

    const allowed = await access.checkAccess('profile-admin')

    expect(allowed).toBe(true)
  })

  it('denies access for a member', async () => {
    const access = useTenantAdminAccess(() => clientReturning({ data: [{ role: 'member' }], error: null }))

    const allowed = await access.checkAccess('profile-member')

    expect(allowed).toBe(false)
  })

  it('denies access for an authenticated user with no tenant memberships at all', async () => {
    const access = useTenantAdminAccess(() => clientReturning({ data: [], error: null }))

    const allowed = await access.checkAccess('profile-no-tenant')

    expect(allowed).toBe(false)
  })

  it('denies access for a platform admin with no tenant memberships (platform role never enters this query)', async () => {
    // This composable never reads platform_admins or is_platform_admin(): a platform admin with
    // zero tenant memberships looks identical to any other user with zero memberships here.
    const access = useTenantAdminAccess(() => clientReturning({ data: [], error: null }))

    const allowed = await access.checkAccess('profile-platform-admin-no-tenant')

    expect(allowed).toBe(false)
  })

  it('grants access when a membership exists, independent of any platform-admin status (platform admin + owner)', async () => {
    const access = useTenantAdminAccess(() => clientReturning({ data: [{ role: 'owner' }], error: null }))

    const allowed = await access.checkAccess('profile-platform-admin-and-owner')

    expect(allowed).toBe(true)
  })

  it('fails closed on a backend error', async () => {
    const access = useTenantAdminAccess(() => clientReturning({ data: null, error: { message: 'permission denied' } }))

    const allowed = await access.checkAccess('profile-a')

    expect(allowed).toBe(false)
    expect(access.error.value).not.toBe('')
  })

  it('fails closed when the client throws before returning a response', async () => {
    const access = useTenantAdminAccess(() => { throw new Error('client unavailable') })

    const allowed = await access.checkAccess('profile-a')

    expect(allowed).toBe(false)
    expect(access.hasTenantAdminAccess.value).toBe(false)
  })

  it('sets loading synchronously before the query resolves, so a guard can block on it', async () => {
    const access = useTenantAdminAccess(() => clientReturning({ data: [{ role: 'owner' }], error: null }))

    const pending = access.checkAccess('profile-owner')
    expect(access.loading.value).toBe(true)
    await pending

    expect(access.loading.value).toBe(false)
  })
})
