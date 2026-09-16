import { describe, expect, it } from 'vitest'
import { platformAdminRedirect, protectedRouteRedirect, tenantAdminRedirect } from './navigation-guards'

describe('protected route guard', () => {
  it('redirects an unsigned user and a user with no profile', () => {
    expect(protectedRouteRedirect('pool', false, false)).toBe('home')
    expect(protectedRouteRedirect('pool', true, false)).toBe('onboarding')
  })

  it('does not treat tenant or role client state as authorization', () => {
    expect(protectedRouteRedirect('pool', true, true)).toBeNull()
  })
})

describe('platform admin route guard', () => {
  it('rejects an unauthenticated visitor', () => {
    expect(platformAdminRedirect(false, false)).toBe('home')
  })

  it('rejects an authenticated user who is not a platform admin (e.g. a tenant owner or admin)', () => {
    expect(platformAdminRedirect(true, false)).toBe('home')
  })

  it('allows a platform admin, regardless of any tenant membership', () => {
    expect(platformAdminRedirect(true, true)).toBeNull()
  })
})

describe('tenant admin route guard', () => {
  it('rejects an unauthenticated visitor', () => {
    expect(tenantAdminRedirect(false, false)).toBe('home')
  })

  it('rejects an authenticated user with no administrable tenant (e.g. a member, or a platform admin with no tenant)', () => {
    expect(tenantAdminRedirect(true, false)).toBe('home')
  })

  it('allows an owner or admin of at least one active tenant', () => {
    expect(tenantAdminRedirect(true, true)).toBeNull()
  })
})
