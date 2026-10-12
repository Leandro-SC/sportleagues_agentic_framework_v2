// Pruebas de la PWA: lógica de registro (pura), reglas de exclusión del service worker real (public/sw.js se carga
// en un sandbox `vm`, sin duplicar la lógica) y campos obligatorios del manifest/index.html.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { deepLinkToRoute, disableServiceWorker, isSecureOrigin, registerNativeDeepLinks, shouldRegisterServiceWorker } from './pwa'

const publicDir = (name: string) => resolve(import.meta.dirname, '../../public', name)
const ORIGIN = 'https://app.sportleagues.test'

type Rules = {
  classifyRequest: (req: Record<string, unknown>, origin: string) => 'bypass' | 'navigate' | 'static'
  isCacheableResponse: (res: unknown, kind: 'static' | 'shell') => boolean
}

type FakeResponse = { ok: boolean; status: number; type: string; headers: { get(name: string): string | null }; clone(): FakeResponse }
function res(init: { status?: number; type?: string; headers?: Record<string, string> } = {}): FakeResponse {
  const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
  const self: FakeResponse = {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    type: init.type ?? 'basic',
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    clone: () => self,
  }
  return self
}

type Listener = (event: Record<string, unknown>) => void
function loadServiceWorker() {
  const listeners: Record<string, Listener> = {}
  const store = new Map<string, Map<string, FakeResponse>>()
  const caches = {
    open: async (name: string) => {
      const bucket = store.get(name) ?? new Map<string, FakeResponse>()
      store.set(name, bucket)
      return {
        match: async (key: unknown) => bucket.get(typeof key === 'string' ? key : (key as { url: string }).url),
        put: async (key: unknown, value: FakeResponse) => { bucket.set(typeof key === 'string' ? key : (key as { url: string }).url, value) },
        keys: async () => [...bucket.keys()].map((url) => ({ url })),
        delete: async (key: { url: string }) => bucket.delete(key.url),
      }
    },
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
  }
  const fetchMock = vi.fn()
  const self: Record<string, unknown> = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Listener) => { listeners[type] = fn },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => undefined) },
    registration: { unregister: vi.fn(async () => true) },
  }
  const context = vm.createContext({ self, caches, fetch: fetchMock, Request: class { constructor(public url: string) {} }, Response: { error: () => 'ERR' }, URL, Promise, console })
  vm.runInContext(readFileSync(publicDir('sw.js'), 'utf8'), context, { filename: 'sw.js' })
  return { rules: self.SL_SW_RULES as Rules, listeners, store, fetchMock, self }
}

