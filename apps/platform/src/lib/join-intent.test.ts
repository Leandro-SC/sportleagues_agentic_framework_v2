import { beforeEach, describe, expect, it } from 'vitest'
import { JOIN_INTENT_TTL_MS, clearJoinIntent, normalizeJoinCode, peekJoinIntent, saveJoinIntent, takeJoinIntent } from './join-intent'

const KEY = 'sportleagues.join-code'

beforeEach(() => { localStorage.clear(); sessionStorage.clear() })

describe('join intent', () => {
  it('normalizes only the opaque six-character code', () => {
    expect(normalizeJoinCode(' ab12cd ')).toBe('AB12CD')
    expect(normalizeJoinCode('tenant-a')).toBeNull()
  })

  it('persists only the opaque code and a timestamp, and consumes it once', () => {
    saveJoinIntent('ab12cd', 1000)
    expect(Object.keys(JSON.parse(localStorage.getItem(KEY)!)).sort()).toEqual(['at', 'code'])
    expect(peekJoinIntent(1000)).toBe('AB12CD')
    expect(takeJoinIntent(1000)).toBe('AB12CD')
    expect(takeJoinIntent(1000)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('survives a different tab (localStorage) and expires after 24 hours', () => {
    saveJoinIntent('AB12CD', 1000)
    expect(peekJoinIntent(1000 + JOIN_INTENT_TTL_MS)).toBe('AB12CD')
    expect(takeJoinIntent(1000 + JOIN_INTENT_TTL_MS + 1)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('discards corrupt or tampered values instead of throwing', () => {
    localStorage.setItem(KEY, '{not json')
    expect(takeJoinIntent()).toBeNull()
    localStorage.setItem(KEY, JSON.stringify({ code: 'tenant-a', at: Date.now() }))
    expect(takeJoinIntent()).toBeNull()
    localStorage.setItem(KEY, JSON.stringify({ code: 'AB12CD', at: Date.now() + 10 * JOIN_INTENT_TTL_MS }))
    expect(takeJoinIntent()).toBeNull()
  })

  it('still reads an intent stored by the previous sessionStorage version', () => {
    sessionStorage.setItem(KEY, 'ab12cd')
    expect(takeJoinIntent()).toBe('AB12CD')
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('rejects an invalid code and clears a pending intent on logout', () => {
    expect(() => saveJoinIntent('nope')).toThrow()
    saveJoinIntent('AB12CD')
    clearJoinIntent()
    expect(localStorage.length + sessionStorage.length).toBe(0)
  })
})
