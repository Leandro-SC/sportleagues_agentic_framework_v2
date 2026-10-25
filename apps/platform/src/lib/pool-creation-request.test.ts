import { describe, expect, it } from 'vitest'
import {
  STATUS_COPY, extractRetryAfter, POOL_REQUEST_NOTE_MAX, POOL_REQUEST_UNAVAILABLE_MESSAGE, classifyPoolCreationError, humanizePoolCreationError, isRpcMissing, normalizePoolRequestNote, parsePoolCreationRequest,
} from './pool-creation-request'

describe('normalizePoolRequestNote', () => {
  it('treats empty or whitespace-only notes as no note', () => {
    expect(normalizePoolRequestNote('')).toEqual({ note: null, error: null })
    expect(normalizePoolRequestNote('   \n  ')).toEqual({ note: null, error: null })
  })
  it('trims and strips control characters', () => {
    expect(normalizePoolRequestNote('  Quiero organizar la liga\u0000 de mi barrio \u0007 ').note).toBe('Quiero organizar la liga de mi barrio')
  })
  it('accepts exactly 500 characters and rejects 501 (counting code points, not UTF-16 units)', () => {
    expect(normalizePoolRequestNote('a'.repeat(POOL_REQUEST_NOTE_MAX)).error).toBeNull()
    expect(normalizePoolRequestNote('a'.repeat(POOL_REQUEST_NOTE_MAX + 1)).error).toMatch(/500/)
    expect(normalizePoolRequestNote('⚽'.repeat(POOL_REQUEST_NOTE_MAX)).error).toBeNull()
  })
})

describe('parsePoolCreationRequest', () => {
  const valid = { id: 'r1', status: 'pending', created: true, requested_at: '2026-10-12T10:00:00Z', reviewed_at: null }
  it('parses a valid server payload', () => {
    expect(parsePoolCreationRequest(valid)).toEqual(valid)
    expect(parsePoolCreationRequest({ ...valid, status: 'approved', created: undefined, reviewed_at: '2026-10-13T10:00:00Z' })).toMatchObject({ status: 'approved', created: null, reviewed_at: '2026-10-13T10:00:00Z' })
  })
  it('returns null for null, malformed or unknown-status payloads', () => {
    expect(parsePoolCreationRequest(null)).toBeNull()
    expect(parsePoolCreationRequest('x')).toBeNull()
    expect(parsePoolCreationRequest({ ...valid, status: 'superadmin' })).toBeNull()
    expect(parsePoolCreationRequest({ ...valid, id: '' })).toBeNull()
    expect(parsePoolCreationRequest({ ...valid, requested_at: 'ayer' })).toBeNull()
  })
})

describe('error classification', () => {
  it('detects a missing RPC (PGRST202 / 42883) and network failures', () => {
    expect(isRpcMissing({ code: 'PGRST202', message: 'x' })).toBe(true)
    expect(isRpcMissing({ code: '42883', message: 'function does not exist' })).toBe(true)
    expect(isRpcMissing({ code: 'P0001', message: 'already_organizer' })).toBe(false)
    expect(classifyPoolCreationError({ code: 'PGRST202' })).toBe('unavailable')
    expect(classifyPoolCreationError({ code: '', message: 'TypeError: Failed to fetch' })).toBe('network')
    expect(classifyPoolCreationError(new TypeError('Failed to fetch'))).toBe('network')
  })
  it('maps the documented contract errors', () => {
    expect(classifyPoolCreationError({ code: 'P0001', message: 'already_organizer' })).toBe('already_organizer')
    expect(classifyPoolCreationError({ code: '22023', message: 'note too long' })).toBe('invalid_note')
    expect(classifyPoolCreationError({ code: '28000', message: 'no session' })).toBe('no_session')
    expect(classifyPoolCreationError({ code: 'P0001', message: 'cooldown_active' })).toBe('cooldown_active')
    expect(classifyPoolCreationError({ code: 'P0001', message: 'rate_limited' })).toBe('rate_limited')
    expect(classifyPoolCreationError({ code: 'P0001', message: 'profile_required' })).toBe('profile_required')
    expect(classifyPoolCreationError({ code: 'P0001', message: 'no_pending_request' })).toBe('no_pending_request')
    expect(classifyPoolCreationError({ code: '22023', message: 'note_too_long' })).toBe('invalid_note')
    expect(classifyPoolCreationError({ code: 'XX000', message: 'raro' })).toBe('unknown')
  })
  it('never leaks the server message in user-facing text', () => {
    for (const kind of ['unavailable', 'network', 'already_organizer', 'cooldown_active', 'rate_limited', 'profile_required', 'no_pending_request', 'invalid_note', 'no_session', 'unknown'] as const) {
      expect(humanizePoolCreationError(kind)).not.toMatch(/P0001|22023|28000|PGRST|SQLSTATE/)
    }
    expect(humanizePoolCreationError('unavailable')).toBe(POOL_REQUEST_UNAVAILABLE_MESSAGE)
  })
})

describe('extractRetryAfter and approved copy', () => {
  it('reads retry_after from the DETAIL, and ignores garbage', () => {
    expect(extractRetryAfter({ details: 'retry_after=2026-10-20T10:00:00+00:00' })).toBe('2026-10-20T10:00:00+00:00')
    expect(extractRetryAfter({ details: 'retry_after: 2026-10-20 10:00:00Z' })).toBe('2026-10-20T10:00:00Z')
    expect(extractRetryAfter({ details: 'retry_after=mañana' })).toBeNull()
    expect(extractRetryAfter({})).toBeNull()
  })
  it('the approved copy tells the user to reopen the app and says access comes from the membership', () => {
    expect(STATUS_COPY.approved.detail).toMatch(/vuelve a abrir la app/)
    expect(STATUS_COPY.approved.detail).toMatch(/membresía/)
  })
})
