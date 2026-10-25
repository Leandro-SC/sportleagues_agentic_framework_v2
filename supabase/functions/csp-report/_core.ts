// Receptor de reportes CSP (F-06). Lógica PURA (sin globales de Deno) para poder probarla con vitest.
// Principios (AGENTS §5): minimizar PII y logs; endpoint público => sin superficie de abuso, sin filtrar validaciones.
//  - Solo POST (y OPTIONS únicamente para preflight de la Reporting API desde orígenes de una lista permitida).
//  - Cuerpo acotado (8 KB) y leído en flujo: se aborta al superar el tope, sin leerlo entero.
//  - Se extraen SOLO: directiva violada/efectiva, origen bloqueado, ruta saneada, disposición y familia de navegador.
//  - Duplicados (misma directiva+origen+ruta) descartados 60 s; tasa limitada por instancia. Todo reporte bien formado => 204.
//  - Registro: una línea `csp-violation {json}` a stdout (logs de Supabase Functions). Sin tabla, sin servicio externo.

export const MAX_BODY_BYTES = 8 * 1024
export const DEDUPE_WINDOW_MS = 60_000
export const RATE_WINDOW_MS = 60_000
export const RATE_LIMIT = 100
export const MAX_REPORTS_PER_REQUEST = 5
export const MAX_TRACKED_KEYS = 500
const MAX_FIELD_LEN = 4096

