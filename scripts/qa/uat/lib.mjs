// Utilidades compartidas de la UAT móvil autenticada (navegador real por CDP contra la app construida y Supabase QA).
// Nada aquí imprime ni guarda contraseñas: `password` viene de ensureQaIdentities() (propiedad no enumerable, solo memoria) y solo se
// escribe en el campo de contraseña de la UI.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { auditPage, focusProbe } from './audit.mjs'
import { sleep } from './cdp.mjs'

export const OUT = process.env.UAT_OUT ?? join(tmpdir(), 'sportleagues-uat')
export const SHOTS = join(OUT, 'shots')
export const BASE = process.env.UAT_BASE_URL ?? 'http://127.0.0.1:4391'
mkdirSync(SHOTS, { recursive: true })

/** Registro de resultados: cada caso PASS/FAIL/NOT_RUN con la evidencia observada. */
export class Reporter {
  constructor(file) { this.file = file; this.items = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {} }
  rec(id, status, evidence) {
    const prev = this.items[id]
    this.items[id] = { status, evidence: String(evidence).slice(0, 2400), at: new Date().toISOString() }
    console.log(`${status.padEnd(8)} ${id}  ${String(evidence).slice(0, 260)}${prev && prev.status !== status ? `  (antes ${prev.status})` : ''}`)
    this.save()
  }
  pass(id, ev) { this.rec(id, 'PASS', ev) }
  fail(id, ev) { this.rec(id, 'FAIL', ev) }
  notRun(id, why) { this.rec(id, 'NOT_RUN', why) }
  check(id, ok, ev) { this.rec(id, ok ? 'PASS' : 'FAIL', ev) }
  data(key, value) { this.items[`#${key}`] = value; this.save() }
  save() { writeFileSync(this.file, JSON.stringify(this.items, null, 1)) }
}

export const shotPath = (name) => join(SHOTS, `${name}.png`)
export async function shot(page, name, opts) { return page.screenshot(shotPath(name), opts) }

/** Peticiones de red registradas cuya URL contiene `part` (p. ej. '/rest/v1/rpc/publish_official_result'). */
// Sin las peticiones CORS de comprobación previa (OPTIONS, tipo «Preflight»), que CDP también notifica y duplicarían los conteos.
export const calls = (page, part) => page.netEntries().filter((r) => r.url.includes(part) && r.method !== 'OPTIONS' && r.type !== 'Preflight')
export const rpcCalls = (page, name) => calls(page, `/rest/v1/rpc/${name}`)

/** Acceso por la UI real: escribe en los formularios (toque + inserción de texto) y espera la barra inferior. */
export async function loginUI(page, identity, { navigate = true } = {}) {
  // navigate=false: se usa la portada ya abierta (p. ej. justo después de cerrar sesión), sin recargar el documento ni la memoria de la app.
  if (navigate) await page.goto(`${BASE}/`)
  if (await page.has('nav[aria-label]')) throw new Error('loginUI: ya hay una sesión abierta')
  await page.tap('button', 'Iniciar sesión')
  await page.waitFor('#email')
  await page.type('#email', identity.email)
  await page.type('#password', identity.password)
  await page.tap('form button[type=submit]')
  await page.waitFor(`!!document.querySelector('nav[aria-label]')`, { timeout: 30000, label: 'barra inferior tras iniciar sesión' })
  await sleep(500)
}

/** Cierre de sesión por la UI: Perfil -> Ajustes -> Cerrar sesión. Espera la portada de visitante. */
export async function logoutUI(page) {
  await page.tap('nav a[href="/perfil"]')
  await page.waitForUrl(/^\/perfil/)
  await page.tap('button[aria-label="Ajustes de la cuenta"]')
  await page.tap('button', 'Cerrar sesión')
  await page.waitFor(`!document.querySelector('nav[aria-label]') && document.body.innerText.includes('Crear cuenta')`, { timeout: 20000, label: 'portada de visitante tras cerrar sesión' })
  await sleep(600)
}

export async function audit(page) { return page.eval(`(${auditPage.toString()})()`) }

/** Recorrido real con Tab: devuelve los elementos enfocados y si muestran indicador de foco. */
export async function focusWalk(page, steps = 12) {
  const seen = []
  await page.eval('document.activeElement && document.activeElement.blur && document.activeElement.blur(); window.scrollTo(0,0)')
  for (let i = 0; i < steps; i += 1) {
    await page.key('Tab')
    const probe = await page.eval(`(${focusProbe.toString()})()`)
    if (probe) seen.push(probe)
  }
  return seen
}

/** Interpreta una auditoría y devuelve una fila resumida para la matriz de pantallas. */
export function summarize(a) {
  return {
    hscroll: a.hscroll.ok,
    overflow: a.overflowers.length,
    interactive: a.touch.interactive,
    smallTargets: a.touch.small.length,
    unnamed: a.names.unnamed.length,
    placeholderOnly: a.names.placeholderOnly.length,
    imgMissingAlt: a.images.missingAlt.length,
    contrastFail: a.contrast.failing.length,
    contrastInd: a.contrast.indeterminateBgImage,
    truncated: a.truncated.length,
    states: a.states,
  }
}

