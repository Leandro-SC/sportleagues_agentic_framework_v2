// Observabilidad mínima del cliente (Fase 12) SIN proveedor externo: añadir uno (Sentry, etc.) requiere ADR (AGENTS §12).
// Principio: minimizar PII y logs (AGENTS §5). Todo texto pasa por `scrubPii` antes de salir del módulo; un sumidero
// (`setTelemetrySink`) permite conectar luego un colector aprobado sin tocar el resto de la app.

export type TelemetryEvent = {
  kind: 'error' | 'unhandled-rejection' | 'event'
  name: string
  message: string
  at: string
  route?: string
}

export type TelemetrySink = (event: TelemetryEvent) => void

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

// La ruta se reporta sin query ni hash y sin segmentos que parezcan identificadores o códigos de unión.
export function safeRoute(path: string | undefined): string | undefined {
  if (!path) return undefined
  return scrubPii(path.split(/[?#]/)[0] ?? '')
}

let sink: TelemetrySink = () => undefined
let handlersInstalled = false

export function setTelemetrySink(next: TelemetrySink | null): void {
  sink = next ?? (() => undefined)
}

export function reportError(error: unknown, context?: { name?: string; route?: string }): void {
  try {
    sink({
      kind: 'error',
      name: scrubPii(context?.name ?? (error instanceof Error ? error.name : 'Error')),
      message: scrubPii(error),
      at: new Date().toISOString(),
      route: safeRoute(context?.route),
    })
  } catch {
    // La telemetría nunca debe romper la aplicación.
  }
}

export function trackEvent(name: string, route?: string): void {
  try {
    sink({ kind: 'event', name: scrubPii(name), message: '', at: new Date().toISOString(), route: safeRoute(route) })
  } catch {
    // Ídem.
  }
}

// Captura errores no controlados del navegador. Idempotente: instalar dos veces no duplica los manejadores.
export function installGlobalErrorHandlers(target: Pick<Window, 'addEventListener' | 'location'> = window): void {
  if (handlersInstalled) return
  handlersInstalled = true
  target.addEventListener('error', (event) => {
    reportError((event as ErrorEvent).error ?? (event as ErrorEvent).message, { route: target.location.pathname })
  })
  target.addEventListener('unhandledrejection', (event) => {
    try {
      sink({
        kind: 'unhandled-rejection',
        name: 'UnhandledRejection',
        message: scrubPii((event as PromiseRejectionEvent).reason),
        at: new Date().toISOString(),
        route: safeRoute(target.location.pathname),
      })
    } catch {
      // Ídem.
    }
  })
}

export function resetTelemetryForTests(): void {
  sink = () => undefined
  handlersInstalled = false
}
