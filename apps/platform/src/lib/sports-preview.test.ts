import { describe, expect, it } from 'vitest'
import { normalizeJoinCode } from './join-intent'
import { matchesInWindow, standingPoints } from './sports-catalog'
import { buildPreviewCatalog } from './sports-preview'

describe('preview catalog integrity', () => {
  const now = new Date(2026, 9, 5, 18, 0)
  const catalog = buildPreviewCatalog(now)
  const teamIds = new Set(catalog.teams.map((team) => team.id))
  const competitionIds = new Set(catalog.competitions.map((competition) => competition.id))

  it('references only existing teams and competitions, never the same team twice in a match', () => {
    for (const match of catalog.matches) {
      expect(teamIds.has(match.home_team_id), match.id).toBe(true)
      expect(teamIds.has(match.away_team_id), match.id).toBe(true)
      expect(match.home_team_id).not.toBe(match.away_team_id)
      expect(competitionIds.has(match.tournament_id), match.id).toBe(true)
    }
    for (const team of catalog.teams) expect(competitionIds.has(team.competition_id), team.id).toBe(true)
    for (const id of catalog.followedTeamIds) expect(teamIds.has(id), id).toBe(true)
  })

  it('keeps scores consistent with match status (mirrors official_results rules)', () => {
    for (const match of catalog.matches) {
      if (match.status === 'scheduled') {
        expect(match.home_score).toBeNull()
        expect(match.away_score).toBeNull()
      } else {
        expect(match.home_score).toBeGreaterThanOrEqual(0)
        expect(match.away_score).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('has internally consistent standings', () => {
    for (const rows of Object.values(catalog.standings)) {
      for (const row of rows) {
        expect(row.played).toBe(row.won + row.drawn + row.lost)
        expect(teamIds.has(row.team_id)).toBe(true)
        expect(standingPoints(row)).toBe(row.won * 3 + row.drawn)
      }
    }
  })

  it('uses join codes with the real six-character format', () => {
    for (const league of catalog.communityLeagues) expect(normalizeJoinCode(league.code), league.id).toBe(league.code)
  })

  it('populates today and tomorrow relative to the given date', () => {
    expect(matchesInWindow(catalog.matches, 'today', now).length).toBeGreaterThan(0)
    expect(matchesInWindow(catalog.matches, 'tomorrow', now).length).toBeGreaterThan(0)
  })
})
