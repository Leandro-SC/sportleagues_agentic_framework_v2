#!/usr/bin/env node
// Construye la SEMILLA del catálogo deportivo central a partir de Wikidata (datos estructurados CC0). Reproducible: ids estables (Q-ids),
// orden determinista, sin claves ni contratos. No descarga imágenes: los escudos de clubes NO tienen una fuente libre autorizada
// (ADR-009/016) y las banderas se sirven desde el paquete MIT `flag-icons` (ver scripts/catalog/vendor-flags.mjs).
// Uso: node scripts/catalog/build-catalog.mjs   → escribe supabase/seed/catalog/catalog-wikidata.json
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..', '..')
const OUT = resolve(ROOT, 'supabase/seed/catalog/catalog-wikidata.json')
const UA = 'SportLeaguesCatalogBuilder/1.0 (lsilvac@ipesa.com.pe)'
const SEASON_YEAR = 2026

// Q-id verificado → etiqueta esperada (se comprueba contra Wikidata; si no coincide, el proceso aborta).
const DOMESTIC = [
  ['Q9448', /premier league/i, 'Premier League', 'GB-ENG', 'Inglaterra', ['EPL', 'Primera de Inglaterra']],
  ['Q324867', /la liga|primera/i, 'LaLiga', 'ES', 'España', ['Primera División de España', 'La Liga']],
  ['Q15804', /serie a/i, 'Serie A', 'IT', 'Italia', []],
  ['Q82595', /bundesliga/i, 'Bundesliga', 'DE', 'Alemania', []],
  ['Q13394', /ligue 1/i, 'Ligue 1', 'FR', 'Francia', []],
  ['Q182994', /liga|primeira/i, 'Primeira Liga', 'PT', 'Portugal', ['Liga Portugal']],
  ['Q167541', /eredivisie/i, 'Eredivisie', 'NL', 'Países Bajos', []],
  ['Q14377162', /scottish premiership/i, 'Scottish Premiership', 'GB-SCT', 'Escocia', []],
  ['Q216022', /pro league|jupiler/i, 'Pro League de Bélgica', 'BE', 'Bélgica', ['Jupiler Pro League']],
  ['Q485568', /s[uü]per lig/i, 'Süper Lig', 'TR', 'Turquía', ['Super Lig']],
  ['Q606652', /peruvian primera/i, 'Liga 1 de Perú', 'PE', 'Perú', ['Liga 1', 'Primera División de Perú', 'Liga 1 Betsson', 'Torneo Descentralizado']],
  ['Q764690', /liga mx/i, 'Liga MX', 'MX', 'México', ['Primera División de México']],
  ['Q206813', /brasileiro|s[eé]rie a/i, 'Brasileirão Série A', 'BR', 'Brasil', ['Campeonato Brasileiro Série A']],
  ['Q223170', /argentine primera/i, 'Liga Profesional de Argentina', 'AR', 'Argentina', ['Primera División de Argentina']],
  ['Q1033349', /categor[ií]a primera a|primera a/i, 'Liga BetPlay (Categoría Primera A)', 'CO', 'Colombia', ['Primera A Colombia', 'Liga Colombiana']],
  ['Q606832', /chilean primera/i, 'Primera División de Chile', 'CL', 'Chile', ['Campeonato Nacional']],
  ['Q287453', /uruguayan primera/i, 'Primera División de Uruguay', 'UY', 'Uruguay', ['Campeonato Uruguayo']],
  ['Q2289847', /ecuador.*serie a|serie a.*ecuador|ecuadorian/i, 'LigaPro Ecuador (Serie A)', 'EC', 'Ecuador', ['LigaPro']],
  ['Q954911', /paraguayan primera/i, 'Primera División de Paraguay', 'PY', 'Paraguay', []],
  ['Q1622667', /bolivian|boliviano|primera divisi[oó]n de bolivia/i, 'Primera División de Bolivia', 'BO', 'Bolivia', ['Liga del Fútbol Profesional Boliviano']],
  ['Q18543', /major league soccer/i, 'Major League Soccer', 'US', 'Estados Unidos', ['MLS']],
]
// Competiciones internacionales: solo la entidad (sin lista de participantes: no hay fuente libre fiable y no se inventa).
const INTERNATIONAL = [
  ['Q18756', /champions league/i, 'UEFA Champions League', 'continental', 'cup', ['Champions League', 'Liga de Campeones']],
  ['Q18760', /europa league/i, 'UEFA Europa League', 'continental', 'cup', ['Europa League', 'Liga Europa']],
  ['Q59365764', /conference league/i, 'UEFA Conference League', 'continental', 'cup', ['Conference League']],
  ['Q184795', /libertadores/i, 'Copa Libertadores', 'continental', 'cup', ['CONMEBOL Libertadores']],
  ['Q60585', /sudamericana/i, 'Copa Sudamericana', 'continental', 'cup', ['CONMEBOL Sudamericana']],
  ['Q223366', /club world cup/i, 'Copa Mundial de Clubes FIFA', 'world', 'cup', ['FIFA Club World Cup', 'Mundial de Clubes']],
  ['Q19317', /world cup/i, 'Copa Mundial de la FIFA', 'world', 'cup', ['FIFA World Cup', 'Mundial']],
  ['Q178750', /copa am[eé]rica/i, 'Copa América', 'continental', 'cup', ['CONMEBOL Copa América']],
  ['Q260858', /european (football )?championship|euro/i, 'Eurocopa', 'continental', 'cup', ['UEFA European Championship', 'Euro']],
]
// País (Q-id) de cada liga nacional, para el complemento de clubes por país.
const COUNTRY_Q = { 'GB-ENG': 'Q21', 'ES': 'Q29', IT: 'Q38', DE: 'Q183', FR: 'Q142', PT: 'Q45', NL: 'Q55', 'GB-SCT': 'Q22', BE: 'Q31', TR: 'Q43', PE: 'Q419', MX: 'Q96', BR: 'Q155',
  AR: 'Q414', CO: 'Q739', CL: 'Q298', UY: 'Q77', EC: 'Q736', PY: 'Q733', BO: 'Q750', US: 'Q30' }
