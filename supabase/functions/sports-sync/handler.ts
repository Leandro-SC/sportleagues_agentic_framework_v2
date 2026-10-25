import {
  DENIAL_CODES,
  MAX_BODY_BYTES,
  MIN_SECRET_LENGTH,
  constantTimeEqual,
  parseRequest,
  readBoundedText,
  statusForDenial,
  type Operation,
} from '../_shared/sports/access.ts'
import { importSeason, searchCompetitions, syncDue, type OperationResult, type SyncDeps } from '../_shared/sports/sync.ts'

// ADR-021 / F-05, F-10. Manejador HTTP de `sports-sync` SIN dependencias de Deno ni de Supabase (todo se inyecta), de modo que la autorización, los
// topes de entrada y el orden «autorizar → validar → comprobar acceso → reservar cuota → llamar al proveedor» se prueban con vitest.
//
// Quién puede invocar: SOLO procesos backend autorizados de la plataforma, con el secreto interno `SPORTS_SYNC_SECRET` en `x-sync-secret`
// (comparación en tiempo constante). Un JWT de usuario —administrador de tenant incluido— NUNCA autoriza: se rechaza con 403 sin verificarlo ni
// consultar nada. Sin CORS (llamada servidor-a-servidor): una petición con `Origin` se rechaza.
export type OperationSession = {
  deps: SyncDeps
  // Comprobación previa sin consumir: 'OK' o motivo de rechazo.
  checkAccess(): Promise<string>
  // Motivo de la última reserva de cuota rechazada en la operación, si la hubo.
  denial(): string | null
}

export type SyncHandlerDeps = {
  getEnv(name: string): string | undefined
  // Crea cliente privilegiado, almacén y proveedor. SOLO se invoca tras autenticar y validar la petición.
  open(scope: { kind: Operation; tenantId: string | null }): Promise<OperationSession>
  log(entry: Record<string, unknown>): void
}

const SECRET_HEADER = 'x-sync-secret'

function respond(body: Record<string, unknown>, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra },
  })
}

export function createSportsSyncHandler(handlerDeps: SyncHandlerDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const requestId = crypto.randomUUID()
    const deny = (status: number, code: string, reason: string, extra: Record<string, string> = {}) => {
      handlerDeps.log({ request_id: requestId, event: 'rejected', reason })
      return respond({ code, request_id: requestId }, status, extra)
    }
    try {
      if (request.method !== 'POST') return deny(405, 'METHOD_NOT_ALLOWED', 'method', { allow: 'POST' })
      // Los navegadores envían Origin: esta función no es para navegadores y no emite cabeceras CORS.
      if (request.headers.get('origin')) return deny(403, 'FORBIDDEN', 'origin')

      // 1. Autenticación: solo el secreto interno. Falla cerrado si no está configurado o es corto.
      const expected = handlerDeps.getEnv('SPORTS_SYNC_SECRET')
      const received = request.headers.get(SECRET_HEADER)
      const secretConfigured = typeof expected === 'string' && expected.length >= MIN_SECRET_LENGTH
      if (!secretConfigured) return deny(401, 'UNAUTHORIZED', 'secret_not_configured')
      const authenticated = Boolean(received) && (await constantTimeEqual(expected, received as string))
      if (!authenticated) {
        // Una credencial de usuario (Authorization) es 403: identificada como no aceptada, sin validarla ni consultar nada.
        if (request.headers.get('authorization')) return deny(403, 'FORBIDDEN', 'user_credential')
        return deny(401, 'UNAUTHORIZED', received ? 'bad_secret' : 'no_credential')
      }

      // 2. Entrada acotada (F-10): tipo, tamaño en bytes, JSON estricto.
      const contentType = request.headers.get('content-type') ?? ''
      if (!/^application\/json\s*(;|$)/i.test(contentType)) return deny(415, 'UNSUPPORTED_MEDIA_TYPE', 'content_type')
      const read = await readBoundedText(request, MAX_BODY_BYTES)
      if (!read.ok) return deny(read.reason === 'too_large' ? 413 : 400, read.reason === 'too_large' ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST', read.reason)
      let raw: unknown
      try { raw = JSON.parse(read.text) } catch { return deny(400, 'BAD_REQUEST', 'json') }
      const parsed = parseRequest(raw)
      if (!parsed) return deny(400, 'BAD_REQUEST', 'schema')

      // 3. Acceso del ámbito (plan, bandera, tenant, proveedor) ANTES de abrir trabajos o llamar al proveedor.
      const tenantId = parsed.action === 'sync' ? null : parsed.tenantId
      const scope = tenantId ? 'tenant' : 'platform'
      const session = await handlerDeps.open({ kind: parsed.action, tenantId })
      const access = await session.checkAccess()
      if (access !== 'OK') {
        const code = DENIAL_CODES.has(access) ? access : 'FORBIDDEN'
        handlerDeps.log({ request_id: requestId, action: parsed.action, scope, status: 'denied', code })
        return respond({ status: 'denied', code, request_id: requestId }, statusForDenial(code))
      }

      // 4. Operación. Cada intento HTTP al proveedor reserva cuota atómicamente antes de salir (ver store.consume); sin reserva aprobada no hay llamada.
      let result: OperationResult
      switch (parsed.action) {
        case 'search': result = await searchCompetitions(session.deps, null, parsed.query); break
        case 'import_season': result = await importSeason(session.deps, null, parsed.competition, parsed.year); break
        case 'sync': result = await syncDue(session.deps, null); break
      }
      const quotaReason = result.code === 'QUOTA_EXHAUSTED' ? session.denial() : null
      const quota = quotaReason && DENIAL_CODES.has(quotaReason) ? { quota_reason: quotaReason } : {}
      // Registro mínimo: sin secretos, sin JWT, sin datos personales ni identificadores de tenant.
      handlerDeps.log({ request_id: requestId, action: parsed.action, scope, status: result.status, code: result.code, requests_used: result.requests_used, ...quota })
      return respond({ ...result, ...quota, request_id: requestId }, 200)
    } catch {
      // Nunca se devuelve ni se registra el mensaje de la excepción (podría contener secretos o detalles internos).
      handlerDeps.log({ request_id: requestId, status: 'error' })
      return respond({ code: 'INTERNAL_ERROR', request_id: requestId }, 500)
    }
  }
}
