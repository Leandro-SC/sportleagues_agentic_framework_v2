// Fuente de datos de VISTA PREVIA (borrador previo a Fase 06). Solo se usa cuando
// isPreviewDataEnabled() lo permite y las pantallas la marcan como "Vista previa".
// Los nombres de equipos y competiciones son ilustrativos; no se usan escudos ni marcas oficiales.
// Fechas relativas a `now` para que Hoy/Mañana/Esta semana se puedan revisar en cualquier día.
import type { Competition, CommunityLeague, Match, MatchStatus, SportsCatalog, StandingRow, Team } from './sports-catalog'

const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

const competitions: Competition[] = [
  { id: 'liga-mx', name: 'Liga MX CL 2020', sport: 'football', country: 'MX', country_name: 'México', accent: '#21f59a', season_label: 'Clausura 2020' },
  { id: 'laliga', name: 'Liga de España', sport: 'football', country: 'ES', country_name: 'España', accent: '#ff5d7a', season_label: '2020/21' },
  { id: 'premier', name: 'Premier League', sport: 'football', country: 'GB', country_name: 'Inglaterra', accent: '#a78bfa', season_label: '2020/21' },
  { id: 'serie-a', name: 'Serie A', sport: 'football', country: 'IT', country_name: 'Italia', accent: '#16d8f4', season_label: '2020/21' },
  { id: 'libertadores', name: 'Copa Libertadores', sport: 'football', country: null, country_name: 'Sudamérica', accent: '#ffc24b', season_label: '2020' },
  { id: 'liga-1', name: 'Liga 1', sport: 'football', country: 'PE', country_name: 'Perú', accent: '#ff5d7a', season_label: '2020' },
  { id: 'liga-basket', name: 'Liga Nacional de Básquet', sport: 'basketball', country: 'AR', country_name: 'Argentina', accent: '#ffc24b', season_label: '2020/21' },
]

const team = (id: string, name: string, shortName: string, colors: [string, string], competitionId: string, country: Team['country'], countryName: string): Team =>
  ({ id, name, short_name: shortName, colors, competition_id: competitionId, country, country_name: countryName })

const teams: Team[] = [
  team('america', 'América', 'AME', ['#ffd23f', '#0b2a6b'], 'liga-mx', 'MX', 'México'),
  team('cruz-azul', 'Cruz Azul', 'CAZ', ['#1d4ed8', '#f8fafc'], 'liga-mx', 'MX', 'México'),
  team('monterrey', 'Monterrey', 'MTY', ['#1e3a8a', '#e2e8f0'], 'liga-mx', 'MX', 'México'),
  team('tigres', 'Tigres', 'TIG', ['#f59e0b', '#1e40af'], 'liga-mx', 'MX', 'México'),
  team('leon', 'León', 'LEO', ['#16a34a', '#fde047'], 'liga-mx', 'MX', 'México'),
  team('pachuca', 'Pachuca', 'PAC', ['#1e3a8a', '#f8fafc'], 'liga-mx', 'MX', 'México'),
  team('santos', 'Santos', 'SAN', ['#15803d', '#f8fafc'], 'liga-mx', 'MX', 'México'),
  team('pumas', 'Pumas', 'PUM', ['#1e3a8a', '#d4a017'], 'liga-mx', 'MX', 'México'),
  team('real-madrid', 'Real Madrid', 'RMA', ['#f8fafc', '#d4a017'], 'laliga', 'ES', 'España'),
  team('barcelona', 'Barcelona', 'BAR', ['#1e3a8a', '#b91c1c'], 'laliga', 'ES', 'España'),
  team('liverpool', 'Liverpool', 'LIV', ['#dc2626', '#fde68a'], 'premier', 'GB', 'Inglaterra'),
  team('man-city', 'Man. City', 'MCI', ['#7dd3fc', '#1e3a8a'], 'premier', 'GB', 'Inglaterra'),
  team('juventus', 'Juventus', 'JUV', ['#f8fafc', '#111827'], 'serie-a', 'IT', 'Italia'),
  team('milan', 'Milan', 'MIL', ['#dc2626', '#111827'], 'serie-a', 'IT', 'Italia'),
  team('flamengo', 'Flamengo', 'FLA', ['#dc2626', '#111827'], 'libertadores', 'BR', 'Brasil'),
  team('palmeiras', 'Palmeiras', 'PAL', ['#15803d', '#f8fafc'], 'libertadores', 'BR', 'Brasil'),
  team('sporting-cristal', 'Sporting Cristal', 'SCR', ['#38bdf8', '#f8fafc'], 'liga-1', 'PE', 'Perú'),
  team('alianza', 'Alianza Lima', 'ALI', ['#1e3a8a', '#f8fafc'], 'liga-1', 'PE', 'Perú'),
  team('boca-basket', 'Boca Básquet', 'BOC', ['#1e3a8a', '#facc15'], 'liga-basket', 'AR', 'Argentina'),
  team('quimsa', 'Quimsa', 'QUI', ['#dc2626', '#f8fafc'], 'liga-basket', 'AR', 'Argentina'),
]

const row = (teamId: string, won: number, drawn: number, lost: number, goalsFor: number, goalsAgainst: number): StandingRow =>
  ({ team_id: teamId, played: won + drawn + lost, won, drawn, lost, goals_for: goalsFor, goals_against: goalsAgainst })

