// F-06: pruebas del receptor de reportes CSP (lógica pura en _core.ts; index.ts solo la expone con Deno.serve).
import { describe, expect, it } from 'vitest'
import {
  DEDUPE_WINDOW_MS, MAX_BODY_BYTES, RATE_LIMIT, createCspReportHandler, safeBlockedOrigin, safeDocumentRoute, safeRoute as coreSafeRoute, scrubPii as coreScrubPii, userAgentFamily,
  type CspLogEntry,
} from '../../../../supabase/functions/csp-report/_core.ts'
import { safeRoute, scrubPii } from './telemetry.ts'

const UUID = '3f2b8c1e-9d4a-4e7b-8a21-5c6d7e8f9a0b'
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop1234'
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.122 Mobile Safari/537.36'

function setup(opts: Parameters<typeof createCspReportHandler>[0] = {}) {
  let t = 1_700_000_000_000
  const lines: string[] = []
  const handler = createCspReportHandler({ now: () => t, log: (l) => lines.push(l), ...opts })
  return {
    handler, lines,
    advance: (ms: number) => { t += ms },
    entries: () => lines.filter((l) => l.startsWith('csp-violation {')).map((l) => JSON.parse(l.slice('csp-violation '.length)) as CspLogEntry).filter((e) => e.event === 'csp-violation'),
  }
}
function post(body: unknown, contentType = 'application/csp-report', headers: Record<string, string> = {}): Request {
  return new Request('https://x.supabase.co/functions/v1/csp-report', {
    method: 'POST', headers: { 'content-type': contentType, 'user-agent': CHROME_ANDROID, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}
function classic(over: Record<string, unknown> = {}) {
  return { 'csp-report': {
    'document-uri': 'https://app.example.com/pools/abc?token=SECRETVALUE#access_token=HASHSECRET', 'violated-directive': "style-src-elem 'self'", 'effective-directive': 'style-src-elem',
    'blocked-uri': 'https://cdn.evil.test/path/x.css?k=v', disposition: 'report', 'original-policy': "default-src 'self'", ...over,
  } }
}
function reportingApi(over: Record<string, unknown> = {}) {
  return [{ type: 'csp-violation', age: 10, url: 'https://app.example.com/', user_agent: CHROME_ANDROID, body: {
    documentURL: 'https://app.example.com/leagues', blockedURL: 'https://fonts.gstatic.com/s/inter/v1/a.woff2', effectiveDirective: 'font-src', disposition: 'report', ...over,
  } }]
}

describe('csp-report: método, tipo, tamaño y forma', () => {
  it('rechaza métodos distintos de POST con 405 sin detalles internos', async () => {
    const { handler, lines } = setup()
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      const res = await handler(new Request('https://x/csp-report', { method }))
      expect(res.status).toBe(405)
      expect(res.headers.get('allow')).toBe('POST')
      expect(await res.json()).toEqual({ code: 'METHOD_NOT_ALLOWED' })
    }
    expect(lines).toHaveLength(0)
  })

  it('rechaza tipos de contenido no aceptados con 415', async () => {
    const { handler } = setup()
    expect((await handler(post(classic(), 'text/plain'))).status).toBe(415)
    expect((await handler(post(classic(), 'application/x-www-form-urlencoded'))).status).toBe(415)
  })

  it('acepta los tres tipos permitidos (con parámetros de charset)', async () => {
    for (const ct of ['application/csp-report', 'application/json; charset=utf-8', 'application/reports+json']) {
      const { handler } = setup()
      expect((await handler(post(classic(), ct))).status).toBe(204)
    }
  })

  it('cuerpo declarado grande: 413 sin leerlo', async () => {
    const { handler, lines } = setup()
    const stream = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array(10)); c.close() } })
    const req = new Request('https://x/csp-report', { method: 'POST', headers: { 'content-type': 'application/csp-report', 'content-length': String(MAX_BODY_BYTES + 1) }, body: stream, duplex: 'half' } as RequestInit)
    const res = await handler(req)
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ code: 'PAYLOAD_TOO_LARGE' })
    expect(req.bodyUsed).toBe(false)   // el manejador nunca tomó el lector del cuerpo
    expect(lines).toHaveLength(0)
  })

  it('cuerpo grande sin content-length: se aborta al superar el tope (413) sin consumirlo entero', async () => {
    const { handler } = setup()
    let chunks = 0
    const stream = new ReadableStream<Uint8Array>({ pull(c) { chunks++; c.enqueue(new Uint8Array(2048)); if (chunks > 100) c.close() } })
    const req = new Request('https://x/csp-report', { method: 'POST', headers: { 'content-type': 'application/csp-report' }, body: stream, duplex: 'half' } as RequestInit)
    const res = await handler(req)
    expect(res.status).toBe(413)
    expect(chunks).toBeLessThan(20)
  })

  it('un cuerpo grande como cadena también devuelve 413', async () => {
    const { handler } = setup()
    expect((await handler(post('x'.repeat(MAX_BODY_BYTES + 10)))).status).toBe(413)
  })

  it('JSON roto, vacío o de forma inválida: 400', async () => {
    const { handler, lines } = setup()
    expect((await handler(post('{not json'))).status).toBe(400)
    expect((await handler(post(''))).status).toBe(400)
    expect((await handler(post('null'))).status).toBe(400)
    expect((await handler(post({}))).status).toBe(400)
    expect((await handler(post({ 'csp-report': 'x' }))).status).toBe(400)
    expect((await handler(post({ 'csp-report': { 'blocked-uri': 'inline' } }))).status).toBe(400)           // sin document-uri/directiva
    expect((await handler(post({ 'csp-report': { 'document-uri': 5, 'violated-directive': 'x' } }))).status).toBe(400)
    expect((await handler(post([]))).status).toBe(400)
    expect((await handler(post([{ type: 'deprecation', body: {} }], 'application/reports+json'))).status).toBe(400)
    expect((await handler(post([{ type: 'csp-violation', body: { documentURL: 'https://a/' } }], 'application/reports+json'))).status).toBe(400)
    expect(lines).toHaveLength(0)
  })

  it('los errores no revelan detalles de validación ni internos', async () => {
    const { handler } = setup()
    const res = await handler(post('{not json'))
    expect(await res.text()).toBe('{"code":"BAD_REQUEST"}')
  })
})

