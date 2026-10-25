// Ajuste inteligente del logo antes de subirlo, en el navegador y sin servicios externos:
//   1. detecta el fondo (transparente o de un color liso) mirando las esquinas;
//   2. recorta los márgenes vacíos alrededor del dibujo;
//   3. lo centra en un lienzo cuadrado con aire alrededor, conservando su proporción (nunca se estira);
//   4. ajusta el tamaño a lo que acepta el servidor (256–2048 px, máx. 1 MiB) y conserva la transparencia.
// El organizador ve el antes y el después y elige; la subida y la normalización final siguen siendo del servidor (branding-asset).
import { brandingAssetLimits } from './admin-contracts'
import { readLocalImage } from './local-image'

export type Rect = { x: number; y: number; w: number; h: number }
export type Background = { kind: 'transparent' } | { kind: 'solid'; r: number; g: number; b: number } | { kind: 'none' }
export type LogoPlan = { size: number; crop: Rect; dest: Rect }

const ALPHA_EMPTY = 16
const COLOR_TOLERANCE = 28

const px = (data: ArrayLike<number>, w: number, x: number, y: number): [number, number, number, number] => {
  const i = (y * w + x) * 4
  return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!]
}
const close = (a: number[], b: number[], tolerance: number): boolean => Math.abs(a[0]! - b[0]!) <= tolerance && Math.abs(a[1]! - b[1]!) <= tolerance && Math.abs(a[2]! - b[2]!) <= tolerance

/** Fondo según las cuatro esquinas: todas transparentes, todas del mismo color opaco, o sin fondo reconocible. */
export function detectBackground(data: ArrayLike<number>, w: number, h: number): Background {
  const corners = [px(data, w, 0, 0), px(data, w, w - 1, 0), px(data, w, 0, h - 1), px(data, w, w - 1, h - 1)]
  if (corners.every((c) => c[3] < ALPHA_EMPTY)) return { kind: 'transparent' }
  if (corners.every((c) => c[3] > 240) && corners.every((c) => close(c, corners[0]!, COLOR_TOLERANCE))) {
    const avg = (k: number) => Math.round(corners.reduce((sum, c) => sum + c[k]!, 0) / corners.length)
    return { kind: 'solid', r: avg(0), g: avg(1), b: avg(2) }
  }
  return { kind: 'none' }
}

/** Caja que contiene todo lo que no es fondo. null si la imagen está vacía. Sin fondo reconocible, la imagen completa. */
export function contentBounds(data: ArrayLike<number>, w: number, h: number, bg: Background): Rect | null {
  if (bg.kind === 'none') return { x: 0, y: 0, w, h }
  const isContent = (x: number, y: number): boolean => {
    const c = px(data, w, x, y)
    if (bg.kind === 'transparent') return c[3] >= ALPHA_EMPTY
    return c[3] >= ALPHA_EMPTY && !close(c, [bg.r, bg.g, bg.b], COLOR_TOLERANCE)
  }
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isContent(x, y)) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/** Lienzo cuadrado de 512–1024 px con un 10 % de aire; el dibujo se encaja centrado sin deformarse. */
export function planLogo(content: Rect, opts: { min?: number; max?: number; padding?: number } = {}): LogoPlan {
  const min = opts.min ?? 512
  const max = opts.max ?? 1024
  const padding = opts.padding ?? 0.1
  const side = Math.max(content.w, content.h)
  const size = Math.min(max, Math.max(min, Math.round(side / (1 - 2 * padding))))
  const inner = size * (1 - 2 * padding)
  const scale = inner / side
  const w = Math.round(content.w * scale)
  const h = Math.round(content.h * scale)
  return { size, crop: content, dest: { x: Math.round((size - w) / 2), y: Math.round((size - h) / 2), w, h } }
}

