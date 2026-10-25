// Bloque b3: sesión, caché y seguridad observable desde el navegador.
//   C1   cierre de sesión y cambio de cuenta en el MISMO dispositivo y SIN recargar (qa-user1 -> qa-user2): nada de qa-user1 en pantalla,
//        en la red ni en IndexedDB.
//   C2   sin conexión en una liga ya visitada (quiniela B, clásica, de qa-user2): aviso «Sin conexión: mostrando lo último guardado»,
//        guardar exige red y la pantalla se recupera sola al volver la conexión.
//   F3   participante en rutas de organizador; en su liga solo recibe su propia fila de participante.
//   SEC.a  el JS servido no contiene claves service_role ni secretos (se recorren todos los chunks y se decodifica cada JWT incrustado).
//   SEC.b  credenciales/PII: la contraseña no aparece en almacenamiento, IndexedDB, consola ni URL; el JWT solo en la clave de sesión de auth.
//   SEC.c  acceso cruzado por URL: quiniela de otra organización y uuid inexistente -> mismo mensaje, sin nombre ni datos de la ajena.
//   SEC.d  escalada desde el navegador con la sesión del participante (RPC de organizador y lecturas privadas) -> rechazo y BD sin cambios.
//   SEC.e  tenant_id manipulado: un organizador intenta crear en la organización de otro (manage_pool/upsert_tournament/código) -> 42501.
//   SEC.f  tras cerrar sesión: token borrado, rutas protegidas vuelven a Inicio y «Atrás» no muestra datos privados.
import { BASE, calls, consoleErrors, idbSummary, loginUI, logoutUI, restInPage, rpcCalls, settle, shot, short, watchSupabase } from './lib.mjs'
import { sleep } from './cdp.mjs'

