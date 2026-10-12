// @vitest-environment node
// ADR-021 / F-05, F-10. Pruebas del control de acceso de `sports-sync` con dobles (sin red, sin base de datos, sin proveedor real):
// solo procesos backend con el secreto interno; JWT de usuario → 403; topes de entrada; el secreto nunca sale; sin reserva aprobada no hay llamada.
// NO prueban la base de datos (eso lo cubre supabase/tests/provider-access-quota.sql) ni el despliegue real de la función.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { MAX_BODY_BYTES, constantTimeEqual, parseRequest, readBoundedText, statusForDenial } from '../../../../supabase/functions/_shared/sports/access.ts'
import { createApiFootballProvider } from '../../../../supabase/functions/_shared/sports/api-football.ts'
import type { SyncDeps } from '../../../../supabase/functions/_shared/sports/sync.ts'
import { createSportsSyncHandler } from '../../../../supabase/functions/sports-sync/handler.ts'
import { createCatalogStore, type RpcClient } from '../../../../supabase/functions/sports-sync/store.ts'

// Valores sintéticos: no son credenciales reales.
const SECRET = 'test-internal-secret-0123456789abcdefghij'
const API_KEY = 'test-provider-key-zzzzzzzzzzzzzzzz'
const SERVICE_KEY = 'test-service-role-key-qqqqqqqqqqqqqqqq'
const USER_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMtdXNlciIsInJvbGUiOiJhdXRoZW50aWNhdGVkIn0.c2lnbmF0dXJlLXN5bnRoZXRpYw'
const TENANT = '7b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const URL_ = 'https://edge.test/functions/v1/sports-sync'

type Opts = { access?: string; denyReserve?: string; fetchStatus?: number; due?: { external_id: string; season_id: string }[]; env?: Record<string, string | undefined> }

function setup(opts: Opts = {}) {
  const order: string[] = []
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = []
  const logs: Record<string, unknown>[] = []
  let reserved = 0
  const fetchMock = vi.fn(async () => {
    order.push('fetch')
    return new Response(JSON.stringify({ errors: [], response: [] }), { status: opts.fetchStatus ?? 200 })
  })
  const rpc: RpcClient['rpc'] = async (fn, args) => {
    rpcCalls.push({ fn, args })
    switch (fn) {
      case 'provider_access_check': return { data: opts.access ?? 'OK', error: null }
      case 'provider_reserve':
        order.push('reserve')
        if (opts.denyReserve) return { data: [{ allowed: false, reason: opts.denyReserve, reservation_id: null, global_remaining: 0 }], error: null }
        reserved += 1
        return { data: [{ allowed: true, reason: null, reservation_id: `res-${reserved}`, global_remaining: 50 }], error: null }
      case 'provider_settle': return { data: true, error: null }
      case 'catalog_begin_import': return { data: [{ outcome: 'started', job_id: 'job-1' }], error: null }
      case 'catalog_fixtures_due': return { data: opts.due ?? [], error: null }
      default: return { data: null, error: null }
    }
  }
  const chain: unknown = new Proxy({}, { get: (_t, p) => (p === 'maybeSingle' ? async () => ({ data: null, error: null }) : () => chain) })
  const open = vi.fn(async ({ kind, tenantId }: { kind: 'search' | 'import_season' | 'sync'; tenantId: string | null }) => {
    const store = createCatalogStore({ rpc, from: () => chain }, { provider: 'api_football', kind, tenantId })
    const deps: SyncDeps = {
      store, dailyLimit: 100, syncReserve: 10,
      provider: (gate) => createApiFootballProvider({ apiKey: API_KEY, gate, fetchImpl: fetchMock as unknown as typeof fetch, sleep: async () => undefined, plan: 'free' }),
    }
    return { deps, checkAccess: () => store.checkAccess(), denial: () => store.denial() }
  })
  const env: Record<string, string | undefined> = { SPORTS_SYNC_SECRET: SECRET, API_FOOTBALL_KEY: API_KEY, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, ...opts.env }
  const handler = createSportsSyncHandler({ getEnv: (name) => env[name], log: (entry) => logs.push(entry), open })
  return { handler, open, fetchMock, rpcCalls, order, logs }
}

function post(body: unknown, headers: Record<string, string> = {}, raw = false): Request {
  return new Request(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sync-secret': SECRET, ...headers },
    body: raw ? (body as string) : JSON.stringify(body),
  })
}
const SEARCH = { action: 'search', query: 'premier league' }
async function text(response: Response): Promise<string> { return await response.text() }

