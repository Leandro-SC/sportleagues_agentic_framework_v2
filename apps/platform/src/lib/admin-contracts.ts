import { parseNonNegativeInteger } from './number-input'

export type TenantRole ='owner' | 'admin' | 'member'
export type PaymentStatus = 'paid' | 'pending' | 'invited'
export type PoolStatus = 'draft' | 'open' | 'paused' | 'archived'
export type BrandingAssetKind = 'logo' | 'banner'

export const brandingAssetLimits = {
  logo: { maxBytes: 1024 * 1024, minWidth: 256, minHeight: 256, maxWidth: 2048, maxHeight: 2048 },
  banner: { maxBytes: 2 * 1024 * 1024, minWidth: 1200, minHeight: 450, maxWidth: 2400, maxHeight: 900 },
} as const

export function canManageTenant(role: TenantRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

export function validatePoolName(value: string): string | null {
  const name = value.trim()
  return name.length >= 1 && name.length <= 120 ? null : 'El nombre debe tener entre 1 y 120 caracteres.'
}

export function validatePoints(exactPoints: number, outcomePoints: number): string | null {
  if (!(Number.isInteger(exactPoints) && Number.isInteger(outcomePoints) && exactPoints >= 0 && outcomePoints >= 0)) {
    return 'Los puntos deben ser números enteros iguales o mayores que cero.'
  }
  return exactPoints >= outcomePoints ? null : 'El marcador exacto no puede valer menos que acertar el resultado.'
}

// ADR-023: FREE usa la puntuación estándar; los puntos personalizados son PRO. El desempate es elegible en ambos planes.
export const STANDARD_SCORING = { exactPoints: 3, outcomePoints: 1 } as const
export const RULES_FROZEN_MESSAGE = 'Las reglas quedaron fijas al cerrar el primer partido: cambiarlas ahora alteraría la tabla.'
export const PRO_SCORING_MESSAGE = 'La puntuación personalizada está disponible en el plan PRO. En FREE se usa la estándar: 3 puntos por marcador exacto y 1 por acertar el resultado.'

export const MAX_POINTS = 1000
export const MAX_LOCK_MINUTES = 1440

export type FieldNumber = { ok: true; value: number } | { ok: false; message: string }

// Un campo en blanco NO es 0 (FE-01): se valida la cadena antes de convertir.
export function parseLockMinutesInput(raw: string): FieldNumber {
  const parsed = parseNonNegativeInteger(raw, MAX_LOCK_MINUTES)
  return parsed.ok ? parsed : { ok: false, message: `El bloqueo debe ser un número entero entre 0 y ${MAX_LOCK_MINUTES} minutos.` }
}

export function parsePointsInput(raw: string, label: string): FieldNumber {
  const parsed = parseNonNegativeInteger(raw, MAX_POINTS)
  return parsed.ok ? parsed : { ok: false, message: `${label}: ingresa un número entero entre 0 y ${MAX_POINTS}.` }
}

export function freeLimitMessage(plan: 'free' | 'pro', activePools: number): string | null {
  return plan === 'free' && activePools >= 1 ? 'Tu plan FREE permite una sola quiniela activa.' : null
}

export function humanizeAdminRpcError(message: string | null | undefined): string {
  if (/free plan allows one active pool/i.test(message ?? '')) {
    return freeLimitMessage('free', 1) ?? 'Tu plan FREE permite una sola quiniela activa.'
  }
  if (/scoring rules are frozen/i.test(message ?? '')) return RULES_FROZEN_MESSAGE
  if (/custom scoring requires the pro plan/i.test(message ?? '')) return PRO_SCORING_MESSAGE
  if (/exact points cannot be lower than outcome points/i.test(message ?? '')) return 'El marcador exacto no puede valer menos que acertar el resultado.'

  return 'No pudimos completar esta acción. Inténtalo de nuevo.'
}

export function brandingControlsAvailable(plan: 'free' | 'pro'): boolean {
  return plan === 'pro'
}

export function validateBrandingFile(kind: BrandingAssetKind, file: Pick<File, 'type' | 'size'>, dimensions?: { width: number; height: number }): string | null {
  const limits = brandingAssetLimits[kind]
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return 'Usa una imagen PNG, JPEG o WebP.'
  if (file.size <= 0 || file.size > limits.maxBytes) return `El archivo supera el máximo de ${kind === 'logo' ? '1 MiB' : '2 MiB'}.`
  if (dimensions && (dimensions.width < limits.minWidth || dimensions.height < limits.minHeight || dimensions.width > limits.maxWidth || dimensions.height > limits.maxHeight)) {
    return `La imagen debe medir entre ${limits.minWidth}×${limits.minHeight} y ${limits.maxWidth}×${limits.maxHeight}.`
  }
  return null
}

export function humanizeBrandingUploadError(code: string | null | undefined): string {
  const messages: Record<string, string> = {
    FILE_TOO_LARGE: 'El archivo supera el tamaño máximo permitido.',
    INVALID_IMAGE_TYPE: 'Usa una imagen PNG, JPEG o WebP.',
    INVALID_DIMENSIONS: 'La imagen no cumple con las dimensiones requeridas.',
    IMAGE_DECODE_FAILED: 'No pudimos procesar la imagen. Prueba con otro archivo.',
    FILE_REQUIRED: 'Selecciona una imagen para continuar.',
    PLAN_REQUIRED: 'Esta función está disponible en el plan PRO.',
    FORBIDDEN: 'No tienes permisos para actualizar este branding.',
    UNAUTHORIZED: 'Tu sesión expiró. Vuelve a iniciar sesión.',
    INVALID_ASSET_STATE: 'La carga anterior ya no está disponible. Inténtalo nuevamente.',
    ACTIVATION_FAILED: 'La imagen se verificó, pero no pudo activarse. Inténtalo nuevamente.',
    STORAGE_FAILED: 'No pudimos guardar la imagen. Inténtalo nuevamente.',
    METADATA_FAILED: 'No pudimos verificar la imagen. Inténtalo nuevamente.',
  }
  return messages[code ?? ''] ?? 'No pudimos actualizar la imagen. Inténtalo nuevamente.'
}

export function lockMinutesFromInterval(interval: string): number {
  const match = interval.match(/(?:(\d+)\s+hour[s]?)?\s*(?:(\d+)\s+min)?/i)
  if (match && (match[1] || match[2])) return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)
  const clock = interval.match(/^(\d{1,2}):(\d{2}):\d{2}$/)
  return clock ? Number(clock[1]) * 60 + Number(clock[2]) : 0
}