const JWT = /eyJ[\w-]{8,}\.eyJ[\w-]{8,}\.[\w-]{8,}/g
const isJwt = (s) => new RegExp(JWT.source).test(String(s))
const decode = (jwt) => { try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')) } catch { return null } }

/** Contenido de almacenamiento web e IndexedDB de la app, para examinarlo EN EL PROCESO (no se imprime). */
const dumpStorage = (page) => page.eval(`(async () => {
  const ls = Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]));
  const ss = Object.fromEntries(Object.keys(sessionStorage).map((k) => [k, sessionStorage.getItem(k)]));
  let idb = '';
  try {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('sportleagues-cache'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) });
    if (db.objectStoreNames.contains('entries')) idb = JSON.stringify(await new Promise((res) => { const rq = db.transaction('entries').objectStore('entries').getAll(); rq.onsuccess = () => res(rq.result); rq.onerror = () => res([]) }));
    db.close();
  } catch {}
  return { ls, ss, idb, url: location.href };
})()`)

export async function run(ctx) {
  const { rep, svc, identities, D, fresh, bOpen } = ctx
  const { user1: u1, user2: u2, requester: rq } = identities
  const part = async (poolId, profileId) => ((await svc.from('participants').select('id, approval_status, payment_status').eq('pool_id', poolId).eq('profile_id', profileId)).data ?? [])
  const p1A = (await part(D.pool.id, u1.id))[0]
  const p2A = (await part(D.pool.id, u2.id))[0]
  const p2B = (await part(D.poolB.id, u2.id))[0] ?? null
  const roundName = fresh.round.name

  // ---------- SEC.a: recorrido de todos los chunks JS servidos (sin navegador; mismo servidor que la UAT) ----------
  {
    const seen = new Set(); const queue = []
    const html = await (await fetch(`${BASE}/`)).text()
    for (const m of html.matchAll(/(?:src|href)="\/(assets\/[\w.-]+\.js)"/g)) queue.push(m[1])
    const jwts = []; let bytes = 0; let secretHits = 0; let serviceWord = 0
    while (queue.length) {
      const path = queue.shift(); if (seen.has(path)) continue; seen.add(path)
      const res = await fetch(`${BASE}/${path}`); if (!res.ok) continue
      const js = await res.text(); bytes += js.length
      for (const m of js.matchAll(/["'`(]\.\/([\w.-]+\.js)["'`)]/g)) queue.push(`assets/${m[1]}`)
      for (const m of js.matchAll(/assets\/[\w.-]+\.js/g)) queue.push(m[0])
      for (const j of js.match(JWT) ?? []) jwts.push(decode(j)?.role ?? 'desconocido')
      secretHits += (js.match(/sb_secret_[\w-]{10,}|SUPABASE_SERVICE_ROLE|service_role_key/gi) ?? []).length
      serviceWord += (js.match(/service_role/g) ?? []).length
    }
    rep.check('SEC.a', seen.size > 10 && !jwts.includes('service_role') && secretHits === 0,
      `chunks JS recorridos=${seen.size} (${Math.round(bytes / 1024)} KB); JWT incrustados por rol=${JSON.stringify(jwts.reduce((a, r) => ({ ...a, [r]: (a[r] ?? 0) + 1 }), {}))}; patrones de secreto (sb_secret_/SERVICE_ROLE_KEY)=${secretHits}; apariciones del literal "service_role"=${serviceWord}`)
  }

  const chrome = await ctx.launch('b3')
  try {
    const page = await chrome.newPage({ width: 390, height: 844, dpr: 3 })
    watchSupabase(page)
    const t0 = Date.now()

    // ================= qa-user1 =================
    await loginUI(page, u1)
    await page.goto(`${BASE}/p/${D.pool.id}`)
    await page.waitForText('Esta quiniela usa tickets', { timeout: 25000 })
    await settle(page)
    await page.tap('[role=tab]', 'Partidos')
    await page.waitFor(`!!document.querySelector('[aria-label="Tickets de ${roundName}"]')`, { timeout: 20000 })
    await settle(page)
    const u1Tabs = await page.eval(`[...document.querySelectorAll('[aria-label="Tickets de la quiniela"] [role=tab]')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim())`)
    const idb1 = await idbSummary(page)
    await shot(page, 'b3-01-c1-user1-tickets')

    // ---------- F3 (parte «su liga»): filas de participante recibidas por la pantalla ----------
    let ownOnly = true; let partRows = 0
    for (const r of calls(page, '/rest/v1/participants')) {
      const b = await page.body(r); if (!b) continue
      try { for (const row of JSON.parse(b) ?? []) { partRows += 1; if (row.id && row.id !== p1A.id && row.profile_id !== u1.id) ownOnly = false } } catch { /* no JSON */ }
    }

    // ---------- SEC.b: contraseña/JWT fuera de su sitio ----------
    const st1 = await dumpStorage(page)
    const authKeys = [...Object.keys(st1.ls), ...Object.keys(st1.ss)].filter((k) => /^sb-.*-auth-token$/.test(k))
    const nonAuth = [...Object.entries(st1.ls), ...Object.entries(st1.ss)].filter(([k]) => !/^sb-.*-auth-token$/.test(k))
    const pwdIn = { storage: [...Object.values(st1.ls), ...Object.values(st1.ss)].some((v) => String(v).includes(u1.password)), idb: st1.idb.includes(u1.password), console: page.console.some((c) => c.text.includes(u1.password)), url: st1.url.includes(u1.password) }
    const jwtOutside = { otherKeys: nonAuth.filter(([, v]) => isJwt(v)).map(([k]) => k), idb: /access_token|refresh_token/.test(st1.idb) || isJwt(st1.idb), console: page.console.filter((c) => isJwt(c.text)).length, url: /access_token|refresh_token/.test(st1.url) }
    const emailInConsole = page.console.filter((c) => c.text.includes(u1.email)).length

    // ---------- SEC.c: acceso cruzado por URL ----------
    const probeUrl = async (poolId) => {
      page.clearLogs()
      await page.goto(`${BASE}/p/${poolId}`)
      await page.waitFor(`/No tienes acceso|Próximos partidos|Esta quiniela usa tickets|No fue posible/.test(document.body.innerText)`, { timeout: 20000 })
      await settle(page)
      const text = await page.eval(`document.querySelector('main')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`)
      const poolsReq = calls(page, '/rest/v1/pools').find((r) => r.url.includes(poolId))
      const body = poolsReq ? await page.body(poolsReq) : null
      return { text, status: poolsReq?.status, body: (body ?? '').slice(0, 80), leaked: body ? body.includes(D.poolB.name) : false }
    }
    const foreign = await probeUrl(D.poolB.id)
    await shot(page, 'b3-02-secc-quiniela-ajena')
    const ghost = await probeUrl('00000000-0000-4000-8000-000000000000')
    const sameMsg = foreign.text.replace(D.poolB.id, '') === ghost.text && /No tienes acceso a esta quiniela/.test(foreign.text)
    rep.check('SEC.c', sameMsg && !foreign.text.includes(D.poolB.name) && !foreign.leaked && foreign.body.trim() === '[]',
      `qa-user1 abre /p/<quiniela de B>: texto="${foreign.text.slice(0, 110)}", GET pools -> HTTP ${foreign.status} cuerpo=${foreign.body}; uuid inexistente: texto idéntico=${sameMsg}; nombre de la quiniela B en pantalla=${foreign.text.includes(D.poolB.name)}`)

    // ---------- SEC.d: escalada con la sesión del participante (desde la página) ----------
    const payBefore = (await part(D.pool.id, u2.id))[0]?.payment_status
    const esc = {
      pago: await restInPage(page, '/rest/v1/rpc/set_participant_payment_status', { method: 'POST', body: { p_participant_id: p2A.id, p_status: payBefore === 'paid' ? 'pending' : 'paid' } }),
      aprobar: await restInPage(page, '/rest/v1/rpc/approve_participant', { method: 'POST', body: { p_participant_id: p2A.id } }),
      resultado: await restInPage(page, '/rest/v1/rpc/publish_official_result', { method: 'POST', body: { p_match_id: D.matches[0].match_id, p_home_score: 9, p_away_score: 9, p_expected_revision: 99 } }),
      crearQuiniela: await restInPage(page, '/rest/v1/rpc/manage_pool', { method: 'POST', body: { p_action: 'create', p_pool_id: null, p_tenant_id: D.tenant, p_name: 'UAT intrusa', p_lock_offset_minutes: 15, p_requires_approval: false } }),
      codigos: await restInPage(page, `/rest/v1/pool_join_codes?select=code&pool_id=eq.${D.pool.id}`),
      auditoria: await restInPage(page, `/rest/v1/audit_log?select=id&limit=5`),
      otrosParticipantes: await restInPage(page, `/rest/v1/participants?select=id,payment_status&pool_id=eq.${D.pool.id}`),
    }
    const payAfter = (await part(D.pool.id, u2.id))[0]?.payment_status
    const intrusa = ((await svc.from('pools').select('id').eq('tenant_id', D.tenant).eq('name', 'UAT intrusa')).data ?? []).length
    const denied = (r) => r.status >= 400 && /42501|28000|PGRST/.test(JSON.stringify(r.data ?? ''))
    const rowsOk = (r) => r.status >= 400 || (Array.isArray(r.data) && r.data.length === 0)
    const others = Array.isArray(esc.otrosParticipantes.data) ? esc.otrosParticipantes.data.filter((x) => x.id !== p1A.id).length : -1
    const summary = Object.fromEntries(Object.entries(esc).map(([k, r]) => [k, `${r.status}${r.data?.code ? '/' + r.data.code : ''}${Array.isArray(r.data) ? ` filas=${r.data.length}` : ''}`]))
    rep.check('SEC.d', denied(esc.pago) && denied(esc.aprobar) && denied(esc.resultado) && denied(esc.crearQuiniela) && rowsOk(esc.codigos) && rowsOk(esc.auditoria) && others === 0 && payBefore === payAfter && intrusa === 0 && esc.pago.hasToken,
      `con el JWT de qa-user1 guardado por la app (desde la página): ${JSON.stringify(summary)}; participantes ajenos legibles=${others}; pago de qa-user2 antes/después=${payBefore}/${payAfter}; quinielas «UAT intrusa»=${intrusa}`)

    // ---------- F3: rutas de organizador como participante ----------
    const f3 = {}
    for (const path of ['/admin/ingresos', '/organizador', '/admin', '/admin/parrilla']) {
      await page.goto(`${BASE}${path}`)
      await sleep(2500)
      f3[path] = { final: await page.url(), adminNav: await page.has('nav[aria-label="Navegación del organizador"]'), finance: /Resumen de la organización|Mis finanzas/.test(await page.text()) }
    }
    await shot(page, 'b3-03-f3-participante-admin')
    rep.check('F3', Object.values(f3).every((r) => r.final === '/' && !r.adminNav && !r.finance) && ownOnly && partRows >= 1,
      `rutas -> ${JSON.stringify(f3)}; en su liga la pantalla recibió ${partRows} fila(s) de participants, todas propias=${ownOnly}`)

    // ================= C1 + SEC.f: cerrar sesión e iniciar como qa-user2 sin recargar =================
    await page.goto(`${BASE}/p/${D.pool.id}`)
    await page.waitForText('Esta quiniela usa tickets', { timeout: 25000 })
    await settle(page)
    await logoutUI(page)
    const idb2 = await idbSummary(page)
    const st2 = await dumpStorage(page)
    const tokenLeft = [...Object.keys(st2.ls), ...Object.keys(st2.ss)].filter((k) => /^sb-.*-auth-token$/.test(k)).length
    // «Atrás» tras cerrar sesión: navegación interna (mismo documento, misma memoria de la app).
    await page.eval('history.back()'); await sleep(2500)
    const backUrl = await page.url(); const backText = await page.text()
    await shot(page, 'b3-04-secf-atras-tras-logout')
    if (backUrl !== '/') { await page.eval('history.forward()'); await sleep(1500) }
    const secf = { tokenLeft, idb2, backUrl, backLeak: backText.includes(D.pool.name) || backText.includes('qa-user1') }
    rep.check('SEC.b', authKeys.length === 1 && !Object.values(pwdIn).some(Boolean) && jwtOutside.otherKeys.length === 0 && !jwtOutside.idb && jwtOutside.console === 0 && !jwtOutside.url && emailInConsole === 0,
      `claves de sesión de auth=${authKeys.length} (${authKeys.map((k) => k.replace(/^sb-(.{4}).*-auth-token$/, 'sb-$1…-auth-token')).join(',')}); contraseña presente en almacenamiento/IndexedDB/consola/URL=${JSON.stringify(pwdIn)}; JWT fuera de la clave de auth: otras claves=${JSON.stringify(jwtOutside.otherKeys)}, IndexedDB=${jwtOutside.idb}, consola=${jwtOutside.console}, URL=${jwtOutside.url}; correo en consola=${emailInConsole}; claves no-auth en almacenamiento=${JSON.stringify(nonAuth.map(([k]) => k))}`)

    // Login de qa-user2 en la portada que dejó el cierre de sesión, sin recargar el documento (misma memoria de la app que usó qa-user1).
    const mark = page.netEntries().length
    if ((await page.url()) !== '/' || await page.has('nav[aria-label]')) await page.goto(`${BASE}/`)
    const reloadedBeforeLogin = page.netEntries().slice(mark).some((r) => r.type === 'Document')
    await loginUI(page, u2, { navigate: false })
    // Barra inferior (no el acceso rápido de Inicio); se reintenta si el toque llega mientras la portada aún se está montando.
    for (let i = 0; i < 3 && (await page.url()) !== '/ligas'; i += 1) { await settle(page); await page.tap('nav[aria-label="Navegación principal"] a[href="/ligas"]'); await sleep(1500) }
    await page.waitFor(`!!document.querySelector('a[href="/p/${D.pool.id}"]')`, { timeout: 20000 })
    await page.tap(`a[href="/p/${D.pool.id}"]`)
    await page.waitForText('Esta quiniela usa tickets', { timeout: 25000 })
    await settle(page)
    const summary2 = await page.eval(`(() => { const t = document.body.innerText; return { pos: (t.match(/Tu posición\\s*#(\\d+)/) ?? [])[1] ?? null, pts: (t.match(/Puntos\\s*(\\d+)/) ?? [])[1] ?? null } })()`)
    await page.tap('[role=tab]', 'Partidos')
    await page.waitFor(`!!document.querySelector('[aria-label="Tickets de ${roundName}"]')`, { timeout: 20000 })
    await settle(page)
    const u2Tabs = await page.eval(`[...document.querySelectorAll('[aria-label="Tickets de la quiniela"] [role=tab]')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim())`)
    await page.tap('[role=tab]', 'Tabla'); await sleep(1500)
    const meRow = await page.eval(`(() => { const r = [...document.querySelectorAll('div.border-primary\\\\/40')].map((x) => x.innerText.replace(/\\s+/g, ' ')); return r })()`)
    const idb3 = await idbSummary(page)
    const u2TicketsDb = ((await svc.from('tickets').select('id').eq('participant_id', p2A.id)).data ?? []).length
    const lb = (await u2.client.rpc('pool_leaderboard', { p_pool_id: D.pool.id, p_round_id: null })).data ?? []
    const myLb = lb.find((r) => r.is_me)
    const leakReq = page.netEntries().slice(mark).filter((r) => r.url.includes(p1A.id) || r.url.includes(`profile_id=eq.${u1.id}`)).length
    await shot(page, 'b3-05-c1-user2-tabla')
    // qa-user2 no emite tickets en la UAT: cualquier pestaña de ticket en su pantalla sería de otra cuenta.
    const tabsOk = u2TicketsDb === 0 ? u2Tabs.length === 0 : u2Tabs.length <= u2TicketsDb
    rep.check('C1', Object.keys(idb1.namespaces).includes(`u:${short(u1.id)}`) && !Object.keys(idb2.namespaces).some((n) => n.startsWith('u:'))
      && JSON.stringify(Object.keys(idb3.namespaces).filter((n) => n.startsWith('u:'))) === JSON.stringify([`u:${short(u2.id)}`])
      && tabsOk && meRow.length === 1 && meRow[0].includes('qa-user2') && String(myLb?.rank) === summary2.pos && leakReq === 0,
      `qa-user1: IndexedDB=${JSON.stringify(idb1.namespaces)}, pestañas de ticket=${JSON.stringify(u1Tabs)}; tras cerrar sesión: IndexedDB=${JSON.stringify(idb2.namespaces)}; qa-user2 en la misma pestaña (documento recargado antes del login=${reloadedBeforeLogin}): IndexedDB=${JSON.stringify(idb3.namespaces)}, pestañas de ticket=${JSON.stringify(u2Tabs)} (tickets de qa-user2 en BD=${u2TicketsDb}), fila resaltada en la tabla=${JSON.stringify(meRow)}, «Tu posición» #${summary2.pos} vs RPC ${myLb?.rank}; peticiones con ids de qa-user1 tras el cambio=${leakReq}`)

    // ================= C2: sin conexión en la quiniela B (ya visitada) =================
    if (!p2B) {
      rep.notRun('C2', 'qa-user2 no participa en la quiniela B (lo inscribe b2/P1); sin una liga clásica con formulario no se puede probar «guardar requiere conexión»')
    } else {
      const c2 = []
      await page.goto(`${BASE}/p/${D.poolB.id}`)
      await page.waitFor(`/Próximos partidos|Tu inscripción/.test(document.body.innerText)`, { timeout: 25000 })
      await settle(page)
      // El SW debe controlar la página para el modo avión (segunda carga tras instalarse).
      if (!(await page.eval('!!navigator.serviceWorker?.controller'))) { await sleep(1500); await page.reload(); await settle(page) }
      const swCtl = await page.eval('!!navigator.serviceWorker?.controller')
      const predBefore = ((await svc.from('predictions').select('home_score, away_score').eq('participant_id', p2B.id)).data ?? [])
      const view = () => page.eval(`({ path: location.pathname, offline: document.querySelector('[data-test=offline-notice]')?.innerText ?? '', alert: [...document.querySelectorAll('[role=alert]')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim()).join(' | '), poolName: document.body.innerText.includes(${JSON.stringify(D.poolB.name)}), inputs: document.querySelectorAll('input[inputmode=numeric]').length, text: document.querySelector('main')?.innerText.replace(/\\s+/g, ' ').slice(0, 140) ?? document.body.innerText.slice(0, 140) })`)
      await page.emulateNetwork({ offline: true })
      await sleep(500)
      // (1) Navegación interna sin red: Inicio y volver a la liga.
      await page.tap('nav a[href="/"]'); await sleep(1200)
      await page.eval('history.back()'); await sleep(6000)
      const spa = await view()
      await shot(page, 'b3-06-c2-sin-red-navegacion')
      c2.push(`SW controla=${swCtl}; sin red, Inicio -> Atrás a la liga: aviso sin conexión="${spa.offline.slice(0, 60)}", alertas="${spa.alert.slice(0, 120)}", nombre de la liga=${spa.poolName}, campos=${spa.inputs}`)
      // (2) Guardar sin red, si el formulario está visible.
      let saveMsg = null
      if (spa.inputs >= 2) {
        page.clearLogs()
        await page.type(`#ph-${bOpen.matchId}`, '3'); await page.type(`#pa-${bOpen.matchId}`, '0')
        await page.tap(`form:has(#ph-${bOpen.matchId}) button[type=submit]`)
        await sleep(3000)
        saveMsg = await page.eval(`[...document.querySelectorAll('article [role=alert]')].map((e) => e.innerText).join(' | ')`)
        c2.push(`guardar 3-0 sin red: mensaje="${saveMsg}"`)
      }
      // (3) Recarga en modo avión (shell del SW).
      await page.reload({ settle: 6000 }).catch(() => {})
      await sleep(2000)
      const rel = await view()
      await shot(page, 'b3-07-c2-sin-red-recarga')
      c2.push(`recarga sin red: ruta=${rel.path}, aviso="${rel.offline.slice(0, 60)}", alertas="${rel.alert.slice(0, 120)}", nombre de la liga=${rel.poolName}, texto="${rel.text.slice(0, 100)}"`)
      // (4) Vuelve la red, sin tocar nada.
      await page.emulateNetwork({ offline: false })
      await sleep(12000)
      const back = await view()
      await shot(page, 'b3-08-c2-red-recuperada')
      const predAfter = ((await svc.from('predictions').select('home_score, away_score').eq('participant_id', p2B.id)).data ?? [])
      c2.push(`12 s después de volver la red (sin tocar nada): aviso="${back.offline.slice(0, 60)}", alertas="${back.alert.slice(0, 120)}", liga visible=${back.poolName}, campos=${back.inputs}; pronósticos en BD sin cambios=${JSON.stringify(predBefore) === JSON.stringify(predAfter)}`)
      const noticeShown = /Sin conexión: mostrando lo último guardado/.test(spa.offline + rel.offline)
      rep.check('C2', noticeShown && (spa.poolName || rel.poolName) && (saveMsg === null || saveMsg.length > 0) && JSON.stringify(predBefore) === JSON.stringify(predAfter) && back.poolName && !back.offline && !back.alert, c2.join(' · '))
    }
    rep.data('b3.consoleErrors', consoleErrors(page, t0).slice(0, 12))

    // ---------- SEC.f (cierre): cerrar la sesión de qa-user2 y abrir la quiniela por URL directa ----------
    await page.goto(`${BASE}/`); await settle(page)
    await logoutUI(page)
    await page.goto(`${BASE}/p/${D.pool.id}`); await sleep(3000)
    const directUrl = await page.url(); const directText = await page.text()
    await shot(page, 'b3-09-secf-url-directa-sin-sesion')
    rep.check('SEC.f', secf.tokenLeft === 0 && !Object.keys(secf.idb2.namespaces).some((n) => n.startsWith('u:')) && secf.backUrl === '/' && !secf.backLeak && directUrl === '/' && !directText.includes(D.pool.name),
      `tras «Cerrar sesión» de qa-user1: claves de sesión de auth restantes=${secf.tokenLeft}; IndexedDB=${JSON.stringify(secf.idb2.namespaces)}; «Atrás» -> "${secf.backUrl}" (datos de qa-user1 o de la quiniela visibles=${secf.backLeak}); tras cerrar la de qa-user2, /p/<quiniela> por URL -> "${directUrl}", nombre de la quiniela visible=${directText.includes(D.pool.name)}`)
  } catch (e) { await ctx.errShot(chrome, 'b3'); throw e } finally { await chrome.close() }

  // ================= SEC.e: un organizador manipula tenant_id (qa-requester contra la organización B) =================
  const chromeE = await ctx.launch('b3-e')
  try {
    const page = await chromeE.newPage({ width: 390, height: 844, dpr: 3 })
    watchSupabase(page)
    await loginUI(page, rq)
    await page.goto(`${BASE}/organizador`); await settle(page)
    const poolsB0 = ((await svc.from('pools').select('id').eq('tenant_id', D.tenantB)).data ?? []).length
    const toursB0 = ((await svc.from('tournaments').select('id').eq('tenant_id', D.tenantB)).data ?? []).length
    const r = {
      quiniela: await restInPage(page, '/rest/v1/rpc/manage_pool', { method: 'POST', body: { p_action: 'create', p_pool_id: null, p_tenant_id: D.tenantB, p_name: 'UAT tenant ajeno', p_lock_offset_minutes: 15, p_requires_approval: false } }),
      torneo: await restInPage(page, '/rest/v1/rpc/upsert_tournament', { method: 'POST', body: { p_tenant_id: D.tenantB, p_tournament_id: null, p_name: 'UAT tenant ajeno', p_sport_code: 'football', p_season_label: '2026' } }),
      codigo: await restInPage(page, '/rest/v1/rpc/create_pool_join_code', { method: 'POST', body: { p_pool_id: D.poolB.id } }),
      pausar: await restInPage(page, '/rest/v1/rpc/manage_pool', { method: 'POST', body: { p_action: 'pause', p_pool_id: D.poolB.id, p_tenant_id: null, p_name: null, p_lock_offset_minutes: null, p_requires_approval: null } }),
    }
    const poolsB1 = ((await svc.from('pools').select('id').eq('tenant_id', D.tenantB)).data ?? []).length
    const toursB1 = ((await svc.from('tournaments').select('id').eq('tenant_id', D.tenantB)).data ?? []).length
    const statusB = (await svc.from('pools').select('status').eq('id', D.poolB.id).single()).data.status
    const sum = Object.fromEntries(Object.entries(r).map(([k, x]) => [k, `${x.status}${x.data?.code ? '/' + x.data.code : ''}`]))
    rep.check('SEC.e', Object.values(r).every((x) => x.status >= 400 && x.data?.code === '42501') && poolsB0 === poolsB1 && toursB0 === toursB1 && statusB === 'open' && r.quiniela.hasToken,
      `qa-requester (owner de A) desde su sesión del navegador con ids de la organización B: ${JSON.stringify(sum)}; quinielas/torneos de B antes→después=${poolsB0}→${poolsB1}/${toursB0}→${toursB1}; estado de la quiniela B=${statusB}`)
    rep.data('b3.e.rpcCalls', rpcCalls(page, 'manage_pool').length)
  } catch (e) { await ctx.errShot(chromeE, 'b3-e'); throw e } finally { await chromeE.close() }
}
