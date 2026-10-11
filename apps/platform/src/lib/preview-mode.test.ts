import { describe, expect, it } from 'vitest'
import { isPreviewDataEnabled } from './preview-mode'

describe('isPreviewDataEnabled', () => {
  it('is off for production builds unless explicitly enabled', () => {
    expect(isPreviewDataEnabled({ DEV: false })).toBe(false)
    expect(isPreviewDataEnabled({ DEV: false, VITE_PREVIEW_DATA: 'true' })).toBe(true)
  })

  it('is on in local development unless explicitly disabled', () => {
    expect(isPreviewDataEnabled({ DEV: true })).toBe(true)
    expect(isPreviewDataEnabled({ DEV: true, VITE_PREVIEW_DATA: 'false' })).toBe(false)
  })

  it('ignores values other than true/false', () => {
    expect(isPreviewDataEnabled({ DEV: false, VITE_PREVIEW_DATA: '1' })).toBe(false)
  })
})
