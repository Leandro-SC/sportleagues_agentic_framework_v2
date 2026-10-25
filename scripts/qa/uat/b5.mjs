// Bloque b5: rendimiento y PWA en Chrome real (criterios 8 y 12 de docs/testing/MOBILE-FIRST-ACCEPTANCE.md; caso W1 y H1 del checklist).
//   PERF.visitante / PERF.quiniela  carga en frío con red «4G lenta» (150 ms RTT, 1,6 Mbps bajada, 675 kbps subida) y CPU 4x más lenta:
//                                   FCP, LCP, CLS y TBT con PerformanceObserver. Umbrales «bueno» de Web Vitals/Lighthouse móvil:
//                                   LCP <= 2500 ms, CLS <= 0,1, TBT <= 200 ms. NO es un informe Lighthouse (no se añaden dependencias).
//   PERF.js                         JS inicial de la portada (gzip calculado aquí, el servidor local no comprime) <= 170 KB y vistas
//                                   cargadas bajo demanda (PoolView/AdminView no se piden en la portada).
//   PERF.img                        imágenes visibles con dimensiones declaradas o carga diferida.
//   W1.manifest, W1.sw, W1.instalable, W1.offline, W1.cache-privada y W1 (todo): instalabilidad que Chrome evalúa
//                                   (Page.getInstallabilityErrors), SW activo y controlando, shell sin conexión y caché del SW sin datos privados.
//   H1                              NOT_RUN: las cabeceras/CSP salen de vercel.json y solo existen en el despliegue de Vercel.
import { gzipSync } from 'node:zlib'
import { BASE, loginUI, settle, shot } from './lib.mjs'
import { perfObservers } from './audit.mjs'
import { sleep } from './cdp.mjs'

const SLOW_4G = { offline: false, latency: 150, down: Math.round(1638.4 * 1024 / 8), up: Math.round(675 * 1024 / 8) }

