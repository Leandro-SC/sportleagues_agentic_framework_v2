import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({ getSupabaseClient: () => ({ rpc: h.rpc }) }))

import PoolCreationRequestCard from './PoolCreationRequestCard.vue'

const row = (overrides: Record<string, unknown> = {}) => ({ id: 'r1', status: 'pending', created: true, requested_at: '2026-10-12T10:00:00Z', reviewed_at: null, ...overrides })
const answer = (map: Record<string, unknown>) => h.rpc.mockImplementation(async (fn: string) => {
  const value = map[fn]
  if (value instanceof Error) throw value
  return value ?? { data: null, error: null }
})

const mounted: Array<{ unmount: () => void }> = []
async function mountCard() {
  const wrapper = mount(PoolCreationRequestCard, { attachTo: document.body })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}
const body = () => document.body
const button = (label: string) => [...body().querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined

beforeEach(() => { h.rpc.mockReset() })
afterEach(() => { mounted.splice(0).forEach((w) => w.unmount()) })

describe('PoolCreationRequestCard', () => {
  it('offers the CTA, explains that nothing is granted until approval, and opens a sheet with an optional note', async () => {
    answer({ my_pool_creation_request: { data: null, error: null } })
    const wrapper = await mountCard()
    expect(wrapper.text()).toContain('Crear mi propia quiniela')
    expect(wrapper.text()).toContain('no recibirás permisos hasta que se apruebe')
    const cta = button('Crear mi propia quiniela')!
    expect(cta.disabled).toBe(false)
    cta.click(); await flushPromises()
    expect(body().querySelector('[role="dialog"] textarea#pool-request-note')).not.toBeNull()
    expect(body().querySelector('label[for="pool-request-note"]')?.textContent).toContain('opcional')
  })

  it('sends only the trimmed note, closes the sheet and shows the pending state with cancel', async () => {
    answer({ my_pool_creation_request: { data: null, error: null }, request_pool_creation: { data: row(), error: null } })
    const wrapper = await mountCard()
    button('Crear mi propia quiniela')!.click(); await flushPromises()
    const textarea = body().querySelector('textarea') as HTMLTextAreaElement
    textarea.value = '  Quiero organizar la liga del barrio  '; textarea.dispatchEvent(new Event('input')); await flushPromises()
    expect(body().querySelector('#pool-request-count')?.textContent).toContain('/500')
    button('Enviar solicitud')!.click(); await flushPromises()
    expect(h.rpc).toHaveBeenCalledWith('request_pool_creation', { p_note: 'Quiero organizar la liga del barrio' })
    expect(body().querySelector('[role="dialog"]')).toBeNull()
    expect(wrapper.get('[data-test="request-status"]').text()).toContain('Solicitud pendiente')
    expect(button('Cancelar solicitud')).toBeDefined()
    expect(button('Crear mi propia quiniela')).toBeUndefined() // reenvío deshabilitado mientras hay una pendiente
  })

  it('shows the pending state from the server on load and cancels it after a confirmation step', async () => {
    answer({ my_pool_creation_request: { data: row(), error: null }, cancel_pool_creation_request: { data: row({ status: 'cancelled', created: undefined }), error: null } })
    const wrapper = await mountCard()
    expect(wrapper.text()).toContain('Solicitud pendiente')
    button('Cancelar solicitud')!.click(); await flushPromises()
    expect(h.rpc).not.toHaveBeenCalledWith('cancel_pool_creation_request', undefined) // aún no: pide confirmación
    expect(wrapper.find('[data-test="cancel-confirm"]').exists()).toBe(true)
    button('Sí, cancelar')!.click(); await flushPromises()
    expect(h.rpc).toHaveBeenCalledWith('cancel_pool_creation_request', undefined)
    expect(wrapper.get('[data-test="request-status"]').text()).toContain('Solicitud cancelada')
    expect(button('Enviar una nueva solicitud')!.disabled).toBe(false)
  })

  it('shows approved and rejected states with clear text', async () => {
    answer({ my_pool_creation_request: { data: row({ status: 'rejected', reviewed_at: '2026-10-13T10:00:00Z' }), error: null } })
    const rejected = await mountCard()
    expect(rejected.get('[data-test="request-status"]').text()).toContain('no fue aprobada')
    expect(button('Enviar una nueva solicitud')).toBeDefined()
    mounted.splice(0).forEach((w) => w.unmount())
    answer({ my_pool_creation_request: { data: row({ status: 'approved', reviewed_at: '2026-10-13T10:00:00Z' }), error: null } })
    const approved = await mountCard()
    expect(approved.get('[data-test="request-status"]').text()).toContain('Solicitud aprobada')
  })

  it('degrades with a disabled CTA and the unavailable message when the RPC does not exist', async () => {
    answer({ my_pool_creation_request: { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } } })
    const wrapper = await mountCard()
    expect(wrapper.get('[data-test="unavailable"]').text()).toContain('Función aún no disponible en este entorno')
    expect(button('Crear mi propia quiniela')!.disabled).toBe(true)
    expect(wrapper.text()).not.toContain('PGRST202')
  })

  it('degrades on a network failure and offers a retry that recovers', async () => {
    answer({ my_pool_creation_request: new TypeError('Failed to fetch') })
    const wrapper = await mountCard()
    expect(wrapper.get('[data-test="unavailable"]').text()).toContain('Función aún no disponible en este entorno')
    expect(button('Crear mi propia quiniela')!.disabled).toBe(true)
    answer({ my_pool_creation_request: { data: null, error: null } })
    button('Reintentar')!.click(); await flushPromises()
    expect(button('Crear mi propia quiniela')!.disabled).toBe(false)
  })

  it('shows the server rejection inside the sheet without leaking raw errors', async () => {
    answer({ my_pool_creation_request: { data: null, error: null }, request_pool_creation: { data: null, error: { code: '22023', message: 'note too long internal' } } })
    await mountCard()
    button('Crear mi propia quiniela')!.click(); await flushPromises()
    button('Enviar solicitud')!.click(); await flushPromises()
    const alert = body().querySelector('[role="dialog"] [role="alert"]')!
    expect(alert.textContent).toMatch(/nota no es válida/)
    expect(alert.textContent).not.toContain('internal')
  })
})
