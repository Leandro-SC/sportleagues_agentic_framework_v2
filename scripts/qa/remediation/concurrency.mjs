#!/usr/bin/env node
// Pruebas de concurrencia (INC-C1…C4, R6, lock) con sesiones reales de usuarios sintéticos. CLASE C: SOLO proyecto Supabase
// descartable en la nube (sin Docker). Usa @supabase/supabase-js (ya instalado); no añade dependencias.
//
//   SCRATCH_URL=https://<ref>.supabase.co SCRATCH_ANON_KEY=... SCRATCH_SERVICE_ROLE_KEY=... SCRATCH_CONFIRM=DESTRUCTIVE \
//     node scripts/qa/remediation/concurrency.mjs [iteraciones=25]
//
// Las claves viven solo en variables de entorno locales del proyecto descartable; nunca se imprimen ni se guardan.
// Requiere 1/3, 2/3 y 3/3 aplicadas. Se rechaza si el host es el de QA o falta SCRATCH_CONFIRM=DESTRUCTIVE.
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const QA_REF = 'juoftaofzepxbrrxbkhx'
const url = process.env.SCRATCH_URL || ''
const anon = process.env.SCRATCH_ANON_KEY || ''
const service = process.env.SCRATCH_SERVICE_ROLE_KEY || ''
const iterations = Number(process.argv[2] || 25)
if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url) || !anon || !service) throw new Error('Faltan SCRATCH_URL / SCRATCH_ANON_KEY / SCRATCH_SERVICE_ROLE_KEY válidas.')
if (url.includes(QA_REF)) throw new Error('RECHAZADO: es el proyecto QA. QA nunca es entorno descartable.')
if (process.env.SCRATCH_CONFIRM !== 'DESTRUCTIVE') throw new Error('Falta SCRATCH_CONFIRM=DESTRUCTIVE.')

