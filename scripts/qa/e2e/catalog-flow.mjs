#!/usr/bin/env node
// E2E REAL contra Supabase QA del catálogo compartido y los resultados híbridos (ADR-016 revisión). Sesiones de usuario con supabase-js
// (mismas RPC/RLS que la app). Usa el catálogo REAL cargado en QA (Wikidata) y datos sintéticos etiquetados para tenants/usuarios.
//   QA_OWNER_AUTHORIZED=yes node scripts/qa/e2e/catalog-flow.mjs
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

const tag = `CAE-${randomUUID().slice(0, 8)}`
const [owner, p1, p2, outsider, owner2] = await Promise.all(['cae-owner', 'cae-p1', 'cae-p2', 'cae-out', 'cae-owner2'].map(user))
const tenant = must(await svc.from('tenants').insert({ name: tag, timezone: 'America/Lima' }).select('id').single(), 'tenant').id
const tenant2 = must(await svc.from('tenants').insert({ name: `${tag}-B` }).select('id').single(), 'tenant2').id
must(await svc.from('tenant_entitlements').insert([{ tenant_id: tenant, plan_code: 'pro' }, { tenant_id: tenant2, plan_code: 'free' }]), 'entitlements')
must(await svc.from('tenant_memberships').insert([{ tenant_id: tenant, profile_id: owner.id, role: 'owner' }, { tenant_id: tenant2, profile_id: owner2.id, role: 'owner' }]), 'memberships')

// ---- Catálogo global: lectura, búsqueda y deduplicación ---------------------------------------------------------
const anon = createClient(url, key('anon'), opts)
const anonRead = await anon.from('catalog_teams').select('id').limit(1)
rec('CAT1 un anónimo no lee el catálogo', Boolean(anonRead.error) || (anonRead.data ?? []).length === 0, code(anonRead))
const teamCount = await owner.client.from('catalog_teams').select('id', { count: 'exact', head: true })
rec('CAT2 un usuario autenticado lee el catálogo precargado (≥1000 equipos)', (teamCount.count ?? 0) >= 1000, `equipos=${teamCount.count}`)
const compCount = await owner.client.from('catalog_competitions').select('id', { count: 'exact', head: true })
rec('CAT3 hay competiciones precargadas (≥25)', (compCount.count ?? 0) >= 25, `competiciones=${compCount.count}`)
const write = await owner.client.from('catalog_teams').insert({ provider: 'x', external_id: '1', name: 'Falso' })
rec('CAT4 un organizador no escribe en el catálogo global', Boolean(write.error), code(write))
const upd = await owner.client.from('catalog_teams').update({ name: 'Hack' }).eq('kind', 'club').select('id')
rec('CAT5 un organizador no modifica el catálogo global', Boolean(upd.error) || (upd.data ?? []).length === 0, code(upd))
const dupes = must(await svc.rpc('catalog_normalize', { p_text: 'x' }), 'norm')
rec('CAT6 la normalización de búsqueda es accesible', dupes === 'x')
const search = must(await owner.client.rpc('search_catalog_teams', { p_query: 'cristal', p_kind: 'club', p_country: 'PE' }), 'search')
rec('CAT7 búsqueda "cristal" de clubes de Perú encuentra Sporting Cristal', search.some((t) => /sporting cristal/i.test(t.name)), JSON.stringify(search.map((t) => t.name)))
const natPe = must(await owner.client.rpc('search_catalog_teams', { p_query: 'peru', p_kind: 'national' }), 'natPe')
rec('CAT8 búsqueda "peru" de selecciones encuentra la selección de Perú (sin acento)', natPe.some((t) => t.country_code === 'PE'), JSON.stringify(natPe.map((t) => t.name)))
const page1 = must(await owner.client.rpc('search_catalog_teams', { p_limit: 25, p_offset: 0 }), 'p1')
const page2 = must(await owner.client.rpc('search_catalog_teams', { p_limit: 25, p_offset: 25 }), 'p2')
rec('CAT9 paginación: dos páginas de 25 sin solaparse y con total', page1.length === 25 && page2.length === 25 && !page1.some((a) => page2.some((b) => b.id === a.id)) && Number(page1[0].total) >= 1000, `total=${page1[0]?.total}`)
const comps = must(await owner.client.rpc('search_catalog_competitions', { p_query: 'liga 1' }), 'comps')
const liga1 = comps.find((c) => c.country_code === 'PE')
rec('CAT10 la Liga 1 de Perú existe con sus participantes', Boolean(liga1) && Number(liga1.team_count) >= 10, JSON.stringify(liga1))
const inLeague = must(await owner.client.rpc('search_catalog_teams', { p_competition_id: liga1.id, p_limit: 50 }), 'league teams')
rec('CAT11 filtrar por competición devuelve sus equipos', inLeague.length === Number(liga1.team_count), `${inLeague.length}/${liga1.team_count}`)
const dupRows = must(await svc.rpc('catalog_normalize', { p_text: 'Perú' }), 'n2')
rec('CAT12 "Perú" se normaliza como "peru"', dupRows === 'peru')