// ---- Saneamiento: copia de apps/platform/src/lib/telemetry.ts (scrubPii/safeRoute). La paridad la verifica csp-report.test.ts.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi
const SECRET_PARAM = /([?&#](?:access_token|refresh_token|id_token|token|code|apikey|api_key|key|password)=)[^&#\s]+/gi
const JOIN_CODE_PATH = /(\/j\/)[A-Za-z0-9]{6}\b/g
const MAX_LEN = 300

export function scrubPii(input: unknown): string {
  const text = typeof input === 'string' ? input : input instanceof Error ? input.message : String(input ?? '')
  return text
    .replace(JWT, '[jwt]')
    .replace(BEARER, 'Bearer [token]')
    .replace(SECRET_PARAM, '$1[redacted]')
    .replace(EMAIL, '[email]')
    .replace(UUID, '[id]')
    .replace(JOIN_CODE_PATH, '$1[code]')
    .slice(0, MAX_LEN)
}

export function safeRoute(path: string | undefined): string | undefined {
  if (!path) return undefined
  return scrubPii(path.split(/[?#]/)[0] ?? '')
}

// Endurecimiento adicional (no existe en telemetry): segmentos opacos largos tipo token/identificador.
function isOpaqueSegment(segment: string): boolean {
  return segment.length >= 24 && /^[A-Za-z0-9_-]+$/.test(segment) && /\d/.test(segment) && /[A-Za-z]/.test(segment) && (segment.match(/-/g)?.length ?? 0) <= 1
}

// document-uri => SOLO ruta, sin host, query ni hash; con UUID, correos, códigos de unión y segmentos opacos enmascarados.
export function safeDocumentRoute(documentUri: string): string {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(documentUri)) return '[unknown]'
  let pathname: string
  try {
    pathname = new URL(documentUri).pathname
  } catch {
    return '[unknown]'
  }
  let decoded = pathname
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    // Percent-encoding inválido: se usa la ruta tal cual (se sanea igual).
  }
  const scrubbed = safeRoute(decoded) ?? ''
  const masked = scrubbed.split('/').map((s) => (isOpaqueSegment(s) ? '[opaque]' : s)).join('/')
  // eslint-disable-next-line no-control-regex
  return (masked.replace(/[^\x20-\x7e]/g, '?') || '/').slice(0, 200)
}

const KNOWN_DIRECTIVES = new Set([
  'default-src', 'script-src', 'script-src-elem', 'script-src-attr', 'style-src', 'style-src-elem', 'style-src-attr',
  'img-src', 'font-src', 'connect-src', 'media-src', 'object-src', 'frame-src', 'child-src', 'worker-src', 'manifest-src',
  'prefetch-src', 'base-uri', 'form-action', 'frame-ancestors', 'navigate-to', 'require-trusted-types-for', 'trusted-types', 'sandbox',
])

function normalizeDirective(raw: string | undefined): string {
  const first = (raw ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  return KNOWN_DIRECTIVES.has(first) ? first : 'other'
}

const KEYWORD_BLOCKED = new Set(['inline', 'eval', 'self', 'data', 'blob', 'about', 'wasm-eval', 'trusted-types-policy', 'trusted-types-sink'])

// blocked-uri => ORIGEN únicamente (sin path/query/hash/credenciales) o una palabra clave CSP.
export function safeBlockedOrigin(raw: string): string {
  const value = raw.trim()
  if (!value) return 'none'
  const lower = value.toLowerCase()
  if (KEYWORD_BLOCKED.has(lower)) return lower
  if (lower.startsWith('data:')) return 'data'
  if (lower.startsWith('blob:')) return 'blob'
  if (lower.startsWith('about:')) return 'about'
  try {
    const url = new URL(value)
    if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return scrubPii(url.origin).slice(0, 120)
    return scrubPii(url.protocol.replace(/:$/, '')).slice(0, 40)
  } catch {
    return 'other'
  }
}

// Familia de navegador y plataforma gruesa; jamás la cadena completa ni versiones.
export function userAgentFamily(userAgent: string | null): { ua: string; platform: string } {
  const value = userAgent ?? ''
  const platform = /Android/i.test(value) ? 'android' : /iPhone|iPad|iPod/i.test(value) ? 'ios' : /Windows/i.test(value) ? 'windows' : /Mac OS X|Macintosh/i.test(value) ? 'macos' : /Linux|X11/i.test(value) ? 'linux' : 'other'
  const webview = /; wv\)/.test(value) || (platform === 'ios' && !/Safari\//.test(value))
  const ua = webview ? 'webview' : /Edg(e|A|iOS)?\//.test(value) ? 'edge' : /OPR\/|Opera/.test(value) ? 'opera' : /Firefox\/|FxiOS\//.test(value) ? 'firefox' : /Chrome\/|CriOS\//.test(value) ? 'chrome' : /Safari\//.test(value) ? 'safari' : 'other'
  return { ua, platform }
}

// ---- Extracción de la forma del reporte -----------------------------------------------------------------------------
type RawReport = { violated: string; effective: string; blocked: string; documentUri: string; disposition: string; channel: 'report-uri' | 'report-to' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, MAX_FIELD_LEN) : undefined
}

export function extractReports(payload: unknown): RawReport[] | null {
  if (Array.isArray(payload)) {
    const reports: RawReport[] = []
    for (const entry of payload.slice(0, MAX_REPORTS_PER_REQUEST)) {
      if (!isRecord(entry) || entry.type !== 'csp-violation' || !isRecord(entry.body)) continue
      const body = entry.body
      const effective = str(body.effectiveDirective)
      const documentUri = str(body.documentURL)
      if (effective === undefined || documentUri === undefined) continue
      reports.push({ violated: effective, effective, blocked: str(body.blockedURL) ?? '', documentUri, disposition: str(body.disposition) ?? '', channel: 'report-to' })
    }
    return reports.length ? reports : null
  }
  if (isRecord(payload) && isRecord(payload['csp-report'])) {
    const r = payload['csp-report']
    const documentUri = str(r['document-uri'])
    const violated = str(r['violated-directive']) ?? str(r['effective-directive'])
    if (documentUri === undefined || violated === undefined) return null
    return [{ violated, effective: str(r['effective-directive']) ?? violated, blocked: str(r['blocked-uri']) ?? '', documentUri, disposition: str(r.disposition) ?? '', channel: 'report-uri' }]
  }
  return null
}

export type CspLogEntry = {
  event: 'csp-violation'
  ts: string
  directive: string
  effective_directive: string
  blocked: string
  route: string
  disposition: 'report' | 'enforce' | 'unknown'
  ua: string
  platform: string
  channel: 'report-uri' | 'report-to'
}

// ---- Manejador ------------------------------------------------------------------------------------------------------
export type CspReportOptions = {
  now?: () => number
  log?: (line: string) => void
  maxBodyBytes?: number
  dedupeWindowMs?: number
  rateWindowMs?: number
  rateLimit?: number
  allowedOrigins?: string[]   // solo para el preflight de la Reporting API (report-to); vacío = sin CORS.
}

const ALLOWED_CONTENT_TYPES = new Set(['application/csp-report', 'application/reports+json', 'application/json'])

function plain(status: number, code: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ code }), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra } })
}

type ReadResult = { ok: true; text: string } | { ok: false; status: 400 | 413 }

