import { describe, expect, it } from 'vitest'
import {
  classifyLeagueQuery,
  firstNameOf,
  initialsOf,
  kickoffLabel,
  matchesForSport,
  matchesInWindow,
  matchMoment,
  rankStandings,
  relativeTimeLabel,
  searchCatalog,
  teamForm,
  teamMatches,
  upcomingMatches,
  type Competition,
  type Match,
  type Team,
} from './sports-catalog'

// Fechas en hora local para que los tests no dependan de la zona horaria de la máquina.
const now = new Date(2026, 9, 5, 18, 0)
const at = (dayOffset: number, hours: number, minutes = 0) => new Date(2026, 9, 5 + dayOffset, hours, minutes).toISOString()

let sequence = 0
function match(overrides: Partial<Match>): Match {
  return {
    id: `m-${++sequence}`,
    tournament_id: 'liga',
    round_name: 'Jornada 1',
    home_team_id: 'a',
    away_team_id: 'b',
    starts_at: at(0, 20),
    status: 'scheduled',
    home_score: null,
    away_score: null,
    minute: null,
    ...overrides,
  }
}

const competitions: Competition[] = [
  { id: 'liga', name: 'Liga Ejemplo', sport: 'football', country: 'MX', country_name: 'México', accent: '#21f59a', season_label: '2026' },
  { id: 'basket', name: 'Liga de Básquet', sport: 'basketball', country: null, country_name: 'Global', accent: '#ffc24b', season_label: '2026' },
]

const teams: Team[] = [
  { id: 'a', name: 'Atlético Peñarol', short_name: 'ATP', colors: ['#fff', '#000'], competition_id: 'liga', country: 'MX', country_name: 'México' },
  { id: 'b', name: 'Club Bravo', short_name: 'BRA', colors: ['#000', '#fff'], competition_id: 'liga', country: 'MX', country_name: 'México' },
]

describe('matchesInWindow', () => {
  const live = match({ status: 'live', starts_at: at(-1, 23, 30), minute: 80 })
  const tonight = match({ starts_at: at(0, 21) })
  const earlierToday = match({ status: 'final', starts_at: at(0, 9), home_score: 1, away_score: 0 })
  const tomorrow = match({ starts_at: at(1, 19) })
  const inSixDays = match({ starts_at: at(6, 19) })
  const inSevenDays = match({ starts_at: at(7, 19) })
  const yesterday = match({ status: 'final', starts_at: at(-1, 19), home_score: 0, away_score: 0 })
  const all = [inSevenDays, yesterday, tomorrow, earlierToday, tonight, live, inSixDays]

  it('treats live matches as today even if they started yesterday, and orders live, scheduled, final', () => {
    expect(matchesInWindow(all, 'today', now).map((item) => item.id)).toEqual([live.id, tonight.id, earlierToday.id])
  })

  it('returns only next-day matches for tomorrow', () => {
    expect(matchesInWindow(all, 'tomorrow', now).map((item) => item.id)).toEqual([tomorrow.id])
  })

  it('covers today through the next six days, excluding past days and the seventh day', () => {
    const ids = matchesInWindow(all, 'week', now).map((item) => item.id)
    expect(ids).toEqual([live.id, tonight.id, tomorrow.id, inSixDays.id, earlierToday.id])
    expect(ids).not.toContain(inSevenDays.id)
    expect(ids).not.toContain(yesterday.id)
  })
})

