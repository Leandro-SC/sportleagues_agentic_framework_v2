import { describe, expect, it, vi } from 'vitest'
import { shareImage, shareLink } from './share'

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

describe('shareImage', () => {
  const file = { blob: new Blob(['x'], { type: 'image/png' }), filename: 'r.png', title: 'Mi resultado' }

  it('usa el menú nativo con archivos cuando el navegador lo permite', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    expect(await shareImage(file, { share, canShare: () => true }, null)).toBe('shared')
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ title: 'Mi resultado' }))
  })

  it('cancelar el diálogo no es un error', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('x', 'AbortError'))
    expect(await shareImage(file, { share, canShare: () => true }, null)).toBe('cancelled')
  })

  it('sin Web Share de archivos descarga la imagen', async () => {
    const click = vi.fn()
    const anchor = { click, remove: vi.fn(), href: '', download: '' }
    const doc = { createElement: vi.fn(() => anchor), body: { appendChild: vi.fn() } }
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() })
    expect(await shareImage(file, {}, doc as never)).toBe('downloaded')
    expect(click).toHaveBeenCalled()
    expect(anchor.download).toBe('r.png')
    vi.unstubAllGlobals()
  })

  it('sin Web Share ni documento queda como no soportado', async () => {
    expect(await shareImage(file, {}, null)).toBe('unsupported')
  })
})