describe('autenticación: solo procesos backend con el secreto interno', () => {
  it('sin credencial → 401 y no se abre cliente ni almacén', async () => {
    const t = setup()
    const response = await t.handler(post(SEARCH, { 'x-sync-secret': '' }))
    expect(response.status).toBe(401)
    expect(t.open).not.toHaveBeenCalled(); expect(t.rpcCalls).toHaveLength(0); expect(t.fetchMock).not.toHaveBeenCalled()
    const bare = new Request(URL_, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(SEARCH) })
    expect((await t.handler(bare)).status).toBe(401)
    expect(t.open).not.toHaveBeenCalled()
  })

  it('secreto incorrecto (incluso con el mismo prefijo) → 401', async () => {
    const t = setup()
    for (const wrong of ['x', SECRET.slice(0, -1), `${SECRET}x`, SECRET.toUpperCase()]) {
      const response = await t.handler(post(SEARCH, { 'x-sync-secret': wrong }))
      expect(response.status).toBe(401)
      expect(await text(response)).not.toContain(wrong.trim() || 'x-never')
    }
    expect(t.open).not.toHaveBeenCalled()
  })

  it('JWT de usuario (administrador de tenant) en Authorization, sin secreto → 403 sin consultar nada', async () => {
    const t = setup()
    const response = await t.handler(post(SEARCH, { authorization: `Bearer ${USER_JWT}`, 'x-sync-secret': '' }))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'FORBIDDEN' })
    expect(t.open).not.toHaveBeenCalled(); expect(t.rpcCalls).toHaveLength(0); expect(t.fetchMock).not.toHaveBeenCalled()
  })

  it('un JWT de usuario con un secreto incorrecto también es 403, y jamás se refleja', async () => {
    const t = setup()
    const response = await t.handler(post(SEARCH, { authorization: `Bearer ${USER_JWT}`, 'x-sync-secret': 'wrong' }))
    expect(response.status).toBe(403)
    expect(await text(response)).not.toContain(USER_JWT)
    expect(JSON.stringify(t.logs)).not.toContain(USER_JWT)
    expect(t.open).not.toHaveBeenCalled()
  })

  it('un JWT de usuario nunca sustituye al secreto: la función ya no valida JWT ni consulta membresías', () => {
    const index = readFileSync(new URL('../../../../supabase/functions/sports-sync/index.ts', import.meta.url), 'utf8')
    const handler = readFileSync(new URL('../../../../supabase/functions/sports-sync/handler.ts', import.meta.url), 'utf8')
    const store = readFileSync(new URL('../../../../supabase/functions/sports-sync/store.ts', import.meta.url), 'utf8')
    for (const source of [index, handler, store]) {
      expect(source).not.toMatch(/auth\.getUser|SUPABASE_ANON_KEY|tenant_memberships|authorizeAdmin/)
      expect(source).not.toMatch(/access-control-allow|CORS_ALLOWED_ORIGINS/i)
    }
    expect(store).not.toMatch(/['"`]provider_consume['"`]/) // la reserva pasa solo por provider_reserve (global + tenant)
  })

  it('con el secreto correcto la petición se atiende y el JWT presente se ignora', async () => {
    const t = setup()
    const response = await t.handler(post(SEARCH, { authorization: `Bearer ${USER_JWT}` }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'ok', requests_used: 1 })
  })

  it('si el secreto no está configurado o es corto la función falla cerrado (401 a todos)', async () => {
    for (const env of [{ SPORTS_SYNC_SECRET: undefined }, { SPORTS_SYNC_SECRET: '' }, { SPORTS_SYNC_SECRET: 'short-secret' }]) {
      const t = setup({ env })
      const matching = env.SPORTS_SYNC_SECRET ?? 'x'
      const response = await t.handler(post(SEARCH, { 'x-sync-secret': matching }))
      expect(response.status).toBe(401)
      expect(t.open).not.toHaveBeenCalled()
    }
  })

  it('una petición con Origin (navegador) se rechaza aunque lleve el secreto y no emite cabeceras CORS', async () => {
    const t = setup()
    const response = await t.handler(post(SEARCH, { origin: 'https://app.example.test' }))
    expect(response.status).toBe(403)
    expect([...response.headers.keys()].some((name) => name.startsWith('access-control-'))).toBe(false)
    expect(t.open).not.toHaveBeenCalled()
  })
})

