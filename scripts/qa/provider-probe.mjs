#!/usr/bin/env node
// Sonda REAL del adaptador API-Football (ADR-016). Consume cuota del plan: ~4 solicitudes. NO toca la base de datos.
// Lee la clave de API_FOOTBALL_SPORT_TEST (.env.local) o API_FOOTBALL_KEY; jamás la imprime.
// Uso: node scripts/qa/provider-probe.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createApiFootballProvider } from '../../supabase/functions/_shared/sports/api-football.ts'

const ROOT = resolve(import.meta.dirname, '..', '..')
function readKey() {
  if (process.env.API_FOOTBALL_KEY) return process.env.API_FOOTBALL_KEY
  for (const file of ['.env.local', 'apps/platform/.env.local']) {
    try {
      const line = readFileSync(resolve(ROOT, file), 'utf8').split(/\r?\n/).find((l) => /^API_FOOTBALL_(SPORT_TEST|KEY)=/.test(l))
      if (line) return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')
    } catch { /* archivo ausente */ }
  }
  return undefined
}

const apiKey = readKey()
if (!apiKey) { console.log('BLOCKED: no hay clave configurada (API_FOOTBALL_KEY / API_FOOTBALL_SPORT_TEST).'); process.exit(3) }

let used = 0
const attempts = []
const provider = createApiFootballProvider({
  apiKey,
  plan: process.env.API_FOOTBALL_PLAN === 'paid' ? 'paid' : 'free',
  gate: async () => { used += 1; return used <= 6 }, // tope duro de la sonda
  onAttempt: (a) => attempts.push(`${a.path}:${a.status}`),
})

const results = []
async function step(name, fn) {
  try { const detail = await fn(); results.push({ name, ok: true, detail }); console.log(`PASS ${name} — ${detail}`) }
  catch (error) { results.push({ name, ok: false, detail: error.code ?? String(error) }); console.log(`${error.code ? 'DEGRADED' : 'FAIL'} ${name} — ${error.code ?? error.message}`) }
}

await step('P1 buscar competiciones ("premier league")', async () => {
  const found = await provider.searchCompetitions('premier league')
  const pl = found.find((c) => c.external_id === '39')
  if (!pl || !pl.seasons.length) throw new Error('Premier League (39) no aparece')
  return `${found.length} competiciones; PL con ${pl.seasons.length} temporadas`
})
let sample = []
await step('P2 temporada completa 2023 de la liga 39 (1 solicitud)', async () => {
  const fixtures = await provider.getSeasonFixtures('39', 2023)
  if (fixtures.length < 300) throw new Error(`solo ${fixtures.length} partidos`)
  const finals = fixtures.filter((f) => f.state === 'final')
  if (finals.some((f) => f.home_goals === null)) throw new Error('final sin marcador')
  sample = finals.slice(0, 3).map((f) => f.external_id)
  const rounds = new Set(fixtures.map((f) => f.round))
  return `${fixtures.length} partidos, ${rounds.size} jornadas, ${finals.length} finales con marcador a 90'`
})
await step('P3 partidos en juego (live=all, 1 solicitud; el plan gratuito no admite ids)', async () => {
  const live = await provider.getLiveFixtures()
  return `${live.length} partidos en juego en el mundo; ids soportado: ${provider.supportsIdsLookup}`
})
await step('P4 temporada fuera del plan gratuito (degradación esperada)', async () => {
  try { await provider.getSeasonFixtures('39', 2025); return 'el plan permite 2025 (sin restricción)' }
  catch (error) { if (error.code === 'PLAN_RESTRICTED') return 'PLAN_RESTRICTED detectado y mapeado'; throw error }
})
console.log(`\nSolicitudes consumidas por la sonda: ${used}. Intentos HTTP: ${attempts.join(', ')}`)
process.exit(results.some((r) => !r.ok && !/^(PLAN_RESTRICTED|RATE_LIMITED)$/.test(r.detail)) ? 1 : 0)
