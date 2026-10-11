import { describe, expect, it, vi } from 'vitest'
import { shareLink } from './share'

const data = { title: 'Liga', url: 'https://example.test/ligas/liga-mx' }

describe('shareLink', () => {
  it('uses Web Share when available', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    expect(await shareLink(data, { share })).toBe('shared')
    expect(share).toHaveBeenCalledWith(data)
  })

  it('treats a dismissed share dialog as cancelled, without copying', async () => {
    const writeText = vi.fn()
    const share = vi.fn().mockRejectedValue(new DOMException('dismissed', 'AbortError'))
    expect(await shareLink(data, { share, clipboard: { writeText } as unknown as Clipboard })).toBe('cancelled')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to copying the URL', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    expect(await shareLink(data, { clipboard: { writeText } as unknown as Clipboard })).toBe('copied')
    expect(writeText).toHaveBeenCalledWith(data.url)
  })

  it('reports unsupported when nothing works', async () => {
    expect(await shareLink(data, {})).toBe('unsupported')
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    expect(await shareLink(data, { clipboard: { writeText } as unknown as Clipboard })).toBe('unsupported')
  })
})
