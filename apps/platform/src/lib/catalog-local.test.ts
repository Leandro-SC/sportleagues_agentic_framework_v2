import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { CATALOG_TTL_MS, EMPTY_SNAPSHOT, flagSrc, loadCatalog, normalizeSearch, searchCompetitions, searchTeams, syncCatalog, type CatalogClient, type CatalogSnapshot } from './catalog-local'
import { OfflineCache } from './offline-cache'
import { resetSwrForTests } from './swr'

type Row = Record<string, unknown>
function fakeClient(tables: Record<string, Row[]>, log: string[] = [], failing = { on: false }): CatalogClient {
  return {
    from(table) {
      let rows = [...(tables[table] ?? [])]
      let from = 0; let to = 999; let gte: [string, string] | null = null
      const order: string[] = []
      const query: any = {
        gte(column: string, value: string) { gte = [column, value]; return query },
        order(column: string) { order.push(column); return query },
        range(a: number, b: number) { from = a; to = b; return query },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          log.push(`${table}${gte ? `>=${gte[1]}` : ''}@${from}`)
          if (failing.on) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(resolve, reject)
          if (gte) rows = rows.filter((row) => String(row[gte![0]]) >= gte![1])
          for (const column of order.slice().reverse()) rows.sort((x, y) => String(x[column]).localeCompare(String(y[column])))
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null }).then(resolve, reject)
        },
      }
      return { select: () => query }
    },
  }
}

const T = (id: string, name: string, kind: 'club' | 'national', country: string, at = '2026-10-01T00:00:00Z') =>
  ({ id, name, official_name: null, kind, country_code: country, search_name: normalizeSearch(name), updated_at: at })
const tables = (): Record<string, Row[]> => ({
  catalog_teams: [T('t1', 'Sporting Cristal', 'club', 'PE'), T('t2', 'Alianza Lima', 'club', 'PE'), T('t3', 'Perú', 'national', 'PE'), T('t4', 'Inglaterra', 'national', 'GB-ENG'), T('t5', 'Arsenal', 'club', 'GB-ENG')],
  catalog_competitions: [{ id: 'c1', name: 'Liga 1 de Perú', kind: 'league', scope: 'domestic', country_code: 'PE', search_name: 'liga 1 de peru primera division', updated_at: '2026-10-01T00:00:00Z' },
    { id: 'c2', name: 'Copa Libertadores', kind: 'cup', scope: 'continental', country_code: null, search_name: 'copa libertadores', updated_at: '2026-10-01T00:00:00Z' }],
  catalog_seasons: [{ id: 's1', competition_id: 'c1', year: 2026, is_current: true, updated_at: '2026-10-01T00:00:00Z' }],
  catalog_countries: [{ code: 'PE', name_en: 'Peru', name_es: 'Perú', confederation: 'CONMEBOL', updated_at: '2026-10-01T00:00:00Z' }],
  catalog_competition_teams: [{ season_id: 's1', team_id: 't1' }, { season_id: 's1', team_id: 't2' }],
})
const filters = { query: '', kind: 'all', country: '', competitionId: '' } as const

describe('búsqueda local del catálogo', () => {
  let snapshot: CatalogSnapshot
  beforeEach(async () => { snapshot = await syncCatalog(fakeClient(tables()), null) })

  it('normaliza acentos y mayúsculas igual que el servidor', () => {
    expect(normalizeSearch('  PERÚ!! ')).toBe('peru')
    expect(normalizeSearch('Atlético-Grau')).toBe('atletico grau')
  })

  it('busca por nombre sin acentos, por nombre parcial y filtra por tipo y país', () => {
    expect(searchTeams(snapshot, { ...filters, query: 'peru' }).items.map((t) => t.name)).toEqual(['Perú'])
    expect(searchTeams(snapshot, { ...filters, query: 'CRIS' }).items.map((t) => t.name)).toEqual(['Sporting Cristal'])
    expect(searchTeams(snapshot, { ...filters, kind: 'national' }).total).toBe(2)
    expect(searchTeams(snapshot, { ...filters, kind: 'club', country: 'PE' }).items.map((t) => t.name)).toEqual(['Alianza Lima', 'Sporting Cristal'])
  })

  it('filtra por competición y devuelve solo sus participantes', () => {
    expect(searchTeams(snapshot, { ...filters, competitionId: 'c1' }).items.map((t) => t.name)).toEqual(['Alianza Lima', 'Sporting Cristal'])
    expect(searchTeams(snapshot, { ...filters, competitionId: 'c2' }).total).toBe(0)
  })

  it('pagina y avisa si hay más', () => {
    const first = searchTeams(snapshot, filters, 0, 2)
    expect(first).toMatchObject({ total: 5, hasMore: true }); expect(first.items).toHaveLength(2)
    const last = searchTeams(snapshot, filters, 2, 2)
    expect(last).toMatchObject({ hasMore: false }); expect(last.items).toHaveLength(1)
  })

  it('no rompe con caracteres especiales y la coincidencia exacta va primero', () => {
    expect(searchTeams(snapshot, { ...filters, query: '%_;--' }).total).toBe(0)
    expect(searchTeams(snapshot, { ...filters, query: 'arsenal' }).items[0]?.name).toBe('Arsenal')
  })

  it('busca competiciones por alias/nombre', () => {
    expect(searchCompetitions(snapshot, 'primera division').map((c) => c.name)).toEqual(['Liga 1 de Perú'])
    expect(searchCompetitions(snapshot, '').map((c) => c.scope)).toEqual(['continental', 'domestic'])
  })

  it('las banderas solo se resuelven para códigos válidos', () => {
    expect(flagSrc('PE')).toBe('/flags/pe.svg')
    expect(flagSrc('GB-ENG')).toBe('/flags/gb-eng.svg')
    expect(flagSrc('../x')).toBeNull(); expect(flagSrc(null)).toBeNull()
  })
})

