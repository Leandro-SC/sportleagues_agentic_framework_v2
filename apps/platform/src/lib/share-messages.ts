// Textos listos para WhatsApp que acompañan a cada flyer. Solo usan datos que el usuario ya ve en la app (nombre de la quiniela,
// tabla, partidos y resultados oficiales). Nunca incluyen pronósticos ajenos ni datos personales distintos del nombre visible.
import type { FlyerInput } from './flyer'

export type ShareMessageContext = { brandName?: string | null; link?: string | null }

const firstLine = (brand: string | null | undefined, pool: string): string => (brand?.trim() ? `*${brand.trim()}* · ${pool}` : `*${pool}*`)

export function buildShareMessage(input: FlyerInput, ctx: ShareMessageContext = {}): string {
  const lines = [firstLine(ctx.brandName, input.poolName)]
  switch (input.kind) {
    case 'ranking': {
      lines.push(`📊 ${input.scopeLabel}`)
      for (const row of input.rows.slice(0, 5)) lines.push(`${row.rank}. ${row.name} — ${row.points} pts`)
      if (!input.rows.length) lines.push('Aún no hay resultados.')
      break
    }
    case 'my-result':
      lines.push(`🏅 Voy #${input.rank} de ${input.participants} con ${input.points} puntos (${input.exactHits} exactos).`)
      break
    case 'next-round': {
      lines.push(`⏰ ${input.roundName}: pronósticos hasta ${input.closesAt}`)
      for (const match of input.matches.slice(0, 6)) lines.push(`• ${match.home} vs ${match.away} — ${match.kickoff}`)
      lines.push('¡No te quedes sin pronosticar!')
      break
    }
    case 'round-results': {
      lines.push(`⚽ Resultados · ${input.roundName}`)
      for (const result of input.results.slice(0, 8)) lines.push(`• ${result.home} ${result.homeScore}-${result.awayScore} ${result.away}`)
      break
    }
    case 'winner': {
      const names = input.winners.map((winner) => winner.name).join(', ')
      lines.push(names ? `🏆 ${input.winners.length > 1 ? 'Campeones' : 'Campeón'}: ${names}` : 'Aún no hay resultados.')
      if (input.winners[0]) lines.push(`${input.winners[0].points} puntos · ${input.participants} participantes`)
      break
    }
    case 'invite':
      lines.push(`🎟️ Únete a mi quiniela con el código *${input.code.toUpperCase()}*`)
      break
  }
  if (ctx.link) lines.push('', ctx.link)
  return lines.join('\n')
}