const CONFEDERATIONS = { UEFA: 'Q35572', CONMEBOL: 'Q58733', CONCACAF: 'Q160549', AFC: 'Q83276', CAF: 'Q168360', OFC: 'Q180344' }
// Subdivisiones del Reino Unido con bandera propia (Wikidata no les da ISO 3166-1).
const UK = { Q21: ['GB-ENG', 'England', 'Inglaterra'], Q22: ['GB-SCT', 'Scotland', 'Escocia'], Q25: ['GB-WLS', 'Wales', 'Gales'], Q26: ['GB-NIR', 'Northern Ireland', 'Irlanda del Norte'] }

const JUNK = /reserves?|academy|\bB team\b|women|femenino|feminino|\(\d{4}/i
function displayName(label) {
  const trimmed = label.replace(/\s+(F\.C\.|A\.F\.C\.|FC|CF|C\.F\.)$/, '').replace(/^Club\s+(?=\S{3,})/, '').trim()
  return trimmed || label
}
const UK_BY_CODE = Object.fromEntries(Object.values(UK).map(([code, en]) => [code, en]))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function fetchJson(url, attempt = 0) {
  const response = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/sparql-results+json, application/json' } })
  if ((response.status === 429 || response.status >= 500) && attempt < 3) { await sleep(2000 * (attempt + 1)); return fetchJson(url, attempt + 1) }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url.slice(0, 80)}`)
  return response.json()
}
const sparql = async (query) => { await sleep(700); return (await fetchJson('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query))).results.bindings }
const qid = (uri) => uri.split('/').pop()

async function labels(ids) {
  const data = await fetchJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels&languages=en|es|mul&ids=${ids.join('|')}`)
  return Object.fromEntries(Object.entries(data.entities).map(([id, e]) => [id, { en: e.labels?.en?.value ?? e.labels?.mul?.value ?? '', es: e.labels?.es?.value ?? e.labels?.mul?.value ?? '' }]))
}