describe('sincronización incremental', () => {
  it('la primera carga trae todo y la siguiente solo lo nuevo (cursor por updated_at)', async () => {
    const data = tables(); const log: string[] = []
    const first = await syncCatalog(fakeClient(data, log), null)
    expect(first.teams).toHaveLength(5)
    expect(log.some((l) => l.startsWith('catalog_competition_teams'))).toBe(true)
    log.length = 0
    data.catalog_teams.push(T('t6', 'Universitario', 'club', 'PE', '2026-10-05T00:00:00Z'))
    data.catalog_teams[0] = T('t1', 'Sporting Cristal FBC', 'club', 'PE', '2026-10-06T00:00:00Z')
    const second = await syncCatalog(fakeClient(data, log), first)
    expect(second.teams).toHaveLength(6)
    expect(second.teams.find((t) => t.id === 't1')?.name).toBe('Sporting Cristal FBC')
    expect(log.filter((l) => l.startsWith('catalog_teams'))[0]).toBe('catalog_teams>=2026-10-01T00:00:00Z@0')
    expect(log.some((l) => l.startsWith('catalog_competition_teams'))).toBe(false) // sin temporadas nuevas no se relee la participación
    expect(second.cursors.teams).toBe('2026-10-06T00:00:00Z')
  })

  it('es idempotente: sincronizar dos veces lo mismo no duplica filas', async () => {
    const data = tables()
    const first = await syncCatalog(fakeClient(data), null)
    const again = await syncCatalog(fakeClient(data), first)
    expect(again.teams).toHaveLength(first.teams.length)
  })

  it('pagina lotes de 1000 filas', async () => {
    const data = tables()
    data.catalog_teams = Array.from({ length: 2300 }, (_, i) => T(`x${String(i).padStart(5, '0')}`, `Equipo ${i}`, 'club', 'PE'))
    const log: string[] = []
    const snap = await syncCatalog(fakeClient(data, log), null)
    expect(snap.teams).toHaveLength(2300)
    expect(log.filter((l) => l.startsWith('catalog_teams'))).toHaveLength(3)
  })

  it('un error del servidor se informa sin texto de la base de datos', async () => {
    await expect(syncCatalog(fakeClient(tables(), [], { on: true }), null)).rejects.toThrow('CATALOG_SYNC_FAILED')
  })
})

describe('caché del catálogo (persistente, versionada, con revalidación)', () => {
  const clock = { t: 9_000_000 }
  let cache: OfflineCache
  beforeEach(() => { resetSwrForTests(); clock.t = 9_000_000; cache = new OfflineCache({ idb: new IDBFactory(), now: () => clock.t }) })

  it('segunda apertura sin solicitudes; tras 24 h muestra lo guardado y revalida en segundo plano', async () => {
    const log: string[] = []; const data = tables()
    const first = await loadCatalog(fakeClient(data, log), { cache, now: () => clock.t })
    expect(first.status).toBe('network')
    const requests = log.length
    expect(await loadCatalog(fakeClient(data, log), { cache, now: () => clock.t })).toMatchObject({ status: 'fresh' })
    expect(log.length).toBe(requests) // cero solicitudes a Supabase

    clock.t += CATALOG_TTL_MS + 1000
    data.catalog_teams.push(T('t9', 'Nuevo Club', 'club', 'PE', '2026-10-20T00:00:00Z'))
    const updates: unknown[] = []
    const stale = await loadCatalog(fakeClient(data, log), { cache, now: () => clock.t, onUpdate: (u) => updates.push(u) })
    expect(stale.status).toBe('revalidating'); expect(stale.value.teams).toHaveLength(5)
    await new Promise((r) => setTimeout(r, 30))
    expect((updates[0] as { value: CatalogSnapshot }).value.teams).toHaveLength(6)
  })

  it('sin conexión muestra el catálogo guardado y marca offline con su fecha de actualización', async () => {
    const data = tables()
    await loadCatalog(fakeClient(data), { cache, now: () => clock.t })
    const savedAt = clock.t
    clock.t += CATALOG_TTL_MS + 1000
    const updates: { status: string; updatedAt: number }[] = []
    const result = await loadCatalog(fakeClient(data, [], { on: true }), { cache, now: () => clock.t, onUpdate: (u) => updates.push(u) })
    expect(result.value.teams).toHaveLength(5)
    await new Promise((r) => setTimeout(r, 30))
    expect(updates[0]).toMatchObject({ status: 'offline', updatedAt: savedAt })
  })

  it('el catálogo no contiene datos privados: solo se guarda en el espacio público', async () => {
    await loadCatalog(fakeClient(tables()), { cache, now: () => clock.t })
    await cache.clearPrivate()
    expect(await cache.get('public', 'catalog', 'catalog-v1')).not.toBeNull()
  })

  it('EMPTY_SNAPSHOT no se muta entre sincronizaciones', async () => {
    await syncCatalog(fakeClient(tables()), null)
    expect(EMPTY_SNAPSHOT.teams).toHaveLength(0)
  })
})