const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, service, opts)
const results = []
const rec = (id, ok, detail = '') => { results.push({ id, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${detail}`) }
const must = (res, what) => { if (res.error) throw new Error(`${what}: ${res.error.message}`); return res.data }

async function mkUser(label) {
  const email = `${label}-${randomUUID()}@example.test`
  const password = `Pw-${randomUUID()}`
  const created = must(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'createUser')
  const id = created.user.id
  must(await admin.from('profiles').insert({ id, display_name: label.slice(0, 40) }), 'profile')
  const client = createClient(url, anon, opts)
  must(await client.auth.signInWithPassword({ email, password }), 'signIn')
  return { id, client }
}

async function mkTenant(plan, members) {
  const t = must(await admin.from('tenants').insert({ name: `C-${randomUUID().slice(0, 8)}` }).select('id').single(), 'tenant')
  must(await admin.from('tenant_entitlements').insert({ tenant_id: t.id, plan_code: plan }), 'entitlement')
  must(await admin.from('tenant_memberships').insert(members.map(([u, role]) => ({ tenant_id: t.id, profile_id: u.id, role }))), 'memberships')
  return t.id
}

async function mkPool(tenantId, code, extraCodes = []) {
  const p = must(await admin.from('pools').insert({ tenant_id: tenantId, name: `P-${randomUUID().slice(0, 6)}`, status: 'open', lock_offset: '15 minutes' }).select('id').single(), 'pool')
  const codes = [code, ...extraCodes].map((c) => ({ tenant_id: tenantId, pool_id: p.id, code: c }))
  must(await admin.from('pool_join_codes').insert(codes), 'codes')
  return p.id
}

const code = () => randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()
const settle = (...p) => Promise.allSettled(p).then((r) => r.map((x) => (x.status === 'fulfilled' ? x.value : { error: { message: String(x.reason) } })))
const deadlock = (r) => /deadlock|40P01|serializ/i.test(r?.error?.message || '')

// INC-C1: inscripción vs. concesión de rol del mismo perfil en la misma quiniela
async function c1() {
  const owner = await mkUser('c1-owner')
  const tenant = await mkTenant('pro', [[owner, 'owner']])
  let both = 0, neither = 0, dead = 0
  for (let i = 0; i < iterations; i++) {
    const u = await mkUser('c1-u')
    must(await admin.from('tenant_memberships').insert({ tenant_id: tenant, profile_id: u.id, role: 'member' }), 'membership')
    const c = code()
    const pool = await mkPool(tenant, c)
    const [j, a] = await settle(u.client.rpc('join_pool', { p_code: c }), owner.client.rpc('assign_pool_staff', { p_pool_id: pool, p_profile_id: u.id, p_role: 'pool_manager' }))
    if (deadlock(j) || deadlock(a)) dead++
    const part = (await admin.from('participants').select('id').eq('pool_id', pool).eq('profile_id', u.id)).data?.length ?? 0
    const staff = (await admin.from('pool_staff').select('id').eq('pool_id', pool).eq('profile_id', u.id).eq('is_active', true)).data?.length ?? 0
    if (part > 0 && staff > 0) both++
    if (part === 0 && staff === 0) neither++
  }
  rec('INC-C1 nunca participante y colaborador a la vez', both === 0, `${iterations} iteraciones, violaciones=${both}`)
  rec('INC-C1b siempre gana exactamente una operación', neither === 0, `ninguna ganó=${neither}`)
  rec('INC-C1c sin deadlocks', dead === 0, `deadlocks=${dead}`)
}

// INC-C2: rol de tenant (admin) concedido mientras el perfil se inscribe en dos quinielas
async function c2() {
  const owner = await mkUser('c2-owner')
  const tenant = await mkTenant('pro', [[owner, 'owner']])
  let bad = 0, dead = 0
  for (let i = 0; i < iterations; i++) {
    const v = await mkUser('c2-v')
    must(await admin.from('tenant_memberships').insert({ tenant_id: tenant, profile_id: v.id, role: 'member' }), 'membership')
    const ca = code(), cb = code()
    const pa = await mkPool(tenant, ca), pb = await mkPool(tenant, cb)
    const res = await settle(
      v.client.rpc('join_pool', { p_code: ca }), v.client.rpc('join_pool', { p_code: cb }),
      admin.from('tenant_memberships').update({ role: 'admin' }).eq('tenant_id', tenant).eq('profile_id', v.id))
    if (res.some(deadlock)) dead++
    const m = (await admin.from('tenant_memberships').select('role').eq('tenant_id', tenant).eq('profile_id', v.id).single()).data
    const parts = (await admin.from('participants').select('id').in('pool_id', [pa, pb]).eq('profile_id', v.id)).data?.length ?? 0
    if (m?.role === 'admin' && parts > 0) bad++
  }
  rec('INC-C2 estado final consistente (admin del tenant ⇒ sin participaciones)', bad === 0, `violaciones=${bad}/${iterations}`)
  rec('INC-C2b sin deadlocks entre varias quinielas', dead === 0, `deadlocks=${dead}`)
}

// R6: límite Free con varios códigos activos
async function c3() {
  const owner = await mkUser('c3-owner')
  const tenant = await mkTenant('free', [[owner, 'owner']])
  const [c1c, c2c] = [code(), code()]
  const pool = await mkPool(tenant, c1c, [c2c])
  const users = []
  for (let i = 0; i < 16; i++) users.push(await mkUser('c3-u'))
  await settle(...users.map((u, i) => u.client.rpc('join_pool', { p_code: i % 2 ? c1c : c2c })))
  const n = (await admin.from('participants').select('id').eq('pool_id', pool)).data?.length ?? -1
  rec('R6 el plan Free admite exactamente 10 participantes con códigos concurrentes', n === 10, `participantes=${n} (esperado 10 de 16)`)
}

// INC-C4: revocaciones/transferencias cruzadas en administración por quiniela (modelo 'pool': el owner del tenant no gestiona)
async function c4() {
  const owner = await mkUser('c4-owner')
  const a = await mkUser('c4-a'), b = await mkUser('c4-b'), t1 = await mkUser('c4-t1'), t2 = await mkUser('c4-t2')
  const tenant = await mkTenant('pro', [[owner, 'owner'], [a, 'member'], [b, 'member'], [t1, 'member'], [t2, 'member']])
  must(await admin.from('tenants').update({ pool_admin_model: 'pool' }).eq('id', tenant), 'switch model')
  let bad = 0, dead = 0
  const n = Math.min(iterations, 15)
  for (let i = 0; i < n; i++) {
    const pool = await mkPool(tenant, code())
    must(await admin.from('pool_staff').insert([
      { tenant_id: tenant, pool_id: pool, profile_id: a.id, role: 'pool_owner' }, { tenant_id: tenant, pool_id: pool, profile_id: b.id, role: 'pool_owner' }]), 'seed staff')
    const res = await settle(
      a.client.rpc('revoke_pool_staff', { p_pool_id: pool, p_profile_id: b.id }), b.client.rpc('revoke_pool_staff', { p_pool_id: pool, p_profile_id: a.id }),
      a.client.rpc('transfer_pool_administration', { p_pool_id: pool, p_from: a.id, p_to: t1.id }), b.client.rpc('transfer_pool_administration', { p_pool_id: pool, p_from: b.id, p_to: t2.id }))
    if (res.some(deadlock)) dead++
    const owners = (await admin.from('pool_staff').select('id').eq('pool_id', pool).eq('role', 'pool_owner').eq('is_active', true)).data?.length ?? 0
    if (owners < 1) bad++
  }
  rec('INC-C4 la quiniela conserva ≥ 1 pool_owner tras operaciones cruzadas', bad === 0, `violaciones=${bad}/${n}`)
  rec('INC-C4b sin deadlocks', dead === 0, `deadlocks=${dead}`)
}

// Lock: guardados en paralelo mientras el partido pasa a live (sync legítimo)
async function c5() {
  const owner = await mkUser('c5-owner'), p = await mkUser('c5-p')
  const tenant = await mkTenant('pro', [[owner, 'owner'], [p, 'member']])
  const c = code()
  const pool = await mkPool(tenant, c)
  const tour = must(await admin.from('tournaments').insert({ tenant_id: tenant, name: 'T' }).select('id').single(), 'tour')
  const th = must(await admin.from('teams').insert({ tenant_id: tenant, name: 'H' }).select('id').single(), 'team h')
  const ta = must(await admin.from('teams').insert({ tenant_id: tenant, name: 'A' }).select('id').single(), 'team a')
  const rd = must(await admin.from('rounds').insert({ tenant_id: tenant, tournament_id: tour.id, name: 'R', sort_order: 1 }).select('id').single(), 'round')
  const m = must(await admin.from('matches').insert({ tenant_id: tenant, tournament_id: tour.id, round_id: rd.id, home_team_id: th.id, away_team_id: ta.id, starts_at: new Date(Date.now() + 3600_000).toISOString() }).select('id').single(), 'match')
  const pm = must(await admin.from('pool_matches').insert({ tenant_id: tenant, pool_id: pool, match_id: m.id }).select('id,lock_at').single(), 'pool_match')
  must(await p.client.rpc('join_pool', { p_code: c }), 'join')
  const saves = Array.from({ length: 20 }, (_, i) => p.client.rpc('save_prediction', { p_pool_id: pool, p_match_id: m.id, p_home_score: i % 5, p_away_score: 1 }))
  const live = admin.rpc('apply_fixture_update', { p_match_id: m.id, p_status: 'live' })
  await settle(...saves, live)
  const lock = (await admin.from('pool_matches').select('lock_at').eq('id', pm.id).single()).data.lock_at
  const preds = (await admin.from('predictions').select('updated_at').eq('pool_match_id', pm.id)).data ?? []
  const late = preds.filter((x) => new Date(x.updated_at).getTime() > new Date(lock).getTime()).length
  // LIMITACIÓN: updated_at = now() (inicio de la transacción), no el instante de escritura; esta comprobación solo detecta casos gruesos.
  // La carrera exacta (FOR SHARE) se verifica con la prueba manual de dos sesiones del informe de remediación.
  rec('LOCK ningún pronóstico se guarda después del lock tras un cambio a live (comprobación gruesa)', late === 0, `tardíos=${late}, lock_at=${lock}`)
  const after = await p.client.rpc('save_prediction', { p_pool_id: pool, p_match_id: m.id, p_home_score: 9, p_away_score: 9 })
  rec('LOCK tras live el guardado se rechaza', Boolean(after.error), after.error?.code ?? 'sin error')
}

const only = process.env.ONLY ? process.env.ONLY.split(',') : null
for (const [name, fn] of [['c1', c1], ['c2', c2], ['c3', c3], ['c4', c4], ['c5', c5]]) {
  if (only && !only.includes(name)) continue
  try { await fn() } catch (e) { rec(`${name.toUpperCase()} ERROR`, false, String(e.message || e).slice(0, 300)) }
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} PASS`)
process.exitCode = failed ? 1 : 0