async function main() {
  const allIds = [...DOMESTIC.map((d) => d[0]), ...INTERNATIONAL.map((d) => d[0])]
  const lab = {}
  for (let i = 0; i < allIds.length; i += 40) Object.assign(lab, await labels(allIds.slice(i, i + 40)))
  const bad = [...DOMESTIC.map((d) => [d[0], d[1]]), ...INTERNATIONAL.map((d) => [d[0], d[1]])].filter(([id, rx]) => !(rx.test(lab[id]?.en ?? '') || rx.test(lab[id]?.es ?? '')))
  if (bad.length) throw new Error('Q-id con etiqueta inesperada: ' + bad.map(([id]) => `${id}="${lab[id]?.en}"`).join(', '))

  const teams = new Map()
  const competitions = []
  const countries = new Map()
  const addCountry = (code, en, es, confederation) => {
    const prev = countries.get(code)
    countries.set(code, { code, name_en: en || prev?.name_en || code, name_es: es || prev?.name_es || en || code, confederation: confederation ?? prev?.confederation ?? null })
  }

  // 1) Selecciones nacionales por confederación (miembros de la confederación según Wikidata)
  for (const [conf, id] of Object.entries(CONFEDERATIONS)) {
    const rows = await sparql(`SELECT DISTINCT ?c ?en ?es ?iso WHERE { ?a wdt:P463 wd:${id} . ?a wdt:P17 ?c . FILTER NOT EXISTS { ?c wdt:P576 ?d }
      OPTIONAL { ?c wdt:P297 ?iso } OPTIONAL { ?c rdfs:label ?en FILTER(LANG(?en)="en") } OPTIONAL { ?c rdfs:label ?es FILTER(LANG(?es)="es") } }`)
    for (const row of rows) {
      const c = qid(row.c.value)
      const uk = UK[c]
      const code = uk ? uk[0] : row.iso?.value
      const en = uk ? uk[1] : row.en?.value
      const es = uk ? uk[2] : row.es?.value
      if (!code || !en) continue
      addCountry(code, en, es, conf)
      const key = `NT:${c}`
      if (!teams.has(key)) teams.set(key, { external_id: key, name: es || en, official_name: null, kind: 'national', country_code: code, country_name: es || en, aliases: [...new Set([en, code])] })
    }
    console.log(`  ${conf}: ${rows.length} filas`)
  }

  for (const [c, [code, en, es]] of Object.entries(UK)) {
    addCountry(code, en, es, 'UEFA')
    teams.set(`NT:${c}`, { external_id: `NT:${c}`, name: es, official_name: null, kind: 'national', country_code: code, country_name: es, aliases: [en, code] })
  }

  // 2) Ligas nacionales: clubes vigentes (P118 sin fecha de fin, no disueltos)
  for (const [id, , name, cc, countryEs, aliases] of DOMESTIC) {
    const rows = await sparql(`SELECT DISTINCT ?c ?en ?es ?country WHERE { ?c p:P118 ?st . ?st ps:P118 wd:${id} . ?c wdt:P31/wdt:P279* wd:Q476028 .
      FILTER NOT EXISTS { ?st pq:P582 ?end } FILTER NOT EXISTS { ?c wdt:P576 ?d } ?c wikibase:sitelinks ?sl FILTER(?sl >= 6)
      OPTIONAL { ?c wdt:P17 ?country } OPTIONAL { ?c rdfs:label ?en FILTER(LANG(?en)="en") } OPTIONAL { ?c rdfs:label ?es FILTER(LANG(?es)="es") } }`)
    const members = []
    for (const row of rows) {
      const c = qid(row.c.value)
      const label = row.en?.value ?? row.es?.value
      if (!label || /^Q\d+$/.test(label) || JUNK.test(label)) continue
      const country = row.country ? qid(row.country.value) : null
      const club_cc = country && UK[country] ? UK[country][0] : cc
      const clean = displayName(label)
      if (!teams.has(c)) teams.set(c, { external_id: c, name: clean, official_name: clean !== label ? label : null, kind: 'club', country_code: club_cc, country_name: countryEs, aliases: row.es?.value && row.es.value !== label ? [row.es.value] : [] })
      members.push(c)
    }
    addCountry(cc, UK_BY_CODE[cc] ?? null, countryEs, null)
    // Complemento: clubes más conocidos del país aunque Wikidata no los liste en la liga (búsqueda y selección manual).
    const extra = await sparql(`SELECT DISTINCT ?c ?en ?es ?sl WHERE { ?c wdt:P31/wdt:P279* wd:Q476028 . ?c wdt:P17 wd:${COUNTRY_Q[cc]} . FILTER NOT EXISTS { ?c wdt:P576 ?d } ?c wikibase:sitelinks ?sl FILTER(?sl >= 8)
      OPTIONAL { ?c rdfs:label ?en FILTER(LANG(?en)="en") } OPTIONAL { ?c rdfs:label ?es FILTER(LANG(?es)="es") } } ORDER BY DESC(?sl) LIMIT 90`)
    let added = 0
    for (const row of extra) {
      const c = qid(row.c.value)
      const label = row.en?.value ?? row.es?.value
      if (!label || /^Q\d+$/.test(label) || JUNK.test(label) || teams.has(c)) continue
      const clean = displayName(label)
      teams.set(c, { external_id: c, name: clean, official_name: clean !== label ? label : null, kind: 'club', country_code: cc, country_name: countryEs, aliases: row.es?.value && row.es.value !== label ? [row.es.value] : [] })
      added += 1
    }
    console.log(`  +${added} clubes de ${cc} (complemento por país)`)
    competitions.push({ external_id: id, name, kind: 'league', scope: 'domestic', country_code: cc, country_name: countryEs, sport: 'football',
      aliases: [...new Set([lab[id].en, ...aliases])].filter((a) => a && a !== name), season: { year: SEASON_YEAR, start: null, end: null, current: true }, team_ids: [...new Set(members)].sort() })
    console.log(`  ${name}: ${members.length} clubes`)
  }
  for (const [id, , name, scope, kind, aliases] of INTERNATIONAL) {
    competitions.push({ external_id: id, name, kind, scope, country_code: null, country_name: null, sport: 'football',
      aliases: [...new Set([lab[id].en, ...aliases])].filter((a) => a && a !== name), season: { year: SEASON_YEAR, start: null, end: null, current: true }, team_ids: [] })
  }

  // Deduplicación global: dos Q-ids con el mismo nombre/país/tipo son el mismo equipo. Se conserva el que figura en más ligas y, si empata, el de Q menor.
  const norm = (value) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
  const memberships = new Map()
  for (const comp of competitions) for (const id of comp.team_ids) memberships.set(id, (memberships.get(id) ?? 0) + 1)
  const groups = new Map()
  for (const team of teams.values()) {
    const key = `${team.kind}|${norm(team.name)}|${team.country_code}`
    groups.set(key, [...(groups.get(key) ?? []), team])
  }
  const remap = new Map()
  for (const group of groups.values()) {
    if (group.length < 2) continue
    group.sort((a, b) => (memberships.get(b.external_id) ?? 0) - (memberships.get(a.external_id) ?? 0) || Number(a.external_id.replace(/\D/g, '')) - Number(b.external_id.replace(/\D/g, '')))
    for (const loser of group.slice(1)) { remap.set(loser.external_id, group[0].external_id); teams.delete(loser.external_id) }
  }
  for (const comp of competitions) comp.team_ids = [...new Set(comp.team_ids.map((id) => remap.get(id) ?? id))].sort()
  console.log(`  deduplicados: ${remap.size}`)

  const num = (id) => Number(String(id).replace(/\D/g, ''))
  const sortedTeams = [...teams.values()].sort((a, b) => a.kind.localeCompare(b.kind) || num(a.external_id) - num(b.external_id))
  const catalog = {
    source: { key: 'wikidata', name: 'Wikidata', license: 'CC0 1.0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
      attribution: 'Datos estructurados de Wikidata (CC0). Pertenencia de clubes a ligas según el estado de Wikidata en la fecha de carga; puede no coincidir con la temporada vigente.',
      version: new Date().toISOString().slice(0, 10) },
    countries: [...countries.values()].sort((a, b) => a.code.localeCompare(b.code)),
    competitions: competitions.sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name)),
    teams: sortedTeams,
  }
  mkdirSync(resolve(ROOT, 'supabase/seed/catalog'), { recursive: true })
  writeFileSync(OUT, JSON.stringify(catalog, null, 1) + '\n', 'utf8')
  const nat = sortedTeams.filter((t) => t.kind === 'national').length
  console.log(`OK: ${catalog.countries.length} países, ${nat} selecciones, ${sortedTeams.length - nat} clubes, ${catalog.competitions.length} competiciones → ${OUT}`)
}
main().catch((error) => { console.error('FALLO:', error.message); process.exit(1) })
