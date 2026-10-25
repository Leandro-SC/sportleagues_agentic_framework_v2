import { relativeLuminance } from './color-contrast'

// Branding PRO visible para participantes (white-label básico del PRD). El color del organizador solo se usa como acento sobre el
// fondo oscuro de la app y de los flyers: si no contrasta lo suficiente (WCAG 3:1 para elementos gráficos y texto grande) se
// conserva el acento de SportLeagues en lugar de pintar algo ilegible.
const CANVAS = '#03111c'
const MIN_CONTRAST = 3

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

/** Devuelve el color (#rrggbb en minúsculas) si es válido y legible sobre el fondo oscuro; si no, null. */
export function safeAccent(color: string | null | undefined, background = CANVAS): string | null {
  const value = color?.trim().toLowerCase() ?? ''
  if (!/^#[0-9a-f]{6}$/.test(value)) return null
  return contrastRatio(value, background) >= MIN_CONTRAST ? value : null
}

/** URL https pública de la app para QR y enlaces compartidos (también dentro del wrapper nativo, cuyo origen es local). */
export function publicAppUrl(host: string, path = '/'): string {
  return `https://${host}${path.startsWith('/') ? path : `/${path}`}`
}
