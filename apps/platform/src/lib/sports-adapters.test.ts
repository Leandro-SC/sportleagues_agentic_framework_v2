import { describe, expect, it } from 'vitest'
import { computeStandings, deriveShortName, deriveTeamColors, mapSportsRows, type SportsRows } from './sports-adapters'
import { rankStandings } from './sports-catalog'

function rows(overrides: Partial<SportsRows> = {}): SportsRows {
  return {
    tournaments: [{ id: 't1', name: 'Liga Barrial 2026' }],
    teams: [
      { id: 'a', name: 'Atlético Peñarol', crest_asset_path: null },
      { id: 'b', name: 'Club Bravo', crest_asset_path: 'tenant/crest-b' },
      { id: 'c', name: 'Real Unidos', crest_asset_path: null },
    ],
    rounds: [{ id: 'r1', tournament_id: 't1', name: 'Jornada 1', sort_order: 0 }],
    matches: [
      { id: 'm1', tournament_id: 't1', round_id: 'r1', home_team_id: 'a', away_team_id: 'b', starts_at: '2026-10-05T20:00:00Z', status: 'final' },
      { id: 'm2', tournament_id: 't1', round_id: 'r1', home_team_id: 'b', away_team_id: 'c', starts_at: '2026-10-06T20:00:00Z', status: 'scheduled' },
    ],
    officialResults: [{ match_id: 'm1', home_score: 2, away_score: 1, revision: 1 }],
    ...overrides,
  }
}

describe('mapSportsRows', () => {
  it('maps tournaments, teams, rounds, matches and official results into the presentation model', () => {
    const { catalog, warnings } = mapSportsRows(rows())
    expect(warnings).toEqual([])
    expect(catalog.competitions).toMatchObject([{ id: 't1', name: 'Liga Barrial 2026' }])
    expect(catalog.matches.map((match) => [match.id, match.round_name, match.status, match.home_score, match.away_score])).toEqual([
      ['m1', 'Jornada 1', 'final', 2, 1],
      ['m2', 'Jornada 1', 'scheduled', null, null],
    ])
    expect(catalog.matches.every((match) => match.minute === null)).toBe(true)
  })

  it('does not invent data the database does not have', () => {
    const { catalog } = mapSportsRows(rows())
    expect(catalog.communityLeagues).toEqual([])
    expect(catalog.activity).toEqual([])
    expect(catalog.followedTeamIds).toEqual([])
    expect(catalog.profileStats).toBeNull()
    expect(catalog.teams.every((team) => team.country === null && team.country_name === '')).toBe(true)
    expect(catalog.teams.find((team) => team.id === 'b')?.crest_path).toBe('tenant/crest-b')
  })

  it('derives each team competition from the tournament that schedules it most, null if none', () => {
    const base = rows()
    const { catalog } = mapSportsRows({
      ...base,
      tournaments: [...base.tournaments, { id: 't2', name: 'Copa' }],
      teams: [...base.teams, { id: 'orphan', name: 'Sin Partidos', crest_asset_path: null }],
      rounds: [...base.rounds, { id: 'r2', tournament_id: 't2', name: 'Final', sort_order: 0 }],
      matches: [
        ...base.matches,
        { id: 'm3', tournament_id: 't2', round_id: 'r2', home_team_id: 'a', away_team_id: 'c', starts_at: '2026-10-09T20:00:00Z', status: 'scheduled' },
      ],
    })
    const byId = Object.fromEntries(catalog.teams.map((team) => [team.id, team.competition_id]))
    expect(byId).toEqual({ a: 't1', b: 't1', c: 't1', orphan: null })
  })

  it('drops matches that reference teams or tournaments outside the visible set (cross-tenant safety)', () => {
    const base = rows()
    const { catalog, warnings } = mapSportsRows({
      ...base,
      matches: [
        ...base.matches,
        { id: 'leak-team', tournament_id: 't1', round_id: 'r1', home_team_id: 'a', away_team_id: 'foreign-team', starts_at: '2026-10-07T20:00:00Z', status: 'scheduled' },
        { id: 'leak-tournament', tournament_id: 'foreign-t', round_id: 'r1', home_team_id: 'a', away_team_id: 'b', starts_at: '2026-10-07T20:00:00Z', status: 'scheduled' },
        { id: 'same-team', tournament_id: 't1', round_id: 'r1', home_team_id: 'a', away_team_id: 'a', starts_at: '2026-10-07T20:00:00Z', status: 'scheduled' },
      ],
    })
    expect(catalog.matches.map((match) => match.id)).toEqual(['m1', 'm2'])
    expect(warnings.map((warning) => [warning.code, warning.id])).toEqual([
      ['MATCH_BROKEN_REFERENCE', 'leak-team'],
      ['MATCH_BROKEN_REFERENCE', 'leak-tournament'],
      ['MATCH_BROKEN_REFERENCE', 'same-team'],
    ])
  })

  it('rejects statuses outside the MVP contract instead of inventing a label', () => {
    const base = rows()
    const { catalog, warnings } = mapSportsRows({
      ...base,
      matches: [...base.matches, { id: 'm9', tournament_id: 't1', round_id: 'r1', home_team_id: 'a', away_team_id: 'c', starts_at: '2026-10-08T20:00:00Z', status: 'postponed' }],
    })
    expect(catalog.matches.map((match) => match.id)).toEqual(['m1', 'm2'])
    expect(warnings).toEqual([{ code: 'MATCH_STATUS_UNSUPPORTED', entity: 'match', id: 'm9' }])
  })

  it('shows a final match without an official result as scoreless and warns', () => {
    const { catalog, warnings } = mapSportsRows(rows({ officialResults: [] }))
    expect(catalog.matches[0]).toMatchObject({ id: 'm1', status: 'final', home_score: null, away_score: null })
    expect(warnings).toContainEqual({ code: 'FINAL_WITHOUT_RESULT', entity: 'match', id: 'm1' })
    expect(catalog.standings.t1!.every((row) => row.played === 0)).toBe(true)
  })

  it('uses the latest revision of a corrected result and ignores invalid scores', () => {
    const { catalog, warnings } = mapSportsRows(rows({
      officialResults: [
        { match_id: 'm1', home_score: 2, away_score: 1, revision: 1 },
        { match_id: 'm1', home_score: 0, away_score: 3, revision: 2 },
        { match_id: 'm2', home_score: -1, away_score: 0, revision: 1 },
      ],
    }))
    expect(catalog.matches[0]).toMatchObject({ home_score: 0, away_score: 3 })
    expect(catalog.matches[1]).toMatchObject({ home_score: null, away_score: null })
    expect(warnings).toContainEqual({ code: 'RESULT_INVALID_SCORE', entity: 'result', id: 'm2' })
  })

  it('keeps the original match when its round belongs to another tournament, with a warning', () => {
    const { catalog, warnings } = mapSportsRows(rows({ rounds: [{ id: 'r1', tournament_id: 'other', name: 'Ajena', sort_order: 0 }] }))
    expect(catalog.matches).toHaveLength(2)
    expect(catalog.matches[0]!.round_name).toBe('')
    expect(warnings.some((warning) => warning.code === 'MATCH_ROUND_MISSING')).toBe(true)
  })

  it('handles an empty tenant', () => {
    const { catalog, warnings } = mapSportsRows({ tournaments: [], teams: [], rounds: [], matches: [], officialResults: [] })
    expect(catalog.matches).toEqual([])
    expect(catalog.standings).toEqual({})
    expect(warnings).toEqual([])
  })
})

