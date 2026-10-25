// Plantillas del centro para compartir de una quiniela, armadas solo con lo que la app ya muestra (parrilla, tabla, estadísticas
// del propio jugador). Función pura: la vista decide cuándo llamarla.
import { publicAppUrl } from './branding'
import type { FlyerInput } from './flyer'

export type ShareFixtureItem = { roundId: string; roundName: string; roundOrder: number; homeName: string; awayName: string; startsAt: string; lockAt: string; status: 'scheduled' | 'live' | 'final'; result: { home: number; away: number } | null }
export type ShareLeaderRow = { rank: number; display_name: string; points: number; exact_hits: number; is_me: boolean }
export type ShareStats = { rank: number; participants: number; points: number; exact_hits: number; current_streak: number }
export type PoolShareTemplate = { id: string; label: string; input: FlyerInput; filename: string; qrUrl: string; qrLabel: string }

export type PoolShareContext = {
  poolId: string; poolName: string; host: string; timezone: string; now: Date
  fixture: ShareFixtureItem[]; leaderboard: ShareLeaderRow[]; scopeLabel: string
  stats: ShareStats | null; playerName: string; joinCode: string | null
}

export function formatKickoff(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('es', { timeZone: timezone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  } catch {
    return new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  }
}

/** Enlace que acompaña al mensaje: invitación con código para quien lo tiene (organizador); para jugadores, la quiniela. */
export function poolShareLink(ctx: Pick<PoolShareContext, 'host' | 'poolId' | 'joinCode'>): string {
  return ctx.joinCode ? publicAppUrl(ctx.host, `/j/${ctx.joinCode.toUpperCase()}`) : publicAppUrl(ctx.host, `/p/${ctx.poolId}`)
}

export function buildPoolShareTemplates(ctx: PoolShareContext): PoolShareTemplate[] {
  const link = poolShareLink(ctx)
  const qrLabel = ctx.joinCode ? 'Escanea para unirte' : 'Escanea y entra a la quiniela'
  const make = (id: string, label: string, input: FlyerInput, filename: string): PoolShareTemplate => ({ id, label, input, filename, qrUrl: link, qrLabel })
  const templates: PoolShareTemplate[] = []
  const nowMs = ctx.now.getTime()

  if (ctx.leaderboard.length) {
    templates.push(make('table', 'Avance de la tabla', {
      kind: 'ranking', poolName: ctx.poolName, scopeLabel: ctx.scopeLabel,
      rows: ctx.leaderboard.map((row) => ({ rank: row.rank, name: row.display_name, points: row.points, isMe: row.is_me })),
    }, 'tabla'))
  }

  // Por cerrar: la primera jornada con partidos aún abiertos a pronóstico (cierre según el servidor).
  const open = ctx.fixture.filter((item) => item.status === 'scheduled' && new Date(item.lockAt).getTime() > nowMs)
  if (open.length) {
    const firstRound = [...open].sort((a, b) => a.roundOrder - b.roundOrder || a.lockAt.localeCompare(b.lockAt))[0]!
    const items = open.filter((item) => item.roundId === firstRound.roundId).sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    const closes = items.reduce((min, item) => (item.lockAt < min ? item.lockAt : min), items[0]!.lockAt)
    templates.push(make('closing', 'Por cerrar', {
      kind: 'next-round', poolName: ctx.poolName, roundName: firstRound.roundName, closesAt: formatKickoff(closes, ctx.timezone),
      matches: items.map((item) => ({ home: item.homeName, away: item.awayName, kickoff: formatKickoff(item.startsAt, ctx.timezone) })),
    }, 'por-cerrar'))
  }

  // Resultados: la jornada con el resultado oficial más reciente.
  const finals = ctx.fixture.filter((item) => item.result)
  if (finals.length) {
    const latest = [...finals].sort((a, b) => b.startsAt.localeCompare(a.startsAt))[0]!
    const items = finals.filter((item) => item.roundId === latest.roundId).sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    templates.push(make('results', 'Resultados', {
      kind: 'round-results', poolName: ctx.poolName, roundName: latest.roundName,
      results: items.map((item) => ({ home: item.homeName, away: item.awayName, homeScore: item.result!.home, awayScore: item.result!.away })),
    }, 'resultados'))
  }

  // Resultados finales: solo cuando todos los partidos de la quiniela tienen resultado oficial.
  if (ctx.fixture.length && ctx.fixture.every((item) => item.status === 'final' && item.result) && ctx.leaderboard.length) {
    const top = ctx.leaderboard.filter((row) => row.rank === 1)
    templates.push(make('final', 'Resultados finales', {
      kind: 'winner', poolName: ctx.poolName, participants: ctx.leaderboard.length,
      winners: top.map((row) => ({ name: row.display_name, points: row.points, exactHits: row.exact_hits })),
    }, 'campeon'))
  }

  if (ctx.stats) {
    templates.push(make('mine', 'Mi resultado', {
      kind: 'my-result', poolName: ctx.poolName, playerName: ctx.playerName, rank: ctx.stats.rank, participants: ctx.stats.participants,
      points: ctx.stats.points, exactHits: ctx.stats.exact_hits, currentStreak: ctx.stats.current_streak,
    }, 'mi-resultado'))
  }

  if (ctx.joinCode) {
    templates.push(make('invite', 'Invitación', { kind: 'invite', poolName: ctx.poolName, code: ctx.joinCode }, 'invitacion'))
  }
  return templates
}
