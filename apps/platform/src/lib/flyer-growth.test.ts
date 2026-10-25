import jsQR from 'jsqr'
import { describe, expect, it } from 'vitest'
import { buildFlyerLayout, containRect, coverSource, FLYER_FORMATS, qrModules, type DrawOp, type FlyerInput } from './flyer'

const texts = (ops: DrawOp[]): string[] => ops.flatMap((op) => (op.op === 'text' ? [op.text] : []))
const ranking: FlyerInput = { kind: 'ranking', poolName: 'Liga de amigos', scopeLabel: 'Tabla general', rows: [{ rank: 1, name: 'Ana', points: 12, isMe: false }] }
const fakeImage = {} as CanvasImageSource

/** Pinta los módulos en una imagen RGBA y la decodifica con un lector QR real. */
function decode(modules: boolean[][]): string | null {
  const scale = 6
  const size = modules.length * scale
  const data = new Uint8ClampedArray(size * size * 4).fill(255)
  modules.forEach((row, r) => row.forEach((dark, c) => {
    if (!dark) return
    for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
      const i = ((r * scale + y) * size + (c * scale + x)) * 4
      data[i] = 0; data[i + 1] = 0; data[i + 2] = 0
    }
  }))
  return jsQR(data, size, size)?.data ?? null
}

describe('QR de acceso', () => {
  it('codifica la URL de invitación y un lector real la recupera', () => {
    const url = 'https://sportleagues-qa.vercel.app/j/ABC123'
    const modules = qrModules(url)!
    expect(decode(modules)).toBe(url)
  })

  it('solo acepta https y longitudes razonables', () => {
    expect(qrModules('http://example.com')).toBeNull()
    expect(qrModules('javascript:alert(1)')).toBeNull()
    expect(qrModules(`https://example.com/${'a'.repeat(600)}`)).toBeNull()
    expect(qrModules(null)).toBeNull()
  })

  it('con QR la tabla se limita a 6 filas y el QR queda dentro del lienzo', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ rank: i + 1, name: `J${i}`, points: 20 - i, isMe: false }))
    const ops = buildFlyerLayout({ ...ranking, rows } as FlyerInput, { qrUrl: 'https://app.example.com/j/ABC123' })
    expect(texts(ops).filter((t) => t.endsWith(' pts'))).toHaveLength(6)
    const qr = ops.find((op) => op.op === 'qr')!
    expect(qr.y + (qr as Extract<DrawOp, { op: 'qr' }>).size).toBeLessThanOrEqual(FLYER_FORMATS.chat.height)
    expect(texts(ops)).toContain('Escanea para unirte')
  })
})

describe('marca de agua FREE y white-label PRO', () => {
  it('FREE (o sin marca) lleva marca de agua y la firma de SportLeagues', () => {
    const ops = buildFlyerLayout(ranking)
    expect(ops.some((op) => op.op === 'text' && op.text === 'SportLeagues' && op.alpha !== undefined && op.rotate)).toBe(true)
    expect(texts(ops).some((t) => t.includes('SportLeagues'))).toBe(true)
  })

  it('PRO no lleva marca de agua ni menciona SportLeagues', () => {
    const ops = buildFlyerLayout(ranking, { brand: { plan: 'pro', orgName: 'Quinielas Silva' } })
    expect(ops.some((op) => op.op === 'text' && op.alpha !== undefined)).toBe(false)
    expect(texts(ops).some((t) => /sportleagues/i.test(t))).toBe(false)
    expect(texts(ops)).toContain('Quinielas Silva')
  })

  it('el nombre de la plataforma también aparece en FREE, con la marca de agua', () => {
    const ops = buildFlyerLayout(ranking, { brand: { plan: 'free', orgName: 'Quinielas Silva' } })
    expect(texts(ops)).toContain('Quinielas Silva')
    expect(texts(ops)).not.toContain('SPORTLEAGUES')
    expect(ops.some((op) => op.op === 'text' && op.alpha !== undefined)).toBe(true)
  })

  it('el color PRO solo se usa si contrasta; si no, se conserva el acento de la app', () => {
    const bar = (accent: string) => (buildFlyerLayout(ranking, { brand: { plan: 'pro', accent } }).find((op) => op.op === 'rect' && op.h === 10) as Extract<DrawOp, { op: 'rect' }>).fill
    expect(bar('#ffcc00')).toBe('#ffcc00')
    expect(bar('#050505')).toBe('#21f59a')
    expect(buildFlyerLayout(ranking, { brand: { plan: 'free', accent: '#ffcc00' } }).find((op) => op.op === 'rect' && op.h === 10)).toMatchObject({ fill: '#21f59a' })
  })
})

