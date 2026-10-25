/* SportLeagues service worker (escrito a mano, sin dependencias; Fase 11).
 *
 * Principio: este SW NUNCA toca datos privados. La caché privada vive en IndexedDB por cuenta
 * (src/lib/offline-cache.ts). Aquí solo se guarda el shell estático y activos públicos del mismo origen.
 *
 * Qué hace:
 *   - Precache mínimo: /offline.html, manifest e icono (el shell "/" se intenta guardar sin bloquear la instalación).
 *   - Navegación: network-first; si falla la red -> shell "/" cacheado -> /offline.html.
 *   - Activos estáticos (/assets, /flags, /images, /icons) del mismo origen: cache-first.
 *
 * Qué NO hace jamás (ver classifyRequest / isCacheableResponse):
 *   - Cualquier origen distinto al propio (incluye *.supabase.co, Storage, Edge Functions, proveedores deportivos).
 *   - Rutas /auth/* ni URLs con parámetros de callback OAuth/recuperación (code, access_token, token_hash, error...).
 *   - Peticiones no-GET, con cabecera Authorization o Range.
 *   - Respuestas con Cache-Control no-store/private, Set-Cookie o Vary: *.
 *
 * Kill-switch: ver docs/operations/PWA-CAPACITOR-RUNBOOK.md (sección "Kill-switch").
 * Subir CACHE_VERSION invalida todas las cachés anteriores (se borran en `activate`).
 */
'use strict'

const CACHE_VERSION = 'v1'
const CACHE_PREFIX = 'sl-'
const SHELL_CACHE = CACHE_PREFIX + 'shell-' + CACHE_VERSION
const STATIC_CACHE = CACHE_PREFIX + 'static-' + CACHE_VERSION
const MAX_STATIC_ENTRIES = 150
const SHELL_URL = '/'
const OFFLINE_URL = '/offline.html'
const PRECACHE_REQUIRED = [OFFLINE_URL]
const PRECACHE_OPTIONAL = [SHELL_URL, '/manifest.webmanifest', '/icons/icon-192.png']

const STATIC_PREFIXES = ['/assets/', '/flags/', '/images/', '/icons/']
const SENSITIVE_QUERY_KEYS = ['code', 'access_token', 'refresh_token', 'token_hash', 'token', 'error', 'error_description', 'error_code', 'state']
const BLOCKED_HOST_SUFFIXES = ['.supabase.co', '.supabase.in', '.supabase.net']

function hasBlockedHost(hostname) {
  const host = String(hostname || '').toLowerCase()
  return BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
}

function isAuthPath(pathname) {
  return pathname === '/auth' || pathname.indexOf('/auth/') === 0
}

function hasSensitiveQuery(searchParams) {
  for (let i = 0; i < SENSITIVE_QUERY_KEYS.length; i += 1) {
    if (searchParams.has(SENSITIVE_QUERY_KEYS[i])) return true
  }
  return searchParams.get('type') === 'recovery'
}

/**
 * Decide qué hace el SW con una petición. Función pura (testeada desde Vitest leyendo este mismo archivo).
 * req: { url: string, method: string, mode?: string, hasAuthorization?: boolean, hasRange?: boolean }
 * Devuelve 'bypass' (no intervenir), 'navigate' (network-first) o 'static' (cache-first).
 */
