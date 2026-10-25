// Flyers deportivos reutilizables (1080×1350 para chat y 1080×1920 para Estados de WhatsApp) dibujados con la API Canvas nativa: sin
// servicios externos y sin red. El DISEÑO es una función pura (`buildFlyerLayout`) para poder probarlo; `renderFlyer` solo lo pinta.
// Los datos de entrada vienen del backend (pool_leaderboard / my_pool_stats / parrilla): este módulo nunca calcula ni inventa puntuaciones.
// Growth del PRD: QR de acceso (uqr, codificación local), marca de agua en FREE y white-label básico en PRO (logo y color del organizador).
import { encode } from 'uqr'
import { safeAccent } from './branding'

export const FLYER_SIZE = { width: 1080, height: 1350 } as const
/** WhatsApp: «chat» 4:5 se ve completa en la conversación; «status» 9:16 ocupa la pantalla en Estados. */
export const FLYER_FORMATS = { chat: { width: 1080, height: 1350 }, status: { width: 1080, height: 1920 } } as const
export type FlyerFormat = keyof typeof FLYER_FORMATS
const C = { canvas: '#03111c', surface: '#071b29', surface2: '#0a2434', border: '#1c3c50', primary: '#21f59a', secondary: '#16d8f4', text: '#f7fafc', muted: '#8fa6b5' } as const

export type FlyerRow = { rank: number; name: string; points: number; isMe: boolean }
/** `kickoff`: fecha y hora ya formateadas en la zona horaria del tenant. */
export type FlyerMatch = { home: string; away: string; kickoff: string }
export type FlyerWinner = { name: string; points: number; exactHits: number }
export type FlyerInput =
  | { kind: 'ranking'; poolName: string; scopeLabel: string; rows: FlyerRow[] }
  | { kind: 'my-result'; poolName: string; playerName: string; rank: number; participants: number; points: number; exactHits: number; currentStreak: number }
  | { kind: 'next-round'; poolName: string; roundName: string; closesAt: string; matches: FlyerMatch[] }
  | { kind: 'winner'; poolName: string; participants: number; winners: FlyerWinner[] }
  | { kind: 'invite'; poolName: string; code: string }
  | { kind: 'round-results'; poolName: string; roundName: string; results: FlyerResult[] }
export type FlyerResult = { home: string; away: string; homeScore: number; awayScore: number }

/** Logo con su tamaño intrínseco: se encaja conservando la proporción, nunca se estira. */
export type FlyerLogo = { image: CanvasImageSource; width: number; height: number }
/** Marca del organizador. Sin `brand` el flyer es FREE: marca SportLeagues y marca de agua. `orgName` (nombre de la plataforma) se muestra en todos los planes. */
export type FlyerBrand = { plan: 'free' | 'pro'; accent?: string | null; logo?: FlyerLogo | null; orgName?: string | null }
/** `background`: foto propia elegida en el dispositivo (no se sube a ningún servidor); se recorta para cubrir sin deformarse. */
export type FlyerExtras = { brand?: FlyerBrand; qrUrl?: string | null; qrLabel?: string; format?: FlyerFormat; background?: FlyerLogo | null }

export type DrawOp =
  | { op: 'rect'; x: number; y: number; w: number; h: number; fill: string; radius?: number; stroke?: string; alpha?: number }
  | { op: 'text'; x: number; y: number; text: string; size: number; weight: 500 | 700 | 800; fill: string; align: 'left' | 'center' | 'right'; maxWidth?: number; rotate?: number; alpha?: number }
  | { op: 'image'; x: number; y: number; w: number; h: number; image: CanvasImageSource; src?: { x: number; y: number; w: number; h: number } }
  | { op: 'qr'; x: number; y: number; size: number; modules: boolean[][]; fill: string; background: string }

const text = (x: number, y: number, t: string, size: number, fill: string, o: Partial<Extract<DrawOp, { op: 'text' }>> = {}): DrawOp =>
  ({ op: 'text', x, y, text: t, size, weight: 700, fill, align: 'left', ...o })

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

