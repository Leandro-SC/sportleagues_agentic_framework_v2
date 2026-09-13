import { describe, expect, it } from 'vitest'
import { protectedRouteRedirect } from './navigation-guards'

describe('protected route guard', () => {
  it('redirects an unsigned user and a user with no profile', () => {
    expect(protectedRouteRedirect('pool', false, false)).toBe('home')
    expect(protectedRouteRedirect('pool', true, false)).toBe('onboarding')
  })

  it('does not treat tenant or role client state as authorization', () => {
    expect(protectedRouteRedirect('pool', true, true)).toBeNull()
  })
})
