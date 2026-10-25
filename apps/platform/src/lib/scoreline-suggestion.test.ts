import { describe, expect, it } from 'vitest'
import { describeSuggestionError, isSuggestionUnavailable, parseSuggestion, percent } from './scoreline-suggestion'

const ok = { home_goals: 2, away_goals: 1, p_home: 0.5, p_draw: 0.27, p_away: 0.23, rated: true, model_version: 'elo-poisson-v1', computed_at: '2026-10-12T10:00:00Z', lambda_home: 1.6, lambda_away: 1.1 }

describe('parseSuggestion', () => {
  it('acepta la respuesta del contrato', () => {
    expect(parseSuggestion(ok)).toMatchObject({ homeGoals: 2, awayGoals: 1, pHome: 0.5, rated: true, modelVersion: 'elo-poisson-v1' })
  })
  it('acepta numéricos serializados como texto', () => {
    expect(parseSuggestion({ ...ok, p_home: '0.5' })?.pHome).toBe(0.5)
  })
  it('rechaza formas inválidas sin lanzar', () => {
    expect(parseSuggestion(null)).toBeNull()
    expect(parseSuggestion('x')).toBeNull()
    expect(parseSuggestion({ ...ok, home_goals: -1 })).toBeNull()
    expect(parseSuggestion({ ...ok, away_goals: 1.5 })).toBeNull()
    expect(parseSuggestion({ ...ok, home_goals: 120 })).toBeNull()
    expect(parseSuggestion({ ...ok, p_draw: 2 })).toBeNull()
    expect(parseSuggestion({ ...ok, p_away: undefined })).toBeNull()
  })
  it('rated solo es true si el servidor lo afirma', () => {
    expect(parseSuggestion({ ...ok, rated: 'true' })?.rated).toBe(false)
    expect(parseSuggestion({ ...ok, rated: false })?.rated).toBe(false)
  })
})

describe('errores', () => {
  it('detecta RPC no disponible (migración sin aplicar)', () => {
    expect(isSuggestionUnavailable({ code: 'PGRST202' })).toBe(true)
    expect(isSuggestionUnavailable({ code: '42883' })).toBe(true)
    expect(isSuggestionUnavailable({ message: 'Could not find the function public.suggest_scoreline in the schema cache' })).toBe(true)
    expect(isSuggestionUnavailable({ code: '42501' })).toBe(false)
  })
  it('traduce cada hint del contrato', () => {
    expect(describeSuggestionError({ code: '42501', hint: 'STATS_LOCKED' }).message).toMatch(/cerró/)
    expect(describeSuggestionError({ code: '42501', hint: 'STATS_NOT_ELIGIBLE' }).message).toMatch(/aprobados/)
    expect(describeSuggestionError({ code: '42501', hint: 'ADMIN_PARTICIPANT_INCOMPATIBLE' }).message).toMatch(/administra/)
    expect(describeSuggestionError({ code: '22023', hint: 'STATS_UNSUPPORTED_SPORT' }).message).toMatch(/deporte/)
    expect(describeSuggestionError({ code: '22023', hint: 'STATS_NOT_FOUND' }).message).toMatch(/No encontramos/)
    expect(describeSuggestionError({ code: '28000' }).message).toMatch(/Inicia sesión/)
    expect(describeSuggestionError({ code: 'XX000' })).toEqual({ message: 'No pudimos calcular la sugerencia. Inténtalo de nuevo.', unavailable: false })
  })
  it('marca unavailable solo cuando el RPC no existe', () => {
    expect(describeSuggestionError({ code: 'PGRST202' }).unavailable).toBe(true)
    expect(describeSuggestionError({ code: '42501', hint: 'STATS_LOCKED' }).unavailable).toBe(false)
  })
})

describe('percent', () => {
  it('redondea a porcentaje entero', () => {
    expect(percent(0.456)).toBe('46%')
    expect(percent(0)).toBe('0%')
  })
})