/** Solo URLs https razonables llegan al QR: el flyer nunca codifica datos arbitrarios. */
export function qrModules(url: string | null | undefined): boolean[][] | null {
  if (!url || url.length > 512) return null
  try {
    if (new URL(url).protocol !== 'https:') return null
  } catch {
    return null
  }
  return encode(url, { ecc: 'M', border: 2 }).data
}

/** Rectángulo que encaja `srcW×srcH` en `box` conservando la proporción (como object-fit: contain). */
export function containRect(srcW: number, srcH: number, box: { x: number; y: number; w: number; h: number }, align: 'left' | 'center' = 'center'): { x: number; y: number; w: number; h: number } {
  const scale = Math.min(box.w / srcW, box.h / srcH)
  const w = Math.round(srcW * scale)
  const h = Math.round(srcH * scale)
  return { x: align === 'left' ? box.x : box.x + Math.round((box.w - w) / 2), y: box.y + Math.round((box.h - h) / 2), w, h }
}

/** Recorte de la fuente que cubre `w×h` conservando la proporción (como object-fit: cover). */
export function coverSource(srcW: number, srcH: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const scale = Math.max(w / srcW, h / srcH)
  const sw = Math.round(w / scale)
  const sh = Math.round(h / scale)
  return { x: Math.round((srcW - sw) / 2), y: Math.round((srcH - sh) / 2), w: sw, h: sh }
}

const shift = (op: DrawOp, dy: number): DrawOp => (dy ? { ...op, y: op.y + dy } : op)

const LOGO_BOX = { x: 80, y: 55, w: 260, h: 120 } as const
const QR = { x: 790, y: 1100, size: 220 } as const
const CONTENT_BOTTOM_WITH_QR = 1080

