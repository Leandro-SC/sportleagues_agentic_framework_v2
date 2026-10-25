// Núcleo sin dependencias de `delete-account` (ADR-026), probado aparte. La función solo borra la cuenta de quien la llama: el
// usuario sale del JWT verificado, nunca del cuerpo de la petición.

/** Origen del wrapper Capacitor (androidScheme https, host localhost): la app nativa también debe poder borrar la cuenta. */
export const NATIVE_APP_ORIGIN = 'https://localhost'
export const CONFIRMATION = 'ELIMINAR'

export function allowedOrigins(configured: string | undefined): string[] {
  const list = (configured ?? '').split(',').map((value) => value.trim()).filter(Boolean)
  return list.includes(NATIVE_APP_ORIGIN) ? list : [...list, NATIVE_APP_ORIGIN]
}

export function corsHeaders(origin: string | null, configured: string | undefined): Record<string, string> {
  if (!origin || !allowedOrigins(configured).includes(origin)) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, content-type, x-client-info, apikey',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '600',
    vary: 'Origin',
  }
}

export function bearerToken(header: string | null): string | null {
  return header?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null
}

/** El cuerpo solo confirma la intención: `{ "confirm": "ELIMINAR" }`, máximo 256 bytes. */
export function validConfirmation(raw: string): boolean {
  if (raw.length > 256) return false
  try {
    const body = JSON.parse(raw) as unknown
    return typeof body === 'object' && body !== null && Object.keys(body).length === 1 && (body as { confirm?: unknown }).confirm === CONFIRMATION
  } catch {
    return false
  }
}

export type DeletionCode = 'DELETED' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'CONFIRMATION_REQUIRED' | 'HAS_ADMIN_ROLES' | 'METHOD_NOT_ALLOWED' | 'INTERNAL_ERROR'

export const STATUS: Record<DeletionCode, number> = {
  DELETED: 200, UNAUTHORIZED: 401, FORBIDDEN: 403, CONFIRMATION_REQUIRED: 400, HAS_ADMIN_ROLES: 409, METHOD_NOT_ALLOWED: 405, INTERNAL_ERROR: 500,
}

/** Traduce el error de `anonymize_account`: la pista lleva los impedimentos (ADMINISTERS_ORGANIZATION, ADMINISTERS_POOL). */
export function mapAnonymizeError(error: { message?: string; hint?: string } | null): { code: DeletionCode; blockers?: string[] } | null {
  if (!error) return null
  if (/administrative roles/i.test(error.message ?? '')) {
    return { code: 'HAS_ADMIN_ROLES', blockers: (error.hint ?? '').split(',').map((value) => value.trim()).filter(Boolean) }
  }
  return { code: 'INTERNAL_ERROR' }
}
