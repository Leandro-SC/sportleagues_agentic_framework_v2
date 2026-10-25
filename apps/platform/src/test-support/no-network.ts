// Las pruebas unitarias nunca abren conexiones reales. Algunas vistas montan la campana de notificaciones o la tabla en vivo, que se
// suscriben a Supabase Realtime con el cliente real (configurado desde .env.local): este WebSocket inerte nunca conecta, así que ni
// salen datos de prueba hacia QA ni quedan sockets vivos entre archivos. Las pruebas de esos composables inyectan su propio cliente falso.
class InertWebSocket extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  readonly url: string
  readyState = InertWebSocket.CONNECTING
  binaryType: BinaryType = 'blob'
  bufferedAmount = 0
  extensions = ''
  protocol = ''
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null

  constructor(url: string | URL) {
    super()
    this.url = String(url)
  }

  send(): void { /* sin red */ }
  close(): void { this.readyState = InertWebSocket.CLOSED }
}

globalThis.WebSocket = InertWebSocket as unknown as typeof WebSocket

// Tampoco peticiones HTTP reales a Supabase: responden como un servicio caído (las vistas muestran su estado de error/vacío). Las
// pruebas que necesitan respuestas inyectan su cliente falso o hacen su propio `vi.stubGlobal('fetch', …)`, que tiene prioridad.
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (/^https:\/\/[^/]*supabase\.co\//i.test(url)) {
    return new Response(JSON.stringify({ message: 'network disabled in unit tests' }), { status: 503, headers: { 'content-type': 'application/json' } })
  }
  return realFetch(input, init)
}) as typeof fetch