export function buildFlyerLayout(input: FlyerInput, extras: FlyerExtras = {}): DrawOp[] {
  // El contenido se diseña en un bloque de 1080×1350; en formato «status» se centra en vertical y el fondo cubre todo el lienzo.
  const { width, height } = FLYER_SIZE
  const canvas = FLYER_FORMATS[extras.format ?? 'chat']
  const dy = Math.round((canvas.height - height) / 2)
  const pro = extras.brand?.plan === 'pro'
  const accent = (pro ? safeAccent(extras.brand?.accent) : null) ?? C.primary
  const modules = qrModules(extras.qrUrl)
  const maxRows = modules ? 6 : 8
  const base: DrawOp[] = [{ op: 'rect', x: 0, y: 0, w: canvas.width, h: canvas.height, fill: C.canvas }]
  const bg = extras.background
  if (bg && bg.width > 0 && bg.height > 0) {
    base.push(
      { op: 'image', x: 0, y: 0, w: canvas.width, h: canvas.height, image: bg.image, src: coverSource(bg.width, bg.height, canvas.width, canvas.height) },
      { op: 'rect', x: 0, y: 0, w: canvas.width, h: canvas.height, fill: C.canvas, alpha: 0.62 },   // velo para que el texto se lea sobre cualquier foto
    )
  }
  base.push({ op: 'rect', x: 0, y: 0, w: canvas.width, h: 10, fill: accent })
  const ops: DrawOp[] = []
  if (!pro) ops.push(text(540, 760, 'SportLeagues', 150, C.text, { align: 'center', weight: 800, rotate: -Math.PI / 6, alpha: 0.05 }))
  const logo = pro ? extras.brand?.logo : null
  let brandX = 80
  if (logo && logo.width > 0 && logo.height > 0) {
    const box = containRect(logo.width, logo.height, LOGO_BOX, 'left')
    ops.push({ op: 'image', ...box, image: logo.image })
    brandX = box.x + box.w + 28
  }
  // Nombre de la plataforma del organizador (p. ej. «Quinielas Silva») en todos los planes; sin nombre, FREE muestra SportLeagues.
  const orgName = extras.brand?.orgName?.trim() ?? ''
  const brandLine = orgName ? truncate(orgName, 30) : pro ? '' : 'SPORTLEAGUES'
  if (brandLine) ops.push(text(brandX, 130, brandLine, 38, C.secondary, { weight: 800, maxWidth: 1000 - brandX }))
  ops.push(text(80, 250, truncate(input.poolName, 26), 64, C.text, { weight: 800 }))

  if (input.kind === 'ranking') {
    ops.push(text(80, 305, input.scopeLabel, 34, C.muted, { weight: 500 }))
    const rows = input.rows.slice(0, maxRows)
    rows.forEach((row, i) => {
      const y = 380 + i * 110
      ops.push(
        { op: 'rect', x: 60, y, w: 960, h: 92, fill: row.isMe ? '#0e3a2c' : C.surface, radius: 24, stroke: row.isMe ? accent : C.border },
        text(110, y + 61, String(row.rank), 44, row.rank === 1 ? accent : C.muted, { weight: 800 }),
        text(190, y + 60, truncate(row.name, 22), 40, C.text),
        text(990, y + 60, `${row.points} pts`, 40, row.isMe ? accent : C.text, { align: 'right', weight: 800 }),
      )
    })
    if (!rows.length) ops.push(text(540, 700, 'Aún no hay resultados', 44, C.muted, { align: 'center', weight: 500 }))
  } else if (input.kind === 'my-result') {
    ops.push(
      text(80, 305, truncate(input.playerName, 28), 38, C.muted, { weight: 500 }),
      { op: 'rect', x: 60, y: 380, w: 960, h: 420, fill: C.surface, radius: 40, stroke: C.border },
      text(540, 560, `#${input.rank}`, 230, accent, { align: 'center', weight: 800 }),
      text(540, 640, `de ${input.participants} participantes`, 40, C.muted, { align: 'center', weight: 500 }),
      text(540, 740, `${input.points} puntos`, 64, C.text, { align: 'center', weight: 800 }),
      { op: 'rect', x: 60, y: 840, w: 465, h: 200, fill: C.surface2, radius: 32, stroke: C.border },
      { op: 'rect', x: 555, y: 840, w: 465, h: 200, fill: C.surface2, radius: 32, stroke: C.border },
      text(292, 950, String(input.exactHits), 90, C.secondary, { align: 'center', weight: 800 }),
      text(292, 1005, 'marcadores exactos', 30, C.muted, { align: 'center', weight: 500 }),
      text(787, 950, String(input.currentStreak), 90, C.secondary, { align: 'center', weight: 800 }),
      text(787, 1005, 'racha actual', 30, C.muted, { align: 'center', weight: 500 }),
    )
  } else if (input.kind === 'next-round') {
    ops.push(text(80, 305, `${truncate(input.roundName, 24)} · pronósticos hasta ${input.closesAt}`, 32, C.muted, { weight: 500, maxWidth: 920 }))
    const matches = input.matches.slice(0, maxRows)
    matches.forEach((match, i) => {
      const y = 380 + i * 110
      ops.push(
        { op: 'rect', x: 60, y, w: 960, h: 92, fill: C.surface, radius: 24, stroke: C.border },
        text(100, y + 52, `${truncate(match.home, 16)}  vs  ${truncate(match.away, 16)}`, 36, C.text, { maxWidth: 640 }),
        text(990, y + 52, match.kickoff, 30, accent, { align: 'right', weight: 700, maxWidth: 300 }),
      )
    })
    if (!matches.length) ops.push(text(540, 700, 'Sin partidos abiertos', 44, C.muted, { align: 'center', weight: 500 }))
  } else if (input.kind === 'invite') {
    ops.push(
      text(80, 305, 'Te invito a mi quiniela', 34, C.muted, { weight: 500 }),
      { op: 'rect', x: 60, y: 380, w: 960, h: 560, fill: C.surface, radius: 40, stroke: accent },
      text(540, 520, 'Código de invitación', 40, C.muted, { align: 'center', weight: 500 }),
      text(540, 700, input.code.toUpperCase(), 170, accent, { align: 'center', weight: 800 }),
      text(540, 840, 'Ingrésalo en «Unirme a una liga» o escanea el QR', 34, C.text, { align: 'center', weight: 500, maxWidth: 900 }),
    )
  } else if (input.kind === 'round-results') {
    ops.push(text(80, 305, `Resultados · ${truncate(input.roundName, 30)}`, 34, C.muted, { weight: 500 }))
    const results = input.results.slice(0, maxRows)
    results.forEach((result, i) => {
      const y = 380 + i * 110
      ops.push(
        { op: 'rect', x: 60, y, w: 960, h: 92, fill: C.surface, radius: 24, stroke: C.border },
        text(400, y + 60, truncate(result.home, 14), 36, C.text, { align: 'right', maxWidth: 320 }),
        text(540, y + 62, `${result.homeScore} - ${result.awayScore}`, 44, accent, { align: 'center', weight: 800 }),
        text(680, y + 60, truncate(result.away, 14), 36, C.text, { maxWidth: 320 }),
      )
    })
    if (!results.length) ops.push(text(540, 700, 'Aún no hay resultados', 44, C.muted, { align: 'center', weight: 500 }))
  } else {
    const winners = input.winners.slice(0, 3)
    ops.push(
      text(80, 305, `${input.participants} participantes`, 34, C.muted, { weight: 500 }),
      { op: 'rect', x: 60, y: 380, w: 960, h: 640, fill: C.surface, radius: 40, stroke: accent },
      text(540, 500, winners.length > 1 ? 'CAMPEONES' : 'CAMPEÓN', 56, accent, { align: 'center', weight: 800 }),
    )
    winners.forEach((winner, i) => {
      ops.push(text(540, 640 + i * 120, truncate(winner.name, 20), winners.length > 1 ? 64 : 92, C.text, { align: 'center', weight: 800 }))
    })
    if (winners[0]) {
      ops.push(text(540, 960, `${winners[0].points} puntos · ${winners[0].exactHits} marcadores exactos`, 36, C.secondary, { align: 'center', weight: 700 }))
    } else {
      ops.push(text(540, 700, 'Aún no hay resultados', 44, C.muted, { align: 'center', weight: 500 }))
    }
  }

  // La franja inferior llega hasta el borde del lienzo también en formato «status» (h + dy).
  if (modules) {
    ops.push(
      { op: 'rect', x: 0, y: CONTENT_BOTTOM_WITH_QR, w: width, h: height - CONTENT_BOTTOM_WITH_QR + dy, fill: C.surface },
      text(80, 1190, extras.qrLabel ?? 'Escanea para unirte', 40, C.text, { weight: 800, maxWidth: 660 }),
      text(80, 1245, pro ? 'Pronostica con tus amigos' : 'Pronostica con tus amigos · SportLeagues', 30, C.muted, { weight: 500, maxWidth: 660 }),
      { op: 'qr', x: QR.x, y: QR.y, size: QR.size, modules, fill: C.canvas, background: '#ffffff' },
    )
  } else {
    ops.push(
      { op: 'rect', x: 0, y: height - 140, w: width, h: 140 + dy, fill: C.surface },
      text(540, height - 62, pro ? 'Pronostica con tus amigos' : 'Pronostica con tus amigos · SportLeagues', 32, C.muted, { align: 'center', weight: 500 }),
    )
  }
  return [...base, ...ops.map((op) => shift(op, dy))]
}

