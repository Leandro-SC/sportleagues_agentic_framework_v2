#!/usr/bin/env node
// E2E REAL contra Supabase QA (sesiones de usuario con supabase-js, mismas RPC/RLS que la app). No es una prueba unitaria.
// Aprovisiona un tenant sintético con service_role (equivale al provisioning de plataforma, que no tiene RPC) y ejecuta TODO lo demás
// como usuarios autenticados. Deja datos sintéticos etiquetados (E2E-xxxxxxxx / @example.test): anotar cada ejecución en
// docs/operations/QA-SYNTHETIC-RESIDUE.md. Claves: se leen de la CLI en memoria; nunca se imprimen ni se guardan.
//   QA_OWNER_AUTHORIZED=yes node scripts/qa/e2e/mvp-flow.mjs
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

async function user(label) {
  const email = `${label}-${randomUUID()}@example.test`
  const password = `Pw-${randomUUID()}`
  const id = must(await svc.auth.admin.createUser({ email, password, email_confirm: true }), 'createUser').user.id
  must(await svc.from('profiles').insert({ id, display_name: label.slice(0, 40) }), 'profile')
  const client = createClient(url, key('anon'), opts)
  must(await client.auth.signInWithPassword({ email, password }), 'signIn')
  return { id, client }
}

const tag = `E2E-${randomUUID().slice(0, 8)}`
const [owner, p1, p2, outsider, owner2] = await Promise.all(['e2e-owner', 'e2e-p1', 'e2e-p2', 'e2e-out', 'e2e-owner2'].map(user))
const tenant = must(await svc.from('tenants').insert({ name: tag, timezone: 'America/Lima' }).select('id').single(), 'tenant').id
const tenant2 = must(await svc.from('tenants').insert({ name: `${tag}-B` }).select('id').single(), 'tenant2').id
must(await svc.from('tenant_entitlements').insert([{ tenant_id: tenant, plan_code: 'pro' }, { tenant_id: tenant2, plan_code: 'pro' }]), 'entitlements')
must(await svc.from('tenant_memberships').insert([{ tenant_id: tenant, profile_id: owner.id, role: 'owner' }, { tenant_id: tenant2, profile_id: owner2.id, role: 'owner' }]), 'memberships')

// ---- Administración (sesión del organizador) ----------------------------------------------------------------
const tour = must(await owner.client.rpc('upsert_tournament', { p_tenant_id: tenant, p_tournament_id: null, p_name: 'Liga E2E', p_sport_code: 'football', p_season_label: '2026' }), 'tournament')
rec('ADM1 el organizador crea el torneo por RPC', Boolean(tour.id))
const denied = await p1.client.rpc('upsert_tournament', { p_tenant_id: tenant, p_tournament_id: null, p_name: 'No' })
rec('ADM2 un no-miembro no crea torneos', code(denied) === '42501', code(denied))
const teamIds = []
for (const n of ['Local FC', 'Visita FC', 'Tercero FC']) {
  const t = must(await owner.client.rpc('upsert_team', { p_tenant_id: tenant, p_team_id: null, p_name: n }), 'team')
  must(await owner.client.rpc('set_tournament_team', { p_tournament_id: tour.id, p_team_id: t.id, p_enrolled: true }), 'enrol')
  teamIds.push(t.id)
}
const round = must(await owner.client.rpc('upsert_round', { p_tournament_id: tour.id, p_round_id: null, p_name: 'Fecha 1', p_sort_order: 1 }), 'round')
const startsAt = new Date(Date.now() + 40 * 60_000).toISOString() // lock en 25 min (offset 15)
const m1 = must(await owner.client.rpc('upsert_match', { p_tournament_id: tour.id, p_match_id: null, p_round_id: round.id, p_home_team_id: teamIds[0], p_away_team_id: teamIds[1], p_starts_at: startsAt }), 'match')
const m2 = must(await owner.client.rpc('upsert_match', { p_tournament_id: tour.id, p_match_id: null, p_round_id: round.id, p_home_team_id: teamIds[1], p_away_team_id: teamIds[2], p_starts_at: new Date(Date.now() + 3 * 3600_000).toISOString() }), 'match2')
rec('ADM3 el organizador programa partidos', Boolean(m1.id && m2.id))
const crossTeam = await owner.client.rpc('upsert_match', { p_tournament_id: tour.id, p_match_id: null, p_round_id: round.id, p_home_team_id: teamIds[0], p_away_team_id: randomUUID(), p_starts_at: startsAt })
rec('ADM4 un equipo ajeno/no inscrito se rechaza', Boolean(crossTeam.error), code(crossTeam))
const pool = must(await owner.client.rpc('manage_pool', { p_action: 'create', p_pool_id: null, p_tenant_id: tenant, p_name: 'Quiniela E2E', p_lock_offset_minutes: 15, p_requires_approval: false }), 'pool')
must(await owner.client.rpc('publish_pool_rules', { p_pool_id: pool.id, p_exact_points: 5, p_outcome_points: 2, p_tie_breaker: 'exact_predictions' }), 'rules')
must(await owner.client.rpc('manage_pool', { p_action: 'open', p_pool_id: pool.id, p_tenant_id: null, p_name: null, p_lock_offset_minutes: null, p_requires_approval: null }), 'open')
for (const m of [m1, m2]) must(await owner.client.rpc('set_pool_match', { p_pool_id: pool.id, p_match_id: m.id, p_included: true }), 'pool match')
const joinCode = must(await owner.client.rpc('create_pool_join_code', { p_pool_id: pool.id }), 'code').code
rec('ADM5 quiniela abierta con reglas, partidos y código de unión', Boolean(joinCode))