// ---- Importación de equipos al torneo del organizador -----------------------------------------------------------------
const tour = must(await owner.client.rpc('upsert_tournament', { p_tenant_id: tenant, p_tournament_id: null, p_name: 'Liga E2E catálogo', p_sport_code: 'football', p_season_label: '2026' }), 'tournament')
const tour2 = must(await owner2.client.rpc('upsert_tournament', { p_tenant_id: tenant2, p_tournament_id: null, p_name: 'Torneo B', p_sport_code: 'football' }), 'tournament2')
const pick = inLeague.slice(0, 4).map((t) => t.id)
const nat = must(await owner.client.rpc('search_catalog_teams', { p_kind: 'national', p_country: 'BR' }), 'brazil')
const imp1 = await owner.client.rpc('import_catalog_teams', { p_tournament_id: tour.id, p_team_ids: [...pick, nat[0].id] })
rec('IMP1 el organizador incorpora 4 clubes y 1 selección del catálogo', !imp1.error && imp1.data.enrolled === 5, JSON.stringify(imp1.data ?? imp1.error))
const imp2 = await owner.client.rpc('import_catalog_teams', { p_tournament_id: tour.id, p_team_ids: [...pick, nat[0].id] })
rec('IMP2 repetir la importación es idempotente (0 nuevos, 5 ya inscritos)', !imp2.error && imp2.data.enrolled === 0 && imp2.data.already_enrolled === 5, JSON.stringify(imp2.data ?? imp2.error))
const myTeams = must(await owner.client.from('teams').select('id, name, kind, country_code').eq('tenant_id', tenant), 'myTeams')
rec('IMP3 el tenant tiene exactamente 5 equipos (sin duplicados) y la selección conserva tipo y país', myTeams.length === 5 && myTeams.some((t) => t.kind === 'national' && t.country_code === 'BR'), JSON.stringify(myTeams.map((t) => t.name)))
const enrolled = must(await owner.client.from('tournament_teams').select('team_id').eq('tournament_id', tour.id), 'enrolled')
rec('IMP4 los 5 quedan inscritos en el torneo', enrolled.length === 5)
const refs = must(await owner.client.from('external_refs').select('external_id, entity_type').eq('tenant_id', tenant).eq('entity_type', 'team'), 'refs')
rec('IMP5 cada equipo queda vinculado al catálogo por external_refs', refs.length === 5)
const forbid1 = await p1.client.rpc('import_catalog_teams', { p_tournament_id: tour.id, p_team_ids: pick })
rec('IMP6 un participante no importa equipos', code(forbid1) === '42501', code(forbid1))
const forbid2 = await owner2.client.rpc('import_catalog_teams', { p_tournament_id: tour.id, p_team_ids: pick })
rec('IMP7 el organizador de otro tenant no importa en un torneo ajeno', code(forbid2) === '42501', code(forbid2))
const own2 = await owner2.client.rpc('import_catalog_teams', { p_tournament_id: tour2.id, p_team_ids: pick })
const t2teams = must(await owner2.client.from('teams').select('id').eq('tenant_id', tenant), 'cross teams')
rec('IMP8 otro tenant reutiliza el MISMO catálogo con copias propias y no ve los equipos del primero', !own2.error && own2.data.enrolled === 4 && t2teams.length === 0, JSON.stringify(own2.data ?? own2.error))
const tooMany = await owner.client.rpc('import_catalog_teams', { p_tournament_id: tour.id, p_team_ids: Array.from({ length: 61 }, () => randomUUID()) })
rec('IMP9 más de 60 por solicitud se rechaza', code(tooMany) === '22023', code(tooMany))