type Ctx = Pick<CanvasRenderingContext2D, 'fillRect' | 'fillText' | 'beginPath' | 'roundRect' | 'fill' | 'stroke' | 'save' | 'restore' | 'translate' | 'rotate' | 'drawImage'>
  & Record<'fillStyle' | 'strokeStyle' | 'lineWidth' | 'font' | 'textAlign' | 'globalAlpha', unknown>

export function paintFlyer(ctx: Ctx, ops: DrawOp[]): void {
  for (const op of ops) {
    if (op.op === 'rect') {
      ctx.fillStyle = op.fill
      if (op.alpha !== undefined) ctx.globalAlpha = op.alpha
      if (op.radius) {
        ctx.beginPath(); ctx.roundRect(op.x, op.y, op.w, op.h, op.radius); ctx.fill()
        if (op.stroke) { ctx.strokeStyle = op.stroke; ctx.lineWidth = 3; ctx.stroke() }
      } else ctx.fillRect(op.x, op.y, op.w, op.h)
      if (op.alpha !== undefined) ctx.globalAlpha = 1
    } else if (op.op === 'text') {
      ctx.fillStyle = op.fill; ctx.textAlign = op.align
      ctx.font = `${op.weight} ${op.size}px Manrope, Inter, system-ui, sans-serif`
      if (op.rotate || op.alpha !== undefined) {
        ctx.save(); ctx.translate(op.x, op.y); ctx.rotate(op.rotate ?? 0); ctx.globalAlpha = op.alpha ?? 1
        ctx.fillText(op.text, 0, 0, op.maxWidth)
        ctx.restore()
      } else ctx.fillText(op.text, op.x, op.y, op.maxWidth)
    } else if (op.op === 'image') {
      // Una imagen que no carga o contamina el lienzo no debe impedir el flyer: se omite.
      try {
        if (op.src) ctx.drawImage(op.image, op.src.x, op.src.y, op.src.w, op.src.h, op.x, op.y, op.w, op.h)
        else ctx.drawImage(op.image, op.x, op.y, op.w, op.h)
      } catch { /* sin imagen */ }
    } else {
      const cell = Math.floor(op.size / op.modules.length)
      const offset = Math.floor((op.size - cell * op.modules.length) / 2)
      ctx.fillStyle = op.background
      ctx.fillRect(op.x, op.y, op.size, op.size)
      ctx.fillStyle = op.fill
      op.modules.forEach((row, r) => {
        // Tramos horizontales contiguos en un solo rectángulo: menos llamadas y sin juntas visibles entre módulos.
        for (let c = 0; c < row.length; c++) {
          if (!row[c]) continue
          let end = c
          while (end + 1 < row.length && row[end + 1]) end++
          ctx.fillRect(op.x + offset + c * cell, op.y + offset + r * cell, (end - c + 1) * cell, cell)
          c = end
        }
      })
    }
  }
}