async function readLimited(request: Request, max: number): Promise<ReadResult> {
  const declared = request.headers.get('content-length')
  if (declared !== null) {
    const length = Number(declared)
    if (!Number.isFinite(length) || length < 0) return { ok: false, status: 400 }
    if (length > max) return { ok: false, status: 413 }   // rechazado sin leer el cuerpo
  }
  if (!request.body) return { ok: false, status: 400 }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > max) {
        await reader.cancel().catch(() => undefined)
        return { ok: false, status: 413 }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, status: 400 }
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return { ok: true, text: new TextDecoder().decode(bytes) }
}

export function createCspReportHandler(options: CspReportOptions = {}): (request: Request) => Promise<Response> {
  const now = options.now ?? (() => Date.now())
  const log = options.log ?? ((line: string) => console.log(line))
  const maxBody = options.maxBodyBytes ?? MAX_BODY_BYTES
  const dedupeWindow = options.dedupeWindowMs ?? DEDUPE_WINDOW_MS
  const rateWindow = options.rateWindowMs ?? RATE_WINDOW_MS
  const rateLimit = options.rateLimit ?? RATE_LIMIT
  const allowedOrigins = options.allowedOrigins ?? []

  const seen = new Map<string, number>()
  let windowStart = now()
  let count = 0
  let suppressed = 0

  function corsFor(request: Request): Record<string, string> {
    const origin = request.headers.get('origin')
    if (!origin || !allowedOrigins.includes(origin)) return {}
    return { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600', vary: 'Origin' }
  }

  // true => se debe registrar. Descarta duplicados dentro de la ventana y excesos de tasa (sin avisar al cliente).
  function admit(key: string, at: number): boolean {
    if (at - windowStart >= rateWindow) {
      if (suppressed > 0) log(`csp-violation ${JSON.stringify({ event: 'csp-violation-suppressed', ts: new Date(at).toISOString(), suppressed })}`)
      windowStart = at; count = 0; suppressed = 0
    }
    const last = seen.get(key)
    if (last !== undefined && at - last < dedupeWindow) return false
    if (seen.size >= MAX_TRACKED_KEYS) {
      for (const [k, t] of seen) if (at - t >= dedupeWindow) seen.delete(k)
      if (seen.size >= MAX_TRACKED_KEYS) { suppressed++; return false }
    }
    if (count >= rateLimit) { suppressed++; return false }
    count++
    seen.set(key, at)
    return true
  }

  return async (request: Request): Promise<Response> => {
    try {
      if (request.method === 'OPTIONS') {
        const cors = corsFor(request)
        return Object.keys(cors).length ? new Response(null, { status: 204, headers: cors }) : plain(405, 'METHOD_NOT_ALLOWED', { allow: 'POST' })
      }
      if (request.method !== 'POST') return plain(405, 'METHOD_NOT_ALLOWED', { allow: 'POST' })

      const contentType = (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
      if (!ALLOWED_CONTENT_TYPES.has(contentType)) return plain(415, 'UNSUPPORTED_MEDIA_TYPE')

      const read = await readLimited(request, maxBody)
      if (!read.ok) return plain(read.status, read.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST')

      let payload: unknown
      try {
        payload = JSON.parse(read.text)
      } catch {
        return plain(400, 'BAD_REQUEST')
      }
      const reports = extractReports(payload)
      if (!reports) return plain(400, 'BAD_REQUEST')

      const { ua, platform } = userAgentFamily(request.headers.get('user-agent'))
      for (const report of reports) {
        const directive = normalizeDirective(report.violated)
        const effective = normalizeDirective(report.effective)
        const blocked = safeBlockedOrigin(report.blocked)
        const route = safeDocumentRoute(report.documentUri)
        const at = now()
        if (!admit(`${effective}|${blocked}|${route}`, at)) continue
        const disposition = report.disposition === 'report' || report.disposition === 'enforce' ? report.disposition : 'unknown'
        const entry: CspLogEntry = { event: 'csp-violation', ts: new Date(at).toISOString(), directive, effective_directive: effective, blocked, route, disposition, ua, platform, channel: report.channel }
        log(`csp-violation ${JSON.stringify(entry)}`)
      }
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store', ...corsFor(request) } })
    } catch {
      // Nunca se filtran detalles internos. Un fallo inesperado de un reporte ya aceptado no debe reintentarse.
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
    }
  }
}