describe('match filters and labels', () => {
  it('filters by the sport of the competition', () => {
    const football = match({ tournament_id: 'liga' })
    const basket = match({ tournament_id: 'basket' })
    expect(matchesForSport([football, basket], competitions, 'basketball')).toEqual([basket])
    expect(matchesForSport([football, basket], competitions, 'all')).toHaveLength(2)
    expect(matchesForSport([football, basket], competitions, 'tennis')).toEqual([])
  })

  it('labels live, final, today and tomorrow kickoffs', () => {
    expect(kickoffLabel(match({ status: 'live' }), now)).toEqual({ text: 'En vivo', tone: 'live' })
    expect(kickoffLabel(match({ status: 'final' }), now).tone).toBe('final')
    expect(kickoffLabel(match({ starts_at: at(0, 20, 45) }), now)).toEqual({ text: 'Hoy · 20:45', tone: 'today' })
    expect(kickoffLabel(match({ starts_at: at(1, 19) }), now)).toEqual({ text: 'Mañana · 19:00', tone: 'neutral' })
  })

  it('shows the live minute under the score', () => {
    expect(matchMoment(match({ status: 'live', minute: 67 }), now)).toBe("67'")
    expect(matchMoment(match({ status: 'scheduled', starts_at: at(2, 19, 30) }), now)).toBe('19:30')
  })

  it('lists upcoming scheduled matches only, soonest first', () => {
    const later = match({ starts_at: at(3, 19) })
    const sooner = match({ starts_at: at(1, 19) })
    const past = match({ starts_at: at(0, 10) })
    expect(upcomingMatches([later, past, sooner, match({ status: 'live' })], now, 5)).toEqual([sooner, later])
  })

  it('returns team results with live first, then most recent', () => {
    const old = match({ status: 'final', starts_at: at(-10, 19), home_score: 1, away_score: 0 })
    const recent = match({ status: 'final', starts_at: at(-2, 19), home_score: 2, away_score: 2 })
    const live = match({ status: 'live', starts_at: at(0, 17) })
    const otherTeams = match({ status: 'final', home_team_id: 'c', away_team_id: 'd', home_score: 0, away_score: 0 })
    expect(teamMatches([old, otherTeams, recent, live, match({})], 'a').map((item) => item.id)).toEqual([live.id, recent.id, old.id])
  })

  it('computes form from the team perspective, newest first', () => {
    const matches = [
      match({ status: 'final', starts_at: at(-3, 19), home_team_id: 'a', away_team_id: 'b', home_score: 2, away_score: 0 }),
      match({ status: 'final', starts_at: at(-2, 19), home_team_id: 'b', away_team_id: 'a', home_score: 3, away_score: 1 }),
      match({ status: 'final', starts_at: at(-1, 19), home_team_id: 'b', away_team_id: 'a', home_score: 1, away_score: 1 }),
      match({ status: 'live', home_team_id: 'a', away_team_id: 'b', home_score: 5, away_score: 0 }),
    ]
    expect(teamForm(matches, 'a')).toEqual(['E', 'P', 'G'])
  })
})

describe('relativeTimeLabel', () => {
  it('uses minutes, hours and days in Spanish', () => {
    expect(relativeTimeLabel(new Date(now.getTime() - 30 * 1000).toISOString(), now)).toBe('Hace un momento')
    expect(relativeTimeLabel(new Date(now.getTime() - 5 * 60 * 1000).toISOString(), now)).toBe('Hace 5 minutos')
    expect(relativeTimeLabel(new Date(now.getTime() - 2 * 3600 * 1000).toISOString(), now)).toBe('Hace 2 horas')
    expect(relativeTimeLabel(new Date(now.getTime() - 26 * 3600 * 1000).toISOString(), now)).toBe('Hace 1 día')
    expect(relativeTimeLabel(new Date(now.getTime() + 3600 * 1000).toISOString(), now)).toBe('Hace un momento')
  })
})

describe('rankStandings', () => {
  it('orders by points, goal difference, goals for and name', () => {
    const ranked = rankStandings([
      { team_id: 'c', played: 3, won: 1, drawn: 0, lost: 2, goals_for: 4, goals_against: 4 },
      { team_id: 'a', played: 3, won: 2, drawn: 0, lost: 1, goals_for: 3, goals_against: 2 },
      { team_id: 'b', played: 3, won: 2, drawn: 0, lost: 1, goals_for: 5, goals_against: 4 },
      { team_id: 'd', played: 3, won: 1, drawn: 0, lost: 2, goals_for: 4, goals_against: 4 },
    ])
    expect(ranked.map((row) => [row.position, row.team_id, row.points])).toEqual([[1, 'b', 6], [2, 'a', 6], [3, 'c', 3], [4, 'd', 3]])
    expect(ranked[0]!.goal_difference).toBe(1)
  })
})

describe('league search', () => {
  it('detects a six-character join code, with or without #', () => {
    expect(classifyLeagueQuery(' #7f3a2b ')).toEqual({ kind: 'code', code: '7F3A2B' })
    expect(classifyLeagueQuery('ABCDEF')).toEqual({ kind: 'code', code: 'ABCDEF' })
    expect(classifyLeagueQuery('Amigos del barrio')).toEqual({ kind: 'text', text: 'Amigos del barrio' })
    expect(classifyLeagueQuery('   ')).toEqual({ kind: 'empty' })
  })

  it('searches pools first, then competitions and teams, ignoring accents and case', () => {
    const results = searchCatalog('penarol', { competitions, teams }, [{ id: 'pool-1', name: 'Peñarol amigos' }])
    expect(results.map((result) => [result.kind, result.id])).toEqual([['pool', 'pool-1'], ['team', 'a']])
    expect(results[1]!.subtitle).toBe('Liga Ejemplo')
  })

  it('needs at least two characters', () => {
    expect(searchCatalog('l', { competitions, teams }, [])).toEqual([])
  })
})

describe('name helpers', () => {
  it('derives initials and first name', () => {
    expect(initialsOf('bart simpson jr')).toBe('BS')
    expect(initialsOf('  ')).toBe('?')
    expect(initialsOf(null)).toBe('?')
    expect(firstNameOf(' Bart Simpson ')).toBe('Bart')
  })
})
