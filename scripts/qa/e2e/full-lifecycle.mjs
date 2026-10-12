#!/usr/bin/env node
// PRUEBA INTEGRAL del ciclo de vida de una quiniela REAL contra Supabase QA (proyecto enlazado). Nada simulado: todo se ejecuta como
// usuario autenticado con supabase-js (mismas RPC/RLS que la app); solo la revisión de solicitudes, el reloj de partidos (apply_fixture_update),
// la reconstrucción de ratings, la purga en dry-run y las lecturas de verificación usan service_role (operador/sincronizador/QA).
//
//   QA_OWNER_AUTHORIZED=yes node scripts/qa/e2e/full-lifecycle.mjs
//
// Cuentas: SOLO las 5 identidades fijas de scripts/qa/lib/qa-identities.mjs (qa-requester, qa-admin-b, qa-user1, qa-user2, qa-outsider).
// Residuo por ejecución (etiqueta LIFE-xxxxxxxx): tenants nuevos solo si faltan (1 por organizador), 1 torneo, 1 jornada, 4 partidos, 1 quiniela
// (+ 1 torneo/partido/quiniela del organizador B). Se anota en docs/operations/QA-SYNTHETIC-RESIDUE.md.
// Idempotencia: si qa-requester ya es organizador, los pasos 2-4 se registran como SKIPPED(already organizer) y se reutiliza su tenant.
// Las claves se leen de la CLI en memoria; nunca se imprimen ni se guardan. Las contraseñas de las cuentas son aleatorias por ejecución.
import { randomUUID } from 'node:crypto'
import { ensureQaIdentities } from '../lib/qa-identities.mjs'

