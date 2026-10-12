// Flyers deportivos reutilizables (1080×1350, formato vertical 4:5) dibujados con la API Canvas nativa: sin servicios externos, sin
// dependencias nuevas y sin red. El DISEÑO es una función pura (`buildFlyerLayout`) para poder probarlo; `renderFlyer` solo lo pinta.
// Los datos de entrada vienen del backend (pool_leaderboard / my_pool_stats): este módulo nunca calcula ni inventa puntuaciones.

export const FLYER_SIZE = { width: 1080, height: 1350 } as const
const C = { canvas: '#03111c', surface: '#071b29', surface2: '#0a2434', border: '#1c3c50', primary: '#21f59a', secondary: '#16d8f4', text: '#f7fafc', muted: '#8fa6b5' } as const

export type FlyerRow = { rank: number; name: string; points: number; isMe: boolean }
export type FlyerInput =
  | { kind: 'ranking'; poolName: string; scopeLabel: string; rows: FlyerRow[] }
  | { kind: 'my-result'; poolName: string; playerName: string; rank: number; participants: number; points: number; exactHits: number; currentStreak: number }

export type DrawOp =
  | { op: 'rect'; x: number; y: number; w: number; h: number; fill: string; radius?: number; stroke?: string }
  | { op: 'text'; x: number; y: number; text: string; size: number; weight: 500 | 700 | 800; fill: string; align: 'left' | 'center' | 'right'; maxWidth?: number }

const text = (x: number, y: number, t: string, size: number, fill: string, o: Partial<Extract<DrawOp, { op: 'text' }>> = {}): DrawOp =>
  ({ op: 'text', x, y, text: t, size, weight: 700, fill, align: 'left', ...o })

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

export function buildFlyerLayout(input: FlyerInput): DrawOp[] {
  const { width, height } = FLYER_SIZE
  const ops: DrawOp[] = [
    { op: 'rect', x: 0, y: 0, w: width, h: height, fill: C.canvas },
    { op: 'rect', x: 0, y: 0, w: width, h: 10, fill: C.primary },
    text(80, 150, 'SPORTLEAGUES', 34, C.secondary, { weight: 800 }),
    text(80, 250, truncate(input.poolName, 26), 64, C.text, { weight: 800 }),
  ]
  if (input.kind === 'ranking') {
    ops.push(text(80, 305, input.scopeLabel, 34, C.muted, { weight: 500 }))
    const rows = input.rows.slice(0, 8)
    rows.forEach((row, i) => {
      const y = 380 + i * 110
      ops.push(
        { op: 'rect', x: 60, y, w: 960, h: 92, fill: row.isMe ? '#0e3a2c' : C.surface, radius: 24, stroke: row.isMe ? C.primary : C.border },
        text(110, y + 61, String(row.rank), 44, row.rank === 1 ? C.primary : C.muted, { weight: 800 }),
        text(190, y + 60, truncate(row.name, 22), 40, C.text),
        text(990, y + 60, `${row.points} pts`, 40, row.isMe ? C.primary : C.text, { align: 'right', weight: 800 }),
      )
    })
    if (!rows.length) ops.push(text(540, 700, 'Aún no hay resultados', 44, C.muted, { align: 'center', weight: 500 }))
  } else {
    ops.push(
      text(80, 305, truncate(input.playerName, 28), 38, C.muted, { weight: 500 }),
      { op: 'rect', x: 60, y: 380, w: 960, h: 420, fill: C.surface, radius: 40, stroke: C.border },
      text(540, 560, `#${input.rank}`, 230, C.primary, { align: 'center', weight: 800 }),
      text(540, 640, `de ${input.participants} participantes`, 40, C.muted, { align: 'center', weight: 500 }),
      text(540, 740, `${input.points} puntos`, 64, C.text, { align: 'center', weight: 800 }),
      { op: 'rect', x: 60, y: 840, w: 465, h: 200, fill: C.surface2, radius: 32, stroke: C.border },
      { op: 'rect', x: 555, y: 840, w: 465, h: 200, fill: C.surface2, radius: 32, stroke: C.border },
      text(292, 950, String(input.exactHits), 90, C.secondary, { align: 'center', weight: 800 }),
      text(292, 1005, 'marcadores exactos', 30, C.muted, { align: 'center', weight: 500 }),
      text(787, 950, String(input.currentStreak), 90, C.secondary, { align: 'center', weight: 800 }),
      text(787, 1005, 'racha actual', 30, C.muted, { align: 'center', weight: 500 }),
    )
  }
  ops.push(
    { op: 'rect', x: 0, y: height - 140, w: width, h: 140, fill: C.surface },
    text(540, height - 62, 'Pronóstica con tus amigos · SportLeagues', 32, C.muted, { align: 'center', weight: 500 }),
  )
  return ops
}

type Ctx = Pick<CanvasRenderingContext2D, 'fillRect' | 'fillText' | 'beginPath' | 'roundRect' | 'fill' | 'stroke'> & Record<'fillStyle' | 'strokeStyle' | 'lineWidth' | 'font' | 'textAlign', unknown>

export function paintFlyer(ctx: Ctx, ops: DrawOp[]): void {
  for (const op of ops) {
    if (op.op === 'rect') {
      ctx.fillStyle = op.fill
      if (op.radius) {
        ctx.beginPath(); ctx.roundRect(op.x, op.y, op.w, op.h, op.radius); ctx.fill()
        if (op.stroke) { ctx.strokeStyle = op.stroke; ctx.lineWidth = 3; ctx.stroke() }
      } else ctx.fillRect(op.x, op.y, op.w, op.h)
    } else {
      ctx.fillStyle = op.fill; ctx.textAlign = op.align
      ctx.font = `${op.weight} ${op.size}px Manrope, Inter, system-ui, sans-serif`
      ctx.fillText(op.text, op.x, op.y, op.maxWidth)
    }
  }
}

/** Genera la imagen PNG en el dispositivo. null si el navegador no ofrece canvas/toBlob. */
export async function renderFlyer(input: FlyerInput, doc: Document = document): Promise<Blob | null> {
  const canvas = doc.createElement('canvas')
  canvas.width = FLYER_SIZE.width; canvas.height = FLYER_SIZE.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  paintFlyer(ctx as unknown as Ctx, buildFlyerLayout(input))
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'))
}