// ---- Partidos manuales con equipos importados + resultados manuales (modo manual) --------------------------------------------
const homeId = myTeams.find((t) => t.kind === 'club').id
const awayId = myTeams.filter((t) => t.kind === 'club')[1].id
const round = must(await owner.client.rpc('upsert_round', { p_tournament_id: tour.id, p_round_id: null, p_name: 'Fecha 1', p_sort_order: 1 }), 'round')
const m1 = must(await owner.client.rpc('upsert_match', { p_tournament_id: tour.id, p_match_id: null, p_round_id: round.id, p_home_team_id: homeId, p_away_team_id: awayId, p_starts_at: new Date(Date.now() + 40 * 60_000).toISOString() }), 'match')
rec('MAN1 el organizador crea el partido manualmente con equipos del catálogo', Boolean(m1.id))
const manualTeam = must(await owner.client.rpc('upsert_team', { p_tenant_id: tenant, p_team_id: null, p_name: 'Equipo Barrial Propio' }), 'manual team')
rec('MAN2 sigue pudiendo crear manualmente un equipo que falta', Boolean(manualTeam.id))
const pool = must(await owner.client.rpc('manage_pool', { p_action: 'create', p_pool_id: null, p_tenant_id: tenant, p_name: 'Quiniela catálogo', p_lock_offset_minutes: 15, p_requires_approval: false }), 'pool')
must(await owner.client.rpc('publish_pool_rules', { p_pool_id: pool.id, p_exact_points: 5, p_outcome_points: 2, p_tie_breaker: 'exact_predictions' }), 'rules')
must(await owner.client.rpc('manage_pool', { p_action: 'open', p_pool_id: pool.id, p_tenant_id: null, p_name: null, p_lock_offset_minutes: null, p_requires_approval: null }), 'open')
must(await owner.client.rpc('set_pool_match', { p_pool_id: pool.id, p_match_id: m1.id, p_included: true }), 'pool match')
const joinCode = must(await owner.client.rpc('create_pool_join_code', { p_pool_id: pool.id }), 'code').code
must(await p1.client.rpc('join_pool', { p_code: joinCode }), 'join p1')
must(await p2.client.rpc('join_pool', { p_code: joinCode }), 'join p2')
const s1 = await p1.client.rpc('save_prediction', { p_pool_id: pool.id, p_match_id: m1.id, p_home_score: 2, p_away_score: 1 })
const s2 = await p2.client.rpc('save_prediction', { p_pool_id: pool.id, p_match_id: m1.id, p_home_score: 1, p_away_score: 0 })
rec('MAN3 los participantes pronostican con equipos del catálogo', !s1.error && !s2.error)
must(await svc.rpc('apply_fixture_update', { p_match_id: m1.id, p_starts_at: new Date(Date.now() - 60_000).toISOString(), p_status: 'live' }), 'live')
const late = await p1.client.rpc('save_prediction', { p_pool_id: pool.id, p_match_id: m1.id, p_home_score: 9, p_away_score: 9 })
rec('MAN4 el lock del servidor sigue rechazando tras el inicio', code(late) === '42501', code(late))
const pub = await owner.client.rpc('publish_official_result', { p_match_id: m1.id, p_home_score: 2, p_away_score: 1, p_expected_revision: 0 })
rec('MAN5 el organizador publica el resultado manualmente', !pub.error, pub.error?.message)
const res = must(await owner.client.from('official_results').select('source, revision, published_by').eq('match_id', m1.id).single(), 'result')
rec('MAN6 el resultado queda como manual, revisión 1 y con autor', res.source === 'manual' && res.revision === 1 && res.published_by === owner.id)
const board = must(await p1.client.rpc('pool_leaderboard', { p_pool_id: pool.id }), 'board')
rec('MAN7 scoring y ranking automáticos (5 y 2 puntos)', board.length === 2 && Number(board[0].points) === 5 && Number(board[1].points) === 2, JSON.stringify(board.map((b) => Number(b.points))))
const fix = await owner.client.rpc('publish_official_result', { p_match_id: m1.id, p_home_score: 1, p_away_score: 0, p_expected_revision: 1 })
const board2 = must(await p1.client.rpc('pool_leaderboard', { p_pool_id: pool.id }), 'board2')
rec('MAN8 la corrección manual recalcula sin duplicar (p2 pasa a 5, p1 a 2)', !fix.error && Number(board2[0].points) === 5 && Number(board2[1].points) === 2 && board2[0].is_me === false, JSON.stringify(board2.map((b) => Number(b.points))))
const stale = await owner.client.rpc('publish_official_result', { p_match_id: m1.id, p_home_score: 3, p_away_score: 3, p_expected_revision: 1 })
rec('MAN9 una revisión esperada obsoleta se rechaza (409)', code(stale) === 'PT409', code(stale))