/** Describe para el organizador qué cambió, en lenguaje llano. */
export function describeLogoFix(source: { width: number; height: number }, content: Rect, plan: LogoPlan, bg: Background): string[] {
  const notes: string[] = []
  const trimmed = 1 - (content.w * content.h) / (source.width * source.height)
  if (trimmed > 0.02) notes.push(`Recortamos los márgenes vacíos (${Math.round(trimmed * 100)} % de la imagen).`)
  if (source.width !== source.height || trimmed > 0.02) notes.push('Lo centramos en un cuadrado con aire alrededor, sin estirarlo.')
  if (plan.size !== Math.max(source.width, source.height)) notes.push(`Ajustamos el tamaño a ${plan.size}×${plan.size} px.`)
  if (bg.kind === 'transparent') notes.push('Conservamos el fondo transparente.')
  else if (bg.kind === 'solid') notes.push('Mantuvimos su color de fondo en todo el cuadrado.')
  return notes
}

export type LogoFixResult = { ok: true; file: File; width: number; height: number; notes: string[] } | { ok: false; message: string }

const ANALYSIS_MAX = 1600   // análisis sobre una copia reducida: rápido incluso con fotos grandes

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), type, quality))
}

export async function fixLogo(file: File, doc: Document = document): Promise<LogoFixResult> {
  const read = await readLocalImage(file)
  if (!read.ok) return read
  const { image, width, height } = read.value
  const ratio = Math.min(1, ANALYSIS_MAX / Math.max(width, height))
  const aw = Math.max(1, Math.round(width * ratio))
  const ah = Math.max(1, Math.round(height * ratio))
  const analysis = doc.createElement('canvas')
  analysis.width = aw; analysis.height = ah
  const actx = analysis.getContext('2d', { willReadFrequently: true })
  if (!actx) return { ok: false, message: 'Tu navegador no puede ajustar imágenes.' }
  actx.drawImage(image, 0, 0, aw, ah)
  const { data } = actx.getImageData(0, 0, aw, ah)
  const bg = detectBackground(data, aw, ah)
  const found = contentBounds(data, aw, ah, bg)
  if (!found) return { ok: false, message: 'La imagen parece vacía.' }
  // De vuelta a coordenadas de la imagen original, con un píxel de margen por el redondeo.
  const content: Rect = {
    x: Math.max(0, Math.floor(found.x / ratio) - 1), y: Math.max(0, Math.floor(found.y / ratio) - 1),
    w: Math.min(width, Math.ceil(found.w / ratio) + 2), h: Math.min(height, Math.ceil(found.h / ratio) + 2),
  }
  content.w = Math.min(content.w, width - content.x); content.h = Math.min(content.h, height - content.y)
  const limits = brandingAssetLimits.logo

  for (const max of [1024, 768, 512]) {
    const plan = planLogo(content, { min: Math.max(limits.minWidth, Math.min(512, max)), max })
    const out = doc.createElement('canvas')
    out.width = plan.size; out.height = plan.size
    const ctx = out.getContext('2d')
    if (!ctx) return { ok: false, message: 'Tu navegador no puede ajustar imágenes.' }
    if (bg.kind === 'solid') { ctx.fillStyle = `rgb(${bg.r}, ${bg.g}, ${bg.b})`; ctx.fillRect(0, 0, plan.size, plan.size) }
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, plan.crop.x, plan.crop.y, plan.crop.w, plan.crop.h, plan.dest.x, plan.dest.y, plan.dest.w, plan.dest.h)
    // PNG conserva bordes nítidos y transparencia; si pesa más de lo permitido, WebP de alta calidad (también con alfa).
    let blob = await toBlob(out, 'image/png')
    if (blob && blob.size > limits.maxBytes) blob = await toBlob(out, 'image/webp', 0.92)
    if (blob && blob.size <= limits.maxBytes && (blob.type === 'image/png' || blob.type === 'image/webp')) {
      const name = file.name.replace(/\.[^.]+$/, '') || 'logo'
      return { ok: true, file: new File([blob], `${name}-ajustado.${blob.type === 'image/png' ? 'png' : 'webp'}`, { type: blob.type }), width: plan.size, height: plan.size, notes: describeLogoFix({ width, height }, content, plan, bg) }
    }
  }
  return { ok: false, message: 'No pudimos dejar el logo por debajo de 1 MiB. Prueba con una imagen más simple.' }
}
