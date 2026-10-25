// Cliente mínimo del protocolo Chrome DevTools (CDP) sobre el WebSocket global de Node 24. SIN dependencias.
// Lanza el Chrome ya instalado en modo headless, habla CDP y ofrece una clase `Page` con las acciones que necesita la UAT móvil
// (navegar, evaluar, tocar con eventos táctiles reales, escribir, capturar, simular red y móvil).
//
//   import { launchChrome, Page } from './cdp.mjs'
//   const chrome = await launchChrome({ userDataDir })        // un solo navegador a la vez (RAM limitada)
//   const page = await chrome.newPage({ width: 390, height: 844, dpr: 3 })
//   await page.goto('http://127.0.0.1:4391/')
//   await page.tap('button')                                 // touchStart/touchEnd reales en el centro del elemento
//   await chrome.close()
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'

export const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
export const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export { sleep }

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)) })
    srv.on('error', reject)
  })
}

/** Conexión CDP a un target (websocket). */
export class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl
    this.id = 0
    this.pending = new Map()
    this.handlers = new Map()
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl)
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = (e) => reject(new Error('ws error ' + (e.message ?? ''))) })
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, method } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`)); else resolve(msg.result)
      } else if (msg.method) {
        for (const h of this.handlers.get(msg.method) ?? []) { try { h(msg.params, msg) } catch { /* handler */ } }
      }
    }
    this.ws.onclose = () => { for (const { reject, method } of this.pending.values()) reject(new Error(`ws cerrado durante ${method}`)); this.pending.clear() }
    return this
  }
  send(method, params = {}, timeoutMs = 60000) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout CDP ${method}`)) }, timeoutMs)
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v) }, reject: (e) => { clearTimeout(t); reject(e) }, method })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, [])
    this.handlers.get(method).push(handler)
  }
  close() { try { this.ws.close() } catch { /* ya cerrado */ } }
}

