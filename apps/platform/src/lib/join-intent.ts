const JOIN_CODE = /^[A-Z0-9]{6}$/
const storageKey = 'sportleagues.join-code'
// Lectura de compatibilidad: versiones anteriores guardaban el código solo en sessionStorage.
const legacyKey = storageKey
// localStorage (no sessionStorage) para que sobreviva si el correo de confirmación abre otra pestaña.
// Es solo el código opaco de seis caracteres + marca de tiempo: no concede ningún permiso y caduca.
export const JOIN_INTENT_TTL_MS = 24 * 60 * 60 * 1000

export function normalizeJoinCode(value: string): string | null {
  const code = value.trim().toUpperCase()
  return JOIN_CODE.test(code) ? code : null
}

function safe<T>(action: () => T, fallback: T): T {
  try { return action() } catch { return fallback }
}

export function saveJoinIntent(code: string, now: number = Date.now()): void {
  const normalized = normalizeJoinCode(code)
  if (!normalized) throw new Error('El código de unión debe tener seis caracteres alfanuméricos.')
  safe(() => localStorage.setItem(storageKey, JSON.stringify({ code: normalized, at: now })), undefined)
}

function read(now: number): string | null {
  const stored = safe(() => localStorage.getItem(storageKey), null)
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as { code?: unknown; at?: unknown }
      if (typeof parsed.code === 'string' && typeof parsed.at === 'number' && now - parsed.at <= JOIN_INTENT_TTL_MS && parsed.at <= now + 60_000) {
        return normalizeJoinCode(parsed.code)
      }
    } catch { /* valor corrupto: se descarta */ }
    return null
  }
  const legacy = safe(() => sessionStorage.getItem(legacyKey), null)
  return legacy ? normalizeJoinCode(legacy) : null
}

/** Consulta sin consumir (para avisar al usuario que su invitación sigue pendiente). */
export function peekJoinIntent(now: number = Date.now()): string | null {
  return read(now)
}

export function takeJoinIntent(now: number = Date.now()): string | null {
  const code = read(now)
  clearJoinIntent()
  return code
}

export function clearJoinIntent(): void {
  safe(() => localStorage.removeItem(storageKey), undefined)
  safe(() => sessionStorage.removeItem(legacyKey), undefined)
}
