// Contratos de la administración deportiva (Fase 06). Las validaciones son UX: la autoridad es PostgreSQL (RPC + guardas).
// `lockAtPreview` es solo una vista previa; el lock real lo calcula y aplica la base de datos (ADR-011).

export const SPORT_OPTIONS = [
  { code: 'football', label: 'Fútbol' },
  { code: 'futsal', label: 'Futsal' },
  { code: 'basketball', label: 'Baloncesto' },
  { code: 'volleyball', label: 'Vóley' },
  { code: 'baseball', label: 'Béisbol' },
  { code: 'tennis', label: 'Tenis' },
  { code: 'other', label: 'Otro' },
] as const

export type MatchStatus = 'scheduled' | 'live' | 'final'
export type TournamentRow = { id: string; name: string; sport_code: string; country_code: string | null; season_label: string | null; color: string | null }
export type TeamRow = { id: string; name: string; short_name: string | null; country_code: string | null; primary_color: string | null; secondary_color: string | null }
export type RoundRow = { id: string; tournament_id: string; name: string; sort_order: number }
export type MatchRow = { id: string; tournament_id: string; round_id: string; home_team_id: string; away_team_id: string; starts_at: string; status: MatchStatus }
export type ResultRow = { match_id: string; home_score: number; away_score: number; revision: number }

const HEX = /^#[0-9A-Fa-f]{6}$/

export function validateEntityName(value: string, label = 'El nombre'): string | null {
  const length = value.trim().length
  return length >= 1 && length <= 120 ? null : `${label} debe tener entre 1 y 120 caracteres.`
}

export function validateOptionalColor(value: string): string | null {
  return value.trim() === '' || HEX.test(value.trim()) ? null : 'Usa un color hexadecimal de seis dígitos (por ejemplo #00FF88).'
}

export function validateShortName(value: string): string | null {
  const length = value.trim().length
  return length === 0 || length <= 12 ? null : 'La abreviatura admite hasta 12 caracteres.'
}

export function validateCountryCode(value: string): string | null {
  return value.trim() === '' || /^[A-Z]{2}$/.test(value.trim()) ? null : 'Usa un código de país de dos letras (por ejemplo PE).'
}

export function validateScore(value: number): string | null {
  return Number.isInteger(value) && value >= 0 && value <= 99 ? null : 'El marcador debe ser un entero entre 0 y 99.'
}

/** Equipos en bloque: una línea por equipo, "Nombre" o "Nombre, ABR". Devuelve filas únicas y las líneas rechazadas. */
export function parseTeamLines(text: string, existingNames: readonly string[] = []): { teams: { name: string; shortName: string | null }[]; rejected: string[] } {
  const seen = new Set(existingNames.map((name) => name.trim().toLowerCase()))
  const teams: { name: string; shortName: string | null }[] = []
  const rejected: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const [namePart = '', shortPart = ''] = line.split(',').map((part) => part.trim())
    if (validateEntityName(namePart) || validateShortName(shortPart) || seen.has(namePart.toLowerCase())) { rejected.push(line); continue }
    seen.add(namePart.toLowerCase())
    teams.push({ name: namePart, shortName: shortPart || null })
  }
  return { teams, rejected }
}

function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs))
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value)
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - utcMs
}

/** "2026-10-12T20:30" interpretado en la zona del tenant → instante UTC ISO. null si la fecha o la zona no son válidas. */
export function zonedLocalToIso(local: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local)
  if (!m) return null
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))
  if (Number.isNaN(wall)) return null
  try {
    let utc = wall - zoneOffsetMs(wall, timeZone)
    utc = wall - zoneOffsetMs(utc, timeZone)   // segunda pasada: estabiliza alrededor de cambios de horario
    const check = new Date(utc)
    return Number.isNaN(check.getTime()) ? null : check.toISOString()
  } catch {
    return null
  }
}

/** Inverso para editar: instante UTC → "YYYY-MM-DDTHH:mm" en la zona del tenant. */
export function isoToZonedLocal(iso: string, timeZone: string): string {
  const ms = new Date(iso).getTime()
  const shifted = new Date(ms + zoneOffsetMs(ms, timeZone))
  return shifted.toISOString().slice(0, 16)
}

export function validateKickoff(local: string, timeZone: string): { iso: string | null; error: string | null } {
  const iso = zonedLocalToIso(local, timeZone)
  return iso ? { iso, error: null } : { iso: null, error: 'Indica fecha y hora válidas del partido.' }
}

/** Vista previa del cierre de pronósticos (no es autoridad): kickoff − offset. */
export function lockAtPreview(startsAtIso: string, lockOffsetMinutes: number): Date {
  return new Date(new Date(startsAtIso).getTime() - lockOffsetMinutes * 60_000)
}

export function humanizeSportsRpcError(message: string | null | undefined, code?: string | null): string {
  const text = message ?? ''
  if (/schedule is frozen/.test(text)) return 'El calendario de este partido está congelado: ya venció el cierre de una quiniela.'
  if (/schedule change would lock/.test(text)) return 'Ese horario cerraría o revelaría el partido de inmediato. Elige una hora posterior.'
  if (/lock of this match has already been reached/.test(text)) return 'El cierre de este partido ya venció; no se puede añadir a la quiniela.'
  if (/both teams must be enrolled/.test(text)) return 'Los dos equipos deben estar inscritos en el torneo.'
  if (/round does not belong/.test(text)) return 'La jornada no pertenece a este torneo.'
  if (/cannot play itself|23514/.test(text)) return 'Local y visita deben ser equipos distintos.'
  if (/revision conflict|40001|PT409/.test(text) || code === '40001' || code === 'PT409') return 'El resultado cambió mientras lo editabas. Recarga y vuelve a intentarlo.'
  if (/has not started/.test(text)) return 'No puedes publicar un resultado antes de que empiece el partido.'
  if (/only scheduled matches/.test(text)) return 'Solo se editan partidos programados.'
  if (/team with matches cannot be removed/.test(text)) return 'Un equipo con partidos no puede salir del torneo.'
  if (/cannot be removed from|cannot be deleted|used by pools or with official results|with predictions/.test(text)) return 'Este partido ya está en uso (quinielas, pronósticos o resultado) y no puede borrarse ni quitarse.'
  if (/duplicate key|23505/.test(text) || code === '23505') return 'Ya existe un registro con ese nombre u orden.'
  if (/not authorized|42501/.test(text) || code === '42501') return 'No tienes permisos para realizar esta acción.'
  return 'No pudimos completar esta acción. Inténtalo de nuevo.'
}
