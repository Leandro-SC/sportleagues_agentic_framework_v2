// Bloque b2: participante en la UI real. Casos T1 (tickets), R1 (rankings), S1 (solicitud «Crear mi propia quiniela»), P1 (inscripción con
// código y aprobación), X1 (auto-fill Elo+Poisson), P2 (pronóstico clásico y cierre decidido por el servidor) y P3 (privacidad).
//
// Identidades y quinielas (todas sintéticas):
//   qa-user1  -> quiniela A (modo tickets, de qa-requester): T1, R1 y S1.
//   P1        -> la primera de [qa-user2, qa-outsider] que no esté aún en la quiniela B (clásica, de qa-admin-b) se inscribe con código.
//   qa-admin-b -> aprueba desde su panel (P1). Para que haya estado «pendiente» se activa temporalmente la aprobación manual de la quiniela B
//                 con la misma RPC que usa el formulario del panel (manage_pool 'update') y se restaura al terminar.
//   qa-user2  -> en B: X1 y P2; en A: P3 y el aviso de cierre de T1 (no emite tickets, así el aviso es repetible).
// Un solo Chrome a la vez (RAM): user1 -> inscrito P1 -> admin-b -> inscrito P1 (mismo perfil, sesión y caché conservadas) -> user2.
import { BASE, audit, calls, clearDeviceClock, consoleErrors, loginUI, restInPage, rpcCalls, setDeviceClock, settle, shot, short, watchSupabase } from './lib.mjs'
import { sleep } from './cdp.mjs'

const MIN = 60_000

/** Pestañas de tickets de una jornada tal como se ven: número, estado visible y si está elegida. */
const ticketTabs = (page, roundName) => page.eval(`[...document.querySelectorAll('[aria-label="Tus tickets de ${roundName}"] [role=tab]')].map((b, i) => ({ i, text: b.innerText.replace(/\\s+/g, ' ').trim(), selected: b.getAttribute('aria-selected') === 'true' }))`)
/** Toca la pestaña de ticket número `i` (índice en el DOM; evita la ambigüedad «Ticket 1»/«Ticket 12»). */
async function tapTicketTab(page, roundName, i) {
  await page.eval(`(() => { document.querySelectorAll('[data-uat=pick]').forEach((e) => e.removeAttribute('data-uat')); const b = document.querySelectorAll('[aria-label="Tus tickets de ${roundName}"] [role=tab]')[${i}]; if (b) b.setAttribute('data-uat', 'pick') })()`)
  await page.tap('[data-uat=pick]')
  await sleep(400)
}