// ---- Participante ----------------------------------------------------------------------------------------------
const adminJoin = await owner.client.rpc('join_pool', { p_code: joinCode })
rec('INC1 el administrador NO puede inscribirse en su quiniela', Boolean(adminJoin.error), adminJoin.error?.hint ?? code(adminJoin))
must(await p1.client.rpc('join_pool', { p_code: joinCode }), 'join p1')
must(await p2.client.rpc('join_pool', { p_code: joinCode }), 'join p2')
rec('PAR1 dos jugadores se inscriben con el código', true)
const again = await p1.client.rpc('join_pool', { p_code: joinCode })
rec('PAR2 inscribirse dos veces es idempotente', !again.error)
const fixture = must(await p1.client.from('pool_matches').select('id, match_id, lock_at').eq('pool_id', pool.id), 'fixture')
rec('PAR3 el jugador ve la parrilla con el lock calculado por el servidor', fixture.length === 2 && fixture.every((f) => f.lock_at))
const s1 = await p1.client.rpc('save_prediction', { p_pool_id: pool.id, p_match_id: m1.id, p_home_score: 2, p_away_score: 1 })
const s2 = await p2.client.rpc('save_prediction', { p_pool_id: pool.id, p_match_id: m1.id, p_home_score: 1, p_away_score: 0 })
rec('PAR4 los jugadores guardan pronósticos antes del cierre', !s1.error && !s2.error, s1.error?.message ?? s2.error?.message)
const edit = await p1.client.rpc('save_prediction', { p_pool_id: pool.id, p_match_id: m1.id, p_home_score: 3, p_away_score: 1 })
rec('PAR5 editar antes del cierre es posible', !edit.error)
const mine = must(await p1.client.from('predictions').select('id, home_score').eq('pool_id', pool.id), 'mine')
rec('PAR6 el jugador solo ve SU pronóstico antes del cierre (una fila, valor editado)', mine.length === 1 && mine[0].home_score === 3, `filas=${mine.length}`)
const outsiderRead = must(await outsider.client.from('predictions').select('id'), 'out')
rec('SEC1 un usuario ajeno no lee pronósticos', outsiderRead.length === 0)
const other = must(await owner2.client.from('pool_matches').select('id').eq('pool_id', pool.id), 'cross')
rec('SEC2 el organizador de otro tenant no ve la parrilla', other.length === 0)
const crossSave = await outsider.client.rpc('save_prediction', { p_pool_id: pool.id, p_match_id: m1.id, p_home_score: 1, p_away_score: 1 })
rec('SEC3 un no-participante no pronostica', code(crossSave) === '42501', code(crossSave))
const crossPublish = await owner2.client.rpc('publish_official_result', { p_match_id: m1.id, p_home_score: 9, p_away_score: 9, p_expected_revision: 0 })
rec('SEC4 el admin de otro tenant no publica resultados', code(crossPublish) === '42501', code(crossPublish))