/** Carga una imagen apta para el lienzo (CORS anónimo). null si falla o tarda más de `timeoutMs`. */
export function loadFlyerImage(url: string | null | undefined, timeoutMs = 5000, doc: Document = document): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = doc.createElement('img')
    const timer = setTimeout(() => resolve(null), timeoutMs)
    img.crossOrigin = 'anonymous'
    img.onload = () => { clearTimeout(timer); resolve(img) }
    img.onerror = () => { clearTimeout(timer); resolve(null) }
    img.src = url
  })
}

function exportFlyer(input: FlyerInput, extras: FlyerExtras, doc: Document): Promise<Blob | null> {
  const size = FLYER_FORMATS[extras.format ?? 'chat']
  const canvas = doc.createElement('canvas')
  canvas.width = size.width; canvas.height = size.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)
  paintFlyer(ctx as unknown as Ctx, buildFlyerLayout(input, extras))
  // Con foto de fondo, JPEG pesa varias veces menos y WhatsApp lo envía más rápido; sin foto, PNG mantiene el texto nítido.
  const type = extras.background ? 'image/jpeg' : 'image/png'
  const quality = extras.background ? 0.9 : undefined
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality)
    } catch {
      resolve(null)   // lienzo contaminado por una imagen sin CORS
    }
  })
}

/** Genera la imagen PNG en el dispositivo. Si el logo impide exportar, repite sin logo. null si el navegador no ofrece canvas/toBlob. */
export async function renderFlyer(input: FlyerInput, extras: FlyerExtras = {}, doc: Document = document): Promise<Blob | null> {
  const blob = await exportFlyer(input, extras, doc)
  if (blob || !extras.brand?.logo) return blob
  return exportFlyer(input, { ...extras, brand: { ...extras.brand, logo: null } }, doc)
}
