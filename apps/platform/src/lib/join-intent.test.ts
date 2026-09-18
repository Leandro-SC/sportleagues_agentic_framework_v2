import { describe, expect, it } from 'vitest'
import { clearJoinIntent, normalizeJoinCode, saveJoinIntent, takeJoinIntent } from './join-intent'

describe('join intent', () => {
  it('normalizes only the opaque six-character code', () => { expect(normalizeJoinCode(' ab12cd ')).toBe('AB12CD'); expect(normalizeJoinCode('tenant-a')).toBeNull() })
  it('persists and consumes no authorization state', () => { sessionStorage.clear(); saveJoinIntent('AB12CD'); expect([...Array(sessionStorage.length)].map((_, index) => sessionStorage.key(index))).toEqual(['sportleagues.join-code']); expect(takeJoinIntent()).toBe('AB12CD'); expect(takeJoinIntent()).toBeNull(); expect(sessionStorage.getItem('sportleagues.join-code')).toBeNull() })
  it('clears a pending intent on logout', () => { saveJoinIntent('AB12CD'); clearJoinIntent(); expect(sessionStorage.length).toBe(0) })
})
