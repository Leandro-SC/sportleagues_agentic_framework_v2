import { describe, expect, it, vi } from 'vitest'
import { createSupabaseSportsSource, SPORTS_COLUMNS, type SportsSourceClient } from './sports-source'

type Tables = Partial<Record<keyof typeof SPORTS_COLUMNS, { data: unknown[] | null; error: { message: string } | null }>>

function fakeClient(tables: Tables) {
  const select = vi.fn<(table: string, columns: string) => void>()
  const client: SportsSourceClient = {
    from: (table) => ({ select: (columns) => { select(table, columns); return Promise.resolve(tables[table] ?? { data: [], error: null }) } }),
  }
  return { client, select }
}

const ok = (data: unknown[]) => ({ data, error: null })

describe('createSupabaseSportsSource (draft, not wired to the app)', () => {
  it('reads only the five Phase 03 tables, never asks for tenant_id, and adapts the rows', async () => {
    const { client, select } = fakeClient({
      tournaments: ok([{ id: 't1', name: 'Liga' }]),
      teams: ok([{ id: 'a', name: 'Alfa', crest_asset_path: null }, { id: 'b', name: 'Beta', crest_asset_path: null }]),
      rounds: ok([{ id: 'r1', tournament_id: 't1', name: 'J1', sort_order: 0 }]),
      matches: ok([{ id: 'm1', tournament_id: 't1', round_id: 'r1', home_team_id: 'a', away_team_id: 'b', starts_at: '2026-10-05T20:00:00Z', status: 'final' }]),
      official_results: ok([{ match_id: 'm1', home_score: 1, away_score: 0, revision: 1 }]),
    })
    const source = createSupabaseSportsSource(client)
    expect(source.kind).toBe('supabase')
    const { catalog, warnings } = await source.load()

    expect(select.mock.calls.map(([table]) => table).sort()).toEqual(['matches', 'official_results', 'rounds', 'teams', 'tournaments'])
    for (const [, columns] of select.mock.calls) expect(columns).not.toContain('tenant_id')
    expect(warnings).toEqual([])
    expect(catalog.matches[0]).toMatchObject({ id: 'm1', home_score: 1, away_score: 0 })
  })

  it('discards malformed rows instead of breaking the screen', async () => {
    const { client } = fakeClient({
      tournaments: ok([{ id: 't1', name: 'Liga' }, { id: 7 }, null, 'x']),
      teams: ok([{ id: 'a', name: 'Alfa', crest_asset_path: null }, { id: 'b', name: '', crest_asset_path: null }]),
    })
    const { catalog } = await createSupabaseSportsSource(client).load()
    expect(catalog.competitions.map((competition) => competition.id)).toEqual(['t1'])
    expect(catalog.teams.map((team) => team.id)).toEqual(['a'])
  })

  it('fails with a generic message and never leaks the database error text', async () => {
    const { client } = fakeClient({ matches: { data: null, error: { message: 'permission denied for table matches (tenant 9f2…)' } } })
    await expect(createSupabaseSportsSource(client).load()).rejects.toThrow(/^SPORTS_SOURCE_FAILED$/)
  })

  it('returns an empty catalog for a tenant without data', async () => {
    const { client } = fakeClient({})
    const { catalog } = await createSupabaseSportsSource(client).load()
    expect(catalog.competitions).toEqual([])
    expect(catalog.matches).toEqual([])
  })
})
