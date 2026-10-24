// Registro del service worker (public/sw.js). Fase 11.
//
// Cierre de sesión: NO hace falta tocar el SW. Este SW solo guarda el shell estático y activos públicos del
// mismo origen; nunca datos de usuario, respuestas de Supabase ni rutas /auth/*. Los datos privados viven en la
// caché IndexedDB por cuenta (offline-cache.ts), que ya se purga en logout/cambio de identidad
// (purgePrivateCaches). Por eso no se envía ningún mensaje al SW al cerrar sesión.
//
// Sin PII en logs: no se registra nada salvo el nombre de la fase que falló.

export const PWA_UPDATE_EVENT = 'sl:pwa-update-available'
export const SW_URL = '/sw.js'
const CACHE_PREFIX = 'sl-'

export type RegisterDecisionInput = {
  /** import.meta.env.PROD */
  production: boolean
  /** 'serviceWorker' in navigator */
  supported: boolean
  protocol: string
  hostname: string
  /** Dentro del wrapper Capacitor los activos ya son locales: no se registra SW. */
  isNative: boolean
  /** Kill-switch de build (VITE_PWA_DISABLED=true). */
  disabled: boolean
}

export function isSecureOrigin(protocol: string, hostname: string): boolean {
  if (protocol === 'https:') return true
  return protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]')
}

export function shouldRegisterServiceWorker(input: RegisterDecisionInput): boolean {
  if (input.disabled || input.isNative || !input.production || !input.supported) return false
  return isSecureOrigin(input.protocol, input.hostname)
}

export function isNativePlatform(): boolean {
  try {
    const capacitor = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    return Boolean(capacitor?.isNativePlatform?.())
  } catch {
    return false
  }
}

/** Kill-switch: desregistra todos los SW y borra únicamente las cachés propias (prefijo `sl-`). Nunca lanza. */
export async function disableServiceWorker(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker?.getRegistrations?.()
    await Promise.all((registrations ?? []).map((registration) => registration.unregister()))
  } catch {
    /* prescindible */
  }
  try {
    if (typeof caches === 'undefined') return
    const names = await caches.keys()
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => caches.delete(name)))
  } catch {
    /* prescindible */
  }
}

function notifyUpdate(registration: ServiceWorkerRegistration): void {
  window.dispatchEvent(new CustomEvent(PWA_UPDATE_EVENT, { detail: { registration } }))
}

/** Activa la versión nueva en espera y recarga una sola vez. Sin UI propia: la invocará quien consuma el evento. */
export function applyPwaUpdate(registration: ServiceWorkerRegistration): void {
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return
    reloaded = true
    window.location.reload()
  })
  registration.waiting?.postMessage({ type: 'SKIP_WAITING' })
}

function watchForUpdates(registration: ServiceWorkerRegistration): void {
  // Una versión ya instalada y en espera (p. ej. abierta en otra pestaña).
  if (registration.waiting && navigator.serviceWorker.controller) notifyUpdate(registration)
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing
    installing?.addEventListener('statechange', () => {
      // `controller` existe solo si ya había un SW activo: es una actualización, no la primera instalación.
      if (installing.state === 'installed' && navigator.serviceWorker.controller) notifyUpdate(registration)
    })
  })
}

/** Registra el SW cuando corresponde. Tolerante a fallos: devuelve null si no registra. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  const env = import.meta.env as Record<string, string | boolean | undefined>
  const disabled = env.VITE_PWA_DISABLED === 'true'
  const supported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
  if (!supported) return null
  if (disabled) {
    await disableServiceWorker()
    return null
  }
  const allowed = shouldRegisterServiceWorker({
    production: Boolean(env.PROD),
    supported,
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    isNative: isNativePlatform(),
    disabled,
  })
  if (!allowed) return null
  try {
    const registration = await navigator.serviceWorker.register(SW_URL, { scope: '/', updateViaCache: 'none' })
    watchForUpdates(registration)
    return registration
  } catch {
    // Sin logs con datos de usuario; la app funciona igual sin SW.
    return null
  }
}

// --- Deep links nativos (Capacitor App Links), cableados en main.ts. No conceden ningún permiso: solo traducen una URL
// https de un host permitido a una ruta interna conocida; la autorización sigue siendo server-side (join_pool/RLS).
// Los hosts deben coincidir con los intent-filter de AndroidManifest.xml y servir /.well-known/assetlinks.json.
const DEFAULT_APP_LINK_HOSTS = ['sportleagues-qa.vercel.app'] as const
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

/** Hosts de App Links desde `VITE_APP_LINK_HOSTS` (separados por comas); sin ningún valor válido, el host de QA. */
export function appLinkHosts(raw: string | undefined = import.meta.env.VITE_APP_LINK_HOSTS): string[] {
  const hosts = (raw ?? '').split(',').map((host) => host.trim().toLowerCase()).filter((host) => HOSTNAME.test(host))
  return hosts.length ? hosts : [...DEFAULT_APP_LINK_HOSTS]
}

const DEEP_LINK_PATH = /^\/(?:j\/[A-Za-z0-9]{6}|p\/[A-Za-z0-9_-]{1,64})\/?$/

/** Devuelve la ruta interna (`/j/:code` o `/p/:poolId`) o null. Descarta query/hash para no arrastrar tokens. */
export function deepLinkToRoute(rawUrl: string, allowedHosts: readonly string[]): string | null {
  let url: URL
  try { url = new URL(rawUrl) } catch { return null }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  if (!allowedHosts.some((host) => host.toLowerCase() === url.hostname.toLowerCase())) return null
  return DEEP_LINK_PATH.test(url.pathname) ? url.pathname.replace(/\/$/, '') : null
}

/** Escucha `appUrlOpen` del plugin nativo @capacitor/app (sin importarlo: se usa el registro global de Capacitor). */
export async function registerNativeDeepLinks(navigate: (path: string) => void, allowedHosts: readonly string[]): Promise<(() => void) | null> {
  try {
    const app = (globalThis as { Capacitor?: { Plugins?: { App?: { addListener?: (name: string, cb: (event: { url?: string }) => void) => Promise<{ remove: () => void }> } } } }).Capacitor?.Plugins?.App
    if (!isNativePlatform() || !app?.addListener) return null
    const handle = await app.addListener('appUrlOpen', (event) => {
      const route = event.url ? deepLinkToRoute(event.url, allowedHosts) : null
      if (route) navigate(route)
    })
    return () => handle.remove()
  } catch {
    return null
  }
}

/** Programa el registro tras `load` para no competir con el arranque de la app. */
export function scheduleServiceWorkerRegistration(): void {
  if (typeof window === 'undefined') return
  const run = () => { void registerServiceWorker() }
  if (document.readyState === 'complete') run()
  else window.addEventListener('load', run, { once: true })
}