function fetchEvent(url: string, init: { method?: string; mode?: string; headers?: Record<string, string> } = {}) {
  const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
  const respondWith = vi.fn()
  return {
    respondWith,
    event: { respondWith, request: { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors', headers: { has: (n: string) => n.toLowerCase() in headers } } },
  }
}

describe('shouldRegisterServiceWorker', () => {
  const base = { production: true, supported: true, protocol: 'https:', hostname: 'app.example.com', isNative: false, disabled: false }
  it('registra en producción sobre HTTPS y en localhost', () => {
    expect(shouldRegisterServiceWorker(base)).toBe(true)
    expect(shouldRegisterServiceWorker({ ...base, protocol: 'http:', hostname: 'localhost' })).toBe(true)
  })
  it('no registra en desarrollo, sin soporte, http remoto, wrapper nativo o kill-switch', () => {
    expect(shouldRegisterServiceWorker({ ...base, production: false })).toBe(false)
    expect(shouldRegisterServiceWorker({ ...base, supported: false })).toBe(false)
    expect(shouldRegisterServiceWorker({ ...base, protocol: 'http:', hostname: 'app.example.com' })).toBe(false)
    expect(shouldRegisterServiceWorker({ ...base, isNative: true })).toBe(false)
    expect(shouldRegisterServiceWorker({ ...base, disabled: true })).toBe(false)
  })
  it('isSecureOrigin acepta solo https y loopback', () => {
    expect(isSecureOrigin('https:', 'x.com')).toBe(true)
    expect(isSecureOrigin('http:', '127.0.0.1')).toBe(true)
    expect(isSecureOrigin('http:', 'x.com')).toBe(false)
    expect(isSecureOrigin('file:', '')).toBe(false)
  })
})

describe('disableServiceWorker (kill-switch cliente)', () => {
  it('desregistra y borra solo cachés con prefijo sl-', async () => {
    const unregister = vi.fn(async () => true)
    const deleted: string[] = []
    vi.stubGlobal('navigator', { serviceWorker: { getRegistrations: async () => [{ unregister }, { unregister }] } })
    vi.stubGlobal('caches', { keys: async () => ['sl-shell-v1', 'sl-static-v1', 'otra-app'], delete: async (n: string) => { deleted.push(n); return true } })
    await disableServiceWorker()
    expect(unregister).toHaveBeenCalledTimes(2)
    expect(deleted).toEqual(['sl-shell-v1', 'sl-static-v1'])
    vi.unstubAllGlobals()
  })
  it('no lanza si la API falla', async () => {
    vi.stubGlobal('navigator', { serviceWorker: { getRegistrations: async () => { throw new Error('x') } } })
    vi.stubGlobal('caches', { keys: async () => { throw new Error('x') } })
    await expect(disableServiceWorker()).resolves.toBeUndefined()
    vi.unstubAllGlobals()
  })
})

describe('public/sw.js: reglas de exclusión', () => {
  const { rules } = loadServiceWorker()
  const classify = (url: string, extra: Record<string, unknown> = {}) => rules.classifyRequest({ url, method: 'GET', mode: 'cors', ...extra }, ORIGIN)

  it('nunca intercepta otros orígenes ni Supabase', () => {
    expect(classify('https://abc.supabase.co/rest/v1/pools')).toBe('bypass')
    expect(classify('https://abc.supabase.co/storage/v1/object/public/x.png')).toBe('bypass')
    expect(classify('https://cdn.example.com/assets/app.js')).toBe('bypass')
    expect(classify('https://api.football-data.org/v4/matches')).toBe('bypass')
    expect(classify('https://abc.supabase.co/assets/app.js', { mode: 'navigate' })).toBe('bypass')
  })
  it('nunca intercepta rutas /auth ni callbacks con parámetros sensibles', () => {
    expect(classify(`${ORIGIN}/auth/callback`, { mode: 'navigate' })).toBe('bypass')
    expect(classify(`${ORIGIN}/auth/reset`, { mode: 'navigate' })).toBe('bypass')
    expect(classify(`${ORIGIN}/auth`, { mode: 'navigate' })).toBe('bypass')
    expect(classify(`${ORIGIN}/auth/v1/token`)).toBe('bypass')
    expect(classify(`${ORIGIN}/?code=abc`, { mode: 'navigate' })).toBe('bypass')
    expect(classify(`${ORIGIN}/?access_token=abc`, { mode: 'navigate' })).toBe('bypass')
    expect(classify(`${ORIGIN}/?type=recovery`, { mode: 'navigate' })).toBe('bypass')
    expect(classify(`${ORIGIN}/assets/app.js?token_hash=x`)).toBe('bypass')
  })
  it('nunca intercepta métodos no-GET, Authorization ni Range', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      expect(classify(`${ORIGIN}/assets/app.js`, { method })).toBe('bypass')
    }
    expect(classify(`${ORIGIN}/assets/app.js`, { hasAuthorization: true })).toBe('bypass')
    expect(classify(`${ORIGIN}/images/x.jpg`, { hasRange: true })).toBe('bypass')
  })
  it('solo estáticos conocidos del mismo origen son cache-first; navegación es network-first', () => {
    expect(classify(`${ORIGIN}/assets/index-abc123.js`)).toBe('static')
    expect(classify(`${ORIGIN}/flags/pe.svg`)).toBe('static')
    expect(classify(`${ORIGIN}/images/stadium-night-alex-simpson.jpg`)).toBe('static')
    expect(classify(`${ORIGIN}/icons/icon-192.png`)).toBe('static')
    expect(classify(`${ORIGIN}/p/123`, { mode: 'navigate' })).toBe('navigate')
    expect(classify(`${ORIGIN}/j/ABC123`, { mode: 'navigate' })).toBe('navigate')
    // cualquier otra ruta same-origin (API propia, JSON, etc.) no se cachea
    expect(classify(`${ORIGIN}/api/private.json`)).toBe('bypass')
    expect(classify('not a url')).toBe('bypass')
    expect(classify('chrome-extension://x/assets/a.js')).toBe('bypass')
  })

  it('isCacheableResponse rechaza no-store, private, cookies, Vary:*, opaque, errores y HTML como activo', () => {
    const ok = res({ headers: { 'content-type': 'application/javascript' } })
    expect(rules.isCacheableResponse(ok, 'static')).toBe(true)
    expect(rules.isCacheableResponse(res({ headers: { 'cache-control': 'no-store' } }), 'static')).toBe(false)
    expect(rules.isCacheableResponse(res({ headers: { 'cache-control': 'private, max-age=0' } }), 'static')).toBe(false)
    expect(rules.isCacheableResponse(res({ headers: { 'set-cookie': 'sid=1' } }), 'static')).toBe(false)
    expect(rules.isCacheableResponse(res({ headers: { vary: '*' } }), 'static')).toBe(false)
    expect(rules.isCacheableResponse(res({ type: 'opaque' }), 'static')).toBe(false)
    expect(rules.isCacheableResponse(res({ type: 'cors' }), 'static')).toBe(false)
    expect(rules.isCacheableResponse(res({ status: 404 }), 'static')).toBe(false)
    expect(rules.isCacheableResponse(res({ status: 500 }), 'shell')).toBe(false)
    // rewrite de Vercel: ruta de activo inexistente devuelve index.html con 200
    expect(rules.isCacheableResponse(res({ headers: { 'content-type': 'text/html; charset=utf-8' } }), 'static')).toBe(false)
    expect(rules.isCacheableResponse(res({ headers: { 'content-type': 'text/html' } }), 'shell')).toBe(true)
    expect(rules.isCacheableResponse(res({ headers: { 'content-type': 'application/json' } }), 'shell')).toBe(false)
  })
})