describe('logo sin deformar', () => {
  it('containRect conserva la proporción en cualquier forma', () => {
    const wide = containRect(1200, 300, { x: 0, y: 0, w: 260, h: 120 }, 'left')
    expect(wide.w / wide.h).toBeCloseTo(4, 1)
    expect(wide.w).toBeLessThanOrEqual(260)
    const tall = containRect(300, 900, { x: 0, y: 0, w: 260, h: 120 })
    expect(tall.w / tall.h).toBeCloseTo(1 / 3, 1)
    expect(tall.h).toBeLessThanOrEqual(120)
  })

  it('el logo PRO se encaja con su proporción real y el nombre se coloca a su derecha', () => {
    const ops = buildFlyerLayout(ranking, { brand: { plan: 'pro', orgName: 'Quinielas Silva', logo: { image: fakeImage, width: 800, height: 400 } } })
    const logo = ops.find((op) => op.op === 'image') as Extract<DrawOp, { op: 'image' }>
    expect(logo.w / logo.h).toBeCloseTo(2, 1)
    const name = ops.find((op) => op.op === 'text' && op.text === 'Quinielas Silva') as Extract<DrawOp, { op: 'text' }>
    expect(name.x).toBeGreaterThan(logo.x + logo.w)
  })

  it('FREE no dibuja el logo (es PRO)', () => {
    const ops = buildFlyerLayout(ranking, { brand: { plan: 'free', logo: { image: fakeImage, width: 512, height: 512 } } })
    expect(ops.some((op) => op.op === 'image')).toBe(false)
  })
})

describe('formatos de WhatsApp y foto de fondo', () => {
  it('Estado 9:16: el contenido se centra y la franja inferior llega al borde', () => {
    const chat = buildFlyerLayout(ranking)
    const status = buildFlyerLayout(ranking, { format: 'status' })
    expect(status[0]).toMatchObject({ op: 'rect', h: FLYER_FORMATS.status.height })
    const title = (ops: DrawOp[]) => ops.find((op) => op.op === 'text' && op.text === 'Liga de amigos')!.y
    expect(title(status) - title(chat)).toBe((FLYER_FORMATS.status.height - FLYER_FORMATS.chat.height) / 2)
    const footer = status.filter((op): op is Extract<DrawOp, { op: 'rect' }> => op.op === 'rect').at(-1)!
    expect(footer.y + footer.h).toBe(FLYER_FORMATS.status.height)
  })

  it('la foto de fondo cubre el lienzo sin deformarse y lleva un velo para leer el texto', () => {
    const ops = buildFlyerLayout(ranking, { background: { image: fakeImage, width: 4000, height: 3000 } })
    const bg = ops[1] as Extract<DrawOp, { op: 'image' }>
    expect(bg).toMatchObject({ op: 'image', x: 0, y: 0, w: 1080, h: 1350 })
    expect(bg.src!.w / bg.src!.h).toBeCloseTo(1080 / 1350, 2)
    expect(ops[2]).toMatchObject({ op: 'rect', alpha: 0.62 })
  })

  it('coverSource recorta centrado', () => {
    expect(coverSource(2000, 1000, 1000, 1000)).toEqual({ x: 500, y: 0, w: 1000, h: 1000 })
  })
})

describe('plantillas nuevas', () => {
  it('resultados de jornada con marcadores oficiales', () => {
    const t = texts(buildFlyerLayout({ kind: 'round-results', poolName: 'Liga', roundName: 'Fecha 3', results: [{ home: 'Alianza', away: 'Cristal', homeScore: 2, awayScore: 1 }] }))
    expect(t).toEqual(expect.arrayContaining(['Resultados · Fecha 3', 'Alianza', '2 - 1', 'Cristal']))
  })

  it('invitación con el código en grande', () => {
    expect(texts(buildFlyerLayout({ kind: 'invite', poolName: 'Liga', code: 'abc123' }))).toContain('ABC123')
  })

  it('por cerrar y campeón', () => {
    expect(texts(buildFlyerLayout({ kind: 'next-round', poolName: 'Liga', roundName: 'Fecha 4', closesAt: 'sáb 20:00', matches: [{ home: 'A', away: 'B', kickoff: 'sáb 20:15' }] }))).toContain('sáb 20:15')
    expect(texts(buildFlyerLayout({ kind: 'winner', poolName: 'Liga', participants: 9, winners: [{ name: 'Ana', points: 40, exactHits: 6 }] }))).toEqual(expect.arrayContaining(['CAMPEÓN', 'Ana']))
  })
})