describe('csp-report: formas válidas', () => {
  it('forma clásica (report-uri): 204 sin cuerpo y una línea estructurada con prefijo csp-violation', async () => {
    const { handler, lines, entries } = setup()
    const res = await handler(post(classic()))
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect(lines).toHaveLength(1)
    expect(lines[0]!.startsWith('csp-violation {')).toBe(true)
    expect(entries()[0]).toMatchObject({
      event: 'csp-violation', directive: 'style-src-elem', effective_directive: 'style-src-elem', blocked: 'https://cdn.evil.test',
      route: '/pools/abc', disposition: 'report', ua: 'chrome', platform: 'android', channel: 'report-uri',
    })
  })

  it('Reporting API (report-to) con application/reports+json', async () => {
    const { handler, entries } = setup()
    const res = await handler(post(reportingApi(), 'application/reports+json'))
    expect(res.status).toBe(204)
    expect(entries()[0]).toMatchObject({ directive: 'font-src', blocked: 'https://fonts.gstatic.com', route: '/leagues', disposition: 'report', channel: 'report-to' })
  })

  it('Reporting API: procesa varios reportes del lote (acotado) e ignora tipos ajenos', async () => {
    const { handler, entries } = setup()
    const batch = [
      ...reportingApi({ effectiveDirective: 'img-src', blockedURL: 'https://a.test/i.png' }),
      { type: 'deprecation', body: { id: 'x' } },
      ...reportingApi({ effectiveDirective: 'script-src', blockedURL: 'inline', disposition: 'enforce' }),
    ]
    expect((await handler(post(batch, 'application/reports+json'))).status).toBe(204)
    expect(entries().map((e) => [e.directive, e.blocked, e.disposition])).toEqual([['img-src', 'https://a.test', 'report'], ['script-src', 'inline', 'enforce']])
  })

  it('directivas desconocidas se normalizan a "other"; disposición ausente a "unknown"', async () => {
    const { handler, entries } = setup()
    await handler(post(classic({ 'violated-directive': 'Hacker\nforged: line', 'effective-directive': undefined, disposition: undefined })))
    expect(entries()[0]).toMatchObject({ directive: 'other', disposition: 'unknown' })
  })
})

