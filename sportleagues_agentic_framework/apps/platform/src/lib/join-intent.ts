const JOIN_CODE = /^[A-Z0-9]{6}$/
const storageKey = 'sportleagues.join-code'

export function normalizeJoinCode(value: string): string | null {
  const code = value.trim().toUpperCase()
  return JOIN_CODE.test(code) ? code : null
}

export function saveJoinIntent(code: string): void {
  const normalized = normalizeJoinCode(code)
  if (!normalized) throw new Error('El código de unión debe tener seis caracteres alfanuméricos.')
  sessionStorage.setItem(storageKey, normalized)
}

export function takeJoinIntent(): string | null {
  const code = sessionStorage.getItem(storageKey)
  sessionStorage.removeItem(storageKey)
  return code ? normalizeJoinCode(code) : null
}

export function clearJoinIntent(): void {
  sessionStorage.removeItem(storageKey)
}