// ---- Lock y resultados -----------------------------------------------------------------------------------------
must(await svc.rpc('apply_fixture_update', { p_match_id: m1.id, p_starts_at: new Date(Date.now() - 60_000).toISOString(), p_status: 'live' }), 'sync live')
const late = await p1.client.rpc('save_prediction', { p_pool_id: pool.id, p_match_id: m1.id, p_home_score: 9, p_away_score: 9 })
rec('LOCK1 tras el cierre el servidor rechaza guardar', code(late) === '42501', code(late))
const pm1 = fixture.find((f) => f.match_id === m1.id).id
const pm2 = fixture.find((f) => f.match_id === m2.id).id
const revealed = must(await p1.client.from('predictions').select('participant_id').eq('pool_match_id', pm1), 'reveal')
rec('LOCK2 tras el cierre se revelan los pronósticos de los demás', revealed.length === 2, `visibles=${revealed.length}`)
const hidden = must(await p1.client.from('predictions').select('id').eq('pool_match_id', pm2), 'hidden')
rec('LOCK3 los de un partido aún abierto siguen ocultos', hidden.length === 0)
const pub = await owner.client.rpc('publish_official_result', { p_match_id: m1.id, p_home_score: 3, p_away_score: 1, p_expected_revision: 0 })
rec('RES1 el organizador publica el resultado oficial', !pub.error, pub.error?.message)
const ev = must(await p1.client.from('scoring_events').select('points, result_revision, prediction_id'), 'events')
rec('RES2 se calculan los puntos (exacto 5 / signo 2)', ev.length === 2 && ev.map((e) => e.points).sort().join() === '2,5', JSON.stringify(ev.map((e) => e.points)))
const board = must(await p1.client.rpc('pool_leaderboard', { p_pool_id: pool.id }), 'leaderboard')
rec('TAB1 la tabla ordena por puntos (5 > 2), excluye al organizador y marca al jugador', board.length === 2 && board[0].rank === 1 && Number(board[0].points) === 5 && board[0].is_me === true && Number(board[1].points) === 2, JSON.stringify(board.map((b) => [b.rank, Number(b.points), b.is_me])))
const boardOut = await outsider.client.rpc('pool_leaderboard', { p_pool_id: pool.id })
rec('TAB2 un usuario ajeno no lee la tabla', code(boardOut) === '42501', code(boardOut))
const again2 = await owner.client.rpc('publish_official_result', { p_match_id: m1.id, p_home_score: 3, p_away_score: 1, p_expected_revision: 1 })
const ev2 = must(await p1.client.from('scoring_events').select('id'), 'ev2')
rec('RES3 republicar es idempotente (sin puntos duplicados)', !again2.error && ev2.length === 2)
const fix = await owner.client.rpc('publish_official_result', { p_match_id: m1.id, p_home_score: 0, p_away_score: 0, p_expected_revision: 1 })
const ev3 = must(await p1.client.from('scoring_events').select('result_revision, points'), 'ev3')
rec('RES4 la corrección recalcula (revisión 2, conserva la 1)', !fix.error && ev3.filter((e) => e.result_revision === 2).every((e) => e.points === 0) && ev3.length === 4)
const stale = await owner.client.rpc('publish_official_result', { p_match_id: m1.id, p_home_score: 1, p_away_score: 1, p_expected_revision: 1 })
rec('RES5 una revisión obsoleta se rechaza', code(stale) === 'PT409', JSON.stringify(stale.error))
const memberPub = await p1.client.rpc('publish_official_result', { p_match_id: m1.id, p_home_score: 1, p_away_score: 1, p_expected_revision: 2 })
rec('RES6 un jugador no publica resultados', code(memberPub) === '42501', code(memberPub))

console.log(`\nTenant sintético: ${tag}`)
const failed = results.filter((r) => !r.ok).length
console.log(`${results.length - failed}/${results.length} PASS`)
process.exitCode = failed ? 1 : 0
