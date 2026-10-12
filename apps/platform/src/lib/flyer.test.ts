import { describe, expect, it, vi } from 'vitest'
import { buildFlyerLayout, FLYER_SIZE, paintFlyer, truncate, type DrawOp, type FlyerInput } from './flyer'

const texts = (ops: DrawOp[]): string[] => ops.flatMap((op) => (op.op === 'text' ? [op.text] : []))
const ranking: FlyerInput = { kind: 'ranking', poolName: 'Liga de amigos', scopeLabel: 'Tabla general', rows: [
  { rank: 1, name: 'Ana', points: 12, isMe: false }, { rank: 2, name: 'Luis', points: 7, isMe: true } ] }

describe('buildFlyerLayout', () => {
  it('usa solo los datos recibidos: nombres, posiciones y puntos del backend', () => {
    const t = texts(buildFlyerLayout(ranking))
    expect(t).toEqual(expect.arrayContaining(['Liga de amigos', 'Tabla general', 'Ana', '12 pts', 'Luis', '7 pts']))
  })

  it('limita la tabla a 8 filas y no se sale del lienzo', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ rank: i + 1, name: `J${i}`, points: 20 - i, isMe: false }))
    const ops = buildFlyerLayout({ ...ranking, rows } as FlyerInput)
    expect(texts(ops).filter((x) => x.endsWith(' pts'))).toHaveLength(8)
    for (const op of ops) if (op.op === 'rect') expect(op.y + op.h).toBeLessThanOrEqual(FLYER_SIZE.height)
  })

  it('sin resultados muestra un estado honesto, sin cifras inventadas', () => {
    const t = texts(buildFlyerLayout({ ...ranking, rows: [] } as FlyerInput))
    expect(t).toContain('Aún no hay resultados')
    expect(t.some((x) => x.endsWith(' pts'))).toBe(false)
  })

  it('resultado personal: posición, puntos, exactos y racha', () => {
    const t = texts(buildFlyerLayout({ kind: 'my-result', poolName: 'Liga', playerName: 'Ana', rank: 2, participants: 9, points: 31, exactHits: 4, currentStreak: 3 }))
    expect(t).toEqual(expect.arrayContaining(['#2', 'de 9 participantes', '31 puntos', '4', '3', 'racha actual']))
  })

  it('trunca nombres largos', () => {
    expect(truncate('Nombre larguísimo de una liga de barrio', 10)).toHaveLength(10)
    expect(truncate('Corto', 10)).toBe('Corto')
  })
})

describe('paintFlyer', () => {
  it('pinta cada operación en el contexto', () => {
    const ctx = { fillRect: vi.fn(), fillText: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), fill: vi.fn(), stroke: vi.fn(), fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '' }
    const ops = buildFlyerLayout(ranking)
    paintFlyer(ctx as never, ops)
    expect(ctx.fillText).toHaveBeenCalledTimes(ops.filter((o) => o.op === 'text').length)
    expect(ctx.roundRect).toHaveBeenCalled()
  })
})
