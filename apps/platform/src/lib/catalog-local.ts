import { cachedRead, type SwrResult } from './swr'
import { getOfflineCache, type OfflineCache } from './offline-cache'

// Catálogo deportivo global (ADR-016) con estrategia local-first: se sincroniza de forma incremental desde Supabase (nunca desde el
// proveedor), se guarda en IndexedDB en el espacio `public` (no contiene datos personales ni de tenants) y la búsqueda corre en memoria:
// instantánea, paginada y utilizable sin conexión. Los escudos de clubes no se descargan (sin licencia); las banderas son estáticas.
export const CATALOG_VERSION = 'catalog-v1' // subir al cambiar la forma del snapshot: invalida la caché local
export const CATALOG_TTL_MS = 24 * 3600 * 1000 // datos estables: revalidación diaria en segundo plano
const PAGE = 1000

export type CatalogTeam = { id: string; name: string; official_name: string | null; kind: 'club' | 'national'; country_code: string | null; search_name: string; updated_at: string }
export type CatalogCompetition = { id: string; name: string; kind: string; scope: 'domestic' | 'continental' | 'world'; country_code: string | null; search_name: string; updated_at: string }
export type CatalogSeason = { id: string; competition_id: string; year: number; is_current: boolean; updated_at: string }
export type CatalogCountry = { code: string; name_en: string; name_es: string; confederation: string | null; updated_at: string }
export type Membership = { season_id: string; team_id: string }

export type CatalogSnapshot = {
  teams: CatalogTeam[]
  competitions: CatalogCompetition[]
  seasons: CatalogSeason[]
  countries: CatalogCountry[]
  memberships: Membership[]
  cursors: { teams: string; competitions: string; seasons: string; countries: string }
}

export const EMPTY_SNAPSHOT: CatalogSnapshot = { teams: [], competitions: [], seasons: [], countries: [], memberships: [], cursors: { teams: '', competitions: '', seasons: '', countries: '' } }

type PageQuery = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> & {
  gte(column: string, value: string): PageQuery
  order(column: string, options?: { ascending: boolean }): PageQuery
  range(from: number, to: number): PageQuery
}
export type CatalogClient = { from(table: string): { select(columns: string): PageQuery } }

// Misma normalización que `public.catalog_normalize` en SQL (acentos, mayúsculas y signos).
export function normalizeSearch(text: string): string {
  return text.toLowerCase()
    .replace(/[áàâäãåā]/g, 'a').replace(/[éèêëē]/g, 'e').replace(/[íìîïī]/g, 'i').replace(/[óòôöõøō]/g, 'o').replace(/[úùûüū]/g, 'u')
    .replace(/ñ/g, 'n').replace(/ç/g, 'c').replace(/š/g, 's').replace(/ž/g, 'z').replace(/ł/g, 'l').replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ').trim()
}

async function pull<T extends { updated_at: string }>(client: CatalogClient, table: string, columns: string, cursor: string, tie: string): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    let query = client.from(table).select(columns)
    if (cursor) query = query.gte('updated_at', cursor)
    const { data, error } = await query.order('updated_at', { ascending: true }).order(tie, { ascending: true }).range(from, from + PAGE - 1)
    if (error) throw new Error('CATALOG_SYNC_FAILED') // sin texto de la base de datos en la UI
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

function merge<T>(previous: T[], incoming: (T & { updated_at: string })[], key: (row: T) => string): T[] {
  if (!incoming.length) return previous
  const map = new Map(previous.map((row) => [key(row), row]))
  for (const row of incoming) map.set(key(row), row)
  return [...map.values()]
}
const latest = (rows: { updated_at: string }[], fallback: string) => rows.reduce((max, row) => (row.updated_at > max ? row.updated_at : max), fallback)