function classifyRequest(req, ownOrigin) {
  if (!req || String(req.method || 'GET').toUpperCase() !== 'GET') return 'bypass'
  if (req.hasAuthorization || req.hasRange) return 'bypass'
  let url
  try {
    url = new URL(req.url)
  } catch (_) {
    return 'bypass'
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'bypass'
  if (url.origin !== ownOrigin) return 'bypass'
  if (hasBlockedHost(url.hostname)) return 'bypass'
  if (isAuthPath(url.pathname)) return 'bypass'
  if (req.mode === 'navigate') return hasSensitiveQuery(url.searchParams) ? 'bypass' : 'navigate'
  if (hasSensitiveQuery(url.searchParams)) return 'bypass'
  if (STATIC_PREFIXES.some((prefix) => url.pathname.indexOf(prefix) === 0)) return 'static'
  return 'bypass'
}

/** ¿Se puede guardar esta respuesta? kind: 'static' | 'shell'. */
function isCacheableResponse(response, kind) {
  if (!response || response.status !== 200 || response.type !== 'basic') return false
  const headers = response.headers
  const cacheControl = String(headers.get('cache-control') || '').toLowerCase()
  if (cacheControl.indexOf('no-store') !== -1 || cacheControl.indexOf('private') !== -1) return false
  if (headers.get('set-cookie')) return false
  if (String(headers.get('vary') || '').trim() === '*') return false
  const contentType = String(headers.get('content-type') || '').toLowerCase()
  // Vercel reescribe rutas inexistentes a "/" con 200 + HTML: nunca guardar HTML como si fuera un activo.
  if (kind === 'static' && contentType.indexOf('text/html') !== -1) return false
  if (kind === 'shell' && contentType.indexOf('text/html') === -1) return false
  return true
}

function describeRequest(request) {
  return {
    url: request.url,
    method: request.method,
    mode: request.mode,
    hasAuthorization: request.headers.has('authorization'),
    hasRange: request.headers.has('range'),
  }
}

async function precache() {
  const shell = await caches.open(SHELL_CACHE)
  await Promise.all(PRECACHE_REQUIRED.map(async (url) => {
    const response = await fetch(new Request(url, { cache: 'reload' }))
    if (!response.ok) throw new Error('precache ' + url + ' ' + response.status)
    await shell.put(url, response)
  }))
  // Opcionales: no bloquean la instalación si fallan.
  await Promise.all(PRECACHE_OPTIONAL.map(async (url) => {
    try {
      const response = await fetch(new Request(url, { cache: 'reload' }))
      const ok = url === SHELL_URL
        ? isCacheableResponse(response, 'shell')
        : response.status === 200 && response.type === 'basic'
      if (ok) await shell.put(url, response)
    } catch (_) { /* opcional */ }
  }))
}

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  for (let i = 0; i < keys.length - max; i += 1) await cache.delete(keys[i])
}

async function handleNavigation(request) {
  try {
    const response = await fetch(request)
    if (isCacheableResponse(response, 'shell')) {
      const copy = response.clone()
      // Siempre bajo la clave "/": nunca se persiste la URL real (podría llevar parámetros).
      caches.open(SHELL_CACHE).then((cache) => cache.put(SHELL_URL, copy)).catch(() => undefined)
    }
    return response
  } catch (error) {
    const cache = await caches.open(SHELL_CACHE)
    return (await cache.match(SHELL_URL)) || (await cache.match(OFFLINE_URL)) || Response.error()
  }
}

async function handleStatic(request) {
  const cache = await caches.open(STATIC_CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (isCacheableResponse(response, 'static')) {
    const copy = response.clone()
    cache.put(request, copy).then(() => trim(STATIC_CACHE, MAX_STATIC_ENTRIES)).catch(() => undefined)
  }
  return response
}

async function killSwitch() {
  const names = await caches.keys()
  await Promise.all(names.filter((name) => name.indexOf(CACHE_PREFIX) === 0).map((name) => caches.delete(name)))
  await self.registration.unregister()
}

self.addEventListener('install', (event) => {
  // Sin skipWaiting automático: la página decide (mensaje SKIP_WAITING) para no cambiar de versión en medio de un flujo.
  event.waitUntil(precache())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL_CACHE, STATIC_CACHE]
    const names = await caches.keys()
    await Promise.all(names.filter((name) => name.indexOf(CACHE_PREFIX) === 0 && keep.indexOf(name) === -1).map((name) => caches.delete(name)))
    await self.clients.claim()
  })())
})

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type
  if (type === 'SKIP_WAITING') self.skipWaiting()
  if (type === 'SL_KILL') event.waitUntil(killSwitch())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const decision = classifyRequest(describeRequest(request), self.location.origin)
  if (decision === 'navigate') event.respondWith(handleNavigation(request))
  else if (decision === 'static') event.respondWith(handleStatic(request))
  // 'bypass': no se llama a respondWith -> el navegador gestiona la petición con normalidad.
})

// Expuesto solo para pruebas unitarias (no es API).
self.SL_SW_RULES = { classifyRequest, isCacheableResponse, CACHE_VERSION, SHELL_CACHE, STATIC_CACHE }