describe('csp-report: saneamiento (ningún dato sensible llega a la salida)', () => {
  it('query, hash, UUID, correo, JWT y tokens jamás aparecen en el registro', async () => {
    const { handler, lines } = setup()
    const doc = `https://app.example.com/pools/${UUID}/j/ABC123/user%40mail.com/ana.perez@correo.pe/${JWT}?token=SECRETVALUE&email=a@b.co#access_token=HASHSECRET`
    await handler(post(classic({ 'document-uri': doc, 'blocked-uri': `https://user:pass@host.test:8443/p/${UUID}?access_token=SECRETVALUE#frag` })))
    const out = lines.join('\n')
    for (const leak of ['SECRETVALUE', 'HASHSECRET', UUID, 'ABC123', 'ana.perez', '@correo', 'mail.com', JWT, 'user:pass', 'a@b.co', 'eyJ', '?', '#', 'frag']) {
      expect(out, `fuga: ${leak}`).not.toContain(leak)
    }
    const entry = JSON.parse(lines[0]!.slice('csp-violation '.length)) as CspLogEntry
    expect(entry.route).toBe('/pools/[id]/j/[code]/[email]/[email]/[jwt]')
    expect(entry.blocked).toBe('https://host.test:8443')
  })

  it('no se registra el user-agent completo ni versiones, ni la política original ni el referrer', async () => {
    const { handler, lines } = setup()
    await handler(post(classic({ referrer: 'https://secret.example/priv?x=1', 'original-policy': 'default-src SECRETPOLICY', 'script-sample': 'alert("pii")' })))
    const out = lines.join('\n')
    expect(out).not.toMatch(/126\.0|Pixel|AppleWebKit|Mozilla/)
    expect(out).not.toMatch(/secret\.example|SECRETPOLICY|alert/)
  })

  it('segmentos opacos largos (token en la ruta) se enmascaran, pero los slugs normales se conservan', () => {
    expect(safeDocumentRoute('https://a.test/auth/Xk3Jd9Qw2LmZ8vTn4RbY7cHp1sUe')).toBe('/auth/[opaque]')
    expect(safeDocumentRoute('https://a.test/leagues/copa-mundial-2026-fase-de-grupos')).toBe('/leagues/copa-mundial-2026-fase-de-grupos')
    expect(safeDocumentRoute('https://a.test/a%ZZb?x=1')).toBe('/a%ZZb')   // percent-encoding inválido no rompe
    expect(safeDocumentRoute('inline')).toBe('[unknown]')
    expect(safeDocumentRoute('https://a.test')).toBe('/')
  })

  it('blocked-uri se reduce a origen o palabra clave', () => {
    expect(safeBlockedOrigin('https://fonts.gstatic.com/s/inter/a.woff2?x=1')).toBe('https://fonts.gstatic.com')
    expect(safeBlockedOrigin('wss://abc.supabase.co/realtime/v1/websocket?apikey=SECRET')).toBe('wss://abc.supabase.co')
    expect(safeBlockedOrigin('chrome-extension://abcdefg/content.js')).toBe('chrome-extension')
    expect(safeBlockedOrigin('blob:https://app.example.com/3f2b8c1e')).toBe('blob')
    expect(safeBlockedOrigin('data:image/png;base64,AAAA')).toBe('data')
    expect(safeBlockedOrigin('inline')).toBe('inline')
    expect(safeBlockedOrigin('eval')).toBe('eval')
    expect(safeBlockedOrigin('')).toBe('none')
    expect(safeBlockedOrigin('???')).toBe('other')
  })

  it('user-agent: solo familia y plataforma gruesas', () => {
    expect(userAgentFamily(CHROME_ANDROID)).toEqual({ ua: 'chrome', platform: 'android' })
    expect(userAgentFamily('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')).toEqual({ ua: 'safari', platform: 'ios' })
    expect(userAgentFamily('Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0')).toEqual({ ua: 'firefox', platform: 'android' })
    expect(userAgentFamily('Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A; wv) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36')).toEqual({ ua: 'webview', platform: 'android' })
    expect(userAgentFamily(null)).toEqual({ ua: 'other', platform: 'other' })
  })

  it('paridad con telemetry.ts (scrubPii/safeRoute) sobre una tabla de entradas', () => {
    const samples = [
      'plain', `/pools/${UUID}`, '/j/ABC123', 'a@b.com', JWT, 'Bearer abcdefgh12345678', '/cb?access_token=zzz&x=1', '/x#refresh_token=abc', 'x'.repeat(400), '', '/leagues/42',
      `/p/${UUID}/j/Zz9Yy8/extra?token=1#h`,
    ]
    for (const s of samples) {
      expect(coreScrubPii(s)).toBe(scrubPii(s))
      expect(coreSafeRoute(s)).toBe(safeRoute(s))
    }
    expect(coreSafeRoute(undefined)).toBe(safeRoute(undefined))
    expect(safeDocumentRoute(`https://a.test/pools/${UUID}/j/ABC123?q=1#h`)).toBe(safeRoute(`/pools/${UUID}/j/ABC123?q=1#h`))
  })
})

