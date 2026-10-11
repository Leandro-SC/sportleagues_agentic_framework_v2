import { beforeEach, describe, expect, it } from 'vitest'
import { authStorage, getRememberSession, setRememberSession } from './session-storage'

beforeEach(() => { localStorage.clear(); sessionStorage.clear() })

describe('remember-me session storage', () => {
  it('remembers by default and persists the session in localStorage', () => {
    expect(getRememberSession()).toBe(true)
    authStorage.setItem('sb-token', 'v1')
    expect(localStorage.getItem('sb-token')).toBe('v1')
    expect(sessionStorage.getItem('sb-token')).toBeNull()
    expect(authStorage.getItem('sb-token')).toBe('v1')
  })

  it('keeps the session only in sessionStorage when the user opts out, and moves an existing one', () => {
    authStorage.setItem('sb-token', 'v1')
    setRememberSession(false)
    authStorage.setItem('sb-token', 'v2')
    expect(localStorage.getItem('sb-token')).toBeNull()
    expect(sessionStorage.getItem('sb-token')).toBe('v2')
    expect(authStorage.getItem('sb-token')).toBe('v2')
  })

  it('removes the session from both stores', () => {
    authStorage.setItem('sb-token', 'v1')
    sessionStorage.setItem('sb-token', 'v1')
    authStorage.removeItem('sb-token')
    expect(authStorage.getItem('sb-token')).toBeNull()
  })

  it('never throws when storage is unavailable', () => {
    const original = Storage.prototype.getItem
    Storage.prototype.getItem = () => { throw new Error('blocked') }
    try {
      expect(getRememberSession()).toBe(true)
      expect(authStorage.getItem('x')).toBeNull()
    } finally {
      Storage.prototype.getItem = original
    }
  })
})