export class Browser {
  constructor(proc, port, userDataDir) { this.proc = proc; this.port = port; this.userDataDir = userDataDir; this.pages = [] }
  async json(path) { const r = await fetch(`http://127.0.0.1:${this.port}${path}`); return r.json() }
  async version() { return this.json('/json/version') }
  /** Usa la pestaña inicial (about:blank) o crea otra con Target.createTarget. */
  async newPage(opts = {}) {
    let target
    if (!this.pages.length) {
      const list = await this.json('/json')
      target = list.find((t) => t.type === 'page')
    }
    if (!target) {
      const browserCdp = await new Cdp((await this.version()).webSocketDebuggerUrl).connect()
      const { targetId } = await browserCdp.send('Target.createTarget', { url: 'about:blank' })
      browserCdp.close()
      for (let i = 0; i < 20 && !target; i++) { target = (await this.json('/json')).find((t) => t.id === targetId); if (!target) await sleep(100) }
    }
    const page = new Page(await new Cdp(target.webSocketDebuggerUrl).connect(), target.id, this)
    await page.init(opts)
    this.pages.push(page)
    return page
  }
  async close() {
    for (const p of this.pages) p.cdp.close()
    try { const b = await new Cdp((await this.version()).webSocketDebuggerUrl).connect(); await b.send('Browser.close', {}, 5000).catch(() => {}); b.close() } catch { /* ya cerrado */ }
    await sleep(500)
    try { this.proc.kill() } catch { /* ya cerrado */ }
    if (process.platform === 'win32' && this.proc.pid) {
      try { spawn('taskkill', ['/PID', String(this.proc.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* nada */ }
    }
  }
}

export async function launchChrome({ userDataDir, width = 390, height = 844, fresh = true, extraArgs = [] }) {
  if (fresh) rmSync(userDataDir, { recursive: true, force: true })
  mkdirSync(userDataDir, { recursive: true })
  const port = await freePort()
  const args = [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', `--window-size=${width},${height}`, '--disable-extensions', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--metrics-recording-only', '--mute-audio', 'about:blank', ...extraArgs,
  ]
  const proc = spawn(CHROME_PATH, args, { stdio: 'ignore', windowsHide: true })
  const browser = new Browser(proc, port, userDataDir)
  for (let i = 0; i < 80; i++) {
    try { await browser.version(); return browser } catch { await sleep(250) }
  }
  proc.kill()
  throw new Error('Chrome no arrancó (CDP no responde)')
}

/** Una pestaña con utilidades de alto nivel. */
export class Page {
  constructor(cdp, targetId, browser) {
    this.cdp = cdp; this.targetId = targetId; this.browser = browser
    this.console = []        // { type, text, url }
    this.exceptions = []     // excepciones JS no capturadas
    this.requests = new Map()
    this.netLog = []         // { url, method, status, type, encoded, fromCache, ms }
    this.dialogs = []
    this.lastLoadTs = 0
  }
  async init({ width = 390, height = 844, dpr = 3, mobile = true, ua = MOBILE_UA, touch = true } = {}) {
    const c = this.cdp
    await Promise.all([c.send('Page.enable'), c.send('Runtime.enable'), c.send('Network.enable'), c.send('Log.enable'), c.send('DOM.enable'), c.send('Page.setLifecycleEventsEnabled', { enabled: true })])
    c.on('Runtime.consoleAPICalled', (p) => this.console.push({ type: p.type, text: (p.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400), at: Date.now() }))
    c.on('Log.entryAdded', (p) => this.console.push({ type: `log:${p.entry.level}`, text: `${p.entry.source}: ${p.entry.text} ${p.entry.url ?? ''}`.slice(0, 400), at: Date.now() }))
    c.on('Runtime.exceptionThrown', (p) => this.exceptions.push({ text: (p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? '').slice(0, 400), at: Date.now() }))
    c.on('Page.javascriptDialogOpening', (p) => { this.dialogs.push(p.message); c.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}) })
    c.on('Network.requestWillBeSent', (p) => { this.requests.set(p.requestId, { id: p.requestId, postData: p.request.postData ?? null, url: p.request.url, method: p.request.method, type: p.type, t0: p.timestamp, hasAuth: Boolean(p.request.headers?.Authorization || p.request.headers?.authorization) }) })
    c.on('Network.responseReceived', (p) => { const r = this.requests.get(p.requestId); if (r) { r.status = p.response.status; r.fromSW = p.response.fromServiceWorker; r.fromCache = p.response.fromDiskCache || p.response.fromPrefetchCache; r.mime = p.response.mimeType; r.headers = p.response.headers } })
    c.on('Network.loadingFinished', (p) => { const r = this.requests.get(p.requestId); if (r) { r.encoded = p.encodedDataLength; r.ms = Math.round((p.timestamp - r.t0) * 1000); r.done = true } })
    c.on('Network.loadingFailed', (p) => { const r = this.requests.get(p.requestId); if (r) { r.failed = p.errorText; r.done = true } })
    await this.setMobile({ width, height, dpr, mobile, ua, touch })
  }
  async setMobile({ width, height, dpr = 3, mobile = true, ua = MOBILE_UA, touch = true }) {
    this.viewport = { width, height, dpr }
    await this.cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile, screenWidth: width, screenHeight: height })
    await this.cdp.send('Emulation.setUserAgentOverride', { userAgent: ua, acceptLanguage: 'es-PE,es;q=0.9', platform: 'Linux armv81' })
    await this.cdp.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 5 })
    await this.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }).catch(() => {})
  }
  async body(entry) { try { const r = await this.cdp.send('Network.getResponseBody', { requestId: entry.id }); return r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body } catch { return null } }
  /** Reescribe la URL de peticiones que coincidan (Fetch domain). Solo para esquivar un defecto ya documentado y poder seguir probando. */
  async rewriteRequests(urlPattern, rewrite) {
    this.rewritten = 0
    this.cdp.on('Fetch.requestPaused', (p) => {
      const next = rewrite(p.request.url)
      if (next && next !== p.request.url) { this.rewritten += 1; this.cdp.send('Fetch.continueRequest', { requestId: p.requestId, url: next }).catch(() => {}) }
      else this.cdp.send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {})
    })
    await this.cdp.send('Fetch.enable', { patterns: [{ urlPattern, requestStage: 'Request' }] })
  }
  async stopRewriting() { await this.cdp.send('Fetch.disable').catch(() => {}) }
  clearLogs() { this.console = []; this.exceptions = []; this.requests = new Map() }
  netEntries() { return [...this.requests.values()] }

  async goto(url, { waitMs = 15000, settle = 600 } = {}) {
    const loaded = new Promise((resolve) => { const t = setTimeout(resolve, waitMs); this.cdp.on('Page.loadEventFired', () => { clearTimeout(t); resolve() }) })
    await this.cdp.send('Page.navigate', { url })
    await loaded
    await sleep(settle)
  }
  async reload({ ignoreCache = false, settle = 600 } = {}) {
    const loaded = new Promise((resolve) => { const t = setTimeout(resolve, 15000); this.cdp.on('Page.loadEventFired', () => { clearTimeout(t); resolve() }) })
    await this.cdp.send('Page.reload', { ignoreCache })
    await loaded
    await sleep(settle)
  }
  async eval(expression, { awaitPromise = true } = {}) {
    const r = await this.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 400))
    return r.result.value
  }
  async url() { return this.eval('location.pathname + location.search') }
  async text() { return this.eval('document.body.innerText') }
  async has(selector) { return this.eval(`!!document.querySelector(${JSON.stringify(selector)})`) }
  async waitFor(fnOrSelector, { timeout = 15000, interval = 150, label = '' } = {}) {
    const expr = typeof fnOrSelector === 'function' ? `(${fnOrSelector.toString()})()` : (/^\s*(\(|!|document|window|\[\.\.\.|\/)/.test(fnOrSelector) ? fnOrSelector : `!!document.querySelector(${JSON.stringify(fnOrSelector)})`)
    const end = Date.now() + timeout
    while (Date.now() < end) {
      try { if (await this.eval(expr)) return true } catch { /* página navegando */ }
      await sleep(interval)
    }
    throw new Error(`timeout esperando ${label || String(fnOrSelector).slice(0, 120)}`)
  }
  async waitForText(text, opts = {}) { return this.waitFor(`document.body.innerText.includes(${JSON.stringify(text)})`, { label: `texto «${text}»`, ...opts }) }
  async waitForUrl(re, { timeout = 15000 } = {}) { return this.waitFor(`(${re.toString()}.test(location.pathname))`, { timeout, label: `ruta ${re}` }) }

  /** Rectángulo (CSS px del viewport) del primer elemento visible que cumple selector y, opcionalmente, contiene `text`. */
  async rectOf(selector, text = null) {
    return this.eval(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = els.find((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && ${text === null ? 'true' : `(e.innerText || e.value || e.getAttribute('aria-label') || '').includes(${JSON.stringify(text)})`} });
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    })()`)
  }
  /** Toque táctil real (touchStart/touchEnd) en el centro del elemento. */
  async tap(selector, text = null, { retries = 20 } = {}) {
    let rect = null
    for (let i = 0; i < retries && !rect; i++) { rect = await this.rectOf(selector, text); if (!rect) await sleep(150) }
    if (!rect) throw new Error(`tap: no hay elemento visible ${selector}${text ? ` con texto «${text}»` : ''}`)
    await sleep(120)
    rect = await this.rectOf(selector, text) ?? rect
    const x = Math.round(rect.x + rect.w / 2), y = Math.round(rect.y + rect.h / 2)
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await sleep(40)
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await sleep(250)
    return { x, y, w: rect.w, h: rect.h }
  }
  /** Foco (toque) + inserción de texto como la que haría un teclado; dispara `input` real. */
  async type(selector, value, { clear = true } = {}) {
    await this.tap(selector)
    if (clear) await this.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.focus(); e.select?.(); })()`)
    if (clear) { await this.key('Backspace'); }
    if (value) await this.cdp.send('Input.insertText', { text: value })
    await sleep(120)
  }
  /** Fija el valor de un <select>/<input datetime-local> con el setter nativo y dispara el evento (no hay pickers nativos en headless). */
  async setValue(selector, value, event = 'change') {
    await this.rectOf(selector)
    await this.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); const proto = e.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); })()`)
    await sleep(200)
  }
  async key(key, { modifiers = 0 } = {}) {
    const map = { Enter: { code: 'Enter', vk: 13, text: '\r' }, Tab: { code: 'Tab', vk: 9 }, Escape: { code: 'Escape', vk: 27 }, Backspace: { code: 'Backspace', vk: 8 } }
    const m = map[key] ?? { code: key, vk: 0 }
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: m.code, windowsVirtualKeyCode: m.vk, modifiers })
    if (m.text) await this.cdp.send('Input.dispatchKeyEvent', { type: 'char', key, text: m.text, modifiers })
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: m.code, windowsVirtualKeyCode: m.vk, modifiers })
    await sleep(80)
  }
  async screenshot(path, { full = false, scale = null } = {}) {
    // Por defecto 1 px de imagen = 1 px CSS (el DPR 3 solo se emula para el render; evita imágenes de 1170x2532).
    if (scale === null) scale = 1 / (this.viewport?.dpr ?? 1)
    const metrics = await this.cdp.send('Page.getLayoutMetrics')
    const vp = metrics.cssVisualViewport
    // El recorte va en coordenadas del DOCUMENTO: la vista actual empieza en pageX/pageY (si la página está desplazada, 0,0 sale en blanco).
    const clip = full ? { x: 0, y: 0, width: Math.ceil(metrics.cssContentSize.width), height: Math.min(Math.ceil(metrics.cssContentSize.height), 4000), scale } : { x: vp.pageX ?? 0, y: vp.pageY ?? 0, width: vp.clientWidth, height: vp.clientHeight, scale }
    const { data } = await this.cdp.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: full })
    writeFileSync(path, Buffer.from(data, 'base64'))
    return path
  }
  async emulateNetwork({ offline = false, latency = 0, down = -1, up = -1 }) {
    await this.cdp.send('Network.emulateNetworkConditions', { offline, latency, downloadThroughput: down, uploadThroughput: up })
  }
  async cookiesAndStorage() {
    return this.eval(`(async () => {
      const out = { local: Object.keys(localStorage), session: Object.keys(sessionStorage), idb: [], caches: [] };
      try { out.idb = (await indexedDB.databases()).map((d) => d.name) } catch {}
      try { out.caches = await caches.keys() } catch {}
      return out;
    })()`)
  }
  async close() {
    this.cdp.close()
    try { await fetch(`http://127.0.0.1:${this.browser.port}/json/close/${this.targetId}`) } catch { /* ya cerrada */ }
    this.browser.pages = this.browser.pages.filter((p) => p !== this)
  }
}