// ------------------------------------------------------------------------------------------------------------------
// Infraestructura de resultados
// ------------------------------------------------------------------------------------------------------------------
const results = []
const stepOf = (id) => Number(String(id).split('.')[0])
const add = (id, status, detail = '') => {
  results.push({ id: String(id), step: stepOf(id), status, detail })
  console.log(`${status.padEnd(18)} ${id}${detail ? '  ' + detail : ''}`)
}
const rec = (id, ok, detail = '') => add(id, ok ? 'PASS' : 'FAIL', detail)
const skip = (id, why) => add(id, 'SKIPPED(already organizer)', why)
const notRun = (id, why) => add(id, 'NOT_RUN', why)
const code = (r) => r.error?.code ?? (r.error ? 'ERR' : null)
const errIs = (r, c, h) => Boolean(r.error) && (c == null || r.error.code === c) && (h == null || r.error.hint === h)
const errTxt = (r) => (r.error ? `${r.error.code ?? 'ERR'}${r.error.hint ? '/' + r.error.hint : ''}` : 'sin error')
const expectErr = (id, r, c, h, label = '') => rec(id, errIs(r, c, h), `${label ? label + ' ' : ''}esperado=${c}${h ? '/' + h : ''} obtenido=${errTxt(r)}`)
const emptyOrErr = (r) => Boolean(r.error) || (Array.isArray(r.data) && r.data.length === 0)
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.code ?? ''} ${r.error.message}`); return r.data }
const settle = (ps) => Promise.all(ps.map((p) => Promise.resolve(p).catch((e) => ({ error: { message: String(e) } }))))
const near = (a, b, tol) => Math.abs(Number(a) - Number(b)) <= tol
const S = {} // estado compartido entre pasos

async function section(n, title, fn, requires = null) {
  console.log(`\n=== Paso ${n}: ${title}`)
  if (requires && !S[requires]) { notRun(`${n}.0`, `depende de ${requires} (paso previo fallido)`); return }
  try { await fn() } catch (e) { add(`${n}.X`, 'FAIL', `excepción: ${e instanceof Error ? e.message : String(e)}`) }
}

// ------------------------------------------------------------------------------------------------------------------
// Arranque: identidades fijas y cliente de operador
// ------------------------------------------------------------------------------------------------------------------
if (process.env.QA_OWNER_AUTHORIZED !== 'yes') throw new Error('Requiere QA_OWNER_AUTHORIZED=yes (QA, datos sintéticos).')
const tag = `LIFE-${randomUUID().slice(0, 8)}`
const { env, svc, identities } = await ensureQaIdentities()
const { requester: rq, adminB: ab, user1: u1, user2: u2, outsider: out } = identities
const anon = env.anonClient()
console.log(`Ejecución ${tag}; identidades: ${Object.values(identities).map((i) => i.email).join(', ')}`)

const operatorReview = (requestId, decision, note = null, name = null) =>
  svc.rpc('review_pool_creation_request', { p_request_id: requestId, p_decision: decision, p_note: note, p_tenant_name: name })
const orgMembership = async (who) => {
  const r = await who.client.from('tenant_memberships').select('tenant_id, role, is_active').eq('profile_id', who.id)
  return must(r, 'memberships').filter((m) => m.is_active && ['owner', 'admin'].includes(m.role))
}
const REQ_NOTE = 'Prueba integral QA (datos sintéticos)'

// ------------------------------------------------------------------------------------------------------------------
// Paso 1: cuentas y estado inicial
// ------------------------------------------------------------------------------------------------------------------
await section(1, 'cuentas fijas y estado inicial', async () => {
  const prof = must(await rq.client.from('profiles').select('id, display_name').eq('id', rq.id), 'perfil requester')
  rec('1.1', prof.length === 1 && prof[0].display_name === 'qa-requester', 'qa-requester existe como participante con perfil propio')
  const rqOrg = await orgMembership(rq)
  S.alreadyOrganizer = rqOrg.length > 0
  S.tenant = rqOrg[0]?.tenant_id ?? null
  if (!S.alreadyOrganizer) rec('1.2', true, 'qa-requester sin tenant propio (sin rol owner/admin activo)')
  else skip('1.2', 'qa-requester ya es organizador de una ejecución previa; se reutiliza su tenant')
  const others = await Promise.all([u1, u2, out].map(orgMembership))
  rec('1.3', others.every((o) => o.length === 0), 'qa-user1, qa-user2 y qa-outsider no tienen rol de organizador')
  const anonReq = await anon.rpc('request_pool_creation', { p_note: REQ_NOTE })
  expectErr('1.4', anonReq, '42501', null, 'anon no solicita:')
  const longNote = await out.client.rpc('request_pool_creation', { p_note: 'x'.repeat(501) })
  expectErr('1.5', longNote, '22023', 'note_too_long', 'nota de 501 caracteres:')
})

// ------------------------------------------------------------------------------------------------------------------
// Paso 2: solicitud para ser organizador
// ------------------------------------------------------------------------------------------------------------------
await section(2, 'solicitud «Crear mi propia quiniela»', async () => {
  if (S.alreadyOrganizer) {
    const r = await rq.client.rpc('request_pool_creation', { p_note: REQ_NOTE })
    expectErr('2.1R', r, 'P0001', 'already_organizer', 'organizador previo:')
    for (const id of ['2.1', '2.2', '2.3', '2.4', '2.5']) skip(id, 'solicitud inicial ya procesada en una ejecución previa')
    return
  }
  const had = must(await rq.client.from('pool_creation_requests').select('id').eq('status', 'pending'), 'pendientes previas').length
  const burst = await settle(Array.from({ length: 5 }, () => rq.client.rpc('request_pool_creation', { p_note: REQ_NOTE })))
  const okAll = burst.every((r) => !r.error && r.data?.status === 'pending')
  const ids = new Set(burst.filter((r) => !r.error).map((r) => r.data.id))
  const created = burst.filter((r) => r.data?.created === true).length
  S.reqId = [...ids][0]
  rec('2.1', okAll && ids.size === 1 && created === (had ? 0 : 1), `5 solicitudes en paralelo: ids distintos=${ids.size}, created=true x${created} (esperado ${had ? 0 : 1})`)
  const pend = must(await rq.client.from('pool_creation_requests').select('id').eq('status', 'pending'), 'pendientes')
  rec('2.2', pend.length === 1, `solicitudes pendientes de qa-requester en BD=${pend.length}`)
  const upd = await rq.client.from('pool_creation_requests').update({ status: 'approved' }).eq('id', S.reqId).select()
  const still = must(await svc.from('pool_creation_requests').select('status, tenant_id').eq('id', S.reqId).single(), 'estado tras update')
  rec('2.3', emptyOrErr(upd) && still.status === 'pending' && still.tenant_id === null, `UPDATE directo -> ${errTxt(upd)}; estado en BD=${still.status}`)
  const ins = await rq.client.from('pool_creation_requests').insert({ requester_id: rq.id, status: 'approved' })
  const selfReview = await rq.client.rpc('review_pool_creation_request', { p_request_id: S.reqId, p_decision: 'approve', p_note: null, p_tenant_name: null })
  rec('2.4', errIs(ins, '42501') && errIs(selfReview, '42501'), `INSERT directo=${errTxt(ins)}; review_pool_creation_request por API=${errTxt(selfReview)} (esperado 42501 ambos)`)
  const events = await rq.client.from('pool_creation_request_events').select('id')
  const seenOut = must(await out.client.from('pool_creation_requests').select('id').eq('id', S.reqId), 'outsider ve solicitud')
  const seenAb = must(await ab.client.from('pool_creation_requests').select('id').eq('id', S.reqId), 'adminB ve solicitud')
  rec('2.5', seenOut.length === 0 && seenAb.length === 0 && emptyOrErr(events), `qa-outsider ve ${seenOut.length}, qa-admin-b ve ${seenAb.length}, bitácora de eventos para el solicitante=${errTxt(events)}`)
})

// ------------------------------------------------------------------------------------------------------------------
// Paso 3: revisión del operador, idempotencia, rechazo + cooldown; organizador B
// ------------------------------------------------------------------------------------------------------------------
await section(3, 'revisión del operador, idempotencia y cooldown', async () => {
  if (S.alreadyOrganizer) {
    for (const id of ['3.1', '3.2', '3.3', '3.4', '3.5', '3.6']) skip(id, 'ya existe el tenant del solicitante')
    const owners = (await orgMembership(rq)).filter((m) => m.role === 'owner')
    const approved = must(await rq.client.from('pool_creation_requests').select('id').eq('status', 'approved'), 'aprobadas')
    rec('3.7R', owners.length === 1 && approved.length === 1, `sin duplicados tras re-ejecución: tenants propios=${owners.length}, solicitudes aprobadas=${approved.length}`)
  } else {
    const a1 = await operatorReview(S.reqId, 'approve', 'Aprobación QA', tag)
    S.tenant = a1.data?.tenant_id ?? null
    rec('3.1', !a1.error && a1.data.status === 'approved' && a1.data.created === true && Boolean(S.tenant), `operador aprueba -> status=${a1.data?.status} created=${a1.data?.created} ${a1.error ? errTxt(a1) : ''}`)
    const a2 = await operatorReview(S.reqId, 'approve', 'Aprobación QA', tag)
    rec('3.2', !a2.error && a2.data.created === false && a2.data.tenant_id === S.tenant, `repetir aprobación -> created=${a2.data?.created}, mismo tenant=${a2.data?.tenant_id === S.tenant}`)
    const sameName = must(await svc.from('tenants').select('id').eq('name', tag), 'tenants por nombre')
    const owners = (await orgMembership(rq)).filter((m) => m.role === 'owner')
    rec('3.3', sameName.length === 1 && owners.length === 1, `tenants con el nombre ${tag}=${sameName.length}; membresías owner del solicitante=${owners.length}`)
    const flip = await operatorReview(S.reqId, 'reject')
    expectErr('3.4', flip, 'P0001', 'already_reviewed', 'rechazar una aprobada:')
    const plan = must(await rq.client.from('tenant_entitlements').select('plan_code').eq('tenant_id', S.tenant), 'plan')
    rec('3.5', plan.length === 1 && plan[0].plan_code === 'free' && owners[0]?.tenant_id === S.tenant, `plan del tenant nuevo=${plan[0]?.plan_code}; rol=owner`)
    const ev = must(await svc.from('pool_creation_request_events').select('event, actor_kind').eq('request_id', S.reqId), 'eventos')
    const n = (e) => ev.filter((x) => x.event === e).length
    rec('3.6', n('requested') === 1 && n('approved') === 1, `auditoría de la solicitud: requested=${n('requested')}, approved=${n('approved')}`)
  }

  // Rechazo + cooldown con qa-user2 (siempre)
  const mine = must(await u2.client.from('pool_creation_requests').select('id, status, reviewed_at').order('requested_at', { ascending: false }), 'solicitudes user2')
  const recent = mine.find((r) => r.status === 'rejected' && new Date(r.reviewed_at).getTime() > Date.now() - 7 * 86400_000)
  if (recent) {
    const again = await u2.client.rpc('request_pool_creation', { p_note: REQ_NOTE })
    expectErr('3.8', again, 'P0001', 'cooldown_active', 'rechazo previo vigente (re-ejecución), nueva solicitud:')
    rec('3.8d', Boolean(again.error?.details?.includes('retry_after=')), `detalle=${again.error?.details ?? 'n/d'}`)
  } else {
    const c = await u2.client.rpc('request_pool_creation', { p_note: 'Solicitud sintética que será rechazada' })
    rec('3.8', !c.error && c.data.status === 'pending', `qa-user2 solicita -> ${c.error ? errTxt(c) : 'pending'}`)
    const rej = await operatorReview(c.data.id, 'reject', 'Rechazo QA')
    rec('3.8a', !rej.error && rej.data.status === 'rejected' && rej.data.created === true, `operador rechaza -> ${rej.data?.status}`)
    const rej2 = await operatorReview(c.data.id, 'reject', 'Rechazo QA')
    rec('3.8b', !rej2.error && rej2.data.created === false, `repetir rechazo idempotente -> created=${rej2.data?.created}`)
    const flip = await operatorReview(c.data.id, 'approve', null, tag + '-U2')
    expectErr('3.8c', flip, 'P0001', 'already_reviewed', 'aprobar una rechazada:')
    const again = await u2.client.rpc('request_pool_creation', { p_note: REQ_NOTE })
    expectErr('3.8d', again, 'P0001', 'cooldown_active', 'nueva solicitud inmediata tras rechazo:')
  }
  const u2org = await orgMembership(u2)
  const u2tenants = must(await svc.from('tenant_memberships').select('role').eq('profile_id', u2.id).in('role', ['owner', 'admin']), 'roles user2')
  rec('3.9', u2org.length === 0 && u2tenants.length === 0, 'qa-user2 NO quedó como organizador (membresías owner/admin=0)')

  // Segundo organizador (qa-admin-b), por el mismo flujo real
  const abOrg = await orgMembership(ab)
  if (abOrg.length === 0) {
    const req = await ab.client.rpc('request_pool_creation', { p_note: 'Segundo organizador de prueba (aislamiento)' })
    if (req.error) throw new Error(`solicitud de qa-admin-b: ${errTxt(req)}`)
    const ap = await operatorReview(req.data.id, 'approve', 'Aprobación QA', `${tag}-B`)
    S.tenantB = ap.data?.tenant_id ?? null
    rec('3.10', !ap.error && Boolean(S.tenantB), `qa-admin-b obtiene su tenant por solicitud + aprobación del operador`)
  } else {
    S.tenantB = abOrg[0].tenant_id
    skip('3.10', 'qa-admin-b ya es organizador; se reutiliza su tenant')
  }
  S.ready3 = Boolean(S.tenant && S.tenantB)
})

// ------------------------------------------------------------------------------------------------------------------
// Paso 4: el nuevo owner ve lo suyo y nada de qa-admin-b
// ------------------------------------------------------------------------------------------------------------------
await section(4, 'visibilidad del nuevo organizador', async () => {
  const mem = must(await rq.client.from('tenant_memberships').select('tenant_id, role, is_active').eq('profile_id', rq.id), 'membresías')
  const tenants = must(await rq.client.from('tenants').select('id, name'), 'tenants visibles')
  const roleOf = (t) => mem.find((m) => m.tenant_id === t)?.role
  const otherAdmin = mem.filter((m) => m.tenant_id !== S.tenant && ['owner', 'admin'].includes(m.role))
  if (S.alreadyOrganizer) {
    skip('4.1', 'comprobación estricta de visibilidad inicial (el solicitante ya participó en la quiniela de qa-admin-b en una ejecución previa)')
    skip('4.2', 'idem')
    rec('4.3R', otherAdmin.length === 0 && roleOf(S.tenant) === 'owner', `rol en su tenant=${roleOf(S.tenant)}; roles admin en otros tenants=${otherAdmin.length}`)
  } else {
    rec('4.1', mem.length === 1 && roleOf(S.tenant) === 'owner' && tenants.length === 1 && tenants[0].id === S.tenant, `membresías=${mem.length} (owner de su tenant), tenants visibles=${tenants.length}`)
    const audit = must(await rq.client.from('audit_log').select('action').eq('tenant_id', S.tenant), 'auditoría')
    rec('4.2', audit.some((a) => a.action === 'pool_creation_requests.approve'), `el owner lee el audit_log de su tenant (${audit.length} filas, incluye la aprobación)`)
  }
  // En ambos casos: nada administrativo de qa-admin-b
  const abAudit = must(await rq.client.from('audit_log').select('id').eq('tenant_id', S.tenantB), 'auditoría B')
  const abTickets = must(await rq.client.from('tickets').select('id').eq('tenant_id', S.tenantB), 'tickets B')
  const abCodes = must(await rq.client.from('pool_join_codes').select('id').eq('tenant_id', S.tenantB), 'códigos B')
  const bPart = must(await rq.client.from('participants').select('profile_id').eq('tenant_id', S.tenantB), 'participantes B')
  rec('4.4', abAudit.length === 0 && abTickets.length === 0 && abCodes.length === 0 && bPart.every((p) => p.profile_id === rq.id), `auditoría B=${abAudit.length}, tickets B=${abTickets.length}, códigos B=${abCodes.length}, participantes B visibles solo propios=${bPart.every((p) => p.profile_id === rq.id)}`)
  const mp = await rq.client.rpc('manage_pool', { p_action: 'create', p_pool_id: null, p_tenant_id: S.tenantB, p_name: 'x', p_lock_offset_minutes: 0, p_requires_approval: false })
  expectErr('4.5', mp, '42501', null, 'qa-requester no crea quinielas en el tenant de qa-admin-b:')
}, 'ready3')

// ------------------------------------------------------------------------------------------------------------------
// Paso 5: configuración completa (torneo, equipos, jornada, partidos, quiniela, reglas, código, tickets)
// ------------------------------------------------------------------------------------------------------------------
await section(5, 'configuración de la quiniela (organizador) y del organizador B', async () => {
  // Free = una quiniela activa: se archivan las de ejecuciones previas
  let archived = 0
  for (const [who, tenant] of [[rq, S.tenant], [ab, S.tenantB]]) {
    const act = must(await who.client.from('pools').select('id').eq('tenant_id', tenant).in('status', ['open', 'paused']), 'pools activas')
    for (const p of act) {
      must(await who.client.rpc('manage_pool', { p_action: 'archive', p_pool_id: p.id, p_tenant_id: null, p_name: null, p_lock_offset_minutes: null, p_requires_approval: null }), 'archivar')
      archived++
    }
  }
  rec('5.0', true, `quinielas activas previas archivadas (plan Free = 1 activa)=${archived}`)

  const tour = must(await rq.client.rpc('upsert_tournament', { p_tenant_id: S.tenant, p_tournament_id: null, p_name: `${tag} Liga`, p_sport_code: 'football', p_season_label: '2026' }), 'torneo')
  rec('5.1', Boolean(tour.id), 'torneo creado por RPC')
  const manual = {}
  for (const [k, n] of [['x', 'Local'], ['y', 'Visita'], ['z', 'Tercero']]) {
    const t = must(await rq.client.rpc('upsert_team', { p_tenant_id: S.tenant, p_team_id: null, p_name: `${tag} ${n}` }), 'equipo')
    must(await rq.client.rpc('set_tournament_team', { p_tournament_id: tour.id, p_team_id: t.id, p_enrolled: true }), 'inscribir')
    manual[k] = t.id
  }
  let catIds = []
  for (const country of ['BR', 'AR']) {
    const f = await rq.client.rpc('search_catalog_teams', { p_query: '', p_kind: 'national', p_country: country, p_limit: 3 })
    if (!f.error && f.data?.length) catIds.push(f.data[0].id)
  }
  if (catIds.length === 2) {
    const imp = await rq.client.rpc('import_catalog_teams', { p_tournament_id: tour.id, p_team_ids: catIds })
    const imp2 = await rq.client.rpc('import_catalog_teams', { p_tournament_id: tour.id, p_team_ids: catIds })
    rec('5.2', !imp.error && imp.data.enrolled === 2 && !imp2.error && imp2.data.enrolled === 0 && imp2.data.already_enrolled === 2, `catálogo: importa 2 selecciones (enrolled=${imp.data?.enrolled}); repetir -> enrolled=${imp2.data?.enrolled}, ya inscritas=${imp2.data?.already_enrolled}`)
    const enrolled = must(await rq.client.from('tournament_teams').select('team_id').eq('tournament_id', tour.id), 'inscritos')
    const manualIds = new Set(Object.values(manual))
    S.catTeams = enrolled.map((e) => e.team_id).filter((id) => !manualIds.has(id))
  } else {
    S.catTeams = []
    add('5.2', 'NOT_RUN', 'catálogo sin selecciones BR/AR: se usan equipos manuales')
  }
  if (S.catTeams.length !== 2) {
    for (const n of ['Cuarto', 'Quinto']) {
      const t = must(await rq.client.rpc('upsert_team', { p_tenant_id: S.tenant, p_team_id: null, p_name: `${tag} ${n}` }), 'equipo extra')
      must(await rq.client.rpc('set_tournament_team', { p_tournament_id: tour.id, p_team_id: t.id, p_enrolled: true }), 'inscribir extra')
      S.catTeams.push(t.id)
    }
  }
  const round = must(await rq.client.rpc('upsert_round', { p_tournament_id: tour.id, p_round_id: null, p_name: 'Fecha 1', p_sort_order: 1 }), 'jornada')
  const mk = async (h, a, mins) => must(await rq.client.rpc('upsert_match', { p_tournament_id: tour.id, p_match_id: null, p_round_id: round.id, p_home_team_id: h, p_away_team_id: a, p_starts_at: new Date(Date.now() + mins * 60_000).toISOString() }), 'partido')
  const m1 = await mk(manual.x, manual.y, 30)   // el que "empieza" (lock en 15 min; se fuerza el inicio en el paso 9)
  const m2 = await mk(manual.y, manual.z, 90)
  const m3 = await mk(manual.y, manual.x, 180)  // revancha: partido POSTERIOR con equipos ya jugados (rated=true tras el resultado)
  const m4 = await mk(S.catTeams[0], S.catTeams[1], 240)
  rec('5.3', [m1, m2, m3, m4].every((m) => m.id), `jornada 1 con 4 partidos (3 equipos manuales + 2 del catálogo)`)
  Object.assign(S, { tour, round, m1, m2, m3, m4, manual })

  const pool = must(await rq.client.rpc('manage_pool', { p_action: 'create', p_pool_id: null, p_tenant_id: S.tenant, p_name: `${tag} Quiniela`, p_lock_offset_minutes: 15, p_requires_approval: true }), 'quiniela')
  must(await rq.client.rpc('publish_pool_rules', { p_pool_id: pool.id, p_exact_points: 5, p_outcome_points: 2, p_tie_breaker: 'exact_predictions' }), 'reglas')
  must(await rq.client.rpc('manage_pool', { p_action: 'open', p_pool_id: pool.id, p_tenant_id: null, p_name: null, p_lock_offset_minutes: null, p_requires_approval: null }), 'abrir')
  for (const m of [m1, m2, m3, m4]) must(await rq.client.rpc('set_pool_match', { p_pool_id: pool.id, p_match_id: m.id, p_included: true }), 'pool match')
  const joinCode = must(await rq.client.rpc('create_pool_join_code', { p_pool_id: pool.id }), 'código').code
  const second = await rq.client.rpc('manage_pool', { p_action: 'create', p_pool_id: null, p_tenant_id: S.tenant, p_name: 'otra', p_lock_offset_minutes: 15, p_requires_approval: false })
  expectErr('5.4', second, '22023', null, 'plan Free: segunda quiniela activa se rechaza:')
  const tk = await rq.client.rpc('enable_pool_tickets', { p_pool_id: pool.id, p_default_max: 2 })
  rec('5.5', !tk.error && tk.data === 1, `enable_pool_tickets -> jornadas vendibles=${tk.data} (cupo por defecto 2)`)
  const pms = must(await rq.client.from('pool_matches').select('id, match_id, lock_at').eq('pool_id', pool.id), 'parrilla')
  const startOf = Object.fromEntries([m1, m2, m3, m4].map((m) => [m.id, new Date(m.starts_at).getTime()]))
  rec('5.6', pms.length === 4 && pms.every((p) => near(new Date(p.lock_at).getTime(), startOf[p.match_id] - 15 * 60_000, 1500)), `parrilla=${pms.length}; lock_at = inicio - 15 min calculado por el servidor en los 4`)
  S.pool = pool
  S.joinCode = joinCode
  S.pm = Object.fromEntries(pms.map((p) => [p.match_id, p.id]))

  // Organizador B: quiniela clásica (sin tickets) y sin aprobación, para que qa-requester participe en ella
  const tourB = must(await ab.client.rpc('upsert_tournament', { p_tenant_id: S.tenantB, p_tournament_id: null, p_name: `${tag} Liga B`, p_sport_code: 'football', p_season_label: '2026' }), 'torneo B')
  const tb = []
  for (const n of ['B1', 'B2']) {
    const t = must(await ab.client.rpc('upsert_team', { p_tenant_id: S.tenantB, p_team_id: null, p_name: `${tag} ${n}` }), 'equipo B')
    must(await ab.client.rpc('set_tournament_team', { p_tournament_id: tourB.id, p_team_id: t.id, p_enrolled: true }), 'inscribir B')
    tb.push(t.id)
  }
  const roundB = must(await ab.client.rpc('upsert_round', { p_tournament_id: tourB.id, p_round_id: null, p_name: 'Fecha 1', p_sort_order: 1 }), 'jornada B')
  const mB = must(await ab.client.rpc('upsert_match', { p_tournament_id: tourB.id, p_match_id: null, p_round_id: roundB.id, p_home_team_id: tb[0], p_away_team_id: tb[1], p_starts_at: new Date(Date.now() + 120 * 60_000).toISOString() }), 'partido B')
  const poolB = must(await ab.client.rpc('manage_pool', { p_action: 'create', p_pool_id: null, p_tenant_id: S.tenantB, p_name: `${tag} Quiniela B`, p_lock_offset_minutes: 15, p_requires_approval: false }), 'quiniela B')
  must(await ab.client.rpc('publish_pool_rules', { p_pool_id: poolB.id, p_exact_points: 5, p_outcome_points: 2, p_tie_breaker: 'exact_predictions' }), 'reglas B')
  must(await ab.client.rpc('manage_pool', { p_action: 'open', p_pool_id: poolB.id, p_tenant_id: null, p_name: null, p_lock_offset_minutes: null, p_requires_approval: null }), 'abrir B')
  must(await ab.client.rpc('set_pool_match', { p_pool_id: poolB.id, p_match_id: mB.id, p_included: true }), 'pool match B')
  S.poolB = poolB
  S.mB = mB
  S.joinCodeB = must(await ab.client.rpc('create_pool_join_code', { p_pool_id: poolB.id }), 'código B').code
  rec('5.7', true, 'organizador B: torneo, 2 equipos, 1 partido, quiniela abierta con código')
  S.ready5 = true
}, 'ready3')

// ------------------------------------------------------------------------------------------------------------------
// Paso 6: participantes, aprobación, incompatibilidad administrador/participante
// Paso 7 (parte a): auto-fill estadístico antes de resultados
// ------------------------------------------------------------------------------------------------------------------
await section(6, 'inscripción, aprobación y exclusión admin/participante', async () => {
  const j1 = must(await u1.client.rpc('join_pool', { p_code: S.joinCode }), 'join u1')
  const j1b = must(await u1.client.rpc('join_pool', { p_code: S.joinCode }), 'join u1 bis')
  const j2 = must(await u2.client.rpc('join_pool', { p_code: S.joinCode }), 'join u2')
  const own1 = must(await u1.client.from('participants').select('id').eq('pool_id', S.pool.id), 'participantes propios u1')
  rec('6.1', j1.approval_status === 'pending' && j2.approval_status === 'pending' && j1b.id === j1.id && own1.length === 1, `inscripción con código: estado=${j1.approval_status}/${j2.approval_status}; repetir es idempotente (misma fila, filas=${own1.length})`)
  S.part = { u1: j1.id, u2: j2.id }
  const tkPending = await u1.client.rpc('create_ticket', { p_pool_id: S.pool.id, p_round_id: S.round.id, p_idempotency_key: randomUUID() })
  expectErr('6.2', tkPending, '42501', null, 'participante pendiente no emite ticket:')
  const sugPending = await u1.client.rpc('suggest_scoreline', { p_pool_match_id: S.pm[S.m3.id] })
  expectErr('7.1', sugPending, '42501', 'STATS_NOT_ELIGIBLE', 'suggest_scoreline con participación pendiente:')
  const adminJoin = await rq.client.rpc('join_pool', { p_code: S.joinCode })
  expectErr('6.3', adminJoin, '42501', 'ADMIN_PARTICIPANT_INCOMPATIBLE', 'el organizador no se inscribe en SU quiniela:')
  const orgPart = must(await svc.from('participants').select('id').eq('pool_id', S.pool.id).eq('profile_id', rq.id), 'participación del organizador')
  rec('6.4', orgPart.length === 0, `filas de participante del organizador en su quiniela=${orgPart.length}`)
  const abOwn = await ab.client.rpc('join_pool', { p_code: S.joinCodeB })
  expectErr('6.5', abOwn, '42501', 'ADMIN_PARTICIPANT_INCOMPATIBLE', 'qa-admin-b tampoco en SU quiniela:')

  // El organizador aprueba (lee la lista bajo RLS y llama a la RPC)
  const list = must(await rq.client.from('participants').select('id, profile_id, approval_status').eq('pool_id', S.pool.id), 'lista de participantes')
  for (const p of list.filter((x) => x.approval_status === 'pending')) must(await rq.client.rpc('approve_participant', { p_participant_id: p.id }), 'aprobar')
  const again = must(await rq.client.rpc('approve_participant', { p_participant_id: S.part.u1 }), 'aprobar bis')
  const after = must(await rq.client.from('participants').select('approval_status').eq('pool_id', S.pool.id), 'tras aprobar')
  rec('6.6', list.length === 2 && after.every((p) => p.approval_status === 'approved') && again.approval_status === 'approved', `organizador aprueba ${list.length} participantes; repetir aprobación es idempotente`)
  const outTk = await out.client.rpc('create_ticket', { p_pool_id: S.pool.id, p_round_id: S.round.id, p_idempotency_key: randomUUID() })
  const outSave = await out.client.rpc('save_prediction', { p_pool_id: S.pool.id, p_match_id: S.m1.id, p_home_score: 1, p_away_score: 0 })
  rec('6.7', errIs(outTk, '42501') && errIs(outSave, '42501'), `qa-outsider no pronostica: create_ticket=${errTxt(outTk)}, save_prediction=${errTxt(outSave)}`)

  // El organizador SÍ participa en la quiniela de otro tenant (regla por quiniela, ADR-015 §2.4)
  const rj = await rq.client.rpc('join_pool', { p_code: S.joinCodeB })
  rec('6.8', !rj.error && rj.data.approval_status === 'approved', `qa-requester (owner de su tenant) se inscribe en la quiniela de qa-admin-b -> ${rj.error ? errTxt(rj) : 'inscrito y aprobado'}`)
  if (!rj.error) {
    const rj2 = await rq.client.rpc('join_pool', { p_code: S.joinCodeB })
    rec('6.9', !rj2.error && rj2.data.id === rj.data.id, 'repetir la inscripción en la quiniela B es idempotente')
    const sp = await rq.client.rpc('save_prediction', { p_pool_id: S.poolB.id, p_match_id: S.mB.id, p_home_score: 1, p_away_score: 0 })
    rec('6.10', !sp.error, `qa-requester pronostica en la quiniela de qa-admin-b -> ${sp.error ? errTxt(sp) : 'ok'}`)
    const still = (await orgMembership(rq)).filter((m) => m.role === 'owner')
    rec('6.11', still.length === 1 && still[0].tenant_id === S.tenant, 'participar en B no altera su rol de owner en su tenant')
  }
  const rqAdminOnB = await rq.client.rpc('publish_official_result', { p_match_id: S.mB.id, p_home_score: 1, p_away_score: 0, p_expected_revision: 0 })
  expectErr('6.12', rqAdminOnB, '42501', null, 'como miembro de B no administra B (publicar resultado):')

  // Auto-fill (7a): ahora que están aprobados
  const pm3 = S.pm[S.m3.id]
  const sug = await u1.client.rpc('suggest_scoreline', { p_pool_match_id: pm3 })
  const d = sug.data
  rec('7.2', !sug.error && d.rated === false && d.model_version === 'elo-poisson-v1' && Number.isInteger(d.home_goals) && Number.isInteger(d.away_goals) && /no es una certeza/i.test(d.disclaimer ?? ''), `suggest_scoreline -> rated=${d?.rated}, modelo=${d?.model_version}, marcador=${d?.home_goals}-${d?.away_goals}, aviso presente=${/no es una certeza/i.test(d?.disclaimer ?? '')} ${sug.error ? errTxt(sug) : ''}`)
  rec('7.3', !sug.error && near(Number(d.p_home) + Number(d.p_draw) + Number(d.p_away), 1, 1e-5) && d.computed_at && d.ratings_as_of === null, `1X2 suma ${(Number(d?.p_home) + Number(d?.p_draw) + Number(d?.p_away)).toFixed(6)}; computed_at presente; ratings_as_of=null (sin historial)`)
  const sug2 = await u1.client.rpc('suggest_scoreline', { p_pool_match_id: pm3 })
  rec('7.4', !sug2.error && sug2.data.home_goals === d.home_goals && sug2.data.away_goals === d.away_goals && sug2.data.p_scoreline === d.p_scoreline && sug2.data.lambda_home === d.lambda_home, 'determinista: dos llamadas devuelven el mismo marcador, probabilidad y lambdas')
  const sugOrg = await rq.client.rpc('suggest_scoreline', { p_pool_match_id: pm3 })
  expectErr('7.5', sugOrg, '42501', 'ADMIN_PARTICIPANT_INCOMPATIBLE', 'el organizador no usa el auto-fill de su quiniela:')
  const sugOut = await out.client.rpc('suggest_scoreline', { p_pool_match_id: pm3 })
  expectErr('7.6', sugOut, '22023', 'STATS_NOT_FOUND', 'usuario ajeno al tenant:')
  const sugAnon = await anon.rpc('suggest_scoreline', { p_pool_match_id: pm3 })
  expectErr('7.7', sugAnon, '42501', null, 'anon:')
  const savedCount = (await svc.from('predictions').select('id', { count: 'exact', head: true }).eq('pool_id', S.pool.id)).count
  rec('7.8', savedCount === 0, `ningún pronóstico se guardó automáticamente tras 2 sugerencias válidas (predictions en la quiniela=${savedCount})`)
  S.ready6 = true
}, 'ready5')

// ------------------------------------------------------------------------------------------------------------------
// Paso 8: tickets y pronósticos antes del cierre
// ------------------------------------------------------------------------------------------------------------------
await section(8, 'tickets y pronósticos antes del cierre', async () => {
  const [m1, m2, m3, m4] = [S.m1, S.m2, S.m3, S.m4]
  const pool = S.pool.id
  const kA = randomUUID()
  const A = must(await u1.client.rpc('create_ticket', { p_pool_id: pool, p_round_id: S.round.id, p_idempotency_key: kA }), 'ticket A')
  const A2 = must(await u1.client.rpc('create_ticket', { p_pool_id: pool, p_round_id: S.round.id, p_idempotency_key: kA }), 'ticket A bis')
  const B = must(await u1.client.rpc('create_ticket', { p_pool_id: pool, p_round_id: S.round.id, p_idempotency_key: randomUUID() }), 'ticket B')
  const third = await u1.client.rpc('create_ticket', { p_pool_id: pool, p_round_id: S.round.id, p_idempotency_key: randomUUID() })
  rec('8.1', A.id === A2.id && A.id !== B.id, 'emitir con la misma clave de idempotencia devuelve el mismo ticket; otra clave crea el segundo')
  expectErr('8.2', third, '42501', 'TICKET_LIMIT', 'tercer ticket con cupo 2:')
  const burst = await settle(Array.from({ length: 4 }, () => u2.client.rpc('create_ticket', { p_pool_id: pool, p_round_id: S.round.id, p_idempotency_key: randomUUID() })))
  const okT = burst.filter((r) => !r.error).map((r) => r.data).sort((a, b) => Number(a.ticket_no) - Number(b.ticket_no))
  const lim = burst.filter((r) => r.error?.code === '42501' && r.error?.hint === 'TICKET_LIMIT').length
  rec('8.3', okT.length === 2 && lim === 2, `4 emisiones paralelas de qa-user2 con cupo 2: ok=${okT.length}, TICKET_LIMIT=${lim}`)
  const C = okT[0]
  const X = okT[1]
  const emptySubmit = await u2.client.rpc('submit_ticket', { p_ticket_id: X.id })
  expectErr('8.4', emptySubmit, '22023', null, 'enviar un ticket sin selecciones:')
  const cx = await u2.client.rpc('cancel_ticket', { p_ticket_id: X.id })
  const reCx = await u2.client.rpc('cancel_ticket', { p_ticket_id: X.id })
  rec('8.5', !cx.error && cx.data.status === 'cancelled' && !reCx.error, 'el ticket sobrante se cancela (idempotente) y libera cupo')
  S.tickets = { A: A.id, B: B.id, C: C.id }

  const sv = (who, t, m, h, a) => who.client.rpc('save_ticket_prediction', { p_ticket_id: t, p_match_id: m.id, p_home_score: h, p_away_score: a })
  const saves = [
    await sv(u1, A.id, m1, 1, 1), await sv(u1, A.id, m2, 1, 0), await sv(u1, A.id, m3, 0, 0), await sv(u1, A.id, m4, 2, 2),
    await sv(u1, B.id, m1, 1, 0), await sv(u1, B.id, m2, 0, 1),
    await sv(u2, C.id, m1, 0, 0), await sv(u2, C.id, m3, 1, 1),
  ]
  rec('8.6', saves.every((r) => !r.error), `8 selecciones guardadas antes del cierre (errores=${saves.filter((r) => r.error).length})`)
  const edit = await sv(u1, A.id, m1, 2, 1)
  const rowsA = must(await u1.client.from('predictions').select('home_score, away_score').eq('ticket_id', A.id).eq('pool_match_id', S.pm[m1.id]), 'fila A m1')
  rec('8.7', !edit.error && rowsA.length === 1 && rowsA[0].home_score === 2 && rowsA[0].away_score === 1, `editar antes del cierre: 1 fila, valor final ${rowsA[0]?.home_score}-${rowsA[0]?.away_score}`)
  const subs = [await u1.client.rpc('submit_ticket', { p_ticket_id: A.id }), await u1.client.rpc('submit_ticket', { p_ticket_id: B.id }), await u2.client.rpc('submit_ticket', { p_ticket_id: C.id })]
  const reSub = await u1.client.rpc('submit_ticket', { p_ticket_id: A.id })
  rec('8.8', subs.every((r) => !r.error && r.data.status === 'submitted' && r.data.eligibility === 'eligible') && !reSub.error, 'A, B y C enviados (submitted/eligible); reenviar es idempotente')
  const hist = must(await u1.client.rpc('list_my_tickets', { p_pool_id: pool }), 'historial u1')
  rec('8.9', hist.length === 2 && hist.map((t) => t.display_no).sort().join() === '1,2' && hist.every((t) => t.status === 'submitted' && t.selections > 0), `historial de qa-user1: ${hist.length} tickets numerados ${hist.map((t) => t.display_no).sort().join(',')}`)

  // Aislamiento y privacidad antes del cierre
  const sneak = await sv(u2, A.id, m1, 9, 9)
  expectErr('8.10', sneak, '42501', null, 'qa-user2 escribe en el ticket de qa-user1:')
  const peekT = must(await u2.client.from('tickets').select('id').eq('id', A.id), 'peek ticket')
  const u2rows = must(await u2.client.from('predictions').select('participant_id').eq('pool_id', pool), 'predicciones visibles u2')
  rec('8.11', peekT.length === 0 && u2rows.length === 2 && u2rows.every((r) => r.participant_id === S.part.u2), `qa-user2 no ve el ticket ajeno y solo ve sus 2 selecciones (visibles=${u2rows.length})`)
  const orgRows = must(await rq.client.from('predictions').select('id').eq('pool_id', pool), 'predicciones del organizador')
  const outRows = must(await out.client.from('predictions').select('id').eq('pool_id', pool), 'predicciones del outsider')
  rec('8.12', orgRows.length === 0 && outRows.length === 0, `organizador ve ${orgRows.length} y usuario ajeno ve ${outRows.length} pronósticos antes del cierre`)
  const classic = await u1.client.rpc('save_prediction', { p_pool_id: pool, p_match_id: m1.id, p_home_score: 1, p_away_score: 0 })
  expectErr('8.13', classic, '42501', null, 'pronóstico clásico en quiniela con tickets:')
  const orgTicket = await rq.client.rpc('create_ticket', { p_pool_id: pool, p_round_id: S.round.id, p_idempotency_key: randomUUID() })
  const orgSave = await sv(rq, A.id, m1, 1, 1)
  rec('8.14', errIs(orgTicket, '42501') && errIs(orgSave, '42501'), `el organizador no emite ni escribe en tickets: create_ticket=${errTxt(orgTicket)}, save_ticket_prediction=${errTxt(orgSave)}`)
  const codes = await u1.client.from('pool_join_codes').select('id').eq('pool_id', pool)
  rec('8.15', emptyOrErr(codes), `un participante no lee los códigos de unión de la quiniela (${codes.error ? errTxt(codes) : codes.data.length + ' filas'})`)
  S.ready8 = true
}, 'ready6')

// ------------------------------------------------------------------------------------------------------------------
// Paso 9: cierre por el servidor
// ------------------------------------------------------------------------------------------------------------------
await section(9, 'cierre (lock) calculado por el servidor', async () => {
  const [m1, m3] = [S.m1, S.m3]
  const pool = S.pool.id
  must(await svc.rpc('apply_fixture_update', { p_match_id: m1.id, p_starts_at: new Date(Date.now() - 120_000).toISOString(), p_status: 'live' }), 'sync live m1')
  const late = await u1.client.rpc('save_ticket_prediction', { p_ticket_id: S.tickets.A, p_match_id: m1.id, p_home_score: 9, p_away_score: 9 })
  expectErr('9.1', late, '42501', null, 'guardar tras el lock (ticket A, m1):')
  const late2 = await u2.client.rpc('save_ticket_prediction', { p_ticket_id: S.tickets.C, p_match_id: m1.id, p_home_score: 9, p_away_score: 9 })
  expectErr('9.2', late2, '42501', null, 'guardar tras el lock (ticket C, m1):')
  const lateTk = await u1.client.rpc('create_ticket', { p_pool_id: pool, p_round_id: S.round.id, p_idempotency_key: randomUUID() })
  const lateCx = await u1.client.rpc('cancel_ticket', { p_ticket_id: S.tickets.B })
  rec('9.3', errIs(lateTk, '42501') && errIs(lateCx, '42501'), `jornada cerrada: emitir=${errTxt(lateTk)}, cancelar enviado=${errTxt(lateCx)}`)
  const lateClassic = await u1.client.rpc('save_prediction', { p_pool_id: pool, p_match_id: m1.id, p_home_score: 9, p_away_score: 9 })
  expectErr('9.4', lateClassic, '42501', null, 'pronóstico clásico tras el lock:')
  const peekM1 = must(await u2.client.from('predictions').select('participant_id, ticket_id').eq('pool_match_id', S.pm[m1.id]), 'revelados m1')
  const peekM3 = must(await u2.client.from('predictions').select('participant_id').eq('pool_match_id', S.pm[m3.id]), 'ocultos m3')
  rec('9.5', peekM1.length === 3, `tras el lock se revelan los pronósticos de m1 a un participante aprobado (visibles=${peekM1.length}, esperado 3)`)
  rec('9.6', peekM3.length === 1 && peekM3[0].participant_id === S.part.u2, `los de m3 (abierto) siguen ocultos (qa-user2 ve ${peekM3.length}, solo el propio)`)
  const orgPost = must(await rq.client.from('predictions').select('id').eq('pool_match_id', S.pm[m1.id]), 'organizador post-lock')
  const outPost = must(await out.client.from('predictions').select('id').eq('pool_match_id', S.pm[m1.id]), 'outsider post-lock')
  rec('9.7', outPost.length === 0, `usuario ajeno ve ${outPost.length} pronósticos revelados (esperado 0); observación: el organizador ve ${orgPost.length} (RLS exige participación aprobada)`)
  const stillOpen = await u1.client.rpc('save_ticket_prediction', { p_ticket_id: S.tickets.A, p_match_id: m3.id, p_home_score: 0, p_away_score: 1 })
  rec('9.8', !stillOpen.error, `el cierre es por partido: m3 (futuro) sigue editable en un ticket enviado -> ${stillOpen.error ? errTxt(stillOpen) : 'ok'}`)
  const sugLocked = await u1.client.rpc('suggest_scoreline', { p_pool_match_id: S.pm[m1.id] })
  expectErr('7.9', sugLocked, '42501', 'STATS_LOCKED', 'suggest_scoreline tras el cierre:')
  const early = await rq.client.rpc('publish_official_result', { p_match_id: S.m2.id, p_home_score: 1, p_away_score: 0, p_expected_revision: 0 })
  expectErr('9.9', early, '22023', null, 'publicar resultado de un partido que no empezó (m2):')
  S.ready9 = true
}, 'ready8')

// ------------------------------------------------------------------------------------------------------------------
// Paso 10: resultado oficial, puntos, ranking, corrección; Paso 11: estadísticas; Paso 7 (parte c): ratings
// ------------------------------------------------------------------------------------------------------------------
const scoringFor = async (matchId) => {
  const preds = must(await svc.from('predictions').select('id, ticket_id').eq('pool_match_id', S.pm[matchId]), 'predicciones del partido')
  const ev = must(await svc.from('scoring_events').select('prediction_id, result_revision, points').in('prediction_id', preds.map((p) => p.id)), 'eventos')
  return { preds, ev }
}
const ratingRows = async () => must(await svc.from('team_ratings').select('team_id, rating, matches_played, run_id').eq('tenant_id', S.tenant).in('team_id', [S.manual.x, S.manual.y]), 'ratings')
const rebuild = async () => {
  const r = await svc.rpc('rebuild_team_ratings', { p_sport_code: 'football', p_tenant_id: S.tenant, p_model_version: null })
  if (r.error) throw new Error(`rebuild_team_ratings: ${r.error.code} ${r.error.message}`)
  const expected = (await svc.from('official_results').select('id', { count: 'exact', head: true }).eq('tenant_id', S.tenant)).count
  const run = must(await svc.from('stats_rating_runs').select('ratings_fingerprint, matches_processed, teams_rated').eq('tenant_id', S.tenant).order('created_at', { ascending: false }).limit(1), 'run')[0]
  return { out: r.data, run, expected }
}

await section(10, 'resultado oficial, puntos, ranking y corrección', async () => {
  const [m1, m3] = [S.m1, S.m3]
  const pool = S.pool.id
  const player = await u1.client.rpc('publish_official_result', { p_match_id: m1.id, p_home_score: 2, p_away_score: 1, p_expected_revision: 0 })
  expectErr('10.1', player, '42501', null, 'un participante no publica resultados:')
  const pub = await rq.client.rpc('publish_official_result', { p_match_id: m1.id, p_home_score: 2, p_away_score: 1, p_expected_revision: 0 })
  rec('10.2', !pub.error && pub.data.revision === 1 && pub.data.source === 'manual', `el organizador publica 2-1 -> revisión=${pub.data?.revision}, fuente=${pub.data?.source} ${pub.error ? errTxt(pub) : ''}`)
  let sc = await scoringFor(m1.id)
  const pts1 = sc.ev.filter((e) => e.result_revision === 1).map((e) => e.points).sort((a, b) => a - b).join()
  rec('10.3', sc.ev.length === 3 && pts1 === '0,2,5', `puntos revisión 1 (A exacto 5, B signo 2, C 0): eventos=${sc.ev.length}, puntos=[${pts1}]`)
  const lb = must(await u1.client.rpc('pool_leaderboard', { p_pool_id: pool }), 'ranking')
  const names1 = lb.map((r) => r.display_name).sort().join()
  rec('10.4', lb.length === 2 && lb[0].display_name === 'qa-user1' && lb[0].rank === 1 && Number(lb[0].points) === 5 && lb[0].exact_hits === 1 && lb[0].is_me === true && Number(lb[1].points) === 0 && names1 === 'qa-user1,qa-user2', `ranking general: ${JSON.stringify(lb.map((r) => [r.rank, r.display_name, Number(r.points)]))}; el organizador no figura`)
  const lbR = must(await u1.client.rpc('pool_leaderboard', { p_pool_id: pool, p_round_id: S.round.id }), 'ranking por jornada')
  rec('10.5', lbR.length === 2 && Number(lbR[0].points) === 5 && lbR[0].display_name === 'qa-user1', `ranking por jornada coincide: ${JSON.stringify(lbR.map((r) => [r.rank, r.display_name, Number(r.points)]))}`)
  const tb = must(await u2.client.rpc('pool_ticket_leaderboard', { p_pool_id: pool, p_round_id: S.round.id }), 'ranking de tickets')
  const best1 = tb.filter((r) => r.is_best)
  rec('10.6', tb.length === 3 && Number(tb[0].points) === 5 && tb[0].display_name === 'qa-user1' && best1.length === 2 && Number(tb.find((r) => r.display_name === 'qa-user1' && !r.is_best)?.points) === 2, `ranking por ticket: ${JSON.stringify(tb.map((r) => [r.rank, r.display_name, r.display_no, Number(r.points), r.is_best]))}`)
  const lbOut = await out.client.rpc('pool_leaderboard', { p_pool_id: pool })
  const tbOut = await out.client.rpc('pool_ticket_leaderboard', { p_pool_id: pool, p_round_id: S.round.id })
  rec('10.7', errIs(lbOut, '42501') && errIs(tbOut, '42501'), `usuario ajeno: leaderboard=${errTxt(lbOut)}, ticket_leaderboard=${errTxt(tbOut)}`)

  // 11 (a): estadísticas con la revisión 1
  const s1 = await u1.client.rpc('my_pool_stats', { p_pool_id: pool })
  const sm1 = must(await u1.client.rpc('my_points_summary'), 'resumen u1').find((r) => r.pool_id === pool)
  const ev1 = must(await u1.client.rpc('pool_points_evolution', { p_pool_id: pool }), 'evolución u1')
  rec('11.1', !s1.error && s1.data.length === 1 && s1.data[0].rank === 1 && Number(s1.data[0].points) === 5 && s1.data[0].exact_hits === 1 && s1.data[0].results_count === 1 && sm1 && sm1.rank === 1 && Number(sm1.points) === 5 && ev1.length === 1 && Number(ev1[0].my_points) === 5 && Number(ev1[0].my_cumulative) === 5 && Number(ev1[0].avg_points) === 2.5, `qa-user1 (rev. 1): stats=${JSON.stringify(s1.data?.[0] && { rank: s1.data[0].rank, pts: Number(s1.data[0].points), exact: s1.data[0].exact_hits })}, resumen rango=${sm1?.rank}, evolución=${JSON.stringify(ev1.map((e) => [Number(e.my_points), Number(e.avg_points)]))}`)

  // Idempotencia
  const rep = await rq.client.rpc('publish_official_result', { p_match_id: m1.id, p_home_score: 2, p_away_score: 1, p_expected_revision: 1 })
  sc = await scoringFor(m1.id)
  rec('10.8', !rep.error && rep.data.revision === 1 && sc.ev.length === 3, `republicar el mismo marcador: revisión=${rep.data?.revision}, eventos de puntos=${sc.ev.length} (sin duplicar)`)

  // 7 (c): ratings tras el primer resultado
  const rbPlayer = await u1.client.rpc('rebuild_team_ratings', { p_sport_code: 'football', p_tenant_id: S.tenant, p_model_version: null })
  expectErr('7.10', rbPlayer, '42501', null, 'un usuario no reconstruye ratings:')
  const r1 = await rebuild()
  const rows1 = await ratingRows()
  const rx1 = Number(rows1.find((r) => r.team_id === S.manual.x)?.rating)
  const ry1 = Number(rows1.find((r) => r.team_id === S.manual.y)?.rating)
  rec('7.11', r1.out.tenants === 1 && r1.out.matches_processed === r1.expected && rows1.length === 2 && near(rx1, 1508.1507, 0.01) && near(ry1, 1491.8493, 0.01), `rebuild_team_ratings(service_role) tras 2-1: partidos=${r1.out.matches_processed}/${r1.expected}, X=${rx1}, Y=${ry1} (esperado 1508.1507 / 1491.8493 con K=20, ventaja local 65)`)
  const r1b = await rebuild()
  rec('7.12', r1b.run.ratings_fingerprint === r1.run.ratings_fingerprint, 'reconstruir dos veces con los mismos resultados produce la misma huella de ratings (determinista, sin doble conteo)')
  const sugAfter = await u1.client.rpc('suggest_scoreline', { p_pool_match_id: S.pm[m3.id] })
  const dA = sugAfter.data
  rec('7.13', !sugAfter.error && dA.rated === true && Boolean(dA.ratings_as_of), `partido posterior (m3, revancha): rated=${dA?.rated}, ratings_as_of=${dA?.ratings_as_of ? 'presente' : 'null'}, lambdas=${dA?.lambda_home}/${dA?.lambda_away}`)
  const sug2 = await u1.client.rpc('suggest_scoreline', { p_pool_match_id: S.pm[S.m2.id] })
  const sug4 = await u1.client.rpc('suggest_scoreline', { p_pool_match_id: S.pm[S.m4.id] })
  rec('7.14', sug2.data?.rated === false && sug4.data?.rated === false, `rated=false si algún equipo no tiene historial (m2 Y-Z: ${sug2.data?.rated}, m4 catálogo: ${sug4.data?.rated})`)
  S.lambda1 = Number(dA?.lambda_home)

  // Corrección del resultado: 0-0 (revisión 2)
  const fix = await rq.client.rpc('publish_official_result', { p_match_id: m1.id, p_home_score: 0, p_away_score: 0, p_expected_revision: 1 })
  sc = await scoringFor(m1.id)
  const rev2 = sc.ev.filter((e) => e.result_revision === 2).map((e) => e.points).sort((a, b) => a - b).join()
  const dup = sc.ev.length - new Set(sc.ev.map((e) => `${e.prediction_id}|${e.result_revision}`)).size
  rec('10.9', !fix.error && fix.data.revision === 2 && sc.ev.length === 6 && rev2 === '0,0,5' && dup === 0, `corrección a 0-0: revisión=${fix.data?.revision}, eventos totales=${sc.ev.length} (3 de rev.1 conservados + 3 de rev.2), puntos rev.2=[${rev2}], duplicados=${dup}`)
  const stale = await rq.client.rpc('publish_official_result', { p_match_id: m1.id, p_home_score: 1, p_away_score: 1, p_expected_revision: 1 })
  expectErr('10.10', stale, 'PT409', null, 'revisión obsoleta:')
  const fixAgain = await rq.client.rpc('publish_official_result', { p_match_id: m1.id, p_home_score: 0, p_away_score: 0, p_expected_revision: 2 })
  sc = await scoringFor(m1.id)
  rec('10.11', !fixAgain.error && fixAgain.data.revision === 2 && sc.ev.length === 6, `repetir la corrección: revisión=${fixAgain.data?.revision}, eventos=${sc.ev.length} (sin duplicar)`)
  const lb2 = must(await u1.client.rpc('pool_leaderboard', { p_pool_id: pool }), 'ranking final')
  rec('10.12', lb2.length === 2 && lb2[0].display_name === 'qa-user2' && lb2[0].rank === 1 && Number(lb2[0].points) === 5 && lb2[1].display_name === 'qa-user1' && Number(lb2[1].points) === 0 && lb2[1].is_me === true, `ranking tras corregir: ${JSON.stringify(lb2.map((r) => [r.rank, r.display_name, Number(r.points)]))}`)
  const tb2 = must(await u1.client.rpc('pool_ticket_leaderboard', { p_pool_id: pool, p_round_id: S.round.id }), 'tickets final')
  rec('10.13', tb2.length === 3 && tb2[0].display_name === 'qa-user2' && Number(tb2[0].points) === 5 && tb2.slice(1).every((r) => Number(r.points) === 0), `ranking por ticket tras corregir: ${JSON.stringify(tb2.map((r) => [r.rank, r.display_name, r.display_no, Number(r.points), r.is_best]))}`)

  // 7 (c) bis: recalcular ratings tras la corrección
  const r2 = await rebuild()
  const rows2 = await ratingRows()
  const rx2 = Number(rows2.find((r) => r.team_id === S.manual.x)?.rating)
  const ry2 = Number(rows2.find((r) => r.team_id === S.manual.y)?.rating)
  const sugFix = await u1.client.rpc('suggest_scoreline', { p_pool_match_id: S.pm[m3.id] })
  rec('7.15', r2.out.matches_processed === r2.expected && r2.run.ratings_fingerprint !== r1.run.ratings_fingerprint && near(rx2, 1498.1507, 0.01) && near(ry2, 1501.8493, 0.01) && Number(sugFix.data?.lambda_home) !== S.lambda1, `tras corregir a 0-0 el recálculo es consistente: X=${rx2}, Y=${ry2} (esperado 1498.1507 / 1501.8493), huella distinta de la previa, lambda_home ${S.lambda1} -> ${sugFix.data?.lambda_home}`)
  const savedCount = (await svc.from('predictions').select('id', { count: 'exact', head: true }).eq('pool_id', pool)).count
  const mpCount = (await svc.from('model_predictions').select('id', { count: 'exact', head: true }).eq('tenant_id', S.tenant)).count
  rec('7.16', savedCount === 8 && mpCount === 0, `ningún pronóstico se guardó automáticamente: predictions=${savedCount} (8 guardados a mano), model_predictions=${mpCount}`)
  const ins = await u1.client.from('team_ratings').insert({ tenant_id: S.tenant, team_id: S.manual.x, rating: 9999, model_version: 'x' })
  rec('7.17', Boolean(ins.error), `un usuario no escribe ratings (${errTxt(ins)})`)

  // 11 (b): estadísticas finales de cada participante
  const fin = async (who, exp) => {
    const st = await who.client.rpc('my_pool_stats', { p_pool_id: pool })
    const sm = must(await who.client.rpc('my_points_summary'), 'resumen').find((r) => r.pool_id === pool)
    const evo = must(await who.client.rpc('pool_points_evolution', { p_pool_id: pool }), 'evolución')
    const hist = must(await who.client.rpc('list_my_tickets', { p_pool_id: pool }), 'historial')
    const s = st.data?.[0]
    const ok = !st.error && st.data.length === 1 && s.rank === exp.rank && Number(s.points) === exp.points && s.exact_hits === exp.exact && s.results_count === 1 && s.participants === 2
      && sm && sm.rank === exp.rank && Number(sm.points) === exp.points && sm.participants === 2
      && evo.length === 1 && Number(evo[0].my_points) === exp.points && Number(evo[0].my_cumulative) === exp.points && Number(evo[0].avg_points) === 2.5 && Number(evo[0].best_points) === 5
      && hist.length === exp.tickets && hist.filter((t) => t.is_best).length === 1 && hist.every((t) => t.results_count === 1)
    return { ok, text: `rango=${s?.rank}/${s?.participants}, puntos=${Number(s?.points)}, exactos=${s?.exact_hits}, resumen=${sm?.rank}, evolución=${JSON.stringify(evo.map((e) => [Number(e.my_points), Number(e.my_cumulative), Number(e.avg_points)]))}, tickets=${hist.length} (mejor=${hist.filter((t) => t.is_best).length}, puntos=[${hist.map((t) => Number(t.points))}])` }
  }
  const f1 = await fin(u1, { rank: 2, points: 0, exact: 0, tickets: 2 })
  rec('11.2', f1.ok, `qa-user1 final: ${f1.text}`)
  const f2 = await fin(u2, { rank: 1, points: 5, exact: 1, tickets: 2 })
  rec('11.3', f2.ok, `qa-user2 final: ${f2.text}`)
  const orgStats = must(await rq.client.rpc('my_pool_stats', { p_pool_id: pool }), 'stats organizador')
  const orgSum = must(await rq.client.rpc('my_points_summary'), 'resumen organizador')
  rec('11.4', orgStats.length === 0 && !orgSum.some((r) => r.pool_id === pool), `el organizador no tiene estadísticas de jugador en su quiniela (stats=${orgStats.length}); su resumen solo incluye otras quinielas (${orgSum.length})`)
  const outSum = must(await out.client.rpc('my_points_summary'), 'resumen outsider')
  const outStats = await out.client.rpc('my_pool_stats', { p_pool_id: pool })
  rec('11.5', outSum.length === 0 && errIs(outStats, '42501'), `usuario ajeno: resumen=${outSum.length} filas, my_pool_stats=${errTxt(outStats)}`)
  S.ready10 = true
}, 'ready9')

// ------------------------------------------------------------------------------------------------------------------
// Paso 12: reportes del organizador (pago manual) y aislamiento entre tenants
// ------------------------------------------------------------------------------------------------------------------
await section(12, 'estado de pago manual y aislamiento entre tenants', async () => {
  const pool = S.pool.id
  const counts = async () => {
    const rows = must(await rq.client.from('participants').select('payment_status, approval_status').eq('pool_id', pool), 'participantes (organizador)')
    return rows.reduce((a, r) => ({ ...a, [r.payment_status]: (a[r.payment_status] ?? 0) + 1 }), {})
  }
  const c0 = await counts()
  rec('12.1', c0.invited === 2, `el organizador lee los participantes de SU quiniela bajo RLS; pagos iniciales=${JSON.stringify(c0)}`)
  const p1 = await rq.client.rpc('set_participant_payment_status', { p_participant_id: S.part.u1, p_status: 'paid' })
  const p2 = await rq.client.rpc('set_participant_payment_status', { p_participant_id: S.part.u2, p_status: 'pending' })
  const c1 = await counts()
  rec('12.2', !p1.error && !p2.error && c1.paid === 1 && c1.pending === 1 && !c1.invited, `set_participant_payment_status -> conteos=${JSON.stringify(c1)} (estado manual, sin dinero)`)
  const self = await u2.client.rpc('set_participant_payment_status', { p_participant_id: S.part.u2, p_status: 'paid' })
  const other = await u2.client.rpc('set_participant_payment_status', { p_participant_id: S.part.u1, p_status: 'pending' })
  const selfAppr = await u2.client.rpc('approve_participant', { p_participant_id: S.part.u2 })
  rec('12.3', errIs(self, '42501') && errIs(other, '42501') && errIs(selfAppr, '42501'), `un jugador no cambia pagos ni aprueba: propio=${errTxt(self)}, ajeno=${errTxt(other)}, approve=${errTxt(selfAppr)}`)
  const mineRows = must(await u1.client.from('participants').select('id, profile_id, pool_id'), 'participants (user1)')
  const inPool = mineRows.filter((r) => r.pool_id === pool)
  const foreign = await u1.client.from('participants').select('id').eq('id', S.part.u2)
  rec('12.4', mineRows.every((r) => r.profile_id === u1.id) && inPool.length === 1 && foreign.data?.length === 0, `qa-user1 solo ve su propia fila de participants (filas visibles=${mineRows.length}, todas propias; en esta quiniela=${inPool.length}); la de qa-user2 -> ${foreign.data?.length} filas`)
  const stateAfter = must(await svc.from('participants').select('payment_status').eq('id', S.part.u1).single(), 'estado u1')
  rec('12.5', stateAfter.payment_status === 'paid', 'el intento ajeno no alteró el estado de pago (BD)')

  // qa-admin-b contra el tenant del solicitante
  const adminDenied = []
  const chk = (id, label, r, c = '42501', h = null) => { const ok = r.error ? (c ? r.error.code === c : true) && (h ? r.error.hint === h : true) : emptyOrErr(r); adminDenied.push(ok); rec(id, ok, `${label}: ${r.error ? errTxt(r) : `${Array.isArray(r.data) ? r.data.length + ' filas' : 'sin error (!)'}`}`) }
  chk('12.6a', 'qa-admin-b lee participants del tenant', await ab.client.from('participants').select('id').eq('pool_id', pool))
  chk('12.6b', 'lee tickets', await ab.client.from('tickets').select('id').eq('pool_id', pool))
  chk('12.6c', 'lee predictions', await ab.client.from('predictions').select('id').eq('pool_id', pool))
  chk('12.6d', 'lee pools/pool_matches/matches/official_results', { data: [...(must(await ab.client.from('pools').select('id').eq('id', pool), 'pools')), ...must(await ab.client.from('pool_matches').select('id').eq('pool_id', pool), 'pm'), ...must(await ab.client.from('matches').select('id').eq('tenant_id', S.tenant), 'matches'), ...must(await ab.client.from('official_results').select('id').eq('tenant_id', S.tenant), 'or')] })
  chk('12.6e', 'UPDATE directo de pagos', await ab.client.from('participants').update({ payment_status: 'paid' }).eq('pool_id', pool).select())
  chk('12.7a', 'set_participant_payment_status con id ajeno', await ab.client.rpc('set_participant_payment_status', { p_participant_id: S.part.u2, p_status: 'paid' }), '42501')
  chk('12.7b', 'approve_participant con id ajeno', await ab.client.rpc('approve_participant', { p_participant_id: S.part.u2 }), '42501')
  chk('12.7c', 'suggest_scoreline de otro tenant', await ab.client.rpc('suggest_scoreline', { p_pool_match_id: S.pm[S.m3.id] }), '22023', 'STATS_NOT_FOUND')
  chk('12.7d', 'publish_official_result de otro tenant', await ab.client.rpc('publish_official_result', { p_match_id: S.m3.id, p_home_score: 9, p_away_score: 9, p_expected_revision: 0 }), '42501')
  chk('12.7e', 'import_catalog_teams en torneo ajeno', await ab.client.rpc('import_catalog_teams', { p_tournament_id: S.tour.id, p_team_ids: S.catTeams }), '42501')
  chk('12.7f', 'save_ticket_prediction en ticket ajeno', await ab.client.rpc('save_ticket_prediction', { p_ticket_id: S.tickets.A, p_match_id: S.m3.id, p_home_score: 5, p_away_score: 5 }), '42501')
  chk('12.7g', 'create_ticket en quiniela ajena', await ab.client.rpc('create_ticket', { p_pool_id: pool, p_round_id: S.round.id, p_idempotency_key: randomUUID() }), '42501')
  chk('12.7h', 'create_pool_join_code ajeno', await ab.client.rpc('create_pool_join_code', { p_pool_id: pool }), '42501')
  chk('12.7i', 'manage_pool archive ajeno', await ab.client.rpc('manage_pool', { p_action: 'archive', p_pool_id: pool, p_tenant_id: null, p_name: null, p_lock_offset_minutes: null, p_requires_approval: null }), '42501')
  chk('12.7j', 'enable_pool_tickets ajeno', await ab.client.rpc('enable_pool_tickets', { p_pool_id: pool, p_default_max: 3 }), '42501')
  chk('12.7k', 'upsert_tournament en tenant ajeno', await ab.client.rpc('upsert_tournament', { p_tenant_id: S.tenant, p_tournament_id: null, p_name: 'x' }), '42501')
  chk('12.7l', 'pool_leaderboard ajeno', await ab.client.rpc('pool_leaderboard', { p_pool_id: pool }), '42501')
  rec('12.8', adminDenied.every(Boolean), `aislamiento: ${adminDenied.filter(Boolean).length}/${adminDenied.length} accesos de qa-admin-b al tenant del solicitante denegados`)
  const ensure = must(await svc.from('participants').select('payment_status').eq('id', S.part.u2).single(), 'u2 tras ataques')
  rec('12.9', ensure.payment_status === 'pending', 'el estado de pago de qa-user2 sigue siendo el fijado por el organizador (BD)')

  // Participante raso contra funciones de administración
  const adm = [
    ['upsert_tournament', await u1.client.rpc('upsert_tournament', { p_tenant_id: S.tenant, p_tournament_id: null, p_name: 'x' })],
    ['create_pool_join_code', await u1.client.rpc('create_pool_join_code', { p_pool_id: pool })],
    ['import_catalog_teams', await u1.client.rpc('import_catalog_teams', { p_tournament_id: S.tour.id, p_team_ids: S.catTeams })],
    ['enable_pool_tickets', await u1.client.rpc('enable_pool_tickets', { p_pool_id: pool, p_default_max: 5 })],
  ]
  rec('12.10', adm.every(([, r]) => errIs(r, '42501')), `un participante no ejecuta funciones de administración: ${adm.map(([n, r]) => `${n}=${errTxt(r)}`).join(', ')}`)
  // El organizador no administra la quiniela B (aunque participe)
  const rb = [
    await rq.client.rpc('set_participant_payment_status', { p_participant_id: must(await rq.client.from('participants').select('id').eq('pool_id', S.poolB.id).eq('profile_id', rq.id), 'participación B')[0].id, p_status: 'paid' }),
    await rq.client.rpc('manage_pool', { p_action: 'archive', p_pool_id: S.poolB.id, p_tenant_id: null, p_name: null, p_lock_offset_minutes: null, p_requires_approval: null }),
  ]
  rec('12.11', rb.every((r) => errIs(r, '42501')), `participar en B no da poder administrativo en B: auto-pago=${errTxt(rb[0])}, archivar=${errTxt(rb[1])}`)
  const bView = must(await ab.client.from('participants').select('profile_id, payment_status').eq('pool_id', S.poolB.id), 'B ve a sus participantes')
  rec('12.12', bView.some((p) => p.profile_id === rq.id), `qa-admin-b sí ve la participación de qa-requester en SU quiniela (filas=${bView.length})`)
}, 'ready8')

// ------------------------------------------------------------------------------------------------------------------
// Paso 13: retención de fixture_sync_log en dry-run
// ------------------------------------------------------------------------------------------------------------------
await section(13, 'purge_fixture_sync_log en dry-run', async () => {
  const cnt = async (t, f = (q) => q) => (await f(svc.from(t).select('id', { count: 'exact', head: true }))).count
  const runsBefore = await cnt('maintenance_runs', (q) => q.eq('task', 'purge_fixture_sync_log'))
  const logBefore = await cnt('fixture_sync_log')
  const r = await svc.rpc('purge_fixture_sync_log', { p_keep: '180 days', p_max_rows: 10000, p_dry_run: true, p_keep_conflicts: '365 days' })
  const runsAfter = await cnt('maintenance_runs', (q) => q.eq('task', 'purge_fixture_sync_log'))
  const logAfter = await cnt('fixture_sync_log')
  const last = must(await svc.from('maintenance_runs').select('dry_run, affected, error').eq('task', 'purge_fixture_sync_log').order('ran_at', { ascending: false }).limit(1), 'última corrida')[0]
  rec('13.1', !r.error && r.data.ok === true && r.data.dry_run === true && typeof r.data.would_delete === 'number', `dry-run -> ${JSON.stringify(r.data ?? errTxt(r))}`)
  rec('13.2', runsAfter === runsBefore + 1 && last.dry_run === true && last.affected === r.data?.would_delete && last.error === null, `registro en maintenance_runs: ${runsBefore} -> ${runsAfter}; última fila dry_run=${last?.dry_run}, affected=${last?.affected}`)
  rec('13.3', logAfter === logBefore, `el dry-run no borra: fixture_sync_log ${logBefore} -> ${logAfter}`)
  const asUser = await u1.client.rpc('purge_fixture_sync_log', { p_keep: '180 days', p_max_rows: 10, p_dry_run: true, p_keep_conflicts: '365 days' })
  const asOrg = await rq.client.rpc('purge_fixture_sync_log', { p_keep: '180 days', p_max_rows: 10, p_dry_run: true, p_keep_conflicts: '365 days' })
  const readRuns = await u1.client.from('maintenance_runs').select('id')
  rec('13.4', errIs(asUser, '42501') && errIs(asOrg, '42501') && emptyOrErr(readRuns), `usuarios no ejecutan ni leen: participante=${errTxt(asUser)}, organizador=${errTxt(asOrg)}, lectura de maintenance_runs=${readRuns.error ? errTxt(readRuns) : readRuns.data.length + ' filas'}`)
})

// ------------------------------------------------------------------------------------------------------------------
// Paso 14: provider_reserve no ejecutable por usuarios
// ------------------------------------------------------------------------------------------------------------------
await section(14, 'cuota del proveedor (provider_reserve) solo backend', async () => {
  const usage = async () => {
    const r = await svc.from('provider_usage').select('requests, quota_rejected').eq('provider', 'api_football').order('day', { ascending: false }).limit(1)
    return r.data?.[0] ?? { requests: 0, quota_rejected: 0 }
  }
  const before = await usage()
  const args = { p_provider: 'api_football', p_kind: 'search', p_tenant: null, p_n: 1, p_daily_cap: null }
  const calls = [['participante', u1], ['organizador', rq], ['usuario ajeno', out], ['organizador B', ab]]
  const denied = []
  for (const [name, who] of calls) denied.push([name, await who.client.rpc('provider_reserve', args)])
  denied.push(['anon', await anon.rpc('provider_reserve', args)])
  rec('14.1', denied.every(([, r]) => errIs(r, '42501')), `provider_reserve denegada: ${denied.map(([n, r]) => `${n}=${errTxt(r)}`).join(', ')}`)
  const others = [
    ['provider_settle', await rq.client.rpc('provider_settle', { p_reservation_id: randomUUID(), p_outcome: 'released', p_error_code: null })],
    ['provider_quota_purge', await rq.client.rpc('provider_quota_purge', { p_keep: '90 days', p_max_rows: 10 })],
    ['provider_access_check', await rq.client.rpc('provider_access_check', { p_provider: 'api_football', p_kind: 'search', p_tenant: null })],
  ]
  rec('14.2', others.every(([, r]) => errIs(r, '42501')), `resto de funciones de cuota denegadas: ${others.map(([n, r]) => `${n}=${errTxt(r)}`).join(', ')}`)
  const tables = await Promise.all(['provider_quota_config', 'provider_tenant_usage', 'provider_quota_reservations', 'provider_usage'].map((t) => rq.client.from(t).select('*').limit(1)))
  rec('14.3', tables.every(emptyOrErr), `tablas de cuota ilegibles para el organizador: ${tables.map((r) => (r.error ? errTxt(r) : r.data.length + ' filas')).join(', ')}`)
  const after = await usage()
  rec('14.4', after.requests === before.requests && after.quota_rejected === before.quota_rejected, `los intentos denegados no tocaron contadores: requests ${before.requests} -> ${after.requests}, rechazos ${before.quota_rejected} -> ${after.quota_rejected}`)
  // Comprobaciones de lectura como service_role (no reservan ni consumen)
  const cfg = must(await svc.from('provider_quota_config').select('daily_limit, monthly_limit, sync_reserve').eq('provider', 'api_football'), 'config')[0]
  const search = await svc.rpc('provider_access_check', { p_provider: 'api_football', p_kind: 'search', p_tenant: null })
  const sync = await svc.rpc('provider_access_check', { p_provider: 'api_football', p_kind: 'sync', p_tenant: null })
  const tenantCheck = await svc.rpc('provider_access_check', { p_provider: 'api_football', p_kind: 'search', p_tenant: S.tenant ?? randomUUID() })
  const same = await usage()
  rec('14.5', cfg?.daily_limit === 80 && cfg?.monthly_limit === 2400 && cfg?.sync_reserve === 8, `presupuesto configurado=${JSON.stringify(cfg)}`)
  rec('14.6', search.data === 'OK' && sync.data === 'AUTO_RESULTS_OFF' && tenantCheck.data === 'AUTO_RESULTS_OFF' && same.requests === before.requests, `provider_access_check (solo lectura): catálogo=${search.data}, sondeo=${sync.data}, tenant Free con bandera apagada=${tenantCheck.data}; contador sin cambios`)
})

// ------------------------------------------------------------------------------------------------------------------
// Paso 15: entradas incompletas o inválidas en el SERVIDOR (contraparte de FE-01) y sesión cerrada. Nada de esto debe cambiar estado.
// ------------------------------------------------------------------------------------------------------------------
await section(15, 'entradas incompletas/inválidas y sesión cerrada (el servidor es la autoridad)', async () => {
  const m4 = S.m4.id
  const count = async (table, filter) => {
    const q = svc.from(table).select('*', { count: 'exact', head: true })
    const r = await filter(q)
    return r.count ?? -1
  }
  const resultsBefore = await count('official_results', (q) => q.eq('match_id', m4))
  // 15.1-15.3 publicar resultado con marcador incompleto/inválido: ningún valor vacío se convierte en 0.
  const rn = await rq.client.rpc('publish_official_result', { p_match_id: m4, p_home_score: 2, p_away_score: null, p_expected_revision: 0 })
  expectErr('15.1', rn, '22023', null, 'resultado «2 – nulo»:')
  const rneg = await rq.client.rpc('publish_official_result', { p_match_id: m4, p_home_score: -1, p_away_score: 0, p_expected_revision: 0 })
  expectErr('15.2', rneg, '22023', null, 'resultado con marcador negativo:')
  const rtxt = await rq.client.rpc('publish_official_result', { p_match_id: m4, p_home_score: 'dos', p_away_score: 0, p_expected_revision: 0 })
  rec('15.3', Boolean(rtxt.error), `resultado no numérico rechazado (${errTxt(rtxt)})`)
  const resultsAfter = await count('official_results', (q) => q.eq('match_id', m4))
  rec('15.4', resultsBefore === resultsAfter, `ninguna fila de resultado oficial nueva para el partido (antes=${resultsBefore}, después=${resultsAfter})`)

  // 15.5-15.8 pronósticos de ticket con valores incompletos: no cambian lo guardado.
  const pm4 = must(await svc.from('pool_matches').select('id').eq('pool_id', S.pool.id).eq('match_id', m4), 'pool_match m4')[0].id
  const predBefore = await svc.from('predictions').select('home_score, away_score').eq('ticket_id', S.tickets.A).eq('pool_match_id', pm4)
  const before = JSON.stringify(predBefore.data)
  const sv = (h, a) => u1.client.rpc('save_ticket_prediction', { p_ticket_id: S.tickets.A, p_match_id: m4, p_home_score: h, p_away_score: a })
  const pn = await sv(3, null)
  rec('15.5', Boolean(pn.error), `pronóstico «3 – nulo» rechazado (${errTxt(pn)})`)
  const pneg = await sv(-2, 1)
  rec('15.6', Boolean(pneg.error), `pronóstico negativo rechazado (${errTxt(pneg)})`)
  const pfrac = await u1.client.rpc('save_ticket_prediction', { p_ticket_id: S.tickets.A, p_match_id: m4, p_home_score: 2.5, p_away_score: 1 })
  rec('15.7', Boolean(pfrac.error), `pronóstico fraccionario rechazado (${errTxt(pfrac)})`)
  const predAfter = await svc.from('predictions').select('home_score, away_score').eq('ticket_id', S.tickets.A).eq('pool_match_id', pm4)
  rec('15.8', before === JSON.stringify(predAfter.data), `el pronóstico guardado no cambió tras los intentos inválidos (${before})`)

  // 15.9-15.11 reglas de puntuación inválidas no crean versión nueva.
  const rulesBefore = await count('pool_rules', (q) => q.eq('pool_id', S.pool.id))
  const rl1 = await rq.client.rpc('publish_pool_rules', { p_pool_id: S.pool.id, p_exact_points: null, p_outcome_points: 2, p_tie_breaker: 'exact_predictions' })
  const rl2 = await rq.client.rpc('publish_pool_rules', { p_pool_id: S.pool.id, p_exact_points: -5, p_outcome_points: 2, p_tie_breaker: 'exact_predictions' })
  const rl3 = await rq.client.rpc('publish_pool_rules', { p_pool_id: S.pool.id, p_exact_points: 5, p_outcome_points: 2, p_tie_breaker: 'no_existe' })
  rec('15.9', Boolean(rl1.error) && Boolean(rl2.error) && Boolean(rl3.error), `reglas con puntos nulos, negativos o desempate inexistente rechazadas (${errTxt(rl1)} | ${errTxt(rl2)} | ${errTxt(rl3)})`)
  const rulesAfter = await count('pool_rules', (q) => q.eq('pool_id', S.pool.id))
  rec('15.10', rulesBefore === rulesAfter, `no se creó ninguna versión de reglas (antes=${rulesBefore}, después=${rulesAfter})`)

  // 15.11 partido sin fecha de inicio.
  const nm = await rq.client.rpc('upsert_match', { p_tournament_id: S.tour.id, p_match_id: null, p_round_id: S.round.id, p_home_team_id: S.manual.x, p_away_team_id: S.manual.y, p_starts_at: null })
  rec('15.11', Boolean(nm.error), `partido sin fecha rechazado (${errTxt(nm)})`)

  // 15.12-15.13 sesión cerrada: una sesión cerrada (token revocado en este cliente) ya no escribe nada en nombre del usuario.
  const so = await u1.client.auth.signOut({ scope: 'local' })
  rec('15.12', !so.error, 'cierre de sesión local de qa-user1 sin error')
  const after = await sv(1, 1)
  rec('15.13', Boolean(after.error), `tras cerrar sesión el cliente ya no puede guardar pronósticos (${errTxt(after)})`)
  const predFinal = await svc.from('predictions').select('home_score, away_score').eq('ticket_id', S.tickets.A).eq('pool_match_id', pm4)
  rec('15.14', before === JSON.stringify(predFinal.data), 'el pronóstico del usuario no se modificó tras cerrar sesión')
})

// ------------------------------------------------------------------------------------------------------------------
// Resumen
// ------------------------------------------------------------------------------------------------------------------
const titles = {
  1: 'cuentas y estado inicial', 2: 'solicitud de organizador', 3: 'revisión del operador / cooldown', 4: 'visibilidad del nuevo owner',
  5: 'configuración', 6: 'participantes y exclusión admin', 7: 'auto-fill Elo+Poisson', 8: 'tickets y pronósticos', 9: 'cierre por el servidor',
  10: 'resultado, puntos y ranking', 11: 'estadísticas del participante', 12: 'pagos manuales y aislamiento', 13: 'purge dry-run', 14: 'provider_reserve', 15: 'entradas inválidas y sesión cerrada',
}
console.log('\n================ RESUMEN ================')
console.log(`Ejecución ${tag}`)
let anyFail = false
for (let n = 1; n <= 15; n++) {
  const rs = results.filter((r) => r.step === n)
  const c = (s) => rs.filter((r) => r.status.startsWith(s)).length
  const fail = c('FAIL'); const pass = c('PASS'); const sk = c('SKIPPED'); const nr = c('NOT_RUN')
  if (fail) anyFail = true
  const verdict = fail ? 'FAIL' : pass === 0 && sk > 0 ? 'SKIPPED(already organizer)' : nr && !pass ? 'NOT_RUN' : sk ? 'PASS (+SKIPPED)' : 'PASS'
  console.log(`Paso ${String(n).padStart(2)}  ${verdict.padEnd(26)} PASS=${pass} FAIL=${fail} SKIPPED=${sk} NOT_RUN=${nr}   ${titles[n]}`)
}
const total = (s) => results.filter((r) => r.status.startsWith(s)).length
console.log(`TOTAL  PASS=${total('PASS')} FAIL=${total('FAIL')} SKIPPED=${total('SKIPPED')} NOT_RUN=${total('NOT_RUN')}`)
for (const r of results.filter((x) => x.status === 'FAIL')) console.log(`FALLO ${r.id}: ${r.detail}`)
process.exitCode = anyFail ? 1 : 0
