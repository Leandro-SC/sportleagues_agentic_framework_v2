export const BRANDING_BUCKET = 'branding-assets'

export const MAX_MULTIPART_OVERHEAD_BYTES = 64 * 1024

export const BRANDING_LIMITS = {
  logo: {
    maxBytes: 1024 * 1024,
    minWidth: 256,
    minHeight: 256,
    maxWidth: 2048,
    maxHeight: 2048,
  },
  banner: {
    maxBytes: 2 * 1024 * 1024,
    minWidth: 1200,
    minHeight: 450,
    maxWidth: 2400,
    maxHeight: 900,
  },
} as const

export type AssetKind = keyof typeof BRANDING_LIMITS
export type DetectedImageType = 'image/png' | 'image/jpeg' | 'image/webp'

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'ASSET_NOT_FOUND'
  | 'INVALID_ASSET_STATE'
  | 'PLAN_REQUIRED'
  | 'FILE_REQUIRED'
  | 'FILE_TOO_LARGE'
  | 'INVALID_IMAGE_TYPE'
  | 'INVALID_DIMENSIONS'
  | 'IMAGE_DECODE_FAILED'
  | 'STORAGE_FAILED'
  | 'METADATA_FAILED'
  | 'ACTIVATION_FAILED'
  | 'INTERNAL_ERROR'

export class BrandingAssetError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'BrandingAssetError'
  }
}

export function isAssetKind(value: unknown): value is AssetKind {
  return value === 'logo' || value === 'banner'
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export function safeError(code: ErrorCode): BrandingAssetError {
  const errors: Record<ErrorCode, [string, number]> = {
    UNAUTHORIZED: ['Tu sesión no es válida o ha expirado.', 401],
    FORBIDDEN: ['No tienes permisos para cargar este recurso.', 403],
    ASSET_NOT_FOUND: ['No se encontró el recurso de branding solicitado.', 404],
    INVALID_ASSET_STATE: ['Este recurso ya no está disponible para carga.', 409],
    PLAN_REQUIRED: ['El branding con imágenes requiere un plan PRO.', 403],
    FILE_REQUIRED: ['Adjunta un único archivo de imagen.', 400],
    FILE_TOO_LARGE: ['La imagen supera el tamaño máximo permitido.', 413],
    INVALID_IMAGE_TYPE: ['El archivo debe ser PNG, JPEG o WebP.', 415],
    INVALID_DIMENSIONS: ['Las dimensiones de la imagen no son válidas para este recurso.', 422],
    IMAGE_DECODE_FAILED: ['No fue posible procesar la imagen enviada.', 422],
    STORAGE_FAILED: ['No fue posible guardar la imagen. Inténtalo nuevamente.', 502],
    METADATA_FAILED: ['No fue posible verificar la imagen. Inténtalo nuevamente.', 502],
    ACTIVATION_FAILED: ['La imagen se verificó, pero no se pudo activar. Inténtalo nuevamente.', 502],
    INTERNAL_ERROR: ['Ocurrió un error inesperado. Inténtalo nuevamente.', 500],
  }
  const [message, status] = errors[code]
  return new BrandingAssetError(code, message, status)
}

export function responseJson(
  body: Record<string, unknown>,
  status: number,
  corsHeaders: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders },
  })
}

export function allowedCorsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('origin')
  const configuredOrigins = (Deno.env.get('CORS_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (!origin || !configuredOrigins.includes(origin)) return {}

  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, content-type, x-client-info, apikey',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '600',
    vary: 'Origin',
  }
}

export function isAllowedCorsOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  return !origin || Object.keys(allowedCorsHeaders(request)).length > 0
}

export function mapRpcError(message: string | undefined): BrandingAssetError {
  switch (message) {
    case 'authentication required': return safeError('UNAUTHORIZED')
    case 'not authorized': return safeError('FORBIDDEN')
    case 'pro branding is required': return safeError('PLAN_REQUIRED')
    case 'branding asset not found': return safeError('ASSET_NOT_FOUND')
    case 'branding asset is not pending':
    case 'branding asset is not verified and pending':
    case 'branding asset is already active': return safeError('INVALID_ASSET_STATE')
    default: return safeError('INTERNAL_ERROR')
  }
}

export function isStorageConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { statusCode?: string | number; status?: number; message?: string }
  if (candidate.statusCode === 409 || candidate.statusCode === '409' || candidate.status === 409) return true
  return /already exists|duplicate|exists/i.test(candidate.message ?? '')
}
