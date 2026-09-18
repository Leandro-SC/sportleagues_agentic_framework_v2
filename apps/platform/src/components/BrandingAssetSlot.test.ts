import { mount } from '@vue/test-utils'
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

function mountSlot(overrides: Record<string, unknown> = {}) {
  return mount(BrandingAssetSlot, {
    props: { kind: 'logo', plan: 'pro', asset: null, busy: false, error: '', ...overrides },
  })
}

async function selectFile(wrapper: ReturnType<typeof mountSlot>, file: File): Promise<void> {
  const input = wrapper.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
  await input.trigger('change')
  await Promise.resolve()
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
