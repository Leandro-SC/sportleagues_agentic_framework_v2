// Preparación mínima de datos en QA (idempotente) para la UAT de navegador. Todo por la API con sesión de usuario (mismas RPC que la app),
// salvo el adelanto del inicio de un partido (apply_fixture_update, entrada del sincronizador; igual que el E2E de ciclo de vida).
//   - Una jornada "UAT R…" con 2 partidos futuros en la quiniela de qa-requester (modo tickets) para probar tickets desde cero:
//     la jornada del E2E ya está cerrada (su primer partido empezó), así que no admite tickets nuevos.
//   - Un partido futuro en la quiniela clásica de qa-admin-b (auto-fill y pronóstico del organizador como participante).
const MIN = 60_000

export async function ensureFreshRound({ identities, svc }, D) {
  const rq = identities.requester
  const pm = (await svc.from('pool_matches').select('match_id, lock_at').eq('pool_id', D.pool.id)).data ?? []
  const matches = (await svc.from('matches').select('id, round_id, tournament_id, home_team_id, away_team_id, starts_at, status').in('id', pm.map((p) => p.match_id))).data ?? []
  const rounds = (await svc.from('rounds').select('id, name, sort_order, tournament_id').in('id', [...new Set(matches.map((m) => m.round_id))])).data ?? []
  const uat = rounds.filter((r) => r.name.startsWith('UAT R')).find((r) => {
    const ms = pm.filter((p) => matches.find((m) => m.id === p.match_id)?.round_id === r.id)
    return ms.length >= 2 && ms.every((p) => new Date(p.lock_at).getTime() > Date.now() + 90 * MIN)
  })
  if (uat) return { round: uat, created: false }
  const base = matches[0]
  const teams = [...new Set(matches.flatMap((m) => [m.home_team_id, m.away_team_id]))].slice(0, 3)
  // El orden es único por torneo: contar TODAS sus jornadas (b1 crea «UAT Jornada …» desde la parrilla sin añadirla a la quiniela).
  const allRounds = (await svc.from('rounds').select('sort_order').eq('tournament_id', base.tournament_id)).data ?? rounds
  const next = Math.max(0, ...allRounds.map((r) => r.sort_order)) + 1
  const name = `UAT R${Date.now().toString(36).slice(-4)}`
  const round = (await rq.client.rpc('upsert_round', { p_tournament_id: base.tournament_id, p_round_id: null, p_name: name, p_sort_order: next })).data
  if (!round?.id) throw new Error('prep: no se pudo crear la jornada UAT')
  for (const [i, [h, a]] of [[teams[0], teams[1]], [teams[1], teams[2] ?? teams[0]]].entries()) {
    const m = await rq.client.rpc('upsert_match', { p_tournament_id: base.tournament_id, p_match_id: null, p_round_id: round.id, p_home_team_id: h, p_away_team_id: a, p_starts_at: new Date(Date.now() + (8 + i) * 60 * MIN).toISOString() })
    if (m.error) throw new Error(`prep upsert_match: ${m.error.message}`)
    const sp = await rq.client.rpc('set_pool_match', { p_pool_id: D.pool.id, p_match_id: m.data.id, p_included: true })
    if (sp.error) throw new Error(`prep set_pool_match: ${sp.error.message}`)
  }
  const en = await rq.client.rpc('enable_pool_tickets', { p_pool_id: D.pool.id, p_default_max: 2 })
  if (en.error) throw new Error(`prep enable_pool_tickets: ${en.error.message}`)
  return { round, created: true }
}

export async function ensurePoolBOpenMatch({ identities, svc }, D) {
  const ab = identities.adminB
  const pm = (await svc.from('pool_matches').select('match_id, lock_at').eq('pool_id', D.poolB.id)).data ?? []
  const open = pm.filter((p) => new Date(p.lock_at).getTime() > Date.now() + 60 * MIN)
  if (open.length) return { matchId: open[0].match_id, created: false }
  const matches = (await svc.from('matches').select('id, round_id, tournament_id, home_team_id, away_team_id').in('id', pm.map((p) => p.match_id))).data ?? []
  const base = matches[0]
  const m = await ab.client.rpc('upsert_match', { p_tournament_id: base.tournament_id, p_match_id: null, p_round_id: base.round_id, p_home_team_id: base.home_team_id, p_away_team_id: base.away_team_id, p_starts_at: new Date(Date.now() + 5 * 60 * MIN).toISOString() })
  if (m.error) throw new Error(`prep B upsert_match: ${m.error.message}`)
  const sp = await ab.client.rpc('set_pool_match', { p_pool_id: D.poolB.id, p_match_id: m.data.id, p_included: true })
  if (sp.error) throw new Error(`prep B set_pool_match: ${sp.error.message}`)
  return { matchId: m.data.id, created: true }
}