describe('public/sw.js: comportamiento del listener fetch', () => {
  it('no llama a respondWith para Supabase, /auth, POST ni otros orígenes', () => {
    const { listeners } = loadServiceWorker()
    for (const [url, init] of [
      ['https://abc.supabase.co/rest/v1/x', {}],
      [`${ORIGIN}/auth/callback`, { mode: 'navigate' }],
      [`${ORIGIN}/assets/a.js`, { method: 'POST' }],
      ['https://otro.com/assets/a.js', {}],
      [`${ORIGIN}/assets/a.js`, { headers: { Authorization: 'Bearer x' } }],
    ] as const) {
      const { event, respondWith } = fetchEvent(url, init)
      listeners.fetch(event)
      expect(respondWith, url).not.toHaveBeenCalled()
    }
  })

  it('estático: cache-first, guarda JS válido y no guarda HTML ni no-store', async () => {
    const { listeners, store, fetchMock } = loadServiceWorker()
    fetchMock.mockResolvedValueOnce(res({ headers: { 'content-type': 'text/javascript' } }))
    const a = fetchEvent(`${ORIGIN}/assets/a.js`)
    listeners.fetch(a.event)
    await a.respondWith.mock.calls[0][0]
    await new Promise((r) => setTimeout(r, 0))
    expect(store.get('sl-static-v1')?.has(`${ORIGIN}/assets/a.js`)).toBe(true)

    fetchMock.mockResolvedValueOnce(res({ headers: { 'content-type': 'text/html' } }))
    const b = fetchEvent(`${ORIGIN}/assets/missing.js`)
    listeners.fetch(b.event)
    await b.respondWith.mock.calls[0][0]
    await new Promise((r) => setTimeout(r, 0))
    expect(store.get('sl-static-v1')?.has(`${ORIGIN}/assets/missing.js`)).toBe(false)

    // segunda lectura de a.js sale de caché sin red
    fetchMock.mockClear()
    const c = fetchEvent(`${ORIGIN}/assets/a.js`)
    listeners.fetch(c.event)
    await c.respondWith.mock.calls[0][0]
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('navegación: network-first, guarda el shell bajo "/" (no la URL real) y cae al shell/offline sin red', async () => {
    const { listeners, store, fetchMock } = loadServiceWorker()
    fetchMock.mockResolvedValueOnce(res({ headers: { 'content-type': 'text/html' } }))
    const online = fetchEvent(`${ORIGIN}/p/42?foo=bar`, { mode: 'navigate' })
    listeners.fetch(online.event)
    await online.respondWith.mock.calls[0][0]
    await new Promise((r) => setTimeout(r, 0))
    const shell = store.get('sl-shell-v1')
    expect([...(shell?.keys() ?? [])]).toEqual(['/'])

    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    const offline = fetchEvent(`${ORIGIN}/p/42`, { mode: 'navigate' })
    listeners.fetch(offline.event)
    expect(await offline.respondWith.mock.calls[0][0]).toBe(shell?.get('/'))
  })

  it('activate borra cachés sl- antiguas y respeta las ajenas; SL_KILL borra y desregistra', async () => {
    const { listeners, store, self } = loadServiceWorker()
    store.set('sl-shell-v0', new Map()); store.set('sl-shell-v1', new Map()); store.set('otra-app', new Map())
    const waits: Promise<unknown>[] = []
    listeners.activate({ waitUntil: (p: Promise<unknown>) => waits.push(p) })
    await Promise.all(waits)
    expect([...store.keys()].sort()).toEqual(['otra-app', 'sl-shell-v1'])

    const killWaits: Promise<unknown>[] = []
    listeners.message({ data: { type: 'SL_KILL' }, waitUntil: (p: Promise<unknown>) => killWaits.push(p) })
    await Promise.all(killWaits)
    expect([...store.keys()]).toEqual(['otra-app'])
    expect((self.registration as { unregister: () => void }).unregister).toHaveBeenCalled()
  })

  it('precache del shell sin skipWaiting automático: solo con mensaje SKIP_WAITING', async () => {
    const { listeners, self, store, fetchMock } = loadServiceWorker()
    fetchMock.mockImplementation(async (request: { url: string }) => res({ headers: { 'content-type': request.url === '/' ? 'text/html' : 'text/plain' } }))
    const waits: Promise<unknown>[] = []
    listeners.install({ waitUntil: (p: Promise<unknown>) => waits.push(p) })
    await Promise.all(waits)
    expect([...(store.get('sl-shell-v1')?.keys() ?? [])].sort()).toEqual(['/', '/icons/icon-192.png', '/manifest.webmanifest', '/offline.html'])
    expect(self.skipWaiting).not.toHaveBeenCalled()
    listeners.message({ data: { type: 'SKIP_WAITING' } })
    expect(self.skipWaiting).toHaveBeenCalledTimes(1)
  })
})

describe('manifest.webmanifest e index.html', () => {
  const manifest = JSON.parse(readFileSync(publicDir('manifest.webmanifest'), 'utf8'))
  it('incluye los campos obligatorios y coherentes con el tema', () => {
    expect(manifest).toMatchObject({ name: 'SportLeagues', short_name: expect.any(String), lang: 'es', start_url: '/', scope: '/', display: 'standalone', theme_color: '#03111c', background_color: '#03111c' })
    expect(manifest.short_name.length).toBeLessThanOrEqual(12)
  })
  it('declara iconos 192/512 any y maskable cuyos archivos existen y no están vacíos', () => {
    const icons = manifest.icons as { src: string; sizes: string; type: string; purpose: string }[]
    for (const size of ['192x192', '512x512']) {
      for (const purpose of ['any', 'maskable']) expect(icons.some((i) => i.sizes === size && i.purpose === purpose && i.type === 'image/png')).toBe(true)
    }
    for (const icon of icons) {
      const file = publicDir(icon.src.replace(/^\//, ''))
      expect(existsSync(file), icon.src).toBe(true)
      expect(statSync(file).size).toBeGreaterThan(1000)
    }
  })
  it('PNG con dimensiones reales iguales a las declaradas', () => {
    for (const icon of manifest.icons as { src: string; sizes: string }[]) {
      const buffer = readFileSync(publicDir(icon.src.replace(/^\//, '')))
      expect(buffer.subarray(1, 4).toString()).toBe('PNG')
      const [w, h] = icon.sizes.split('x').map(Number)
      expect([buffer.readUInt32BE(16), buffer.readUInt32BE(20)]).toEqual([w, h])
    }
  })
  it('index.html enlaza manifest, apple-touch-icon y theme-color; offline.html existe', () => {
    const html = readFileSync(resolve(import.meta.dirname, '../../index.html'), 'utf8')
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"')
    expect(html).toContain('rel="apple-touch-icon"')
    expect(html).toContain('name="theme-color" content="#03111c"')
    expect(existsSync(publicDir('offline.html'))).toBe(true)
    expect(existsSync(publicDir('icons/apple-touch-icon.png'))).toBe(true)
  })
})

describe('deepLinkToRoute', () => {
  const hosts = ['app.example.com']
  it('acepta /j/:code y /p/:poolId https de hosts permitidos y descarta query/hash', () => {
    expect(deepLinkToRoute('https://app.example.com/j/ABC123?utm=x#access_token=secret', hosts)).toBe('/j/ABC123')
    expect(deepLinkToRoute('https://APP.example.com/p/3f2a-9b/', hosts)).toBe('/p/3f2a-9b')
  })
  it('rechaza hosts ajenos, http, credenciales, rutas no permitidas y códigos mal formados', () => {
    expect(deepLinkToRoute('https://evil.com/j/ABC123', hosts)).toBeNull()
    expect(deepLinkToRoute('http://app.example.com/j/ABC123', hosts)).toBeNull()
    expect(deepLinkToRoute('https://user:pw@app.example.com/j/ABC123', hosts)).toBeNull()
    expect(deepLinkToRoute('https://app.example.com/auth/callback', hosts)).toBeNull()
    expect(deepLinkToRoute('https://app.example.com/admin', hosts)).toBeNull()
    expect(deepLinkToRoute('https://app.example.com/j/AB', hosts)).toBeNull()
    expect(deepLinkToRoute('https://app.example.com/p/../admin', hosts)).toBeNull()
    expect(deepLinkToRoute('https://app.example.com/j/ABC123', [])).toBeNull()
    expect(deepLinkToRoute('javascript:alert(1)', hosts)).toBeNull()
  })
  it('registerNativeDeepLinks no hace nada fuera del wrapper nativo', async () => {
    expect(await registerNativeDeepLinks(() => undefined, ['app.example.com'])).toBeNull()
  })
  it('registerNativeDeepLinks navega solo con enlaces válidos dentro del wrapper', async () => {
    let listener: (event: { url?: string }) => void = () => undefined
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true, Plugins: { App: { addListener: async (_: string, cb: typeof listener) => { listener = cb; return { remove: () => undefined } } } } })
    const navigate = vi.fn()
    const off = await registerNativeDeepLinks(navigate, ['app.example.com'])
    expect(off).toBeTypeOf('function')
    listener({ url: 'https://app.example.com/j/ABC123' })
    listener({ url: 'https://evil.com/j/ABC123' })
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('/j/ABC123')
    vi.unstubAllGlobals()
  })
})

describe('mobile/ (Capacitor)', () => {
  const mobile = (name: string) => resolve(import.meta.dirname, '../../../../mobile', name)
  it('capacitor.config.json: webDir al build web, esquema https y sin server.url', () => {
    const config = JSON.parse(readFileSync(mobile('capacitor.config.json'), 'utf8'))
    expect(config.appId).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/)
    expect(config.webDir).toBe('../apps/platform/dist')
    expect(config.server.androidScheme).toBe('https')
    expect(config.server.url).toBeUndefined()
    expect(config.server.cleartext).toBe(false)
  })
  it('mobile/package.json está aislado y solo declara Capacitor', () => {
    const pkg = JSON.parse(readFileSync(mobile('package.json'), 'utf8'))
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    expect(deps.every((name) => name.startsWith('@capacitor/'))).toBe(true)
    expect(deps).not.toContain('@capacitor/ios')
  })
  it('plantillas de deep link no contienen fingerprints ni hosts inventados', () => {
    const assetlinks = readFileSync(mobile('deep-links/assetlinks.template.json'), 'utf8')
    expect(assetlinks).toContain('REPLACE_WITH_OWNER_SHA256_SIGNING_FINGERPRINT')
    expect(assetlinks).not.toMatch(/([0-9A-F]{2}:){31}[0-9A-F]{2}/i)
    expect(readFileSync(mobile('deep-links/android-intent-filters.template.xml'), 'utf8')).toContain('REPLACE_WITH_APP_LINK_HOST')
  })
})
