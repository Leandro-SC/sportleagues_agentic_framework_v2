// Elige texto oscuro o claro sobre un color de fondo hexadecimal (#rgb o #rrggbb) usando la
// luminancia relativa de WCAG. Se usa en escudos y emblemas generados con colores de equipo.
export function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map((char) => char + char).join('') : value
  if (!/^[0-9a-f]{6}$/i.test(full)) return 0
  const [r, g, b] = [0, 2, 4].map((offset) => {
    const channel = parseInt(full.slice(offset, offset + 2), 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

export function readableTextColor(background: string, dark = '#03111c', light = '#f7fafc'): string {
  const luminance = relativeLuminance(background)
  const contrastWithDark = (luminance + 0.05) / (relativeLuminance(dark) + 0.05)
  const contrastWithLight = (relativeLuminance(light) + 0.05) / (luminance + 0.05)
  return contrastWithDark >= contrastWithLight ? dark : light
}