describe('csp-report: deduplicación y límite de tasa', () => {
  it('descarta duplicados (misma directiva+origen+ruta) dentro de 60 s y responde 204 igual', async () => {
    const { handler, entries, advance } = setup()
    const statuses: number[] = []
    for (let i = 0; i < 3; i++) statuses.push((await handler(post(classic({ 'document-uri': `https://a.test/pools/abc?n=${i}#h${i}` })))).status)
    expect(statuses).toEqual([204, 204, 204])
    expect(entries()).toHaveLength(1)
    advance(DEDUPE_WINDOW_MS - 1)
    await handler(post(classic()))
    expect(entries()).toHaveLength(1)
    advance(2)
    await handler(post(classic()))
    expect(entries()).toHaveLength(2)
  })

  it('claves distintas (otra directiva, origen o ruta) no se deduplican', async () => {
    const { handler, entries } = setup()
    await handler(post(classic()))
    await handler(post(classic({ 'blocked-uri': 'https://otro.test/a.css' })))
    await handler(post(classic({ 'document-uri': 'https://a.test/otra' })))
    await handler(post(classic({ 'violated-directive': 'img-src', 'effective-directive': 'img-src' })))
    expect(entries()).toHaveLength(4)
  })

  it('limita la tasa por instancia: el exceso se descarta con 204 y se resume al cambiar la ventana', async () => {
    const { handler, entries, lines, advance } = setup({ rateLimit: 5 })
    const statuses = new Set<number>()
    for (let i = 0; i < 12; i++) statuses.add((await handler(post(classic({ 'document-uri': `https://a.test/r${i}` })))).status)
    expect([...statuses]).toEqual([204])
    expect(entries()).toHaveLength(5)
    advance(60_001)
    await handler(post(classic({ 'document-uri': 'https://a.test/nuevo' })))
    expect(entries()).toHaveLength(6)
    const summary = lines.find((l) => l.includes('csp-violation-suppressed'))
    expect(summary).toBeDefined()
    expect(JSON.parse(summary!.slice('csp-violation '.length))).toMatchObject({ event: 'csp-violation-suppressed', suppressed: 7 })
  })

  it('el límite por defecto es finito y razonable; el mapa de claves no crece sin límite', async () => {
    expect(RATE_LIMIT).toBeGreaterThan(0)
    const { handler, entries } = setup({ rateLimit: 100_000 })
    for (let i = 0; i < 700; i++) await handler(post(classic({ 'document-uri': `https://a.test/k${i}` })))
    expect(entries().length).toBeLessThanOrEqual(500)   // MAX_TRACKED_KEYS
  })
})

describe('csp-report: CORS y uniformidad de respuesta', () => {
  it('sin lista de orígenes no emite cabeceras CORS; OPTIONS => 405', async () => {
    const { handler } = setup()
    const res = await handler(post(classic(), 'application/csp-report', { origin: 'https://app.example.com' }))
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect((await handler(new Request('https://x/csp-report', { method: 'OPTIONS', headers: { origin: 'https://app.example.com' } }))).status).toBe(405)
  })

  it('preflight de report-to: solo orígenes permitidos, solo POST y content-type; nunca "*"', async () => {
    const { handler } = setup({ allowedOrigins: ['https://app.example.com'] })
    const ok = await handler(new Request('https://x/csp-report', { method: 'OPTIONS', headers: { origin: 'https://app.example.com' } }))
    expect(ok.status).toBe(204)
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.example.com')
    expect(ok.headers.get('access-control-allow-methods')).toBe('POST')
    const bad = await handler(new Request('https://x/csp-report', { method: 'OPTIONS', headers: { origin: 'https://evil.test' } }))
    expect(bad.status).toBe(405)
    expect(bad.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('todas las respuestas 204 son idénticas (sin cuerpo) para reportes nuevos, duplicados y suprimidos', async () => {
    const { handler } = setup({ rateLimit: 1 })
    const results = []
    for (let i = 0; i < 3; i++) {
      const res = await handler(post(classic({ 'document-uri': `https://a.test/${i % 2}` })))
      results.push([res.status, await res.text(), res.headers.get('content-type')])
    }
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1)
  })

  it('un fallo interno del registro devuelve 204 sin detalles (no reintentos del navegador)', async () => {
    const { handler } = setup({ log: () => { throw new Error('boom: secreto interno') } })
    const res = await handler(post(classic()))
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
  })
})
