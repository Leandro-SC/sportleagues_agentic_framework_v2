// BORRADOR TÉCNICO de preparación para Fases 06–07: ayudas de PRESENTACIÓN para pronósticos.
//
// Nada de aquí autoriza ni decide: el lock real lo evalúa PostgreSQL con `now()` en `save_prediction`
// (`now() < starts_at - lock_offset`, ver docs/architecture/phase-02-contracts.md y ADR-003/005).
// El reloj del dispositivo puede estar adelantado o atrasado, así que estas funciones solo sirven
// para mostrar una cuenta atrás y deshabilitar controles; el servidor siempre tiene la última palabra.
import type { Match, MatchStatus } from './sports-catalog'

export type PredictionLockState = 'open' | 'locked' | 'live' | 'final'

const MINUTE_MS = 60 * 1000

// Interpreta `pools.lock_offset` (interval) tal como lo serializa PostgREST con el estilo por
// defecto: "00:30:00", "01:00:00", "1 day", "1 day 02:00:00". Si el formato no se reconoce devuelve
// null en vez de adivinar.
export function parseIntervalMinutes(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null
  const match = /^\s*(?:(\d+)\s+days?)?\s*(?:(\d{1,3}):([0-5]\d):([0-5]\d)(?:\.\d+)?)?\s*$/.exec(value)
  if (!match || (match[1] === undefined && match[2] === undefined)) return null
  const days = Number(match[1] ?? 0)
  const hours = Number(match[2] ?? 0)
  const minutes = Number(match[3] ?? 0)
  const seconds = Number(match[4] ?? 0)
  return days * 1440 + hours * 60 + minutes + Math.floor(seconds / 60)
}

export function lockAt(startsAt: string, offsetMinutes: number): Date {
  return new Date(new Date(startsAt).getTime() - offsetMinutes * MINUTE_MS)
}

// Mismos estados que el contrato: `live`/`final` vienen del partido; `open`/`locked` se calculan.
export function lockState(match: Pick<Match, 'starts_at' | 'status'>, offsetMinutes: number, now: Date): PredictionLockState {
  const status: MatchStatus = match.status
  if (status === 'final') return 'final'
  if (status === 'live') return 'live'
  return now.getTime() < lockAt(match.starts_at, offsetMinutes).getTime() ? 'open' : 'locked'
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

export function lockLabel(state: PredictionLockState, closesAt: Date, now: Date): string {
  if (state === 'final') return 'Partido finalizado'
  if (state === 'live') return 'Partido en juego'
  if (state === 'locked') return 'Pronósticos cerrados'
  const minutes = Math.max(1, Math.ceil((closesAt.getTime() - now.getTime()) / MINUTE_MS))
  if (minutes < 60) return `Cierra en ${minutes} min`
  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return rest ? `Cierra en ${hours} h ${rest} min` : `Cierra en ${hours} h`
  }
  return `Cierra el ${closesAt.getDate()}/${twoDigits(closesAt.getMonth() + 1)} · ${twoDigits(closesAt.getHours())}:${twoDigits(closesAt.getMinutes())}`
}

export type ScoreInput = { ok: true; value: number } | { ok: false; message: string }

// Validación de UX del marcador. La restricción real es `check (home_score >= 0)` en la base; el
// tope de 99 evita errores de tecleo y no forma parte del contrato.
export function parseScoreInput(raw: string): ScoreInput {
  const text = raw.trim()
  if (text === '') return { ok: false, message: 'Ingresa un marcador.' }
  if (!/^\d+$/.test(text)) return { ok: false, message: 'Usa solo números enteros, sin signos.' }
  const value = Number(text)
  if (value > 99) return { ok: false, message: 'El marcador máximo es 99.' }
  return { ok: true, value }
}
