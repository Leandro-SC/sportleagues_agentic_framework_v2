import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BrandingAssetSlot from './BrandingAssetSlot.vue'

const asset = { asset_id: 'asset-1', asset_kind: 'logo' as const, signed_url: 'https://signed.example/logo.webp' }

class SuccessfulImage {
  naturalWidth = 512
  naturalHeight = 512
  onload: (() => void) | null = null
  onerror: (() => void) | null = null

  set src(_value: string) {
    queueMicrotask(() => this.onload?.())
  }
}

// Sin ajuste disponible (como en un navegador sin canvas): se conserva el flujo de subida directa.
const noFix = async () => ({ ok: false as const, message: '' })

function mountSlot(overrides: Record<string, unknown> = {}) {
  return mount(BrandingAssetSlot, {
    props: { kind: 'logo', plan: 'pro', asset: null, busy: false, error: '', fixer: noFix, ...overrides },
  })
}

async function selectFile(wrapper: ReturnType<typeof mountSlot>, file: File): Promise<void> {
  const input = wrapper.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
  await input.trigger('change')
  await flushPromises()
}

describe('BrandingAssetSlot', () => {
  beforeEach(() => {
    vi.stubGlobal('Image', SuccessfulImage)
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('shows a concise PRO lock state without upload controls for FREE', () => {
    const wrapper = mountSlot({ plan: 'free' })
    expect(wrapper.text()).toContain('disponibles en PRO')
    expect(wrapper.find('input[type="file"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Subir logo')
  })

  it('shows upload controls for PRO and emits a valid local selection', async () => {
    const wrapper = mountSlot()
    await selectFile(wrapper, new File(['image'], 'logo.png', { type: 'image/png' }))
    expect(wrapper.emitted('upload')?.[0]).toBeTruthy()
    expect(wrapper.text()).toContain('Listo para subir')
  })

  it('rejects an invalid type and oversized file before emitting upload', async () => {
    const wrapper = mountSlot()
    await selectFile(wrapper, new File(['not an image'], 'logo.svg', { type: 'image/svg+xml' }))
    expect(wrapper.emitted('upload')).toBeUndefined()
    expect(wrapper.text()).toContain('PNG, JPEG o WebP')

    const oversized = new File([new Uint8Array(1024 * 1024 + 1)], 'logo.png', { type: 'image/png' })
    await selectFile(wrapper, oversized)
    expect(wrapper.emitted('upload')).toBeUndefined()
    expect(wrapper.text()).toContain('1 MiB')
  })

  it('disables conflicting controls while uploading', () => {
    const wrapper = mountSlot({ busy: true, asset })
    expect(wrapper.text()).toContain('Subiendo logo')
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
  })

  it('keeps the previous asset visible after a replacement error', async () => {
    const wrapper = mountSlot({ asset })
    await selectFile(wrapper, new File(['image'], 'logo.png', { type: 'image/png' }))
    expect(wrapper.get('img').attributes('src')).toBe('blob:preview')
    await wrapper.setProps({ error: 'No pudimos guardar la imagen.' })
    expect(wrapper.get('img').attributes('src')).toBe(asset.signed_url)
  })

  it('confirms removal before emitting the destructive action', async () => {
    const wrapper = mountSlot({ asset })
    await wrapper.get('button:nth-of-type(2)').trigger('click')
    expect(wrapper.text()).toContain('¿Eliminar el logo?')
    expect(wrapper.emitted('remove')).toBeUndefined()
    await wrapper.get('button.bg-danger-100').trigger('click')
    expect(wrapper.emitted('remove')).toHaveLength(1)
  })
})

describe('BrandingAssetSlot — ajuste inteligente del logo', () => {
  beforeEach(() => {
    vi.stubGlobal('Image', SuccessfulImage)
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() })
  })
  afterEach(() => vi.unstubAllGlobals())

  const fixed = new File(['fixed'], 'logo-ajustado.png', { type: 'image/png' })
  const fixer = vi.fn(async () => ({ ok: true as const, file: fixed, width: 1024, height: 1024, notes: ['Recortamos los márgenes vacíos (40 % de la imagen).'] }))

  it('propone la versión ajustada con antes/después y no sube nada hasta elegir', async () => {
    const wrapper = mountSlot({ fixer })
    await selectFile(wrapper, new File(['image'], 'logo.png', { type: 'image/png' }))
    expect(wrapper.get('[data-testid="logo-fix-proposal"]').text()).toContain('Recortamos los márgenes')
    expect(wrapper.emitted('upload')).toBeUndefined()
    await wrapper.get('[data-testid="logo-fix-use-fixed"]').trigger('click')
    expect(wrapper.emitted('upload')?.[0]?.[0]).toBe(fixed)
    expect(wrapper.find('[data-testid="logo-fix-proposal"]').exists()).toBe(false)
  })

  it('permite subir el original si es válido', async () => {
    const original = new File(['image'], 'logo.png', { type: 'image/png' })
    const wrapper = mountSlot({ fixer })
    await selectFile(wrapper, original)
    await wrapper.get('[data-testid="logo-fix-use-original"]').trigger('click')
    expect(wrapper.emitted('upload')?.[0]?.[0]).toBe(original)
  })

  it('si el original no cumple los límites solo ofrece la versión ajustada', async () => {
    const wrapper = mountSlot({ fixer })
    await selectFile(wrapper, new File([new Uint8Array(1024 * 1024 + 1)], 'grande.png', { type: 'image/png' }))
    expect(wrapper.get('[data-testid="logo-fix-use-original"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('El original no se puede subir tal cual')
    await wrapper.get('[data-testid="logo-fix-use-fixed"]').trigger('click')
    expect(wrapper.emitted('upload')?.[0]?.[0]).toBe(fixed)
  })

  it('el banner no pasa por el ajuste del logo', async () => {
    vi.stubGlobal('Image', class { naturalWidth = 1600; naturalHeight = 600; onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(_v: string) { queueMicrotask(() => this.onload?.()) } })
    const wrapper = mountSlot({ kind: 'banner', fixer })
    fixer.mockClear()
    await selectFile(wrapper, new File(['image'], 'banner.png', { type: 'image/png' }))
    expect(fixer).not.toHaveBeenCalled()
    expect(wrapper.emitted('upload')).toBeTruthy()
  })
})