describe('computeStandings', () => {
  it('computes a presentation table only from final matches with scores, including idle teams', () => {
    const { catalog } = mapSportsRows(rows())
    const table = rankStandings(catalog.standings.t1!)
    expect(table.map((row) => [row.team_id, row.played, row.points, row.goal_difference])).toEqual([
      ['a', 1, 3, 1],
      ['c', 0, 0, 0],
      ['b', 1, 0, -1],
    ])
  })

  it('counts draws and keeps tournaments separate', () => {
    const standings = computeStandings([
      { id: '1', tournament_id: 'x', round_name: '', home_team_id: 'a', away_team_id: 'b', starts_at: '', status: 'final', home_score: 1, away_score: 1, minute: null },
      { id: '2', tournament_id: 'y', round_name: '', home_team_id: 'a', away_team_id: 'c', starts_at: '', status: 'final', home_score: 0, away_score: 2, minute: null },
      { id: '3', tournament_id: 'y', round_name: '', home_team_id: 'a', away_team_id: 'c', starts_at: '', status: 'live', home_score: 5, away_score: 0, minute: 30 },
    ])
    expect(standings.x!.find((row) => row.team_id === 'a')).toMatchObject({ played: 1, drawn: 1, won: 0, lost: 0 })
    expect(standings.y!.find((row) => row.team_id === 'a')).toMatchObject({ played: 1, lost: 1, goals_against: 2 })
    expect(standings.y!.find((row) => row.team_id === 'c')).toMatchObject({ played: 1, won: 1 })
  })
})

describe('derived presentation defaults', () => {
  it('builds short names for crests', () => {
    expect(deriveShortName('Real Madrid')).toBe('RM')
    expect(deriveShortName('Sporting Cristal Lima')).toBe('SCL')
    expect(deriveShortName('Pumas')).toBe('PUM')
    expect(deriveShortName('Ñuñoa')).toBe('NUN')
    expect(deriveShortName('   ')).toBe('?')
  })

  it('gives each team a stable color pair', () => {
    expect(deriveTeamColors('team-1')).toEqual(deriveTeamColors('team-1'))
    expect(deriveTeamColors('team-1')).toHaveLength(2)
  })
})
