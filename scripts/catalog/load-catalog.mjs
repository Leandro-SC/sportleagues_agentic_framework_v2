#!/usr/bin/env node
// Carga la semilla del catálogo en el proyecto Supabase ENLAZADO (QA) mediante catalog_seed_load (idempotente; sin Docker; sin claves).
// Uso:
//   node scripts/catalog/load-catalog.mjs --check            valida la semilla localmente (sin tocar la base de datos)
//   node scripts/catalog/load-catalog.mjs                    carga/actualiza (recargar no duplica nada)
//   node scripts/catalog/load-catalog.mjs --verify           solo consulta conteos y duplicados en la base de datos
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..', '..')
const FILE = resolve(ROOT, 'supabase/seed/catalog/catalog-wikidata.json')
const args = new Set(process.argv.slice(2))
const catalog = JSON.parse(readFileSync(FILE, 'utf8'))

export function checkCatalog(c) {
  const errors = []
  const seen = (rows, key, label) => { const s = new Set(); for (const r of rows) { const k = key(r); if (s.has(k)) errors.push(`${label} duplicado: ${k}`); s.add(k) } }
  seen(c.teams, (t) => t.external_id, 'equipo (external_id)')
  seen(c.competitions, (x) => x.external_id, 'competición (external_id)')
  seen(c.countries, (x) => x.code, 'país')
  const ids = new Set(c.teams.map((t) => t.external_id))
  const codes = new Set(c.countries.map((x) => x.code))
  for (const t of c.teams) {
    if (!t.name || t.name.length > 120) errors.push(`nombre inválido: ${t.external_id}`)
    if (!['club', 'national'].includes(t.kind)) errors.push(`tipo inválido: ${t.external_id}`)
    if (!t.country_code || !codes.has(t.country_code)) errors.push(`país desconocido en ${t.external_id}: ${t.country_code}`)
  }
  for (const x of c.competitions) for (const id of x.team_ids) if (!ids.has(id)) errors.push(`participante inexistente ${id} en ${x.external_id}`)
  return errors
}

function runSql(sql) {
  const file = join(mkdtempSync(join(tmpdir(), 'sl-catalog-')), 'q.sql')
  writeFileSync(file, sql)
  const r = spawnSync('npx', ['supabase', 'db', 'query', '--linked', '-o', 'json', '-f', file], { cwd: ROOT, encoding: 'utf8', shell: true, maxBuffer: 1 << 26 })
  const out = (r.stdout || '') + (r.stderr || '')
  if (r.status !== 0 || /"error"|ERROR:/.test(out)) throw new Error('consulta fallida: ' + out.slice(0, 400))
  return out
}
const lit = (obj) => `$slcat$${JSON.stringify(obj)}$slcat$::jsonb`

if (args.has('--verify')) {
  const out = runSql(`select
    (select count(*) from public.catalog_teams where provider = 'wikidata') as teams,
    (select count(*) from (select external_id from public.catalog_teams where provider = 'wikidata' group by 1 having count(*) > 1) d) as dup_teams,
    (select count(*) from public.catalog_competitions where provider = 'wikidata') as competitions,
    (select count(*) from public.catalog_countries) as countries,
    (select count(*) from public.catalog_competition_teams) as memberships;`)
  console.log(out.trim().slice(0, 600))
  process.exit(0)
}

const errors = checkCatalog(catalog)
if (errors.length) { console.error('Semilla inválida:\n' + errors.slice(0, 20).join('\n')); process.exit(1) }
console.log(`Semilla válida: ${catalog.countries.length} países, ${catalog.teams.length} equipos, ${catalog.competitions.length} competiciones.`)
if (args.has('--check')) process.exit(0)

// Lotes: primero países + equipos (300 por lote), al final las competiciones (necesitan los equipos ya cargados).
const totals = { countries: 0, teams: 0, competitions: 0 }
const add = (out) => {
  const m = out.match(/"catalog_seed_load":\s*(\{[^}]*\})/) ?? out.match(/(\{"competitions"[^}]*\})/)
  if (m) { const j = JSON.parse(m[1]); for (const k of Object.keys(totals)) totals[k] += j[k] ?? 0 }
}
const base = { source: catalog.source }
add(runSql(`select public.catalog_seed_load(${lit({ ...base, countries: catalog.countries })});`))
for (let i = 0; i < catalog.teams.length; i += 300) add(runSql(`select public.catalog_seed_load(${lit({ ...base, teams: catalog.teams.slice(i, i + 300) })});`))
add(runSql(`select public.catalog_seed_load(${lit({ ...base, competitions: catalog.competitions })});`))
console.log('Cargado (filas procesadas):', JSON.stringify(totals))