describe('método, tipo y tamaño de cuerpo (F-10)', () => {
  it('solo POST: GET/PUT/DELETE/PATCH/OPTIONS → 405 con Allow y sin CORS', async () => {
    const t = setup()
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const response = await t.handler(new Request(URL_, { method, headers: { 'x-sync-secret': SECRET } }))
      expect(response.status).toBe(405)
      expect(response.headers.get('allow')).toBe('POST')
      expect([...response.headers.keys()].some((name) => name.startsWith('access-control-'))).toBe(false)
    }
    expect(t.open).not.toHaveBeenCalled()
  })

  it('Content-Type distinto de application/json → 415', async () => {
    const t = setup()
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'application/jsonx', '']) {
      expect((await t.handler(post(JSON.stringify(SEARCH), { 'content-type': type }, true))).status).toBe(415)
    }
    expect((await t.handler(post(SEARCH, { 'content-type': 'application/json; charset=utf-8' }))).status).toBe(200)
    expect(t.open).toHaveBeenCalledTimes(1)
  })

  it('cuerpo enorme (Content-Length declarado) → 413 sin leerlo ni abrir nada', async () => {
    const t = setup()
    const response = await t.handler(post(SEARCH, { 'content-length': String(MAX_BODY_BYTES + 1) }))
    expect(response.status).toBe(413)
    expect(t.open).not.toHaveBeenCalled()
  })

  it('cuerpo enorme sin Content-Length (chunked) → 413 al superar el tope en bytes y cancela el flujo', async () => {
    const t = setup()
    let pulled = 0
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { pulled += 1; controller.enqueue(new TextEncoder().encode('a'.repeat(1024))); if (pulled > 50) controller.close() },
      cancel() { cancelled = true },
    })
    const request = new Request(URL_, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-secret': SECRET }, body: stream, duplex: 'half' } as RequestInit)
    const response = await t.handler(request)
    expect(response.status).toBe(413)
    expect(cancelled).toBe(true)
    expect(pulled).toBeLessThan(10)
    expect(t.open).not.toHaveBeenCalled()
  })

  it('un campo de 3 KiB → 413; JSON mal formado/vacío → 400', async () => {
    const t = setup()
    expect((await t.handler(post({ action: 'search', query: 'a'.repeat(3000) }))).status).toBe(413)
    for (const bad of ['', '{', 'null', '[]', '"search"', '{"action":', '\u0000']) expect((await t.handler(post(bad, {}, true))).status).toBe(400)
    expect(t.open).not.toHaveBeenCalled()
  })

  it('esquema estricto: claves desconocidas, tipos erróneos y valores fuera de rango → 400 sin abrir nada', async () => {
    const t = setup()
    const bodies: unknown[] = [
      {}, { action: 'drop' }, { action: 'search' }, { action: 'search', query: 5 }, { action: 'search', query: 'abc', extra: 1 },
      { action: 'search', query: 'abc', year: 2023 }, { action: 'search', query: 'abc', tenant_id: 'no-uuid' }, { action: 'search', query: 'abc', tenant_id: 5 },
      { action: 'import_season', competition: '39;x', year: 2023 }, { action: 'import_season', competition: '39', year: 1800 },
      { action: 'import_season', competition: '39', year: '2023' }, { action: 'import_season', competition: '39', year: 2023.5 },
      { action: 'sync', tenant_id: TENANT }, { action: 'sync', query: 'abc' },
    ]
    for (const body of bodies) expect((await t.handler(post(body))).status).toBe(400)
    expect((await t.handler(post('{"action":"search","query":"abc","__proto__":{"x":1}}', {}, true))).status).toBe(400)
    expect(t.open).not.toHaveBeenCalled(); expect(t.fetchMock).not.toHaveBeenCalled()
  })

  it('parseRequest y readBoundedText respetan el contrato', async () => {
    expect(parseRequest({ action: 'search', query: 'Premier', tenant_id: TENANT.toUpperCase() })).toEqual({ action: 'search', query: 'Premier', tenantId: TENANT })
    expect(parseRequest({ action: 'sync' })).toEqual({ action: 'sync' })
    expect(parseRequest(null)).toBeNull()
    const ok = await readBoundedText(new Request(URL_, { method: 'POST', body: 'x'.repeat(MAX_BODY_BYTES) }))
    expect(ok).toMatchObject({ ok: true })
    expect(await readBoundedText(new Request(URL_, { method: 'POST', body: 'x'.repeat(MAX_BODY_BYTES + 1) }))).toEqual({ ok: false, reason: 'too_large' })
    expect(await constantTimeEqual('abc', 'abc')).toBe(true)
    expect(await constantTimeEqual('abc', 'abd')).toBe(false)
  })
})

