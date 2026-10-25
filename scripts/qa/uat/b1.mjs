// Bloque b1: organizador (qa-requester) en la UI real. Casos A1, A2, A3, F1, F2 (parte organizador), P4 y FE-01/FE-02.
import { BASE, audit, calls, loginUI, rpcCalls, shot, short } from './lib.mjs'
import { sleep } from './cdp.mjs'

// \b evita falsos positivos como «Pagado 4 Pendiente» (4 + «Pen»).
const MONEY = /(S\/|\$|US\$|USD|PEN|€|EUR)\s?\d|\d\s?(soles|USD|PEN)\b/i

export async function run(ctx) {
  const { rep, svc, identities, D } = ctx
  const rq = identities.requester
  const chrome = await ctx.launch('b1')
  try {
    const page = await chrome.newPage({ width: 390, height: 844, dpr: 3 })
    await loginUI(page, rq)
    await shot(page, 'b1-01-home-admin')

    // ---------- A1 ----------
    const homeTile = await page.has('a[aria-label="Cambiar al panel de organizador"]')
    await page.tap('a[aria-label="Cambiar al panel de organizador"]')
    await page.waitForUrl(/^\/organizador/)
    await page.waitFor(`document.body.innerText.includes('Tus quinielas') || document.body.innerText.includes('No fue posible')`, { timeout: 20000 })
    await sleep(500)
    const nav = await page.eval(`(() => { const n = document.querySelector('nav[aria-label="Navegación del organizador"]'); return n ? { labels: [...n.querySelectorAll('div > a')].map((a) => a.innerText.trim()), strip: document.querySelector('[data-test=exit-admin-mode]')?.innerText.trim() ?? null, stripH: document.querySelector('[data-test=exit-admin-mode]')?.getBoundingClientRect().height ?? 0 } : null })()`)
    const body = await page.text()
    const superLinks = await page.eval(`[...document.querySelectorAll('a[href]')].filter((a) => /superadmin|plataforma/i.test(a.getAttribute('href') + a.innerText)).length`)
    const expected = ['Panel', 'Quinielas', 'Parrilla', 'Finanzas', 'Perfil']
    await shot(page, 'b1-02-panel-organizador')
    rep.check('A1', homeTile && nav && JSON.stringify(nav.labels) === JSON.stringify(expected) && /Modo participante/.test(nav.strip ?? '') && nav.stripH >= 44 && superLinks === 0 && !/superadmin|global/i.test(body),
      `tile Inicio=${homeTile}; barra=${JSON.stringify(nav?.labels)}; franja="${nav?.strip}" alto=${nav?.stripH}px; enlaces superadmin/plataforma=${superLinks}; texto con "superadmin/global"=${/superadmin|global/i.test(body)}`)

    // ---------- A2 ----------
    await page.goto(`${BASE}/superadmin`)
    await page.waitFor(`!!document.querySelector('nav[aria-label]')`)
    const a2url = await page.url()
    const a2text = await page.text()
    await shot(page, 'b1-03-superadmin-redirect')
    rep.check('A2', a2url === '/' && !/superadmin|plataforma|operaciones globales/i.test(a2text), `/superadmin -> ruta final "${a2url}"; texto sin "superadmin/plataforma"=${!/superadmin|plataforma/i.test(a2text)}`)

    // ---------- Defecto UAT-01: sin atajos, ¿cargan las pantallas de organizador? ----------
    const probe = {}
    for (const path of ['/organizador', '/admin', '/admin/parrilla']) {
      page.clearLogs()
      await page.goto(`${BASE}${path}`)
      await sleep(3500)
      const t = await page.text()
      const bad = page.netEntries().find((r) => r.url.includes('/rest/v1/participants') && r.url.includes('profiles') && r.status === 400)
      probe[path] = { loaded: !/No fue posible cargar/.test(t), msg: (t.match(/No fue posible cargar[^.]*./) ?? [''])[0], http400: Boolean(bad), body: bad ? ((await page.body(bad)) ?? '').slice(0, 160) : '' }
      await shot(page, `b1-03b-defecto${path.split('/').join('-')}`)
    }
    rep.check('UAT-01', Object.values(probe).every((p) => p.loaded), `carga de pantallas de organizador SIN atajos: ${JSON.stringify(probe)}`)
    // A partir de aquí, para poder seguir probando lo demás, se reescribe SOLO la URL del embed roto (participants?select=...profiles(display_name)).
    await page.rewriteRequests('*/rest/v1/participants?select=*', (u) => u.replace('%2Cprofiles%28display_name%29', ''))
    rep.data('shim', 'Fetch.continueRequest quita ",profiles(display_name)" de GET /rest/v1/participants?select=id,profile_id,approval_status,payment_status,profiles(display_name) desde UAT-01')

    // ---------- P4 ----------
    await page.goto(`${BASE}/p/${D.pool.id}`)
    await page.waitForText('Administras esta quiniela', { timeout: 20000 })
    const own = await page.eval(`({ inputs: document.querySelectorAll('input[inputmode=numeric]').length, newTicket: /Nuevo ticket|Guardar pronóstico|Enviar ticket/.test(document.body.innerText) })`)
    await shot(page, 'b1-04-own-pool-readonly')
    await page.tap('button, [role=tab]', 'Partidos').catch(() => page.tap('button', 'Partidos'))
    await sleep(1200)
    const ownMatches = await page.eval(`({ inputs: document.querySelectorAll('input[inputmode=numeric]').length, ticketBtns: /Nuevo ticket|Guardar pronóstico|Enviar ticket|Cancelar ticket/.test(document.body.innerText) })`)
    await shot(page, 'b1-05-own-pool-matches')
    await page.goto(`${BASE}/p/${D.poolB.id}`)
    await page.waitFor(`document.body.innerText.includes('Próximos partidos') || document.body.innerText.includes('Guardar pronóstico') || document.body.innerText.includes('Actualizar pronóstico') || document.body.innerText.includes('No tienes acceso')`, { timeout: 20000 })
    await sleep(800)
    const other = await page.eval(`({ inputs: document.querySelectorAll('input[inputmode=numeric]').length, save: /Guardar pronóstico|Actualizar pronóstico/.test(document.body.innerText), denied: /No tienes acceso/.test(document.body.innerText), admin: /Administras esta quiniela/.test(document.body.innerText) })`)
    await shot(page, 'b1-06-other-org-pool')
    rep.check('P4', own.inputs === 0 && !own.newTicket && ownMatches.inputs === 0 && !ownMatches.ticketBtns && other.inputs >= 2 && other.save && !other.admin,
      `propia: formularios=${own.inputs}/${ownMatches.inputs} (resumen/partidos), botones de ticket/pronóstico=${own.newTicket || ownMatches.ticketBtns}; ajena (inscrito): campos de marcador=${other.inputs}, botón guardar=${other.save}, aviso "Administras"=${other.admin}`)

    // ---------- F1 ----------
    await page.goto(`${BASE}/organizador`)
    await page.waitFor(`!!document.querySelector('a[href="/admin/ingresos"]')`)
    await page.tap('nav a[href="/admin/ingresos"]')
    await page.waitForText('Resumen de la organización', { timeout: 20000 })
    await sleep(800)
    const fin = await page.text()
    const pools = (await svc.from('pools').select('id').eq('tenant_id', D.tenant)).data ?? []
    const parts = (await svc.from('participants').select('payment_status, approval_status, withdrawn_at').in('pool_id', pools.map((p) => p.id))).data ?? []
    const dbCount = { total: parts.length, paid: parts.filter((p) => p.payment_status === 'paid').length, pending: parts.filter((p) => p.payment_status === 'pending').length, invited: parts.filter((p) => p.payment_status === 'invited').length }
    const dom = await page.eval(`(() => ({ total: document.querySelector('[data-test=total-participants]')?.innerText.trim(), paid: document.querySelector('[data-test=total-paid]')?.innerText.trim() }))()`)
    await shot(page, 'b1-07-mis-finanzas')
    rep.check('F1', !MONEY.test(fin) && /no cobra ni procesa pagos/i.test(fin) && Number(dom.total) === dbCount.total && Number(dom.paid) === dbCount.paid,
      `sin cifras monetarias=${!MONEY.test(fin)}${MONEY.test(fin) ? ` (coincidencia: «${fin.slice(Math.max(0, fin.search(MONEY) - 40), fin.search(MONEY) + 30).replace(/\s+/g, " ")}»)` : ""}; nota "no cobra ni procesa pagos"=${/no cobra ni procesa pagos/i.test(fin)}; UI participantes=${dom.total}, pagados=${dom.paid} vs BD (service_role, solo lectura) total=${dbCount.total}, pagados=${dbCount.paid}, pendientes=${dbCount.pending}, invitados=${dbCount.invited}`)

    // ---------- F2 (organizador A intenta ver la organización B por URL/selector) ----------
    const tb = short(D.tenantB)
    const probes = {}
    for (const path of [`/admin/ingresos?tenant=${D.tenantB}&tenantId=${D.tenantB}&tenant_id=${D.tenantB}`, `/admin?tenant_id=${D.tenantB}`, `/organizador?tenant=${D.tenantB}`, `/admin/parrilla?tenant_id=${D.tenantB}`]) {
      await page.goto(`${BASE}${path}`)
      await sleep(2500)
      const info = await page.eval(`({ opts: [...document.querySelectorAll('select option')].map((o) => o.textContent.trim().slice(0, 60)), text: document.body.innerText, html: document.documentElement.innerHTML })`)
      probes[path.split('?')[0]] = { tenantBInDom: info.html.includes(D.tenantB) || info.html.includes(tb), poolBName: info.text.includes('Quiniela B'), options: info.opts.filter((o) => /Organización|Tenant/.test(o)).length }
    }
    await shot(page, 'b1-08-f2-parrilla-with-foreign-id')
    rep.check('F2', Object.values(probes).every((p) => !p.tenantBInDom && !p.poolBName && p.options <= 1), `rutas con ids de la organización B en la URL: ${JSON.stringify(probes)} (esperado: sin rastro de B y un solo selector de organización propia)`)

    // ---------- A3 + FE-01 (parrilla) ----------
    const tourId = (await svc.from('matches').select('tournament_id').eq('id', D.matches[0].match_id).single()).data.tournament_id
    const tz = (await svc.from('tenants').select('timezone').eq('id', D.tenant).single()).data.timezone
    const roundName = `UAT Jornada ${Date.now().toString(36).slice(-4)}`
    await page.goto(`${BASE}/admin/parrilla`)
    await page.waitFor(`!!document.querySelector('select')`, { timeout: 20000 })
    await sleep(600)
    // El selector de torneo es el que contiene el id del torneo
    await page.eval(`(() => { const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === ${JSON.stringify(tourId)})); if (s) { s.value = ${JSON.stringify(tourId)}; s.dispatchEvent(new Event('change', { bubbles: true })) } })()`)
    await sleep(1200)
    await page.tap('button, [role=tab]', 'Jornadas').catch(() => {})
    await page.waitFor('#round-name')
    await page.type('#round-name', roundName)
    await page.tap('button[type=submit]', 'Añadir jornada')
    await page.waitForText('Jornada creada.')
    await shot(page, 'b1-09-parrilla-jornada-creada')
    await page.tap('button, [role=tab]', 'Partidos')
    await page.waitFor('#match-kickoff', { timeout: 15000 })
    const sel = await page.eval(`(() => { const labels = [...document.querySelectorAll('label')]; const pick = (t) => labels.find((l) => l.innerText.trim().startsWith(t))?.querySelector('select'); const r = pick('Jornada'); const h = pick('Local'); const v = pick('Visita'); return { r: [...r.options].map((o) => [o.value, o.textContent.trim()]), h: [...h.options].map((o) => [o.value, o.textContent.trim()]), v: [...v.options].map((o) => o.value) } })()`)
    const roundOpt = sel.r.find(([, t]) => t === roundName)
    const home = sel.h.filter(([v]) => v)[0]; const away = sel.h.filter(([v]) => v)[1]
    const setSelect = (labelStart, value) => page.eval(`(() => { const l = [...document.querySelectorAll('label')].find((x) => x.innerText.trim().startsWith(${JSON.stringify(labelStart)})); const s = l.querySelector('select'); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
    await setSelect('Jornada', roundOpt[0]); await setSelect('Local', home[0]); await setSelect('Visita', away[0])
    const kick = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(Date.now() + 3 * 3600_000)).replace(' ', 'T')
    await page.setValue('#match-kickoff', kick, 'input')
    await page.tap('button[type=submit]', 'Crear partido')
    await page.waitForText('Partido creado.', { timeout: 15000 })
    await shot(page, 'b1-10-parrilla-partido-creado')
    const created = (await svc.from('matches').select('id, status').eq('round_id', roundOpt[0])).data ?? []
    rep.check('A3.a', created.length === 1 && created[0].status === 'scheduled', `jornada "${roundName}" y partido creados desde la UI (filas en BD=${created.length}, estado=${created[0]?.status}, hora ${kick} ${tz})`)
    const matchId = created[0].id
    // Adelantar el inicio (sincronizador; igual que el E2E) para poder publicar resultado
    const adv = await svc.rpc('apply_fixture_update', { p_match_id: matchId, p_starts_at: new Date(Date.now() - 120_000).toISOString(), p_status: 'live' })
    if (adv.error) throw new Error(`apply_fixture_update: ${adv.error.message}`)
    await page.goto(`${BASE}/admin/parrilla`)
    await page.waitFor(`!!document.querySelector('select')`, { timeout: 20000 })
    await sleep(600)
    await page.eval(`(() => { const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === ${JSON.stringify(tourId)})); if (s) { s.value = ${JSON.stringify(tourId)}; s.dispatchEvent(new Event('change', { bubbles: true })) } })()`)
    await sleep(1200)
    await page.tap('button', 'Resultados')
    await page.waitFor(`!!document.querySelector('#score-h-${matchId}')`, { timeout: 15000 })
    await shot(page, 'b1-11-parrilla-resultados')
    const hs = await audit(page)

    // FE-01: solo el marcador local -> NO debe llamar al RPC ni publicar
    page.clearLogs()
    await page.type(`#score-h-${matchId}`, '2')
    await page.tap(`li:has(#score-h-${matchId}) button`, 'Publicar')   // el botón de ESTA fila (no el primero de la lista)
    await sleep(800)
    const msg1 = await page.eval(`document.querySelector('[role=alert]')?.innerText ?? ''`)
    const c1 = rpcCalls(page, 'publish_official_result').length
    const row1 = (await svc.from('official_results').select('home_score, away_score, revision').eq('match_id', matchId)).data ?? []
    await shot(page, 'b1-12-fe01-solo-local')
    // Ambos en blanco
    await page.type(`#score-h-${matchId}`, '')
    await page.tap(`li:has(#score-h-${matchId}) button`, 'Publicar')   // el botón de ESTA fila (no el primero de la lista)
    await sleep(600)
    const c2 = rpcCalls(page, 'publish_official_result').length
    rep.check('FE-01.parrilla', c1 === 0 && c2 === 0 && row1.length === 0 && /visita/i.test(msg1),
      `solo local="2": llamadas a publish_official_result=${c1}, mensaje="${msg1}", filas en official_results=${row1.length} (no se publicó 2-0); ambos en blanco: llamadas=${c2}`)

    // A3: publicar 2-1 y corregir a 0-0
    await page.type(`#score-h-${matchId}`, '2'); await page.type(`#score-a-${matchId}`, '1')
    await page.tap(`li:has(#score-h-${matchId}) button`, 'Publicar')
    await page.waitForText('Resultado publicado.', { timeout: 15000 })
    const r1 = (await svc.from('official_results').select('home_score, away_score, revision').eq('match_id', matchId)).data ?? []
    await page.type(`#score-h-${matchId}`, '0'); await page.type(`#score-a-${matchId}`, '0')
    await page.tap(`li:has(#score-h-${matchId}) button`, 'Corregir')
    await page.waitForText('Resultado corregido.', { timeout: 15000 })
    const r2 = (await svc.from('official_results').select('home_score, away_score, revision').eq('match_id', matchId)).data ?? []
    await shot(page, 'b1-13-parrilla-corregido')
    const pubCalls = rpcCalls(page, 'publish_official_result').length
    rep.check('A3', r1.length === 1 && r1[0].revision === 1 && r1[0].home_score === 2 && r1[0].away_score === 1 && r2.length === 1 && r2[0].revision === 2 && r2[0].home_score === 0 && hs.hscroll.ok && pubCalls === 2,
      `UI crea jornada+partido; publica 2-1 -> BD rev ${r1[0]?.revision} (${r1[0]?.home_score}-${r1[0]?.away_score}); corrige 0-0 -> rev ${r2[0]?.revision}, filas=${r2.length} (sin duplicar); llamadas RPC reales=${pubCalls}; scrollWidth/clientWidth parrilla=${hs.hscroll.scrollWidth}/${hs.hscroll.clientWidth}. Recálculo de puntos sin pronósticos en ese partido: el recálculo idempotente con pronósticos lo cubre el E2E de API (paso 10)`)

    // ---------- FE-02 (Panel / Quinielas) ----------
    await page.goto(`${BASE}/admin`)
    await page.waitFor(`document.body.innerText.includes('Quinielas') && !!document.querySelector('#admin-lock-minutes')`, { timeout: 20000 })
    await sleep(800)
    // elegir la quiniela de D.pool por su nombre
    await page.tap('button', D.pool.name)
    await sleep(1500)
    const brBefore = (await svc.from('tenant_branding').select('primary_color, secondary_color').eq('tenant_id', D.tenant)).data ?? []
    page.clearLogs()
    await page.type('#admin-lock-minutes', '')
    await page.tap('form button[type=submit]', 'Guardar configuración')
    await sleep(700)
    const lockMsg = await page.eval(`document.querySelector('[role=alert]')?.innerText ?? ''`)
    const mp = rpcCalls(page, 'manage_pool').length
    await shot(page, 'b1-14-fe02-bloqueo-vacio')
    await page.type('#exact-points', '')
    await page.tap('button', 'Publicar nueva versión')
    await sleep(700)
    const ptsMsg = await page.eval(`document.querySelector('[role=alert]')?.innerText ?? ''`)
    const pr = rpcCalls(page, 'publish_pool_rules').length
    await page.type('#outcome-points', '')
    await page.tap('button', 'Publicar nueva versión')
    await sleep(500)
    const pr2 = rpcCalls(page, 'publish_pool_rules').length
    rep.check('FE-02.panel', mp === 0 && pr === 0 && pr2 === 0 && lockMsg.length > 0 && ptsMsg.length > 0,
      `bloqueo vacío: llamadas manage_pool=${mp}, mensaje="${lockMsg}"; puntos vacíos: llamadas publish_pool_rules=${pr}/${pr2}, mensaje="${ptsMsg}"`)
    // Branding (plan Free)
    const brandState = await page.eval(`(() => ({ plan: document.body.innerText.includes('El branding personalizado requiere PRO.'), primaryDisabled: document.querySelector('#primary-color')?.disabled, secondaryDisabled: document.querySelector('#secondary-color')?.disabled, btnDisabled: [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Guardar branding')?.disabled, planChip: [...document.querySelectorAll('span')].some((s) => s.innerText.trim() === 'FREE') }))()`)
    await page.eval(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Guardar branding')?.scrollIntoView({ block: 'center' })`)
    await shot(page, 'b1-15-fe02-branding-free')
    await page.eval(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Guardar branding')?.click()`)
    await sleep(500)
    const bc = rpcCalls(page, 'update_tenant_branding').length
    const brAfter = (await svc.from('tenant_branding').select('primary_color, secondary_color').eq('tenant_id', D.tenant)).data ?? []
    rep.check('FE-02.branding', brandState.plan && brandState.primaryDisabled && brandState.secondaryDisabled && brandState.btnDisabled && bc === 0 && JSON.stringify(brBefore) === JSON.stringify(brAfter),
      `tenant Free (chip FREE=${brandState.planChip}): mensaje "requiere PRO"=${brandState.plan}, campos deshabilitados=${brandState.primaryDisabled}/${brandState.secondaryDisabled}, botón deshabilitado=${brandState.btnDisabled}, llamadas update_tenant_branding=${bc}, colores en BD sin cambios=${JSON.stringify(brBefore) === JSON.stringify(brAfter)}. Rama PRO (colores precargados y sin pisar) NOT_RUN: no hay tenant PRO en QA y no se eleva el plan`)
    rep.data('b1.console', page.console.filter((c) => /error|warn/.test(c.type)).map((c) => c.text).slice(0, 10))
    rep.data('b1.exceptions', page.exceptions.map((e) => e.text).slice(0, 5))
  } finally {
    await chrome.close()
  }
}