const standings: Record<string, StandingRow[]> = {
  'liga-mx': [
    row('america', 5, 1, 0, 14, 5),
    row('monterrey', 4, 2, 0, 11, 5),
    row('cruz-azul', 3, 3, 0, 10, 6),
    row('tigres', 3, 2, 1, 9, 6),
    row('leon', 3, 1, 2, 8, 7),
    row('pachuca', 3, 0, 3, 7, 8),
    row('santos', 2, 1, 3, 6, 9),
    row('pumas', 1, 1, 4, 5, 11),
  ],
}

const communityLeagues: CommunityLeague[] = [
  { id: 'amigos-fc', name: 'Liga de Amigos FC', code: '7F3A2B', sport: 'football', teams_count: null, members_count: 12, capacity: 20, format_label: 'Torneo semanal', colors: ['#21f59a', '#0b3b2c'] },
  { id: 'liga-mx-comunidad', name: 'Liga MX CL 2020', code: 'LMX202', sport: 'football', teams_count: 18, members_count: 64, capacity: null, format_label: 'Temporada completa', colors: ['#16a34a', '#dc2626'] },
  { id: 'amigos-barrio', name: 'Amigos del Barrio', code: 'BARR20', sport: 'football', teams_count: 10, members_count: 9, capacity: 10, format_label: 'Torneo semanal', colors: ['#1e3a8a', '#facc15'] },
  { id: 'la-12', name: 'La 12', code: 'LA12AR', sport: 'football', teams_count: 14, members_count: 31, capacity: null, format_label: 'Temporada completa', colors: ['#1e3a8a', '#facc15'] },
  { id: 'copa-uni', name: 'Copa Universitaria', code: 'UNI202', sport: 'football', teams_count: 16, members_count: 22, capacity: 40, format_label: 'Eliminación directa', colors: ['#0ea5e9', '#f8fafc'] },
]

// Hoy a una hora local fija; si ya pasó, 90 minutos después de `now` para que siga pendiente.
function laterToday(now: Date, hours: number, minutes: number): Date {
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes)
  return candidate > now ? candidate : new Date(now.getTime() + 90 * MINUTE)
}

function inDays(now: Date, days: number, hours: number, minutes = 0): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hours, minutes)
}

export function buildPreviewCatalog(now: Date = new Date()): SportsCatalog {
  let sequence = 0
  const match = (
    tournamentId: string,
    homeTeamId: string,
    awayTeamId: string,
    startsAt: Date,
    status: MatchStatus,
    score: [number, number] | null = null,
    minute: number | null = null,
  ): Match => ({
    id: `preview-match-${++sequence}`,
    tournament_id: tournamentId,
    round_name: 'Jornada 7',
    home_team_id: homeTeamId,
    away_team_id: awayTeamId,
    starts_at: startsAt.toISOString(),
    status,
    home_score: score?.[0] ?? null,
    away_score: score?.[1] ?? null,
    minute,
  })

  const matches: Match[] = [
    match('liga-mx', 'america', 'cruz-azul', new Date(now.getTime() - 67 * MINUTE), 'live', [1, 1], 67),
    match('premier', 'liverpool', 'man-city', new Date(now.getTime() - 65 * MINUTE), 'live', [3, 0], 65),
    match('laliga', 'real-madrid', 'barcelona', new Date(now.getTime() - 135 * MINUTE), 'final', [2, 1]),
    match('serie-a', 'juventus', 'milan', laterToday(now, 20, 45), 'scheduled'),
    match('liga-basket', 'boca-basket', 'quimsa', laterToday(now, 21, 30), 'scheduled'),
    match('libertadores', 'flamengo', 'palmeiras', inDays(now, 1, 19), 'scheduled'),
    match('liga-mx', 'tigres', 'monterrey', inDays(now, 1, 21), 'scheduled'),
    match('liga-1', 'sporting-cristal', 'alianza', inDays(now, 3, 19, 30), 'scheduled'),
    match('liga-mx', 'pumas', 'america', inDays(now, 6, 19), 'scheduled'),
    match('liga-mx', 'america', 'santos', new Date(now.getTime() - 9 * DAY), 'final', [3, 0]),
    match('liga-mx', 'tigres', 'america', new Date(now.getTime() - 15 * DAY), 'final', [1, 2]),
    match('liga-mx', 'america', 'pumas', new Date(now.getTime() - 20 * DAY), 'final', [2, 1]),
    match('liga-mx', 'leon', 'pachuca', new Date(now.getTime() - 9 * DAY), 'final', [2, 0]),
  ]

  const ago = (minutes: number) => new Date(now.getTime() - minutes * MINUTE).toISOString()

  return {
    competitions,
    teams,
    matches,
    standings,
    communityLeagues,
    activity: [
      { id: 'activity-1', kind: 'joined', title: 'Te uniste a la liga', detail: 'Liga de Amigos FC', occurred_at: ago(2 * 60) },
      { id: 'activity-2', kind: 'prediction', title: 'Hiciste un pronóstico', detail: 'Cruz Azul vs América', occurred_at: ago(5 * 60) },
      { id: 'activity-3', kind: 'match', title: 'Completaste un partido', detail: 'Tu equipo ganó 3 - 1', occurred_at: ago(26 * 60) },
      { id: 'activity-4', kind: 'achievement', title: 'Obtuviste un logro', detail: 'Fanático del Fútbol', occurred_at: ago(50 * 60) },
    ],
    followedTeamIds: ['sporting-cristal', 'real-madrid'],
    profileStats: { tournaments: 5, points: 98, level: 'Nivel Pro', weeklyPoints: 12 },
  }
}