describe('el secreto y las claves nunca salen (respuestas ni registros)', () => {
  it('ningún escenario (éxito, rechazo, error interno) incluye secretos, JWT ni claves', async () => {
    const outputs: string[] = []
    const logs: unknown[] = []
    const scenarios: Request[] = [
      post(SEARCH), post(SEARCH, { 'x-sync-secret': 'wrong' }), post(SEARCH, { authorization: `Bearer ${USER_JWT}`, 'x-sync-secret': '' }),
      post('{', {}, true), post(SEARCH, { origin: 'https://x.test' }), new Request(URL_, { method: 'GET', headers: { 'x-sync-secret': SECRET } }),
    ]
    for (const request of scenarios) {
      const t = setup()
      const response = await t.handler(request)
      outputs.push(await text(response), JSON.stringify([...response.headers.entries()]))
      logs.push(...t.logs)
    }
    // Excepción interna cuyo mensaje contiene los secretos: no puede viajar en la respuesta ni en el registro.
    const logged: Record<string, unknown>[] = []
    const failing = createSportsSyncHandler({
      getEnv: (name) => (name === 'SPORTS_SYNC_SECRET' ? SECRET : undefined), log: (entry) => logged.push(entry),
      open: async () => { throw new Error(`boom ${SECRET} ${API_KEY} ${SERVICE_KEY} ${USER_JWT}`) },
    })
    const failure = await failing(post(SEARCH))
    expect(failure.status).toBe(500)
    outputs.push(await text(failure)); logs.push(...logged)
    const haystack = outputs.join('\n') + JSON.stringify(logs)
    for (const secret of [SECRET, API_KEY, SERVICE_KEY, USER_JWT]) expect(haystack).not.toContain(secret)
  })
})

describe('acceso del ámbito: plan, bandera y tenant (decididos en la base de datos)', () => {
  it.each([
    ['PLAN_NO_ACCESS', 403], ['AUTO_RESULTS_OFF', 403], ['TENANT_UNKNOWN', 403],
    ['TENANT_EXHAUSTED', 429], ['TENANT_MONTH_EXHAUSTED', 429], ['GLOBAL_EXHAUSTED', 429], ['GLOBAL_MONTH_EXHAUSTED', 429], ['PROVIDER_NOT_CONFIGURED', 503],
  ])('motivo %s → %i sin abrir trabajos ni llamar al proveedor', async (reason, status) => {
    const t = setup({ access: reason })
    const response = await t.handler(post({ ...SEARCH, tenant_id: TENANT }))
    expect(response.status).toBe(status)
    expect(await response.json()).toMatchObject({ status: 'denied', code: reason })
    expect(t.rpcCalls.map((call) => call.fn)).toEqual(['provider_access_check'])   // ni catalog_begin_import ni provider_reserve
    expect(t.fetchMock).not.toHaveBeenCalled()
    expect(statusForDenial(reason)).toBe(status)
  })

  it('un motivo desconocido de la base de datos se traduce a FORBIDDEN (no se filtra texto interno)', async () => {
    const t = setup({ access: 'ALGO_INTERNO_SECRETO' })
    const response = await t.handler(post(SEARCH))
    expect(response.status).toBe(403)
    expect(await text(response)).not.toContain('ALGO_INTERNO_SECRETO')
  })

  it('la atribución a un tenant se pasa a la base de datos como p_tenant; sync es siempre de plataforma', async () => {
    const t = setup({ due: [{ external_id: '1', season_id: 's1' }] })
    expect((await t.handler(post({ ...SEARCH, tenant_id: TENANT }))).status).toBe(200)
    expect((await t.handler(post({ action: 'sync' }))).status).toBe(200)
    const checks = t.rpcCalls.filter((call) => call.fn === 'provider_access_check').map((call) => call.args)
    expect(checks).toEqual([
      { p_provider: 'api_football', p_kind: 'search', p_tenant: TENANT },
      { p_provider: 'api_football', p_kind: 'sync', p_tenant: null },
    ])
    const reserves = t.rpcCalls.filter((call) => call.fn === 'provider_reserve').map((call) => call.args)
    expect(reserves).toEqual([
      { p_provider: 'api_football', p_kind: 'search', p_tenant: TENANT, p_n: 1, p_daily_cap: 90 },
      { p_provider: 'api_football', p_kind: 'sync', p_tenant: null, p_n: 1, p_daily_cap: 100 },
    ])
  })
})

