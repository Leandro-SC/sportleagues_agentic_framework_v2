// Descubre (solo lectura, por la API con sesión de usuario) los datos que la UAT de navegador necesita en QA:
//   - la quiniela activa más reciente del tenant de qa-requester (modo tickets, con partidos y qa-user1/qa-user2 aprobados)
//   - la quiniela activa más reciente de qa-admin-b
// Nunca imprime contraseñas ni claves. Los ids son UUID sintéticos de QA.
export async function discover({ identities, svc }) {
  const { requester: rq, adminB: ab, user1: u1, user2: u2 } = identities
  const mem = (await rq.client.from('tenant_memberships').select('tenant_id, role, is_active').eq('profile_id', rq.id)).data ?? []
  const tenant = mem.find((m) => m.is_active && ['owner', 'admin'].includes(m.role))?.tenant_id ?? null
  const memB = (await ab.client.from('tenant_memberships').select('tenant_id, role, is_active').eq('profile_id', ab.id)).data ?? []
  const tenantB = memB.find((m) => m.is_active && ['owner', 'admin'].includes(m.role))?.tenant_id ?? null
  const out = { tenant, tenantB, pool: null, poolB: null, matches: [], notes: [] }
  if (!tenant) { out.notes.push('qa-requester no es organizador: ejecutar node scripts/qa/e2e/full-lifecycle.mjs'); return out }
  const pools = (await rq.client.from('pools').select('id, name, status, ticketing_mode, created_at').eq('tenant_id', tenant).in('status', ['open', 'paused']).order('created_at', { ascending: false })).data ?? []
  out.pool = pools.find((p) => p.ticketing_mode === 'tickets') ?? pools[0] ?? null
  if (out.pool) {
    const pm = (await svc.from('pool_matches').select('id, match_id, lock_at').eq('pool_id', out.pool.id)).data ?? []
    const ids = pm.map((p) => p.match_id)
    const matches = ids.length ? ((await svc.from('matches').select('id, starts_at, status, round_id, home_team_id, away_team_id').in('id', ids)).data ?? []) : []
    out.matches = pm.map((p) => ({ ...p, ...(matches.find((m) => m.id === p.match_id) ?? {}) }))
    const parts = (await svc.from('participants').select('profile_id, approval_status').eq('pool_id', out.pool.id)).data ?? []
    out.u1Approved = parts.some((p) => p.profile_id === u1.id && p.approval_status === 'approved')
    out.u2Approved = parts.some((p) => p.profile_id === u2.id && p.approval_status === 'approved')
    out.openMatches = out.matches.filter((m) => m.status === 'scheduled' && new Date(m.lock_at).getTime() > Date.now() + 60_000).length
    out.liveOrFinal = out.matches.filter((m) => m.status !== 'scheduled').length
  }
  if (tenantB) {
    const poolsB = (await ab.client.from('pools').select('id, name, status, ticketing_mode, created_at').eq('tenant_id', tenantB).in('status', ['open', 'paused']).order('created_at', { ascending: false })).data ?? []
    out.poolB = poolsB[0] ?? null
  }
  const plan = tenant ? ((await rq.client.from('tenant_entitlements').select('plan_code').eq('tenant_id', tenant)).data ?? [])[0]?.plan_code : null
  out.plan = plan
  // Estado de la solicitud de qa-user2 (cooldown)
  const reqs = (await u2.client.from('pool_creation_requests').select('status, reviewed_at').order('requested_at', { ascending: false })).data ?? []
  out.u2Request = reqs[0] ?? null
  const reqs1 = (await u1.client.from('pool_creation_requests').select('status').order('requested_at', { ascending: false })).data ?? []
  out.u1Request = reqs1[0] ?? null
  return out
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const { ensureQaIdentities } = await import('../lib/qa-identities.mjs')
  const ctx = await ensureQaIdentities()
  const d = await discover(ctx)
  console.log(JSON.stringify(d, null, 2))
}
