import { describe, expect, it } from 'vitest'
import { lockAt, lockLabel, lockState, parseIntervalMinutes, parseScoreInput } from './prediction-ux'

const startsAt = '2026-10-05T20:00:00.000Z'
const at = (isoTime: string) => new Date(`2026-10-05T${isoTime}.000Z`)

describe('parseIntervalMinutes (pools.lock_offset)', () => {
  it.each([
    ['00:00:00', 0],
    ['00:30:00', 30],
    ['01:00:00', 60],
    ['1 day', 1440],
    ['1 day 02:00:00', 1560],
    ['2 days 00:15:00', 2895],
    ['  00:45:00  ', 45],
  ])('parses %s as %i minutes', (value, expected) => {
    expect(parseIntervalMinutes(value)).toBe(expected)
  })

  it.each(['', 'P0DT0H30M0S', '30 minutes', '1 mon', 'abc', '00:61:00', null, undefined])('does not guess for %s', (value) => {
    expect(parseIntervalMinutes(value as string | null | undefined)).toBeNull()
  })
})

describe('lock state mirrors the contract (UI hint only)', () => {
  it('is open before lock_at and locked from lock_at inclusive', () => {
    expect(lockAt(startsAt, 30).toISOString()).toBe('2026-10-05T19:30:00.000Z')
    expect(lockState({ starts_at: startsAt, status: 'scheduled' }, 30, at('19:29:59'))).toBe('open')
    expect(lockState({ starts_at: startsAt, status: 'scheduled' }, 30, at('19:30:00'))).toBe('locked')
    expect(lockState({ starts_at: startsAt, status: 'scheduled' }, 30, at('21:00:00'))).toBe('locked')
  })

  it('takes live and final from the match, not from the clock', () => {
    expect(lockState({ starts_at: startsAt, status: 'live' }, 0, at('10:00:00'))).toBe('live')
    expect(lockState({ starts_at: startsAt, status: 'final' }, 0, at('10:00:00'))).toBe('final')
  })

  it('treats a zero offset as locking at kickoff', () => {
    expect(lockState({ starts_at: startsAt, status: 'scheduled' }, 0, at('19:59:59'))).toBe('open')
    expect(lockState({ starts_at: startsAt, status: 'scheduled' }, 0, at('20:00:00'))).toBe('locked')
  })
})

describe('lockLabel', () => {
  const closes = lockAt(startsAt, 30)
  it('counts down in minutes, then hours', () => {
    expect(lockLabel('open', closes, at('19:20:00'))).toBe('Cierra en 10 min')
    expect(lockLabel('open', closes, at('19:29:59'))).toBe('Cierra en 1 min')
    expect(lockLabel('open', closes, at('16:30:00'))).toBe('Cierra en 3 h')
    expect(lockLabel('open', closes, at('16:00:00'))).toBe('Cierra en 3 h 30 min')
  })

  it('shows a date when it closes in a day or more and plain text for other states', () => {
    expect(lockLabel('open', new Date(2026, 9, 9, 8, 5), new Date(2026, 9, 5, 8, 0))).toBe('Cierra el 9/10 · 08:05')
    expect(lockLabel('locked', closes, at('20:00:00'))).toBe('Pronósticos cerrados')
    expect(lockLabel('live', closes, at('20:00:00'))).toBe('Partido en juego')
    expect(lockLabel('final', closes, at('23:00:00'))).toBe('Partido finalizado')
  })
})

describe('parseScoreInput', () => {
  it('accepts non-negative whole numbers', () => {
    expect(parseScoreInput('0')).toEqual({ ok: true, value: 0 })
    expect(parseScoreInput(' 12 ')).toEqual({ ok: true, value: 12 })
    expect(parseScoreInput('007')).toEqual({ ok: true, value: 7 })
  })

  it.each(['', '  ', '-1', '1.5', '1,5', 'a', '1e2', '+3'])('rejects %j', (value) => {
    expect(parseScoreInput(value).ok).toBe(false)
  })

  it('caps at 99 as a UX guard and says so', () => {
    expect(parseScoreInput('99')).toEqual({ ok: true, value: 99 })
    expect(parseScoreInput('100')).toEqual({ ok: false, message: 'El marcador máximo es 99.' })
  })
})