describe('sin reserva aprobada no se llama al proveedor', () => {
  it('reserva rechazada → ninguna solicitud HTTP; respuesta degradada con el motivo y sin liquidaciones', async () => {
    const t = setup({ denyReserve: 'TENANT_EXHAUSTED' })
    const response = await t.handler(post({ ...SEARCH, tenant_id: TENANT }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'degraded', code: 'QUOTA_EXHAUSTED', quota_reason: 'TENANT_EXHAUSTED', requests_used: 0 })
    expect(t.fetchMock).not.toHaveBeenCalled()
    expect(t.rpcCalls.some((call) => call.fn === 'provider_settle')).toBe(false)
  })

  it('también en importación de temporada y con presupuesto global agotado', async () => {
    const t = setup({ denyReserve: 'GLOBAL_EXHAUSTED' })
    const response = await t.handler(post({ action: 'import_season', competition: '39', year: 2023 }))
    expect(await response.json()).toMatchObject({ status: 'degraded', code: 'QUOTA_EXHAUSTED', quota_reason: 'GLOBAL_EXHAUSTED' })
    expect(t.fetchMock).not.toHaveBeenCalled()
  })

  it('reserva aprobada → UNA solicitud, con la reserva hecha ANTES, y se liquida como consumed', async () => {
    const t = setup()
    const response = await t.handler(post(SEARCH))
    expect(await response.json()).toMatchObject({ status: 'ok', requests_used: 1 })
    expect(t.order).toEqual(['reserve', 'fetch'])
    expect(t.fetchMock).toHaveBeenCalledTimes(1)
    const settles = t.rpcCalls.filter((call) => call.fn === 'provider_settle').map((call) => call.args)
    expect(settles).toEqual([{ p_reservation_id: 'res-1', p_outcome: 'consumed', p_error_code: null }])
  })

  it('fallo 5xx del proveedor: cada reintento reserva antes de salir y todos se liquidan como failed (el intento salió; no se devuelve cuota)', async () => {
    const t = setup({ fetchStatus: 500 })
    const response = await t.handler(post(SEARCH))
    expect(await response.json()).toMatchObject({ status: 'degraded', code: 'UPSTREAM', requests_used: 3 })
    expect(t.order).toEqual(['reserve', 'fetch', 'reserve', 'fetch', 'reserve', 'fetch'])
    const settles = t.rpcCalls.filter((call) => call.fn === 'provider_settle').map((call) => call.args)
    expect(settles).toEqual(['res-1', 'res-2', 'res-3'].map((id) => ({ p_reservation_id: id, p_outcome: 'failed', p_error_code: 'UPSTREAM' })))
    expect(t.rpcCalls.some((call) => call.args.p_outcome === 'released')).toBe(false)
  })

  it('si el presupuesto se agota a mitad de operación, lo ya enviado se liquida como consumed (no como error)', async () => {
    const t = setup({ fetchStatus: 429 })
    // La segunda reserva se rechaza: se emulan dos intentos concedidos y el tercero denegado.
    let n = 0
    const original = t.open.getMockImplementation()!
    t.open.mockImplementation(async (scope) => {
      const session = await original(scope)
      const consume = session.deps.store.consume.bind(session.deps.store)
      session.deps.store.consume = async (count, limit) => (++n > 2 ? -1 : consume(count, limit))
      return session
    })
    const response = await t.handler(post(SEARCH))
    expect(await response.json()).toMatchObject({ status: 'degraded', code: 'QUOTA_EXHAUSTED', requests_used: 2 })
    const settles = t.rpcCalls.filter((call) => call.fn === 'provider_settle').map((call) => call.args)
    expect(settles).toEqual(['res-1', 'res-2'].map((id) => ({ p_reservation_id: id, p_outcome: 'consumed', p_error_code: null })))
  })

  it('un error de RPC no filtra mensajes de la base de datos (solo el nombre de la función, que tampoco llega al cliente)', async () => {
    const failing = createSportsSyncHandler({
      getEnv: (name) => (name === 'SPORTS_SYNC_SECRET' ? SECRET : undefined), log: () => undefined,
      open: async ({ kind, tenantId }) => {
        const store = createCatalogStore({ rpc: async () => ({ data: null, error: { message: `permission denied for table secret_internal ${SERVICE_KEY}` } }), from: () => ({}) }, { provider: 'api_football', kind, tenantId })
        return { deps: {} as SyncDeps, checkAccess: () => store.checkAccess(), denial: () => store.denial() }
      },
    })
    const response = await failing(post(SEARCH))
    const body = await text(response)
    expect(response.status).toBe(500)
    expect(body).not.toMatch(/permission denied|secret_internal|provider_access_check/)
    expect(body).not.toContain(SERVICE_KEY)
  })
})
