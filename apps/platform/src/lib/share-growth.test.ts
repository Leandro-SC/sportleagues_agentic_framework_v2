import { describe, expect, it, vi } from 'vitest'
import { contrastRatio, publicAppUrl, safeAccent } from './branding'
import { contentBounds, describeLogoFix, detectBackground, planLogo } from './logo-fix'
import { validateLocalImage } from './local-image'
import { shareToWhatsApp, whatsappTextUrl } from './share'
import { buildShareMessage } from './share-messages'
import { buildPoolShareTemplates, poolShareLink, type PoolShareContext } from './share-templates'

const now = new Date('2026-10-24T15:00:00Z')
const item = (over: Partial<PoolShareContext['fixture'][number]>) => ({
  roundId: 'r1', roundName: 'Fecha 1', roundOrder: 1, homeName: 'Alianza', awayName: 'Cristal',
  startsAt: '2026-10-25T20:00:00Z', lockAt: '2026-10-25T19:45:00Z', status: 'scheduled' as const, result: null, ...over,
})
const ctx = (over: Partial<PoolShareContext> = {}): PoolShareContext => ({
  poolId: 'pool-1', poolName: 'Liga Silva', host: 'sportleagues-qa.vercel.app', timezone: 'America/Lima', now,
  fixture: [], leaderboard: [], scopeLabel: 'Tabla general', stats: null, playerName: 'Ana', joinCode: null, ...over,
})

describe('plantillas del centro para compartir', () => {
  it('sin datos no ofrece plantillas vacías', () => {
    expect(buildPoolShareTemplates(ctx())).toEqual([])
  })

  it('tabla, por cerrar y resultados según el estado real de la quiniela', () => {
    const templates = buildPoolShareTemplates(ctx({
      leaderboard: [{ rank: 1, display_name: 'Ana', points: 6, exact_hits: 2, is_me: true }],
      fixture: [
        item({ roundId: 'r1', status: 'final', startsAt: '2026-10-20T20:00:00Z', lockAt: '2026-10-20T19:45:00Z', result: { home: 2, away: 1 } }),
        item({ roundId: 'r2', roundName: 'Fecha 2', roundOrder: 2, homeName: 'U', awayName: 'Melgar' }),
        item({ roundId: 'r2', roundName: 'Fecha 2', roundOrder: 2, lockAt: '2026-10-24T14:00:00Z' }),   // ya cerrado: no entra
      ],
    }))
    expect(templates.map((t) => t.id)).toEqual(['table', 'closing', 'results'])
    const closing = templates.find((t) => t.id === 'closing')!.input
    expect(closing.kind === 'next-round' && closing.matches.map((m) => m.home)).toEqual(['U'])
    const results = templates.find((t) => t.id === 'results')!.input
    expect(results.kind === 'round-results' && results.results[0]).toMatchObject({ homeScore: 2, awayScore: 1 })
  })

  it('resultados finales solo cuando todos los partidos tienen resultado; empates en el primer lugar son campeones compartidos', () => {
    const fixture = [item({ status: 'final', result: { home: 1, away: 0 } })]
    const leaderboard = [
      { rank: 1, display_name: 'Ana', points: 3, exact_hits: 1, is_me: false },
      { rank: 1, display_name: 'Luis', points: 3, exact_hits: 1, is_me: true },
      { rank: 3, display_name: 'Eva', points: 0, exact_hits: 0, is_me: false },
    ]
    const final = buildPoolShareTemplates(ctx({ fixture, leaderboard })).find((t) => t.id === 'final')!.input
    expect(final.kind === 'winner' && final.winners.map((w) => w.name)).toEqual(['Ana', 'Luis'])
    expect(buildPoolShareTemplates(ctx({ fixture: [...fixture, item({})], leaderboard })).some((t) => t.id === 'final')).toBe(false)
  })

  it('la invitación y el enlace con código solo existen si quien comparte conoce el código (organizador)', () => {
    expect(poolShareLink(ctx())).toBe('https://sportleagues-qa.vercel.app/p/pool-1')
    const withCode = buildPoolShareTemplates(ctx({ joinCode: 'abc123' }))
    expect(withCode.map((t) => t.id)).toEqual(['invite'])
    expect(withCode[0]!.qrUrl).toBe('https://sportleagues-qa.vercel.app/j/ABC123')
  })
})