async function coldMetrics(page, url) {
  await page.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${perfObservers.toString()})()` })
  await page.cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  await page.cdp.send('Network.setBypassServiceWorker', { bypass: true })   // en frío de verdad: ni caché HTTP ni la del SW
  await page.emulateNetwork(SLOW_4G)
  await page.cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  page.clearLogs()
  const t0 = Date.now()
  await page.goto(url, { waitMs: 60000, settle: 0 })
  const loadMs = Date.now() - t0
  await settle(page, { timeout: 30000, extra: 0 })
  await sleep(3000)
  // Un toque real cierra la medición de LCP (como haría Lighthouse al terminar) y deja el CLS acumulado.
  const perf = await page.eval('JSON.parse(JSON.stringify(window.__perf ?? null))')
  await page.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await page.emulateNetwork({ offline: false })
  await page.cdp.send('Network.setCacheDisabled', { cacheDisabled: false })
  await page.cdp.send('Network.setBypassServiceWorker', { bypass: false })
  const net = page.netEntries()
  const js = net.filter((r) => r.type === 'Script' && r.url.startsWith(BASE))
  const top = [...net].filter((r) => r.encoded).sort((a, b) => b.encoded - a.encoded).slice(0, 4).map((r) => `${r.url.split('?')[0].split('/').pop().slice(0, 40)} ${Math.round(r.encoded / 1024)} KB`)
  return { perf, loadMs, requests: net.length, transferred: net.reduce((s, r) => s + (r.encoded ?? 0), 0), js, top }
}

const fmt = (n) => (n == null ? 'n/d' : Math.round(n))

export async function run(ctx) {
  const { rep, identities, D } = ctx

  // ================= Rendimiento =================
  {
    const chrome = await ctx.launch('b5-perf')
    try {
      const page = await chrome.newPage({ width: 390, height: 844, dpr: 3 })
      const g = await coldMetrics(page, `${BASE}/`)
      await shot(page, 'b5-01-perf-visitante')
      let gz = 0; let raw = 0
      for (const r of g.js) { const b = await page.body(r); if (b) { raw += Buffer.byteLength(b); gz += gzipSync(b).length } }
      const lazy = !g.js.some((r) => /\/assets\/(PoolView|AdminView|AdminFixtureView|ProfileView)-/.test(r.url))
      rep.check('PERF.visitante', g.perf && g.perf.lcp != null && g.perf.lcp <= 2500 && g.perf.cls <= 0.1 && g.perf.tbt <= 200,
        `portada en frío (4G lenta + CPU 4x): FCP=${fmt(g.perf?.fcp)} ms, LCP=${fmt(g.perf?.lcp)} ms, CLS=${g.perf?.cls?.toFixed(3)}, TBT=${fmt(g.perf?.tbt)} ms (tareas largas=${g.perf?.longTasks}); evento load=${g.loadMs} ms; peticiones=${g.requests}; transferido=${Math.round(g.transferred / 1024)} KB; mayores=${JSON.stringify(g.top)}`)
      rep.check('PERF.js', gz <= 170 * 1024 && lazy,
        `JS de la portada: ${g.js.length} archivos, ${Math.round(raw / 1024)} KB sin comprimir, ${Math.round(gz / 1024)} KB gzip (umbral 170 KB); vistas pesadas fuera de la portada=${lazy}; archivos=${JSON.stringify(g.js.map((r) => r.url.split('/').pop()))}`)

      // Quiniela autenticada (la pantalla más pesada del participante)
      await page.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
      await loginUI(page, identities.user1)
      const q = await coldMetrics(page, `${BASE}/p/${D.pool.id}`)
      await shot(page, 'b5-02-perf-quiniela')
      const imgs = await page.eval(`[...document.querySelectorAll('img')].filter((i) => i.getBoundingClientRect().width > 0).map((i) => ({ src: i.currentSrc.split('/').pop().slice(0, 40), dims: i.hasAttribute('width') && i.hasAttribute('height'), lazy: i.loading === 'lazy', natural: i.naturalWidth + 'x' + i.naturalHeight, shown: Math.round(i.getBoundingClientRect().width) + 'x' + Math.round(i.getBoundingClientRect().height) }))`)
      rep.check('PERF.quiniela', q.perf && q.perf.lcp != null && q.perf.lcp <= 2500 && q.perf.cls <= 0.1 && q.perf.tbt <= 200,
        `/p/<quiniela> con sesión, en frío (4G lenta + CPU 4x): FCP=${fmt(q.perf?.fcp)} ms, LCP=${fmt(q.perf?.lcp)} ms, CLS=${q.perf?.cls?.toFixed(3)}, TBT=${fmt(q.perf?.tbt)} ms (tareas largas=${q.perf?.longTasks}); load=${q.loadMs} ms; peticiones=${q.requests} (Supabase=${page.netEntries().filter((r) => r.url.includes('.supabase.co')).length}); transferido=${Math.round(q.transferred / 1024)} KB; mayores=${JSON.stringify(q.top)}`)
      const badImg = imgs.filter((i) => !i.dims && !i.lazy)
      rep.check('PERF.img', badImg.length === 0, `imágenes visibles en la quiniela=${imgs.length}; sin width/height ni loading=lazy=${JSON.stringify(badImg.slice(0, 5))}`)
    } catch (e) { await ctx.errShot(chrome, 'b5-perf'); throw e } finally { await chrome.close() }
  }

  // ================= PWA (W1) =================
  {
    const chrome = await ctx.launch('b5-pwa')
    try {
      const page = await chrome.newPage({ width: 390, height: 844, dpr: 3 })
      await page.goto(`${BASE}/`); await settle(page)
      // Manifest según Chrome
      const am = await page.cdp.send('Page.getAppManifest').catch((e) => ({ errors: [{ message: String(e) }] }))
      let mf = null; try { mf = JSON.parse(am.data ?? 'null') } catch { /* no JSON */ }
      const icons = mf?.icons ?? []
      const iconChecks = []
      for (const ic of icons) {
        const res = await fetch(new URL(ic.src, BASE)); const buf = Buffer.from(await res.arrayBuffer())
        const [w, h] = buf.length > 24 ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : [0, 0]
        iconChecks.push({ src: ic.src, ok: res.status === 200 && /png/.test(res.headers.get('content-type') ?? '') && `${w}x${h}` === ic.sizes, purpose: ic.purpose ?? 'any', real: `${w}x${h}` })
      }
      const has = (size, purpose) => iconChecks.some((i) => i.ok && i.real === size && (i.purpose ?? 'any').includes(purpose))
      const mOk = (am.errors ?? []).length === 0 && mf && mf.name && mf.short_name && mf.start_url === '/' && mf.display === 'standalone' && has('192x192', 'any') && has('512x512', 'any') && has('512x512', 'maskable') && iconChecks.every((i) => i.ok)
      rep.check('W1.manifest', mOk, `errores de Chrome=${JSON.stringify(am.errors ?? [])}; name="${mf?.name}", short_name="${mf?.short_name}", start_url=${mf?.start_url}, display=${mf?.display}, orientation=${mf?.orientation}, theme=${mf?.theme_color}; iconos=${JSON.stringify(iconChecks.map((i) => `${i.src} ${i.real} ${i.purpose} ${i.ok ? 'ok' : 'MAL'}`))}`)

      // Service worker: activo y controlando tras una recarga
      const reg = await page.eval(`(async () => { const r = await Promise.race([navigator.serviceWorker.ready, new Promise((res) => setTimeout(() => res(null), 15000))]); return r ? { scope: new URL(r.scope).pathname, state: r.active?.state ?? null, script: new URL(r.active?.scriptURL ?? location.href).pathname } : null })()`)
      await page.reload(); await settle(page)
      const controlled = await page.eval('!!navigator.serviceWorker.controller')
      rep.check('W1.sw', reg && reg.state === 'activated' && reg.scope === '/' && reg.script === '/sw.js' && controlled, `registro=${JSON.stringify(reg)}; controla la página tras recargar=${controlled}`)

      const inst = await page.cdp.send('Page.getInstallabilityErrors').catch((e) => ({ installabilityErrors: [{ errorId: String(e) }] }))
      const instErr = (inst.installabilityErrors ?? []).map((e) => e.errorId)
      await shot(page, 'b5-03-pwa-portada')
      rep.check('W1.instalable', instErr.length === 0, `Page.getInstallabilityErrors=${JSON.stringify(instErr)} (lo mismo que Chrome usa para ofrecer «Instalar app»; el diálogo nativo no existe en headless)`)

      // Sesión real y recorrido por pantallas privadas antes de mirar la caché del SW
      await loginUI(page, identities.user1)
      for (const path of [`/p/${D.pool.id}`, '/ligas', '/mis-tickets', '/perfil', '/mis-puntos']) { await page.goto(`${BASE}${path}`); await settle(page, { timeout: 20000 }) }
      const cache = await page.eval(`(async () => {
        const out = { names: await caches.keys(), entries: [], privateHits: [] };
        for (const n of out.names) {
          const c = await caches.open(n);
          for (const req of await c.keys()) {
            const u = new URL(req.url); out.entries.push(n.replace(/^sl-/, '') + ':' + (u.origin === location.origin ? u.pathname : u.origin + u.pathname));
            const res = await c.match(req); const ct = res.headers.get('content-type') || '';
            // El JS público lleva la clave anon (JWT con rol anon, ver SEC.a): solo se examinan documentos y datos.
            if (/html|json/.test(ct)) { const t = await res.text(); if (/access_token|refresh_token|eyJ[\\w-]{10,}\\.eyJ|@example\\.test|qa-user1/.test(t)) out.privateHits.push(u.pathname) }
          }
        }
        return out;
      })()`)
      const foreign = cache.entries.filter((e) => /supabase|\/rest\/|\/auth\/|https?:\/\//.test(e))
      const allowed = cache.entries.every((e) => /:(\/|\/offline\.html|\/manifest\.webmanifest|\/(assets|icons|flags|images)\/.+)$/.test(e))
      rep.check('W1.cache-privada', foreign.length === 0 && cache.privateHits.length === 0 && allowed,
        `cachés=${JSON.stringify(cache.names)}; entradas=${cache.entries.length} (${JSON.stringify(cache.entries.filter((e) => !/\/assets\//.test(e)))} + ${cache.entries.filter((e) => /\/assets\//.test(e)).length} activos /assets); de otro origen o Supabase/REST/auth=${JSON.stringify(foreign)}; respuestas con tokens/correo/nombre de usuario=${JSON.stringify(cache.privateHits)}`)

      // Sin conexión: navegación de nivel superior a la portada y a una ruta interna
      await page.emulateNetwork({ offline: true })
      const off = {}
      for (const path of ['/', '/ligas']) {
        await page.goto(`${BASE}${path}`, { waitMs: 15000, settle: 500 })
        const t0 = Date.now()
        await page.waitFor(`(document.querySelector('#app')?.innerText ?? '').trim().length > 0`, { timeout: 15000 }).catch(() => {})
        await sleep(1500)
        off[path] = await page.eval(`({ ms: ${Date.now() - t0}, href: location.href.slice(0, 40), path: location.pathname, title: document.title, app: (document.querySelector('#app')?.innerText ?? '').trim().length, text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 80) })`).catch((e) => ({ error: String(e).slice(0, 80) }))
      }
      await shot(page, 'b5-04-pwa-sin-conexion')
      const offlinePage = await page.eval(`caches.match('/offline.html').then((r) => r ? r.text() : '').then((t) => t.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 100))`).catch(() => '')
      await page.emulateNetwork({ offline: false })
      const offOk = Object.entries(off).every(([p, o]) => !o.error && o.href.startsWith(BASE) && o.title === 'SportLeagues' && o.app > 0 && o.path === p) && offlinePage.length > 0
      rep.check('W1.offline', offOk, `sin conexión: ${JSON.stringify(off)}; /offline.html en caché="${offlinePage}"`)
      rep.check('W1', Boolean(mOk) && Boolean(reg && controlled) && instErr.length === 0 && offOk && foreign.length === 0 && cache.privateHits.length === 0,
        'resumen de W1.manifest, W1.sw, W1.instalable, W1.offline y W1.cache-privada (todos deben pasar). La instalación real desde el menú del navegador y el modo avión en un dispositivo físico no se pueden ejecutar en headless')
    } catch (e) { await ctx.errShot(chrome, 'b5-pwa'); throw e } finally { await chrome.close() }
  }

  rep.notRun('H1', 'Las cabeceras de seguridad y la CSP en Report-Only se definen en vercel.json y solo las sirve Vercel; vite preview local no las aplica, así que comprobarlas aquí sería simularlas. Pendiente: `curl -sI https://sportleagues-qa.vercel.app` y consola del navegador sobre el despliegue')
  rep.notRun('LIGHTHOUSE', 'Lighthouse no está instalado y la orden prohíbe añadir dependencias; las métricas PERF.* se toman con PerformanceObserver en el mismo Chrome con red y CPU limitadas (aproximación, no puntuación Lighthouse)')
}
