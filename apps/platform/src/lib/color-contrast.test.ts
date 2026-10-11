import { describe, expect, it } from 'vitest'
import { readableTextColor, relativeLuminance } from './color-contrast'

describe('readableTextColor', () => {
  it('uses dark text on light or bright colors and light text on dark colors', () => {
    expect(readableTextColor('#ffffff')).toBe('#03111c')
    expect(readableTextColor('#ffd23f')).toBe('#03111c')
    expect(readableTextColor('#21f59a')).toBe('#03111c')
    expect(readableTextColor('#0b2a6b')).toBe('#f7fafc')
    expect(readableTextColor('#111827')).toBe('#f7fafc')
  })

  it('accepts short hex and treats invalid input as black', () => {
    expect(relativeLuminance('#fff')).toBeCloseTo(1)
    expect(relativeLuminance('not-a-color')).toBe(0)
  })
})
