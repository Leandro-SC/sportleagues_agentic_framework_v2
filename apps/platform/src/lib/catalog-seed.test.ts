// Invariantes de la semilla del catálogo (supabase/seed/catalog/catalog-wikidata.json): sin duplicados, sin datos ficticios ni recursos
// de terceros, con procedencia/licencia y con las competiciones y selecciones prioritarias.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '../../../..')
type Team = { external_id: string; name: string; kind: 'club' | 'national'; country_code: string; official_name: string | null }
type Competition = { external_id: string; name: string; scope: string; country_code: string | null; team_ids: string[]; season: { year: number } }
type Seed = { source: Record<string, string>; countries: { code: string; confederation: string | null; name_es: string }[]; teams: Team[]; competitions: Competition[] }
const RAW = readFileSync(resolve(ROOT, 'supabase/seed/catalog/catalog-wikidata.json'), 'utf8')
const seed = JSON.parse(RAW) as Seed

describe('semilla del catálogo deportivo', () => {
  it('declara fuente, licencia libre y atribución', () => {
    expect(seed.source).toMatchObject({ key: 'wikidata', license: 'CC0 1.0' })
    expect(seed.source.license_url).toMatch(/^https:\/\//)
    expect(seed.source.attribution!.length).toBeGreaterThan(20)
  })

  it('no tiene duplicados por identificador estable', () => {
    const ids = seed.teams.map((t) => t.external_id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(seed.competitions.map((c) => c.external_id)).size).toBe(seed.competitions.length)
    expect(new Set(seed.countries.map((c) => c.code)).size).toBe(seed.countries.length)
  })

  it('no tiene el mismo equipo repetido bajo identificadores distintos (nombre+país+tipo)', () => {
    const norm = (v: string) => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
    const keys = seed.teams.map((t) => `${t.kind}|${norm(t.name)}|${t.country_code}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('todo equipo tiene país conocido y los participantes existen', () => {
    const codes = new Set(seed.countries.map((c) => c.code))
    const ids = new Set(seed.teams.map((t) => t.external_id))
    expect(seed.teams.every((t) => codes.has(t.country_code))).toBe(true)
    expect(seed.competitions.flatMap((c) => c.team_ids).every((id) => ids.has(id))).toBe(true)
  })

  it('incluye las ligas prioritarias de Europa y América (con Perú) y competiciones internacionales', () => {
    const names = seed.competitions.map((c) => c.name)
    for (const expected of ['Premier League', 'LaLiga', 'Serie A', 'Bundesliga', 'Ligue 1', 'Liga 1 de Perú', 'Liga MX', 'Brasileirão Série A', 'UEFA Champions League', 'Copa Libertadores', 'Copa Mundial de la FIFA']) expect(names).toContain(expected)
    const peru = seed.competitions.find((c) => c.name === 'Liga 1 de Perú')!
    expect(peru.team_ids.length).toBeGreaterThanOrEqual(10)
    expect(peru.country_code).toBe('PE')
  })

  it('incluye selecciones de las seis confederaciones, con subdivisiones del Reino Unido', () => {
    const nationals = seed.teams.filter((t) => t.kind === 'national')
    expect(nationals.length).toBeGreaterThan(150)
    for (const conf of ['UEFA', 'CONMEBOL', 'CONCACAF', 'AFC', 'CAF', 'OFC']) expect(seed.countries.some((c) => c.confederation === conf)).toBe(true)
    for (const code of ['GB-ENG', 'GB-SCT', 'GB-WLS', 'GB-NIR', 'PE', 'BR', 'AR']) expect(nationals.some((t) => t.country_code === code)).toBe(true)
  })

  it('no incluye escudos, logos ni URLs de terceros (sin licencia verificada)', () => {
    expect(RAW).not.toMatch(/https?:\/\/(?!creativecommons\.org)/)
    expect(RAW).not.toMatch(/"(logo|crest|image|flag)[a-z_]*"/i)
  })

  it('los nombres son utilizables (sin identificadores ni filas históricas/de reservas)', () => {
    for (const t of seed.teams) {
      expect(t.name).not.toMatch(/^Q\d+$/)
      expect(t.name).not.toMatch(/reserves?|academy|\(\d{4}/i)
      expect(t.name.length).toBeLessThanOrEqual(120)
    }
  })

  it('cada país del catálogo tiene su bandera vendorizada con licencia', () => {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, 'apps/platform/public/flags/manifest.json'), 'utf8')) as { codes: string[] }
    expect(seed.countries.every((c) => manifest.codes.includes(c.code))).toBe(true)
    expect(existsSync(resolve(ROOT, 'apps/platform/public/flags/LICENSE-flag-icons.txt'))).toBe(true)
    for (const code of ['pe', 'gb-eng']) expect(existsSync(resolve(ROOT, `apps/platform/public/flags/${code}.svg`))).toBe(true)
  })
})