describe('mensajes para WhatsApp', () => {
  it('incluye el nombre de la plataforma, los datos y el enlace', () => {
    const text = buildShareMessage({ kind: 'ranking', poolName: 'Liga', scopeLabel: 'Tabla general', rows: [{ rank: 1, name: 'Ana', points: 9, isMe: false }] }, { brandName: 'Quinielas Silva', link: 'https://x.test/p/1' })
    expect(text.split('\n')[0]).toBe('*Quinielas Silva* · Liga')
    expect(text).toContain('1. Ana — 9 pts')
    expect(text.endsWith('https://x.test/p/1')).toBe(true)
  })

  it('por cerrar invita a pronosticar; resultados lista marcadores', () => {
    expect(buildShareMessage({ kind: 'next-round', poolName: 'L', roundName: 'Fecha 2', closesAt: 'sáb 19:45', matches: [{ home: 'A', away: 'B', kickoff: 'sáb 20:00' }] })).toContain('¡No te quedes sin pronosticar!')
    expect(buildShareMessage({ kind: 'round-results', poolName: 'L', roundName: 'F1', results: [{ home: 'A', away: 'B', homeScore: 2, awayScore: 0 }] })).toContain('A 2-0 B')
  })

  it('wa.me sin destinatario y con el texto codificado', () => {
    expect(whatsappTextUrl('Hola & chau')).toBe('https://wa.me/?text=Hola%20%26%20chau')
  })

  it('con Web Share de archivos comparte imagen + mensaje; sin él descarga y abre WhatsApp', async () => {
    const blob = new Blob(['x'], { type: 'image/png' })
    const share = vi.fn().mockResolvedValue(undefined)
    expect(await shareToWhatsApp({ blob, filename: 'a.png', title: 't', text: 'hola' }, { share, canShare: () => true }, null)).toBe('shared')
    expect(share.mock.calls[0]![0]).toMatchObject({ text: 'hola' })

    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined })
    const open = vi.fn()
    const link = { click: vi.fn(), remove: vi.fn() } as unknown as HTMLAnchorElement
    const doc = { createElement: () => link, body: { appendChild: vi.fn() } } as unknown as Document
    expect(await shareToWhatsApp({ blob, filename: 'a.png', title: 't', text: 'hola' }, {}, doc, open)).toBe('downloaded-and-opened')
    expect(open).toHaveBeenCalledWith('https://wa.me/?text=hola')
    vi.unstubAllGlobals()
  })
})

describe('marca del organizador', () => {
  it('safeAccent valida formato y contraste sobre el fondo oscuro', () => {
    expect(safeAccent('#FFCC00')).toBe('#ffcc00')
    expect(safeAccent('#101010')).toBeNull()
    expect(safeAccent('rojo')).toBeNull()
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0)
    expect(publicAppUrl('app.test', 'j/ABC123')).toBe('https://app.test/j/ABC123')
  })

  it('valida fotos locales por tipo y tamaño', () => {
    expect(validateLocalImage({ type: 'image/jpeg', size: 1000 })).toBeNull()
    expect(validateLocalImage({ type: 'application/pdf', size: 1000 })).toContain('foto')
    expect(validateLocalImage({ type: 'image/png', size: 20 * 1024 * 1024 })).toContain('MB')
  })
})

describe('ajuste inteligente del logo (lógica pura)', () => {
  // Imagen 10×6 RGBA: fondo blanco opaco y un dibujo rojo en x 3..5, y 2..3.
  function image(bg: [number, number, number, number]): Uint8ClampedArray {
    const w = 10, h = 6
    const data = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const ink = x >= 3 && x <= 5 && y >= 2 && y <= 3
      data.set(ink ? [200, 20, 20, 255] : bg, i)
    }
    return data
  }

  it('detecta fondo transparente, liso o ausente', () => {
    expect(detectBackground(image([0, 0, 0, 0]), 10, 6)).toEqual({ kind: 'transparent' })
    expect(detectBackground(image([255, 255, 255, 255]), 10, 6)).toEqual({ kind: 'solid', r: 255, g: 255, b: 255 })
    const mixed = image([255, 255, 255, 255]); mixed.set([0, 0, 255, 255], 0)
    expect(detectBackground(mixed, 10, 6)).toEqual({ kind: 'none' })
  })

  it('recorta exactamente el dibujo', () => {
    const white = image([255, 255, 255, 255])
    expect(contentBounds(white, 10, 6, detectBackground(white, 10, 6))).toEqual({ x: 3, y: 2, w: 3, h: 2 })
    expect(contentBounds(new Uint8ClampedArray(10 * 6 * 4), 10, 6, { kind: 'transparent' })).toBeNull()
  })

  it('encuadra en un cuadrado de 512–1024 px centrado y sin deformar', () => {
    const plan = planLogo({ x: 0, y: 0, w: 3000, h: 1000 })
    expect(plan.size).toBe(1024)
    expect(plan.dest.w / plan.dest.h).toBeCloseTo(3, 1)
    expect(plan.dest.x).toBe(Math.round((1024 - plan.dest.w) / 2))
    expect(planLogo({ x: 0, y: 0, w: 100, h: 100 }).size).toBe(512)
    const notes = describeLogoFix({ width: 3000, height: 2000 }, { x: 0, y: 500, w: 3000, h: 1000 }, plan, { kind: 'transparent' })
    expect(notes.join(' ')).toMatch(/márgenes.*sin estirarlo.*1024×1024.*transparente/s)
  })
})