/** Lectura (solo) de IndexedDB de la app: espacios de nombres y conteos, nunca valores. */
export async function idbSummary(page) {
  return page.eval(`(async () => {
    const dbs = await indexedDB.databases();
    const out = { dbs: dbs.map((d) => d.name), namespaces: {} };
    for (const d of dbs) {
      if (d.name !== 'sportleagues-cache') continue;
      const db = await new Promise((res, rej) => { const r = indexedDB.open(d.name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) });
      const all = await new Promise((res, rej) => { const tx = db.transaction('entries', 'readonly'); const rq = tx.objectStore('entries').getAll(); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error) });
      for (const e of all) { const ns = e.ns === 'public' ? 'public' : 'u:' + String(e.ns).split(':')[1].slice(0, 8); out.namespaces[ns] = (out.namespaces[ns] ?? 0) + 1 }
      db.close();
    }
    return out;
  })()`)
}

export const short = (id) => String(id).slice(0, 8)

/** Espera a que la pantalla deje de mostrar estados de carga («Verificando acceso…», «Cargando…», esqueletos). No falla: devuelve si terminó. */
export async function settle(page, { timeout = 15000, extra = 400 } = {}) {
  // La app pinta #app vacío mientras el guard de ruta restaura la sesión: se exige contenido y que el estado «cargado» se mantenga en
  // dos comprobaciones seguidas (evita dar por cargada una pantalla que aún no empezó a cargar).
  const ready = `(() => { const t = document.querySelector('#app')?.innerText ?? ''; return t.trim().length > 20 && !/Verificando|Cargando|Comprobando tu solicitud|Validando tu acceso|Uniéndote a la quiniela|Calculando/.test(t) && !document.querySelector('[role=status][aria-label^=Cargando], .animate-spin') })()`
  const end = Date.now() + timeout
  try {
    while (Date.now() < end) {
      await page.waitFor(ready, { timeout: Math.max(500, end - Date.now()), label: 'fin de la carga' })
      await sleep(450)
      if (await page.eval(ready).catch(() => false)) { await sleep(extra); return true }
    }
  } catch { /* tiempo agotado */ }
  return false
}

/**
 * Captura (solo en memoria del proceso; nunca se imprime ni se guarda) el origen de Supabase y la clave PÚBLICA anon que la app ya
 * envía en sus peticiones. Necesario para `restInPage`. Llamar antes de la primera navegación de la pestaña.
 */
export function watchSupabase(page) {
  const sb = { origin: null, apikey: null }
  page.cdp.on('Network.requestWillBeSent', (p) => {
    const u = p.request.url
    if (sb.apikey || !/\.supabase\.co\/(rest|auth)\/v1\//.test(u)) return
    const h = p.request.headers ?? {}
    const k = h.apikey ?? h.Apikey
    if (k) { sb.apikey = k; sb.origin = new URL(u).origin }
  })
  page.sb = sb
  return sb
}

/**
 * Petición REST/RPC hecha DESDE LA PÁGINA con la sesión que la app guardó (mismo JWT y RLS que la UI). El token se lee y se usa dentro
 * de la página y no vuelve al proceso: solo se devuelven el estado HTTP y el cuerpo JSON.
 */
export async function restInPage(page, path, { method = 'GET', body = null } = {}) {
  if (!page.sb?.apikey) throw new Error('restInPage: falta watchSupabase(page) y una petición previa de la app')
  return page.eval(`(async () => {
    const k = [...Object.keys(localStorage), ...Object.keys(sessionStorage)].find((x) => /^sb-.*-auth-token$/.test(x));
    const raw = k ? (localStorage.getItem(k) ?? sessionStorage.getItem(k)) : null;
    let token = null; try { token = raw ? JSON.parse(raw).access_token : null } catch {}
    const headers = { apikey: ${JSON.stringify(page.sb.apikey)}, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(${JSON.stringify(page.sb.origin)} + ${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, headers, body: ${body === null ? 'undefined' : JSON.stringify(JSON.stringify(body))} });
    let data = null; try { data = await r.json() } catch {}
    return { status: r.status, data, hasToken: Boolean(token) };
  })()`)
}

/**
 * Reloj del DISPOSITIVO desplazado `offsetMs` hacia el pasado (se inyecta antes de cargar cada documento). Sirve para comprobar que el
 * cierre lo decide el servidor y no el reloj local. Devuelve el identificador para retirarlo con `clearDeviceClock`.
 */
export async function setDeviceClock(page, offsetMs) {
  const source = `(() => { const OFF = ${Math.round(offsetMs)}; const R = Date;
    function D(...a) { if (!new.target) return new R(R.now() - OFF).toString(); return a.length ? new R(...a) : new R(R.now() - OFF) }
    D.prototype = R.prototype; Object.setPrototypeOf(D, R); D.now = () => R.now() - OFF; D.parse = R.parse; D.UTC = R.UTC; globalThis.Date = D })()`
  const { identifier } = await page.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source })
  return identifier
}
export async function clearDeviceClock(page, identifier) { await page.cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => {}) }

/** Errores de consola/excepciones desde `since` (marca de tiempo), sin el ruido de recursos de red rechazados a propósito. */
export function consoleErrors(page, since = 0) {
  return [
    ...page.console.filter((c) => c.at >= since && /^(error|log:error)$/.test(c.type)).map((c) => c.text),
    ...page.exceptions.filter((e) => e.at >= since).map((e) => `EXC ${e.text}`),
  ]
}
