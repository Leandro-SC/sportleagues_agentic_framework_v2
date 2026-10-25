// Sugerencia estadística de marcador (Fase 09, ADR-019): ayudas de PRESENTACIÓN sobre el RPC `suggest_scoreline`.
// La autoridad es el servidor (Elo + Poisson en SQL, solo antes del lock, solo participantes elegibles). El cliente únicamente
// rellena el formulario; guardar sigue pasando por `save_prediction` con su propio lock. AGENTS §7: nunca certeza ni apuesta.

export type ScorelineSuggestion = {
  homeGoals: number
  awayGoals: number
  pHome: number
  pDraw: number
  pAway: number
  rated: boolean
  modelVersion: string
  computedAt: string
}

export type SuggestionFailure = { message: string; unavailable: boolean }

export const SUGGESTION_DISCLAIMER = 'Sugerencia estadística (Elo + Poisson): no es una certeza ni una recomendación de apuesta. Tú decides tu pronóstico.'

function num(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

// Valida la forma de la respuesta: un valor inesperado jamás debe rellenar el formulario con basura.
export function parseSuggestion(data: unknown): ScorelineSuggestion | null {
  if (typeof data !== 'object' || data === null) return null
  const r = data as Record<string, unknown>
  const homeGoals = num(r.home_goals); const awayGoals = num(r.away_goals)
  const pHome = num(r.p_home); const pDraw = num(r.p_draw); const pAway = num(r.p_away)
  if (homeGoals === null || awayGoals === null || pHome === null || pDraw === null || pAway === null) return null
  if (!Number.isInteger(homeGoals) || !Number.isInteger(awayGoals) || homeGoals < 0 || awayGoals < 0 || homeGoals > 99 || awayGoals > 99) return null
  if ([pHome, pDraw, pAway].some((p) => p < 0 || p > 1.000001)) return null
  return {
    homeGoals, awayGoals, pHome, pDraw, pAway,
    rated: r.rated === true,
    modelVersion: typeof r.model_version === 'string' ? r.model_version.slice(0, 40) : '',
    computedAt: typeof r.computed_at === 'string' ? r.computed_at : '',
  }
}

export function percent(p: number): string {
  return `${Math.round(p * 100)}%`
}

// El RPC aún no existe en este entorno (migración propuesta sin aplicar) o PostgREST no lo expone.
export function isSuggestionUnavailable(error: { code?: string | null; message?: string | null }): boolean {
  return error.code === 'PGRST202' || error.code === '42883' || /could not find the function|schema cache/i.test(error.message ?? '')
}

export function describeSuggestionError(error: { code?: string | null; message?: string | null; hint?: string | null; details?: string | null }): SuggestionFailure {
  if (isSuggestionUnavailable(error)) return { message: 'La sugerencia estadística aún no está disponible en este entorno.', unavailable: true }
  const text = `${error.hint ?? ''} ${error.message ?? ''} ${error.details ?? ''}`
  if (/ADMIN_PARTICIPANT_INCOMPATIBLE/.test(text)) return { message: 'Quien administra una quiniela no participa en ella.', unavailable: false }
  if (/STATS_LOCKED/.test(text)) return { message: 'Este partido ya cerró: no hay sugerencia disponible.', unavailable: false }
  if (/STATS_NOT_ELIGIBLE/.test(text)) return { message: 'Solo los participantes aprobados pueden pedir una sugerencia.', unavailable: false }
  if (/STATS_UNSUPPORTED_SPORT/.test(text)) return { message: 'Este deporte aún no tiene modelo estadístico.', unavailable: false }
  if (/STATS_NOT_FOUND/.test(text) || error.code === '22023') return { message: 'No encontramos ese partido en tu quiniela.', unavailable: false }
  if (error.code === '28000') return { message: 'Inicia sesión para pedir una sugerencia.', unavailable: false }
  if (error.code === '42501') return { message: 'No estás habilitado para pedir una sugerencia en este partido.', unavailable: false }
  return { message: 'No pudimos calcular la sugerencia. Inténtalo de nuevo.', unavailable: false }
}
