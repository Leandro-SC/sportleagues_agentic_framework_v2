#!/usr/bin/env node
// E2E REAL de tickets gratuitos (ADR-014 Etapa 1) contra Supabase QA, con sesiones de usuario y CONCURRENCIA real.
// Aprovisiona un tenant sintético con service_role y ejecuta todo lo demás como usuarios autenticados. Deja datos sintéticos
// etiquetados (TKE-xxxxxxxx / @example.test): anotar la ejecución en docs/operations/QA-SYNTHETIC-RESIDUE.md.
//   QA_OWNER_AUTHORIZED=yes node scripts/qa/e2e/tickets-flow.mjs
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

if (process.env.QA_OWNER_AUTHORIZED !== 'yes') throw new Error('Requiere QA_OWNER_AUTHORIZED=yes (QA, datos sintéticos).')
const REF = 'juoftaofzepxbrrxbkhx'
const url = `https://${REF}.supabase.co`
const out = spawnSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', REF, '-o', 'json'], { encoding: 'utf8', shell: true }).stdout
const keys = JSON.parse(out.slice(out.indexOf('[')))
const key = (name) => keys.find((k) => k.name === name && k.type === 'legacy')?.api_key
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const svc = createClient(url, key('service_role'), opts)
const results = []
const rec = (id, ok, detail = '') => { results.push({ id, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? '  ' + detail : ''}`) }
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data }
const code = (r) => r.error?.code ?? (r.error ? 'ERR' : null)
const settle = (ps) => Promise.all(ps.map((p) => Promise.resolve(p).catch((e) => ({ error: { message: String(e) } }))))

async function user(label) {
  const email = `${label}-${randomUUID()}@example.test`
  const password = `Pw-${randomUUID()}`
  const id = must(await svc.auth.admin.createUser({ email, password, email_confirm: true }), 'createUser').user.id
  must(await svc.from('profiles').insert({ id, display_name: label.slice(0, 40) }), 'profile')
  const client = createClient(url, key('anon'), opts)
  must(await client.auth.signInWithPassword({ email, password }), 'signIn')
  return { id, client }
}

const tag = `TKE-${randomUUID().slice(0, 8)}`
const [owner, p1, p2, p3, p4] = await Promise.all(['tke-owner', 'tke-p1', 'tke-p2', 'tke-p3', 'tke-p4'].map(user))
const tenant = must(await svc.from('tenants').insert({ name: tag, timezone: 'America/Lima' }).select('id').single(), 'tenant').id
must(await svc.from('tenant_entitlements').insert({ tenant_id: tenant, plan_code: 'pro' }), 'entitlement')
must(await svc.from('tenant_memberships').insert({ tenant_id: tenant, profile_id: owner.id, role: 'owner' }), 'membership')

// ---- Organizador: parrilla, quiniela y tickets ------------------------------------------------------------------
const tour = must(await owner.client.rpc('upsert_tournament', { p_tenant_id: tenant, p_tournament_id: null, p_name: 'Liga TK', p_sport_code: 'football' }), 'tournament')
const teamIds = []
for (const n of ['Uno FC', 'Dos FC']) {
  const t = must(await owner.client.rpc('upsert_team', { p_tenant_id: tenant, p_team_id: null, p_name: n }), 'team')
  must(await owner.client.rpc('set_tournament_team', { p_tournament_id: tour.id, p_team_id: t.id, p_enrolled: true }), 'enrol')
  teamIds.push(t.id)
}
const r1 = must(await owner.client.rpc('upsert_round', { p_tournament_id: tour.id, p_round_id: null, p_name: 'Fecha 1', p_sort_order: 1 }), 'round1')
const r2 = must(await owner.client.rpc('upsert_round', { p_tournament_id: tour.id, p_round_id: null, p_name: 'Fecha 2', p_sort_order: 2 }), 'round2')
const mk = async (round, mins) => must(await owner.client.rpc('upsert_match', { p_tournament_id: tour.id, p_match_id: null, p_round_id: round.id, p_home_team_id: teamIds[0], p_away_team_id: teamIds[1], p_starts_at: new Date(Date.now() + mins * 60_000).toISOString() }), 'match')
const m1 = await mk(r1, 40)
const m2 = await mk(r1, 90)
const m3 = await mk(r2, 600)
const pool = must(await owner.client.rpc('manage_pool', { p_action: 'create', p_pool_id: null, p_tenant_id: tenant, p_name: 'Quiniela tickets', p_lock_offset_minutes: 15, p_requires_approval: false }), 'pool')
must(await owner.client.rpc('publish_pool_rules', { p_pool_id: pool.id, p_exact_points: 5, p_outcome_points: 2, p_tie_breaker: 'exact_predictions' }), 'rules')
must(await owner.client.rpc('manage_pool', { p_action: 'open', p_pool_id: pool.id, p_tenant_id: null, p_name: null, p_lock_offset_minutes: null, p_requires_approval: null }), 'open')
for (const m of [m1, m2, m3]) must(await owner.client.rpc('set_pool_match', { p_pool_id: pool.id, p_match_id: m.id, p_included: true }), 'pool match')
const joinCode = must(await owner.client.rpc('create_pool_join_code', { p_pool_id: pool.id }), 'code').code
for (const p of [p1, p2, p3, p4]) must(await p.client.rpc('join_pool', { p_code: joinCode }), 'join')
const noTicketsYet = await p1.client.rpc('create_ticket', { p_pool_id: pool.id, p_round_id: r1.id, p_idempotency_key: randomUUID() })
rec('SET1 antes de habilitar tickets no se emiten', Boolean(noTicketsYet.error), code(noTicketsYet))
const memberEnable = await p1.client.rpc('enable_pool_tickets', { p_pool_id: pool.id })
rec('SET2 un jugador no habilita tickets', code(memberEnable) === '42501', code(memberEnable))
const enabled = must(await owner.client.rpc('enable_pool_tickets', { p_pool_id: pool.id, p_default_max: 1 }), 'enable')
rec('SET3 el organizador habilita tickets: 2 jornadas vendibles', enabled === 2, String(enabled))
must(await owner.client.rpc('configure_pool_round', { p_pool_id: pool.id, p_round_id: r1.id, p_max: 3 }), 'configure')
const classic = await p1.client.rpc('save_prediction', { p_pool_id: pool.id, p_match_id: m1.id, p_home_score: 1, p_away_score: 0 })
rec('SET4 el pronóstico clásico queda cerrado en una quiniela con tickets', code(classic) === '42501', code(classic))
const adminTicket = await owner.client.rpc('create_ticket', { p_pool_id: pool.id, p_round_id: r1.id, p_idempotency_key: randomUUID() })
rec('SET5 el administrador no crea tickets en su quiniela', code(adminTicket) === '42501', code(adminTicket))

// ---- Concurrencia -------------------------------------------------------------------------------------------------
const burst = await settle(Array.from({ length: 8 }, () => p1.client.rpc('create_ticket', { p_pool_id: pool.id, p_round_id: r1.id, p_idempotency_key: randomUUID() })))
const okN = burst.filter((r) => !r.error).length
const limitN = burst.filter((r) => r.error?.code === '42501').length
const dbCount = (must(await svc.from('tickets').select('id').eq('pool_id', pool.id).neq('status', 'cancelled').eq('participant_id', must(await svc.from('participants').select('id').eq('pool_id', pool.id).eq('profile_id', p1.id).single(), 'part').id), 'count')).length
rec('CON1 8 emisiones paralelas con límite 3: exactamente 3 tickets', okN === 3 && limitN === 5 && dbCount === 3, `ok=${okN} limite=${limitN} bd=${dbCount}`)

const sameKey = randomUUID()
const dup = await settle(Array.from({ length: 10 }, () => p2.client.rpc('create_ticket', { p_pool_id: pool.id, p_round_id: r1.id, p_idempotency_key: sameKey })))
const ids = new Set(dup.filter((r) => !r.error).map((r) => r.data.id))
rec('CON2 10 emisiones paralelas con la MISMA clave: un solo ticket para todas', dup.every((r) => !r.error) && ids.size === 1, `ids=${ids.size}`)

const t3 = []
for (let i = 0; i < 3; i++) t3.push(must(await p3.client.rpc('create_ticket', { p_pool_id: pool.id, p_round_id: r1.id, p_idempotency_key: randomUUID() }), 'p3 ticket'))
const mixed = await settle([p3.client.rpc('cancel_ticket', { p_ticket_id: t3[0].id }), ...Array.from({ length: 4 }, () => p3.client.rpc('create_ticket', { p_pool_id: pool.id, p_round_id: r1.id, p_idempotency_key: randomUUID() }))])
const partId3 = must(await svc.from('participants').select('id').eq('pool_id', pool.id).eq('profile_id', p3.id).single(), 'part3').id
const live3 = must(await svc.from('tickets').select('id').eq('participant_id', partId3).neq('status', 'cancelled'), 'live3').length
rec('CON3 cancelar y emitir en paralelo nunca supera el límite (3 activos como máximo)', live3 <= 3 && !mixed[0].error, `activos=${live3}`)

const tk = [t3[1]]
const sel = await settle(Array.from({ length: 10 }, (_, i) => p3.client.rpc('save_ticket_prediction', { p_ticket_id: tk[0].id, p_match_id: m1.id, p_home_score: i, p_away_score: 0 })))
const rows = must(await svc.from('predictions').select('id, home_score').eq('ticket_id', tk[0].id), 'rows')
rec('CON4 10 guardados paralelos de la misma selección dejan UNA fila', sel.every((r) => !r.error) && rows.length === 1, `filas=${rows.length}`)

const t3b = must(await p3.client.rpc('save_ticket_prediction', { p_ticket_id: tk[0].id, p_match_id: m2.id, p_home_score: 1, p_away_score: 1 }), 'second selection')
const subs = await settle(Array.from({ length: 6 }, () => p3.client.rpc('submit_ticket', { p_ticket_id: tk[0].id })))
const subRow = must(await svc.from('tickets').select('status, eligibility, submitted_at').eq('id', tk[0].id).single(), 'sub')
rec('CON5 6 envíos paralelos del mismo ticket: todos ok y un único estado enviado/elegible', subs.every((r) => !r.error) && subRow.status === 'submitted' && subRow.eligibility === 'eligible' && Boolean(t3b.id), JSON.stringify(subRow))

// ---- Flujo del participante p1: dos tickets, mejor ticket -----------------------------------------------------------
const p1tickets = must(await p1.client.rpc('list_my_tickets', { p_pool_id: pool.id }), 'list')
rec('HIS1 el historial devuelve mis 3 tickets numerados 1..3', p1tickets.length === 3 && p1tickets.map((t) => t.display_no).sort().join() === '1,2,3', JSON.stringify(p1tickets.map((t) => t.display_no)))
const [a, b] = p1tickets
must(await p1.client.rpc('save_ticket_prediction', { p_ticket_id: a.ticket_id, p_match_id: m1.id, p_home_score: 2, p_away_score: 1 }), 'a1')
must(await p1.client.rpc('save_ticket_prediction', { p_ticket_id: a.ticket_id, p_match_id: m2.id, p_home_score: 1, p_away_score: 1 }), 'a2')
must(await p1.client.rpc('save_ticket_prediction', { p_ticket_id: b.ticket_id, p_match_id: m1.id, p_home_score: 2, p_away_score: 1 }), 'b1')
must(await p1.client.rpc('save_ticket_prediction', { p_ticket_id: b.ticket_id, p_match_id: m2.id, p_home_score: 0, p_away_score: 0 }), 'b2')
must(await p1.client.rpc('submit_ticket', { p_ticket_id: a.ticket_id }), 'submit a')
must(await p1.client.rpc('submit_ticket', { p_ticket_id: b.ticket_id }), 'submit b')
const sneak = await p2.client.rpc('save_ticket_prediction', { p_ticket_id: a.ticket_id, p_match_id: m1.id, p_home_score: 9, p_away_score: 9 })
rec('SEC1 nadie escribe en el ticket de otro', code(sneak) === '42501', code(sneak))
const peek = must(await p2.client.from('predictions').select('id').eq('ticket_id', a.ticket_id), 'peek')
rec('SEC2 ni lee sus selecciones antes del cierre', peek.length === 0)
const peekT = must(await p2.client.from('tickets').select('id').eq('id', a.ticket_id), 'peekT')
rec('SEC3 ni ve su ticket', peekT.length === 0)
const outsider = await user('tke-out')
const outCreate = await outsider.client.rpc('create_ticket', { p_pool_id: pool.id, p_round_id: r1.id, p_idempotency_key: randomUUID() })
rec('SEC4 un usuario ajeno no emite', code(outCreate) === '42501', code(outCreate))

// ---- Cierre por el servidor y resultados ---------------------------------------------------------------------------
must(await svc.rpc('apply_fixture_update', { p_match_id: m1.id, p_starts_at: new Date(Date.now() - 120_000).toISOString(), p_status: 'live' }), 'sync m1')
must(await svc.rpc('apply_fixture_update', { p_match_id: m2.id, p_starts_at: new Date(Date.now() - 60_000).toISOString(), p_status: 'live' }), 'sync m2')
const late = await p4.client.rpc('create_ticket', { p_pool_id: pool.id, p_round_id: r1.id, p_idempotency_key: randomUUID() })
rec('LK1 cerrada la jornada el servidor rechaza emitir', code(late) === '42501', code(late))
const lateCancel = await p1.client.rpc('cancel_ticket', { p_ticket_id: a.ticket_id })
rec('LK2 y cancelar un ticket enviado', code(lateCancel) === '42501', code(lateCancel))
const lateSave = await p1.client.rpc('save_ticket_prediction', { p_ticket_id: a.ticket_id, p_match_id: m1.id, p_home_score: 5, p_away_score: 5 })
rec('LK3 y editar un partido bloqueado', code(lateSave) === '42501', code(lateSave))
const revealed = must(await p2.client.from('predictions').select('id').eq('ticket_id', a.ticket_id), 'reveal')
rec('LK4 tras el cierre las selecciones de los demás son visibles', revealed.length === 2, `visibles=${revealed.length}`)
must(await owner.client.rpc('publish_official_result', { p_match_id: m1.id, p_home_score: 2, p_away_score: 1, p_expected_revision: 0 }), 'result 1')
must(await owner.client.rpc('publish_official_result', { p_match_id: m2.id, p_home_score: 0, p_away_score: 0, p_expected_revision: 0 }), 'result 2')
const board = must(await p4.client.rpc('pool_leaderboard', { p_pool_id: pool.id }), 'board')
const byName = Object.fromEntries(board.map((r) => [r.display_name, Number(r.points)]))
rec('RK1 la clasificación usa el MEJOR ticket (p1: 10, no la suma 17)', byName['tke-p1'] === 10, JSON.stringify(byName))
const tboard = must(await p4.client.rpc('pool_ticket_leaderboard', { p_pool_id: pool.id, p_round_id: r1.id }), 'tboard')
rec('RK2 el ranking por ticket lista las jugadas elegibles y marca la mejor de cada jugador', tboard.length >= 3 && tboard[0].display_name === 'tke-p1' && Number(tboard[0].points) === 10 && tboard[0].is_best === true, JSON.stringify(tboard.slice(0, 2).map((r) => [r.display_name, Number(r.points), r.is_best])))
rec('RK3 el organizador no figura en la clasificación', !board.some((r) => r.display_name === 'tke-owner'))
const mine = must(await p1.client.rpc('list_my_tickets', { p_pool_id: pool.id }), 'mine')
const best = mine.filter((t) => t.is_best)
rec('HIS2 el historial marca un único mejor ticket por jornada con sus puntos', best.length === 1 && Number(best[0].points) === 10, JSON.stringify(mine.map((t) => [t.display_no, t.status, t.points, t.is_best])))
const stats = must(await p1.client.rpc('my_pool_stats', { p_pool_id: pool.id }), 'stats')
rec('RK4 las estadísticas del jugador coinciden (#1, 10 pts)', stats[0]?.rank === 1 && Number(stats[0]?.points) === 10, JSON.stringify(stats[0]))

console.log(`\nTenant sintético: ${tag}`)
const failed = results.filter((r) => !r.ok).length
console.log(`${results.length - failed}/${results.length} PASS`)
process.exitCode = failed ? 1 : 0