// Sincronización incremental por `updated_at` (>= cursor; la unión por clave la hace idempotente). El catálogo no borra filas.
export async function syncCatalog(client: CatalogClient, previous: CatalogSnapshot | null): Promise<CatalogSnapshot> {
  const base = previous ?? EMPTY_SNAPSHOT
  const [teams, competitions, seasons, countries] = await Promise.all([
    pull<CatalogTeam>(client, 'catalog_teams', 'id, name, official_name, kind, country_code, search_name, updated_at', base.cursors.teams, 'id'),
    pull<CatalogCompetition>(client, 'catalog_competitions', 'id, name, kind, scope, country_code, search_name, updated_at', base.cursors.competitions, 'id'),
    pull<CatalogSeason>(client, 'catalog_seasons', 'id, competition_id, year, is_current, updated_at', base.cursors.seasons, 'id'),
    pull<CatalogCountry>(client, 'catalog_countries', 'code, name_en, name_es, confederation, updated_at', base.cursors.countries, 'code'),
  ])
  // La participación equipo↔temporada no tiene `updated_at`: solo se vuelve a leer cuando hay temporadas nuevas/cambiadas o es la primera carga.
  let memberships = base.memberships
  const known = new Map(base.seasons.map((season) => [season.id, season.updated_at]))
  if (!previous || seasons.some((season) => known.get(season.id) !== season.updated_at)) {
    const rows: Membership[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client.from('catalog_competition_teams').select('season_id, team_id').order('season_id', { ascending: true }).range(from, from + PAGE - 1)
      if (error) throw new Error('CATALOG_SYNC_FAILED')
      rows.push(...((data ?? []) as Membership[]))
      if ((data ?? []).length < PAGE) break
    }
    memberships = rows
  }
  return {
    teams: merge(base.teams, teams, (t) => t.id),
    competitions: merge(base.competitions, competitions, (c) => c.id),
    seasons: merge(base.seasons, seasons, (s) => s.id),
    countries: merge(base.countries, countries, (c) => c.code),
    memberships,
    cursors: { teams: latest(teams, base.cursors.teams), competitions: latest(competitions, base.cursors.competitions), seasons: latest(seasons, base.cursors.seasons), countries: latest(countries, base.cursors.countries) },
  }
}

export type CatalogLoad = SwrResult<CatalogSnapshot>

// Punto de entrada: datos frescos (<24 h) sin red; vencidos → se muestran y se revalidan en segundo plano; sin datos → sincronización inicial.
export function loadCatalog(client: CatalogClient, options: { onUpdate?: (result: CatalogLoad) => void; cache?: OfflineCache; now?: () => number } = {}): Promise<CatalogLoad> {
  const cache = options.cache ?? getOfflineCache()
  return cachedRead<CatalogSnapshot>({
    ns: 'public',
    key: 'catalog',
    version: CATALOG_VERSION,
    ttlMs: CATALOG_TTL_MS,
    cache,
    now: options.now,
    onUpdate: options.onUpdate,
    fetcher: async () => syncCatalog(client, (await cache.get<CatalogSnapshot>('public', 'catalog', CATALOG_VERSION))?.value ?? null),
  })
}

export type TeamFilters = { query: string; kind: 'all' | 'club' | 'national'; country: string; competitionId: string }
export type TeamPage = { items: CatalogTeam[]; total: number; hasMore: boolean }

const participantsCache = new WeakMap<CatalogSnapshot, Map<string, Set<string>>>()
function participantsByCompetition(snapshot: CatalogSnapshot): Map<string, Set<string>> {
  const cached = participantsCache.get(snapshot)
  if (cached) return cached
  const competitionOf = new Map(snapshot.seasons.map((season) => [season.id, season.competition_id]))
  const map = new Map<string, Set<string>>()
  for (const membership of snapshot.memberships) {
    const competition = competitionOf.get(membership.season_id)
    if (!competition) continue
    const set = map.get(competition) ?? new Set<string>()
    set.add(membership.team_id)
    map.set(competition, set)
  }
  participantsCache.set(snapshot, map)
  return map
}

export function searchTeams(snapshot: CatalogSnapshot, filters: TeamFilters, page = 0, pageSize = 30): TeamPage {
  const q = normalizeSearch(filters.query)
  if (filters.query.trim() && !q) return { items: [], total: 0, hasMore: false } // solo símbolos: nada que buscar
  const only = filters.competitionId ? participantsByCompetition(snapshot).get(filters.competitionId) ?? new Set<string>() : null
  const matches = snapshot.teams.filter((team) =>
    (!q || team.search_name.includes(q)) &&
    (filters.kind === 'all' || team.kind === filters.kind) &&
    (!filters.country || team.country_code === filters.country) &&
    (!only || only.has(team.id)))
  matches.sort((a, b) => Number(b.search_name === q) - Number(a.search_name === q) || Number(b.search_name.startsWith(q)) - Number(a.search_name.startsWith(q)) || a.name.localeCompare(b.name, 'es'))
  const start = page * pageSize
  return { items: matches.slice(start, start + pageSize), total: matches.length, hasMore: start + pageSize < matches.length }
}

export function searchCompetitions(snapshot: CatalogSnapshot, query: string, country = ''): CatalogCompetition[] {
  const q = normalizeSearch(query)
  return snapshot.competitions
    .filter((competition) => (!q || competition.search_name.includes(q)) && (!country || competition.country_code === country))
    .sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name, 'es'))
}

export function countryName(snapshot: CatalogSnapshot, code: string | null): string {
  if (!code) return ''
  return snapshot.countries.find((country) => country.code === code)?.name_es ?? code
}

// Banderas estáticas autorizadas (MIT, public/flags). `null` si no hay bandera: la UI usa el escudo generado.
export function flagSrc(code: string | null | undefined): string | null {
  return code && /^[A-Z]{2}(-[A-Z]{3})?$/.test(code) ? `/flags/${code.toLowerCase()}.svg` : null
}