// ---- Modo de resultados: Premium deshabilitado -------------------------------------------------------------------------------
const tourRow = must(await owner.client.from('tournaments').select('results_mode').eq('id', tour.id).single(), 'tour')
rec('HYB1 el modo por defecto del torneo es manual', tourRow.results_mode === 'manual')
const autoPro = await owner.client.rpc('set_tournament_results_mode', { p_tournament_id: tour.id, p_mode: 'automatic' })
rec('HYB2 aunque el tenant sea PRO, el modo automático está bloqueado (Premium futuro apagado)', code(autoPro) === '42501', code(autoPro))
const tour2Auto = await owner2.client.rpc('set_tournament_results_mode', { p_tournament_id: tour2.id, p_mode: 'automatic' })
rec('HYB3 un tenant gratuito tampoco puede activarlo', code(tour2Auto) === '42501', code(tour2Auto))
const manualAgain = await owner.client.rpc('set_tournament_results_mode', { p_tournament_id: tour.id, p_mode: 'manual' })
rec('HYB4 el modo manual siempre se puede fijar', !manualAgain.error)
const direct = await owner.client.from('tournaments').update({ results_mode: 'automatic' }).eq('id', tour.id).select('id')
const after = must(await owner.client.from('tournaments').select('results_mode').eq('id', tour.id).single(), 'after')
rec('HYB5 no hay DML directo que active el modo automático', after.results_mode === 'manual' && (Boolean(direct.error) || (direct.data ?? []).length === 0))
const flag = must(await owner.client.from('platform_feature_flags').select('enabled').eq('key', 'auto_results').single(), 'flag')
rec('HYB6 el interruptor de plataforma auto_results está apagado', flag.enabled === false)
const canAuto = await owner.client.rpc('tenant_can_use_auto_results', { p_tenant_id: tenant })
rec('HYB7 la comprobación de disponibilidad responde false', canAuto.data === false)
const svcOnly = await owner.client.rpc('catalog_propagate_fixtures', { p_fixture_ids: [randomUUID()] })
rec('HYB8 los clientes no pueden invocar la propagación del proveedor', code(svcOnly) === '42501', code(svcOnly))
const seed = await owner.client.rpc('catalog_seed_load', { p_payload: { source: { key: 'x' } } })
rec('HYB9 los clientes no pueden cargar el catálogo', code(seed) === '42501', code(seed))
const quota = await owner.client.rpc('provider_consume', { p_provider: 'api_football', p_daily_limit: 1, p_n: 1 })
rec('HYB10 los clientes no gastan ni consultan la cuota del proveedor', code(quota) === '42501', code(quota))
const logLeak = must(await owner2.client.from('fixture_sync_log').select('id'), 'log')
rec('HYB11 la bitácora de sincronización no se filtra a otro tenant', logLeak.length === 0)

console.log(`\nTenant sintético: ${tag}`)
const failed = results.filter((r) => !r.ok).length
console.log(`${results.length - failed}/${results.length} PASS`)
process.exitCode = failed ? 1 : 0