export async function run(ctx) {
  const { rep, svc, identities, D, fresh, bOpen } = ctx
  const { user1: u1, user2: u2, adminB: ab, requester: rq } = identities
  const roundName = fresh.round.name

  // Datos de referencia (service_role, SOLO lectura): participaciones, partidos de la jornada UAT y su jornada vendible.
  const part = async (poolId, profileId) => ((await svc.from('participants').select('id, approval_status').eq('pool_id', poolId).eq('profile_id', profileId)).data ?? [])
  const p1A = (await part(D.pool.id, u1.id))[0]
  const p2A = (await part(D.pool.id, u2.id))[0]
  const pmA = (await svc.from('pool_matches').select('id, match_id, lock_at').eq('pool_id', D.pool.id)).data ?? []
  const freshMatches = ((await svc.from('matches').select('id, starts_at, status').eq('round_id', fresh.round.id)).data ?? []).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  const poolRound = ((await svc.from('pool_rounds').select('id, max_tickets_per_participant').eq('pool_id', D.pool.id).eq('round_id', fresh.round.id)).data ?? [])[0]
  const liveTickets = async () => ((await svc.from('tickets').select('id, status').eq('participant_id', p1A.id).eq('pool_round_id', poolRound.id)).data ?? []).filter((t) => t.status !== 'cancelled')
  const cap = poolRound?.max_tickets_per_participant ?? null

  // =========================== qa-user1: T1, R1, S1 ===========================
  {
    const chrome = await ctx.launch('b2-u1')
    try {
      const page = await chrome.newPage({ width: 390, height: 844, dpr: 3 })
      watchSupabase(page)
      await loginUI(page, u1)
      await page.goto(`${BASE}/p/${D.pool.id}`)
      await page.waitForText('Esta quiniela usa tickets', { timeout: 25000 })
      await shot(page, 'b2-01-u1-pool-resumen')
      const t0 = Date.now()

      // ---------- T1: emitir hasta el cupo, guardar, enviar, cancelar y reemitir ----------
      page.clearLogs()
      await page.tap('[role=tab]', 'Partidos')
      const art = `[aria-label="Tickets de ${roundName}"]`
      await page.waitFor(`!!document.querySelector('${art}')`, { timeout: 20000 })
      await settle(page)
      const log = []
      let live = (await liveTickets()).length
      let created = 0
      for (let guard = 0; live < cap && guard < cap + 1; guard += 1) {
        await page.tap(`${art} button`, 'Nuevo ticket')
        for (let i = 0; i < 40 && (await liveTickets()).length === live; i += 1) await sleep(250)
        live = (await liveTickets()).length; created += 1
        await sleep(800)
      }
      const atCap = await page.eval(`(() => { const a = document.querySelector('${art}'); return { newBtn: [...a.querySelectorAll('button')].some((b) => b.innerText.includes('Nuevo ticket')), maxMsg: a.innerText.includes('Alcanzaste el máximo de tickets'), chip: (a.querySelector('header')?.innerText.match(/\\d+\\/\\d+ tickets/) ?? [''])[0], sales: (a.querySelector('header')?.innerText.match(/La venta cierra[^\\n]*/) ?? [''])[0] } })()`)
      log.push(`emitidos ahora=${created}, vivos=${live}/${cap}; botón «Nuevo ticket» con cupo lleno=${atCap.newBtn}; aviso de máximo=${atCap.maxMsg}; chip="${atCap.chip}"; venta="${atCap.sales}"`)
      await shot(page, 'b2-03-t1-cupo-lleno')

      // Elegir un borrador (o cualquier vivo) y guardar las dos selecciones; 9-8 en el primer partido sirve de marca para P3.
      let tabs = await ticketTabs(page, roundName)
      let pick = tabs.find((t) => /Borrador/.test(t.text)) ?? tabs.find((t) => !/Cancelado/.test(t.text))
      await tapTicketTab(page, roundName, pick.i)
      const keepNo = pick.text.match(/Ticket (\d+)/)[1]
      const scores = [[9, 8], [1, 1]]
      for (const [k, m] of freshMatches.slice(0, 2).entries()) {
        await page.type(`#ph-${m.id}`, String(scores[k][0])); await page.type(`#pa-${m.id}`, String(scores[k][1]))
        await page.tap(`form:has(#ph-${m.id}) button[type=submit]`)
        await page.waitFor(`(document.querySelector('form:has(#ph-${m.id})')?.innerText ?? '').includes('Actualizar pronóstico') || !!document.querySelector('article:has(#ph-${m.id}) [role=alert]')`, { timeout: 15000, label: 'selección guardada' })
      }
      const selErr = await page.eval(`[...document.querySelectorAll('${art} [role=alert]')].map((e) => e.innerText).join(' | ')`)
      const preds = ((await svc.from('predictions').select('pool_match_id, home_score, away_score, ticket_id').eq('participant_id', p1A.id).in('pool_match_id', pmA.filter((p) => freshMatches.some((m) => m.id === p.match_id)).map((p) => p.id))).data ?? [])
      if (/Borrador/.test(pick.text)) {
        await page.tap(`${art} button`, 'Enviar ticket')
        await page.waitFor(`[...document.querySelectorAll('[aria-label="Tus tickets de ${roundName}"] [role=tab]')].some((b) => b.getAttribute('aria-selected') === 'true' && /Enviado/.test(b.innerText))`, { timeout: 15000, label: 'ticket enviado' })
      }
      const submittedNow = ((await svc.from('tickets').select('status').eq('participant_id', p1A.id).eq('pool_round_id', poolRound.id).eq('status', 'submitted')).data ?? []).length
      log.push(`ticket ${keepNo}: selecciones en BD=${preds.filter((p) => p.ticket_id).length} (errores UI="${selErr}"), enviados en BD=${submittedNow}`)
      await shot(page, 'b2-04-t1-enviado')

      // Cancelar OTRO ticket vivo y reemitir.
      tabs = await ticketTabs(page, roundName)
      let other = tabs.find((t) => !/Cancelado/.test(t.text) && !t.text.startsWith(`Ticket ${keepNo} `) && t.text !== `Ticket ${keepNo}`)
      await tapTicketTab(page, roundName, other.i)
      await page.tap(`${art} button`, 'Cancelar ticket')
      for (let i = 0; i < 40 && (await liveTickets()).length === cap; i += 1) await sleep(250)
      const afterCancel = (await liveTickets()).length
      await sleep(800)
      const newBack = await page.eval(`[...document.querySelectorAll('${art} button')].some((b) => b.innerText.includes('Nuevo ticket'))`)
      await page.tap(`${art} button`, 'Nuevo ticket')
      for (let i = 0; i < 40 && (await liveTickets()).length === afterCancel; i += 1) await sleep(250)
      const afterReissue = (await liveTickets()).length
      log.push(`cancelar ticket ${other.text.match(/Ticket (\d+)/)[1]} -> vivos=${afterCancel}, «Nuevo ticket» reaparece=${newBack}; reemitir -> vivos=${afterReissue}`)
      await sleep(800)

      // Mala conexión: liberar un hueco, intentar SIN red y reintentar con latencia alta tocando dos veces.
      tabs = await ticketTabs(page, roundName)
      other = [...tabs].reverse().find((t) => /Borrador/.test(t.text) && !t.text.startsWith(`Ticket ${keepNo} `))
      await tapTicketTab(page, roundName, other.i)
      await page.tap(`${art} button`, 'Cancelar ticket')
      for (let i = 0; i < 40 && (await liveTickets()).length === cap; i += 1) await sleep(250)
      const freed = (await liveTickets()).length
      await sleep(800)
      const mark = page.netEntries().length
      const panelState = () => page.eval(`(() => { const p = document.querySelector('[aria-label="Tickets de la quiniela"]'); return p ? { alerts: [...p.querySelectorAll('[role=alert]')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim()).join(' | '), newBtn: [...p.querySelectorAll('button')].some((b) => b.innerText.includes('Nuevo ticket')), retry: [...p.querySelectorAll('[role=alert] button')].some((b) => /Reintentar|Volver a intentar/.test(b.innerText)) } : null })()`)
      await page.emulateNetwork({ offline: true })
      await page.tap(`${art} button`, 'Nuevo ticket')
      await sleep(3000)
      const off = await panelState()
      const offLive = (await liveTickets()).length
      await shot(page, 'b2-05a-t1-sin-red')
      await page.emulateNetwork({ offline: false, latency: 1500, down: 50_000, up: 20_000 })
      await sleep(2000)
      // ¿La pantalla permite reintentar por sí misma? Si quedó en un error sin acción, se sale y se vuelve a la pestaña (lo que haría el usuario).
      const back = await panelState()
      const deadEnd = !back?.newBtn
      if (deadEnd) {
        await page.tap('[role=tab]', 'Resumen'); await sleep(600); await page.tap('[role=tab]', 'Partidos')
        await page.waitFor(`[...document.querySelectorAll('${art} button')].some((b) => b.innerText.includes('Nuevo ticket'))`, { timeout: 30000, label: 'botón Nuevo ticket tras volver a la pestaña' })
      }
      await page.tap(`${art} button`, 'Nuevo ticket')
      await page.tap(`${art} button`, 'Nuevo ticket', { retries: 2 }).catch(() => {})   // segundo toque impaciente (el botón queda en «cargando»)
      for (let i = 0; i < 60 && (await liveTickets()).length === freed; i += 1) await sleep(250)
      await sleep(5000)
      await page.emulateNetwork({ offline: false })
      const finalLive = (await liveTickets()).length
      const createReqs = page.netEntries().slice(mark).filter((r) => r.url.includes('/rest/v1/rpc/create_ticket') && r.method === 'POST')
      const keys = new Set(createReqs.map((r) => { try { return JSON.parse(r.postData).p_idempotency_key } catch { return null } }))
      log.push(`hueco liberado -> vivos=${freed}; sin red: alertas="${off?.alerts}", botón reintentar=${off?.retry}, vivos=${offLive}; al volver la red la pantalla ofrece «Nuevo ticket» sin salir=${!deadEnd}; reintento con 1,5 s de latencia y doble toque: peticiones create_ticket=${createReqs.length} (claves distintas=${keys.size}), tickets nuevos=${finalLive - freed}, vivos finales=${finalLive}`)
      await shot(page, 'b2-05-t1-reintento')
      const maxSeen = Math.max(live, afterReissue, finalLive)
      rep.check('T1', cap === 2 && live === cap && !atCap.newBtn && atCap.maxMsg && /La venta cierra/.test(atCap.sales) && preds.filter((p) => p.ticket_id).length >= 2 && submittedNow >= 1
        && afterCancel === cap - 1 && newBack && afterReissue === cap && freed === cap - 1 && offLive === freed && (off?.alerts ?? '').length > 0 && finalLive === cap && finalLive - freed === 1 && maxSeen <= cap,
        log.join(' · '))
      rep.check('T1.reintento', !deadEnd || Boolean(off?.retry), `tras un fallo sin red el panel de tickets muestra "${off?.alerts}" ${off?.retry ? 'con' : 'SIN'} acción de reintento; al volver la red sigue sin «Nuevo ticket» hasta salir y volver a la pestaña=${deadEnd} (criterio móvil 6: error con reintento)`)
      rep.data('b2.t1.consoleErrors', consoleErrors(page, t0).slice(0, 8))

      // ---------- R1: tabla general, por jornada y rachas ----------
      await page.tap('[role=tab]', 'Tabla')
      await page.waitFor(`!!document.querySelector('select') || document.body.innerText.includes('La tabla aparecerá')`, { timeout: 15000 })
      await sleep(1200)
      const readRows = () => page.eval(`(() => { const box = [...document.querySelectorAll('div.app-surface')].find((d) => d.querySelector(':scope > div > span') && / pts$/m.test(d.innerText)); if (!box) return [];
        return [...box.children].map((r) => ({ rank: Number(r.querySelector('span')?.innerText), name: r.querySelector('div p')?.innerText.trim(), detail: r.querySelectorAll('div p')[1]?.innerText.trim() ?? '', points: Number((r.lastElementChild?.innerText.match(/-?\\d+/) ?? ['NaN'])[0]), me: r.className.includes('border-primary') })) })()`)
      const general = await readRows()
      const rpcGeneral = (await u1.client.rpc('pool_leaderboard', { p_pool_id: D.pool.id, p_round_id: null })).data ?? []
      await shot(page, 'b2-06-r1-tabla-general')
      const roundWithResults = (await svc.from('official_results').select('match_id').in('match_id', pmA.map((p) => p.match_id))).data?.[0]
      const r1Round = roundWithResults ? (await svc.from('matches').select('round_id').eq('id', roundWithResults.match_id).single()).data.round_id : null
      let byRound = []; let rpcRound = []
      if (r1Round) {
        await page.setValue('select', r1Round)
        await sleep(2000)
        byRound = await readRows()
        rpcRound = (await u1.client.rpc('pool_leaderboard', { p_pool_id: D.pool.id, p_round_id: r1Round })).data ?? []
        await shot(page, 'b2-07-r1-tabla-jornada')
      }
      const same = (dom, api) => dom.length === api.length && api.every((r, i) => dom[i] && dom[i].rank === r.rank && dom[i].name === r.display_name && dom[i].points === Number(r.points) && dom[i].me === r.is_me && dom[i].detail === `${r.exact_hits} exactos · racha ${r.current_streak}`)
      const adminListed = [...general, ...byRound].some((r) => /qa-requester|qa-admin-b/.test(r.name))
      rep.check('R1', general.length > 0 && same(general, rpcGeneral) && (!r1Round || (byRound.length > 0 && same(byRound, rpcRound))) && !adminListed && general.filter((r) => r.me).length === 1 && general.find((r) => r.me)?.name === 'qa-user1',
        `general UI=${JSON.stringify(general.map((r) => [r.rank, r.name, r.points, r.detail]))} vs pool_leaderboard (misma sesión)=${JSON.stringify(rpcGeneral.map((r) => [r.rank, r.display_name, Number(r.points), r.current_streak]))}; por jornada ${short(r1Round)} UI=${JSON.stringify(byRound.map((r) => [r.rank, r.name, r.points]))} vs RPC=${JSON.stringify(rpcRound.map((r) => [r.rank, r.display_name, Number(r.points)]))}; organizadores listados=${adminListed}; fila propia resaltada=${general.find((r) => r.me)?.name}`)

      // ---------- S1: «Crear mi propia quiniela» desde Mi perfil ----------
      const reqRows = async () => ((await svc.from('pool_creation_requests').select('id, status').eq('requester_id', u1.id)).data ?? [])
      const before = await reqRows()
      page.clearLogs()
      await page.goto(`${BASE}/perfil`)
      await page.waitFor('[data-test=pool-request-card]', { timeout: 20000 })
      await settle(page)
      const card = '[data-test=pool-request-card]'
      const s1 = []
      let submittedHere = false
      if (!before.some((r) => r.status === 'pending')) {
        const openLabel = (await page.eval(`[...document.querySelectorAll('${card} button')].map((b) => b.innerText.trim()).find((t) => /Crear mi propia quiniela|Enviar una nueva solicitud/.test(t)) ?? 'Crear mi propia quiniela'`))
        await page.tap(`${card} button`, openLabel)
        await page.waitFor('#pool-request-note')
        await page.type('#pool-request-note', 'UAT navegador: solicitud sintética de prueba (qa-user1).')
        await shot(page, 'b2-08-s1-hoja')
        // Doble toque sobre «Enviar solicitud» (reenvío impaciente): el servidor es idempotente y la UI se bloquea mientras envía.
        const r = await page.rectOf('form button[type=submit]', 'Enviar solicitud')
        for (let i = 0; i < 2; i += 1) { await page.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) }] }); await page.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(60) }
        await page.waitFor(`document.querySelector('${card}')?.innerText.includes('Solicitud pendiente')`, { timeout: 15000, label: 'estado pendiente' })
        submittedHere = true
      }
      await sleep(800)
      const s1text = await page.eval(`document.querySelector('${card}').innerText`)
      const createBtn = await page.eval(`[...document.querySelectorAll('${card} button')].some((b) => /Crear mi propia quiniela|Enviar una nueva solicitud/.test(b.innerText) && !b.disabled)`)
      const after = await reqRows()
      const reqCalls = rpcCalls(page, 'request_pool_creation').length
      await shot(page, 'b2-09-s1-pendiente')
      s1.push(`antes: ${JSON.stringify(before.map((r) => r.status))}; enviada en esta ejecución=${submittedHere} (llamadas request_pool_creation=${reqCalls}); tarjeta="${s1text.replace(/\s+/g, ' ').slice(0, 140)}"; botón para enviar otra=${createBtn}; pendientes en BD=${after.filter((r) => r.status === 'pending').length}`)
      // Sin acceso de organizador: Inicio sin acceso al panel y /admin devuelve a Inicio.
      await page.goto(`${BASE}/`); await settle(page)
      const tile = await page.has('a[aria-label="Cambiar al panel de organizador"]')
      await page.goto(`${BASE}/admin`); await sleep(2500)
      const adminUrl = await page.url()
      const mem = ((await svc.from('tenant_memberships').select('role').eq('profile_id', u1.id)).data ?? []).filter((m) => ['owner', 'admin'].includes(m.role)).length
      s1.push(`acceso organizador: tile en Inicio=${tile}, /admin -> "${adminUrl}", membresías owner/admin=${mem}`)
      rep.check('S1', after.filter((r) => r.status === 'pending').length === 1 && /Solicitud pendiente/.test(s1text) && !createBtn && !tile && adminUrl === '/' && mem === 0 && (!submittedHere || after.length === before.length + 1), s1.join(' · '))
      // Limpieza por la misma UI: cancelar la solicitud pendiente (deja QA sin solicitudes vivas de qa-user1 y prueba la cancelación).
      await page.goto(`${BASE}/perfil`)
      await page.waitFor('[data-test=pool-request-card]', { timeout: 20000 }); await settle(page)
      await page.tap(`${card} button`, 'Cancelar solicitud')
      await page.tap(`[data-test=cancel-confirm] button`, 'Sí, cancelar')
      await page.waitFor(`document.querySelector('${card}')?.innerText.includes('Solicitud cancelada')`, { timeout: 15000, label: 'solicitud cancelada' }).catch(() => {})
      const cancelled = (await reqRows()).filter((r) => r.status === 'pending').length === 0
      rep.check('S1.cancelar', cancelled && (await page.eval(`document.querySelector('${card}').innerText.includes('Solicitud cancelada')`)), `cancelación desde la UI -> pendientes en BD=${(await reqRows()).filter((r) => r.status === 'pending').length}`)
      rep.data('b2.u1.consoleErrors', consoleErrors(page, t0).slice(0, 10))
    } catch (e) { await ctx.errShot(chrome, "b2-u1"); throw e } finally {
      await chrome.close()
    }
  }

  // =========================== P1: inscripción con código en la quiniela B, espera y aprobación ===========================
  // La espera de aprobación solo se puede observar una vez por identidad (después queda aprobada para siempre). Se usa la primera de
  // [qa-user2, qa-outsider] que aún no esté en B; qa-outsider en la quiniela B (otro tenant) no altera las comprobaciones del E2E, que
  // usan su ausencia en la quiniela A. Si ambas ya están, P1 no se repite (queda el resultado de la ejecución que sí lo observó).
  const poolB = (await svc.from('pools').select('id, name, lock_offset, requires_approval').eq('id', D.poolB.id).single()).data
  const lockMin = Number(String(poolB.lock_offset).split(':')[1] ?? 15) + Number(String(poolB.lock_offset).split(':')[0] ?? 0) * 60
  const setApproval = (v) => ab.client.rpc('manage_pool', { p_action: 'update', p_pool_id: poolB.id, p_tenant_id: null, p_name: poolB.name, p_lock_offset_minutes: lockMin, p_requires_approval: v })
  const code = (await ab.client.rpc('create_pool_join_code', { p_pool_id: poolB.id })).data?.code
  let joiner = null
  for (const who of [u2, identities.outsider]) if (!joiner && !(await part(poolB.id, who.id)).length) joiner = who
  let approvalTouched = false
  try {
    if (!joiner) {
      rep.notRun('P1.repeticion', 'qa-user2 y qa-outsider ya están inscritos y aprobados en la quiniela B por ejecuciones anteriores; con 5 cuentas fijas no queda identidad libre para volver a observar la espera de aprobación (P1 conserva el resultado de la ejecución que la observó)')
      // Lo que sí se puede repetir: la última identidad aprobada por P1 (qa-outsider), en un dispositivo limpio, ve el formulario y re-inscribirse es idempotente.
      const out = identities.outsider
      const chrome = await ctx.launch('b2-p1b')
      try {
        const page = await chrome.newPage({ width: 390, height: 844, dpr: 3 })
        await loginUI(page, out)
        await page.goto(`${BASE}/ligas/unirme`)
        await page.waitFor('#league-search')
        await page.type('#league-search', code)
        await page.tap('article button', 'Unirme')
        await page.waitForUrl(new RegExp(`^/p/${poolB.id}`), { timeout: 25000 })
        await page.waitFor(`/Próximos partidos|Tu inscripción está pendiente|No tienes acceso/.test(document.body.innerText)`, { timeout: 25000 })
        await settle(page)
        const st = await page.eval(`({ notice: document.querySelector('p[role=status]')?.innerText ?? '', inputs: document.querySelectorAll('input[inputmode=numeric]').length })`)
        const rows = await part(poolB.id, out.id)
        await shot(page, 'b2-12c-p1-aprobado-dispositivo-limpio')
        rep.check('P1.aprobado', rows.length === 1 && rows[0].approval_status === 'approved' && st.inputs >= 2 && !/pendiente/.test(st.notice),
          `qa-outsider (aprobado en una ejecución anterior) en un dispositivo sin caché: re-inscripción con código -> filas en B=${rows.length} (${rows[0]?.approval_status}); aviso="${st.notice}"; campos de marcador=${st.inputs}`)
      } catch (e) { await ctx.errShot(chrome, 'b2-p1b'); throw e } finally { await chrome.close() }
    } else {
      const label = joiner.email.split('@')[0]
      const r = await setApproval(true); if (r.error) throw new Error(`manage_pool update: ${r.error.message}`); approvalTouched = true
      const p1 = [`identidad ${label}`]
      let pendingSeen = false
      {
        const chrome = await ctx.launch('b2-p1')
        try {
          const page = await chrome.newPage({ width: 390, height: 844, dpr: 3 })
          await loginUI(page, joiner)
          page.clearLogs()
          await page.goto(`${BASE}/ligas/unirme`)
          await page.waitFor('#league-search')
          await page.type('#league-search', code)
          await shot(page, 'b2-10a-p1-codigo')
          await page.tap('article button', 'Unirme')
          await page.waitForUrl(new RegExp(`^/p/${poolB.id}`), { timeout: 25000 })
          await page.waitFor(`/Tu inscripción está pendiente|Próximos partidos|No tienes acceso/.test(document.body.innerText)`, { timeout: 20000 })
          await settle(page)
          const st = await page.eval(`({ notice: document.querySelector('p[role=status]')?.innerText ?? '', inputs: document.querySelectorAll('input[inputmode=numeric]').length, save: /Guardar pronóstico|Actualizar pronóstico/.test(document.body.innerText) })`)
          const row = await part(poolB.id, joiner.id)
          await shot(page, 'b2-10-p1-pendiente')
          p1.push(`join_pool desde «Unirme a una liga» (llamadas=${rpcCalls(page, 'join_pool').length}) -> /p/${short(poolB.id)}; aviso="${st.notice}"; campos de marcador=${st.inputs}; botón guardar=${st.save}; fila en BD=${JSON.stringify(row.map((x) => x.approval_status))}`)
          pendingSeen = row.length === 1 && row[0].approval_status === 'pending' && /pendiente de aprobación/.test(st.notice) && st.inputs === 0 && !st.save
        } catch (e) { await ctx.errShot(chrome, 'b2-p1-join'); throw e } finally { await chrome.close() }
      }
      {
        // qa-admin-b aprueba desde su panel. Se reescribe SOLO la URL del embed roto de UAT-01 para que la lista de participantes cargue.
        const chrome = await ctx.launch('b2-ab')
        try {
          const page = await chrome.newPage({ width: 390, height: 844, dpr: 3 })
          await loginUI(page, ab)
          await page.rewriteRequests('*/rest/v1/participants?select=*', (u) => u.replace('%2Cprofiles%28display_name%29', ''))
          await page.goto(`${BASE}/admin`)
          await page.waitFor(`!!document.querySelector('#admin-lock-minutes')`, { timeout: 25000 })
          await sleep(800)
          await page.tap('button', poolB.name)
          await page.waitFor(`[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Aprobar')`, { timeout: 20000, label: 'botón Aprobar' })
          await shot(page, 'b2-11-p1-admin-aprobar')
          page.clearLogs()
          await page.tap('button', 'Aprobar')
          for (let i = 0; i < 40 && (await part(poolB.id, joiner.id))[0]?.approval_status !== 'approved'; i += 1) await sleep(250)
          p1.push(`qa-admin-b aprueba desde /admin (approve_participant=${rpcCalls(page, 'approve_participant').length}, reescrituras UAT-01=${page.rewritten}) -> BD=${(await part(poolB.id, joiner.id))[0]?.approval_status}`)
        } catch (e) { await ctx.errShot(chrome, 'b2-ab'); throw e } finally { await chrome.close() }
      }
      await setApproval(false); approvalTouched = false
      {
        // El participante vuelve a abrir la app en el MISMO dispositivo (perfil conservado, como un usuario real).
        const chrome = await ctx.launch('b2-p1', { fresh: false })
        try {
          const page = await chrome.newPage({ width: 390, height: 844, dpr: 3 })
          await page.goto(`${BASE}/p/${poolB.id}`)
          await page.waitFor(`/Próximos partidos|Tu inscripción está pendiente|No tienes acceso/.test(document.body.innerText)`, { timeout: 25000 })
          await settle(page)
          const state = () => page.eval(`({ notice: document.querySelector('p[role=status]')?.innerText ?? '', inputs: document.querySelectorAll('input[inputmode=numeric]').length })`)
          let ok = await state()
          const rowsB = await part(poolB.id, joiner.id)
          const partReads = calls(page, '/rest/v1/participants').length
          await shot(page, 'b2-12-p1-aprobado')
          p1.push(`tras aprobar, nueva apertura de la app: aviso="${ok.notice}", campos de marcador=${ok.inputs}, lecturas de /participants al abrir=${partReads}, filas en B=${rowsB.length} (${rowsB[0]?.approval_status})`)
          let staleCache = false
          if (/pendiente/.test(ok.notice) && rowsB[0]?.approval_status === 'approved') {
            staleCache = true
            await page.reload(); await settle(page)
            p1.push(`recargando la página: aviso="${(await state()).notice}"`)
            // Diagnóstico: se borra SOLO la entrada de caché privada de esta quiniela (equivale a esperar su caducidad).
            await page.eval(`new Promise((res) => { const r = indexedDB.open('sportleagues-cache'); r.onsuccess = () => { const tx = r.result.transaction('entries', 'readwrite'); tx.objectStore('entries').delete(${JSON.stringify(`u:${joiner.id}|pool:${poolB.id}`)}); tx.oncomplete = () => { r.result.close(); res(true) } }; r.onerror = () => res(false) })`)
            await page.reload(); await settle(page)
            ok = await state()
            await shot(page, 'b2-12b-p1-aprobado-sin-cache')
            p1.push(`tras borrar solo la entrada de caché «pool:${short(poolB.id)}» (equivale a esperar su caducidad, hasta 10 min): aviso="${ok.notice}", campos de marcador=${ok.inputs}`)
          }
          rep.check('P1', pendingSeen && !staleCache && rowsB.length === 1 && rowsB[0].approval_status === 'approved' && ok.inputs >= 2 && !/pendiente/.test(ok.notice), p1.join(' · '))
        } catch (e) { await ctx.errShot(chrome, 'b2-p1-ok'); throw e } finally { await chrome.close() }
      }
    }
  } finally {
    if (approvalTouched) await setApproval(false)
  }

  // =========================== qa-user2: X1, P2 (quiniela B), P3 y aviso de cierre de T1 (quiniela A) ===========================
  {
    const chrome = await ctx.launch('b2-u2')
    try {
      const page = await chrome.newPage({ width: 390, height: 844, dpr: 3 })
      watchSupabase(page)
      await loginUI(page, u2)
      const t0 = Date.now()
      await page.goto(`${BASE}/p/${poolB.id}`)
      await page.waitFor(`/Próximos partidos|Tu inscripción está pendiente|No tienes acceso/.test(document.body.innerText)`, { timeout: 25000 })
      await settle(page)
      const rowsB = await part(poolB.id, u2.id)
      const player = rowsB[0]?.approval_status === 'approved' ? rowsB[0] : null
      const pmB = (await svc.from('pool_matches').select('id, match_id, lock_at').eq('pool_id', poolB.id)).data ?? []
      const openPm = pmB.find((p) => p.match_id === bOpen.matchId)
      const predOf = async (pmId) => player ? ((await svc.from('predictions').select('home_score, away_score').eq('participant_id', player.id).eq('pool_match_id', pmId)).data ?? []) : []

      // ---------- X1: «Sugerir marcador» rellena sin guardar ----------
      if (!player) {
        rep.notRun('X1', 'qa-user2 no está aprobado en la quiniela B (ver P1)'); rep.notRun('P2', 'qa-user2 no está aprobado en la quiniela B (ver P1)')
      } else {
        const predBefore = await predOf(openPm.id)
        page.clearLogs()
        await page.tap(`form:has(#ph-${bOpen.matchId}) button[data-test=suggest]`)
        await page.waitFor(`!!document.querySelector('form:has(#ph-${bOpen.matchId}) [data-test=suggestion], form:has(#ph-${bOpen.matchId}) [data-test=suggestion-error]')`, { timeout: 20000, label: 'sugerencia' })
        await sleep(500)
        const sug = await page.eval(`(() => { const f = document.querySelector('form:has(#ph-${bOpen.matchId})'); return { box: f.querySelector('[data-test=suggestion]')?.innerText ?? '', err: f.querySelector('[data-test=suggestion-error]')?.innerText ?? '', h: f.querySelector('#ph-${bOpen.matchId}').value, a: f.querySelector('#pa-${bOpen.matchId}').value } })()`)
        const predAfter = await predOf(openPm.id)
        await shot(page, 'b2-13-x1-sugerencia')
        const probs = (sug.box.match(/\d+(?:[.,]\d+)?\s?%/g) ?? []).length
        rep.check('X1', /^\d+$/.test(sug.h) && /^\d+$/.test(sug.a) && sug.box.includes(`${sug.h} - ${sug.a}`) && /no está guardada/.test(sug.box) && probs >= 3 && /no es una certeza ni una recomendación de apuesta/.test(sug.box)
          && rpcCalls(page, 'suggest_scoreline').length === 1 && rpcCalls(page, 'save_prediction').length === 0 && JSON.stringify(predBefore) === JSON.stringify(predAfter),
          `campos rellenados ${sug.h}-${sug.a}; recuadro="${sug.box.replace(/\s+/g, ' ').slice(0, 220)}"; error="${sug.err}"; probabilidades mostradas=${probs}; llamadas suggest_scoreline=${rpcCalls(page, 'suggest_scoreline').length}, save_prediction=${rpcCalls(page, 'save_prediction').length}; pronóstico en BD antes/después=${JSON.stringify(predBefore)}/${JSON.stringify(predAfter)}`)

        // ---------- P2: guardar y editar antes del cierre ----------
        const p2 = []
        page.clearLogs()
        await page.type(`#ph-${bOpen.matchId}`, '1'); await page.type(`#pa-${bOpen.matchId}`, '0')
        await page.tap(`form:has(#ph-${bOpen.matchId}) button[type=submit]`)
        await page.waitFor(`(document.querySelector('form:has(#ph-${bOpen.matchId})')?.innerText ?? '').includes('Actualizar pronóstico')`, { timeout: 15000, label: 'pronóstico guardado' })
        const saved = await predOf(openPm.id)
        await page.type(`#ph-${bOpen.matchId}`, '2'); await page.type(`#pa-${bOpen.matchId}`, '1')
        await page.tap(`form:has(#ph-${bOpen.matchId}) button[type=submit]`)
        for (let i = 0; i < 40 && (await predOf(openPm.id))[0]?.home_score !== 2; i += 1) await sleep(250)
        const edited = await predOf(openPm.id)
        p2.push(`antes del cierre: guardar 1-0 -> BD ${JSON.stringify(saved)}; editar 2-1 -> BD ${JSON.stringify(edited)} (filas=${edited.length}); save_prediction=${rpcCalls(page, 'save_prediction').length}`)
        await shot(page, 'b2-14-p2-guardado')

        // Tras el cierre: partido de B con lock_at ya pasado y aún «scheduled» (sin pronóstico de qa-user2).
        const lockedPm = pmB.filter((p) => new Date(p.lock_at).getTime() < Date.now()).sort((a, b) => b.lock_at.localeCompare(a.lock_at))[0]
        const lockedStatus = lockedPm ? (await svc.from('matches').select('status').eq('id', lockedPm.match_id).single()).data.status : null
        if (!lockedPm || lockedStatus !== 'scheduled' || (await predOf(lockedPm.id)).length) {
          p2.push(`sin partido cerrado-y-programado sin pronóstico propio en B (estado=${lockedStatus})`)
          rep.check('P2', saved[0]?.home_score === 1 && saved[0]?.away_score === 0 && edited.length === 1 && edited[0].home_score === 2 && edited[0].away_score === 1, `${p2.join(' · ')}. Parte «tras el cierre» NO ejecutada`)
        } else {
          await page.reload(); await settle(page)
          await page.tap('[role=tab]', 'Partidos').catch(() => {})
          await sleep(800)
          const realTab = await page.eval(`({ form: !!document.querySelector('#ph-${lockedPm.match_id}'), closed: document.body.innerText.includes('Pronósticos cerrados'), noPred: document.body.innerText.includes('No enviaste pronóstico para este partido.') })`)
          await shot(page, 'b2-15-p2-cerrado-reloj-real')
          // Reloj del dispositivo ATRASADO hasta 30 min antes del cierre: la UI ofrece el formulario, pero el servidor debe rechazar.
          const clock = await setDeviceClock(page, Date.now() - (new Date(lockedPm.lock_at).getTime() - 30 * MIN))
          await page.reload(); await settle(page)
          await page.tap('[role=tab]', 'Partidos').catch(() => {})
          await page.waitFor(`#ph-${lockedPm.match_id}`, { timeout: 15000 })
          page.clearLogs()
          await page.type(`#ph-${lockedPm.match_id}`, '3'); await page.type(`#pa-${lockedPm.match_id}`, '3')
          await page.tap(`form:has(#ph-${lockedPm.match_id}) button[type=submit]`)
          await page.waitFor(`!!document.querySelector('article:has(#ph-${lockedPm.match_id}) [role=alert]') || [...document.querySelectorAll('article')].some((a) => a.querySelector('[role=alert]') && a.innerText.includes('cerrado'))`, { timeout: 15000, label: 'mensaje de rechazo' }).catch(() => {})
          await sleep(600)
          const msg = await page.eval(`[...document.querySelectorAll('article [role=alert]')].map((e) => e.innerText).join(' | ')`)
          const call = rpcCalls(page, 'save_prediction')[0]
          const body = call ? ((await page.body(call)) ?? '') : ''
          const lockedPred = await predOf(lockedPm.id)
          await shot(page, 'b2-16-p2-cerrado-reloj-atrasado')
          await clearDeviceClock(page, clock)
          p2.push(`tras el cierre con reloj real: formulario=${realTab.form}, «Pronósticos cerrados»=${realTab.closed}, «No enviaste pronóstico»=${realTab.noPred}; con el reloj del dispositivo atrasado: la UI ofrece el formulario y save_prediction responde HTTP ${call?.status} (${(body.match(/"code":"[^"]+"/) ?? [''])[0]}); mensaje="${msg}"; filas en BD para ese partido=${lockedPred.length}`)
          rep.check('P2', saved[0]?.home_score === 1 && saved[0]?.away_score === 0 && edited.length === 1 && edited[0].home_score === 2 && edited[0].away_score === 1
            && !realTab.form && realTab.closed && call && call.status >= 400 && /cerrado/.test(msg) && lockedPred.length === 0, p2.join(' · '))
        }
      }
      rep.data('b2.u2B.consoleErrors', consoleErrors(page, t0).slice(0, 10))

      // ---------- P3: qa-user2 no ve los pronósticos de qa-user1 antes del cierre; sí después ----------
      const t3 = Date.now()
      await page.goto(`${BASE}/p/${D.pool.id}`)
      await page.waitForText('Esta quiniela usa tickets', { timeout: 25000 })
      await page.tap('[role=tab]', 'Partidos')
      await page.waitFor(`!!document.querySelector('[aria-label="Tickets de ${roundName}"]')`, { timeout: 20000 })
      await settle(page)
      const m1 = freshMatches[0]
      const dom = await page.eval(`(() => { const a = document.querySelector('[aria-label="Tickets de ${roundName}"]'); return { text98: /\\b9\\s*-\\s*8\\b/.test(a.innerText), inputs: [...a.querySelectorAll('#ph-${m1.id}, #pa-${m1.id}')].map((i) => i.value) } })()`)
      // Respuestas reales que recibió la pantalla: ¿alguna fila de pronóstico ajena?
      let foreignRows = 0
      for (const r of page.netEntries().filter((x) => x.url.includes('/rest/v1/predictions') && x.url.includes(D.pool.id))) {
        const b = await page.body(r); if (!b) continue
        try { foreignRows += (JSON.parse(b) ?? []).filter((row) => row.participant_id && row.participant_id !== p2A.id).length } catch { /* no JSON */ }
      }
      const openPmA = pmA.find((p) => p.match_id === m1.id)
      const lockedPmA = pmA.filter((p) => new Date(p.lock_at).getTime() < Date.now())
      // Consulta directa desde la página con la sesión de qa-user2 (sin filtro por participante): lo que la RLS le deja ver.
      const openQ = await restInPage(page, `/rest/v1/predictions?select=participant_id,pool_match_id&pool_match_id=eq.${openPmA.id}`)
      const lockedQ = await restInPage(page, `/rest/v1/predictions?select=participant_id,pool_match_id&pool_match_id=in.(${lockedPmA.map((p) => p.id).join(',')})`)
      const u1Open = ((await svc.from('predictions').select('id').eq('participant_id', p1A.id).eq('pool_match_id', openPmA.id)).data ?? []).length
      const u1Locked = ((await svc.from('predictions').select('id').eq('participant_id', p1A.id).in('pool_match_id', lockedPmA.map((p) => p.id))).data ?? []).length
      const seenOpen = (openQ.data ?? []).filter((r) => r.participant_id === p1A.id).length
      const seenLocked = (lockedQ.data ?? []).filter((r) => r.participant_id === p1A.id).length
      await shot(page, 'b2-17-p3-tickets-user2')
      rep.check('P3', u1Open >= 1 && !dom.text98 && !dom.inputs.includes('9') && foreignRows === 0 && openQ.status === 200 && seenOpen === 0 && (u1Locked === 0 || seenLocked > 0),
        `qa-user1 tiene ${u1Open} pronóstico(s) en el partido abierto ${short(m1.id)} (9-8 en el ticket): pantalla de qa-user2 muestra 9-8=${dom.text98}, valores en campos=${JSON.stringify(dom.inputs)}; filas ajenas en respuestas de /predictions recibidas por la pantalla=${foreignRows}; consulta directa con la sesión del navegador: abierto -> HTTP ${openQ.status}, filas de qa-user1=${seenOpen}; cerrados (${lockedPmA.length} partidos) -> filas de qa-user1 visibles=${seenLocked} de ${u1Locked} existentes`)
      rep.data('b2.u2A.consoleErrors', consoleErrors(page, t3).slice(0, 10))
      const a = await audit(page)
      rep.data('b2.p3.audit', { hscroll: a.hscroll, small: a.touch.small.length })

      // ---------- T1 (aviso de cierre): qa-user2 no tiene ticket enviado en la jornada UAT; reloj del dispositivo a 30 min del cierre ----------
      const firstLock = pmA.filter((p) => freshMatches.some((m) => m.id === p.match_id)).map((p) => new Date(p.lock_at).getTime()).sort()[0]
      const pr2 = ((await svc.from('tickets').select('status').eq('participant_id', p2A.id).eq('pool_round_id', poolRound.id)).data ?? [])
      if (pr2.some((t) => t.status === 'submitted')) {
        rep.notRun('T1.aviso', `qa-user2 tiene un ticket enviado en ${roundName}: el banner solo avisa si falta enviar`)
      } else {
        const clock = await setDeviceClock(page, -(firstLock - 30 * MIN - Date.now()))
        await page.reload()
        await page.waitForText('Esta quiniela usa tickets', { timeout: 25000 })
        await page.tap('[role=tab]', 'Partidos')
        await page.waitFor(`!!document.querySelector('[aria-label="Tickets de ${roundName}"]')`, { timeout: 20000 })
        await settle(page)
        const banner = await page.eval(`[...document.querySelectorAll('aside[role=status]')].map((a) => a.innerText.replace(/\\s+/g, ' ')).join(' | ')`)
        const header = await page.eval(`document.querySelector('[aria-label="Tickets de ${roundName}"] header')?.innerText.replace(/\\s+/g, ' ') ?? ''`)
        await page.eval('window.scrollTo(0, 0)')
        await shot(page, 'b2-18-t1-aviso-cierre')
        await clearDeviceClock(page, clock)
        rep.check('T1.aviso', banner.includes(`${roundName}: aún sin ticket enviado`) && /cierra en \d+ min/.test(banner) && /La venta cierra en \d+ min/.test(header),
          `qa-user2 sin ticket enviado; reloj del dispositivo a 30 min del cierre de venta: banner="${banner.slice(0, 160)}"; cabecera de jornada="${header.slice(0, 80)}"`)
      }
    } catch (e) { await ctx.errShot(chrome, "b2-u2"); throw e } finally { await chrome.close() }
  }
}
