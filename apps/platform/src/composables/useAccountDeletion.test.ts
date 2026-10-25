import { describe, expect, it, vi } from 'vitest'
import { blockerMessages, useAccountDeletion } from './useAccountDeletion'

function client(opts: { blockers?: string[]; rpcError?: boolean; invoke?: () => Promise<unknown> }) {
  const invoke = vi.fn(opts.invoke ?? (async () => ({ data: { code: 'DELETED' }, error: null })))
  return {
    invoke,
    client: {
      rpc: async () => (opts.rpcError ? { data: null, error: { message: 'x' } } : { data: opts.blockers ?? [], error: null }),
      functions: { invoke },
    } as never,
  }
}

describe('useAccountDeletion', () => {
  it('consulta los impedimentos y los explica en lenguaje llano', async () => {
    const fake = client({ blockers: ['ADMINISTERS_ORGANIZATION'] })
    const d = useAccountDeletion(() => fake.client)
    await d.loadBlockers()
    expect(d.blockers.value).toEqual(['ADMINISTERS_ORGANIZATION'])
    expect(blockerMessages(d.blockers.value!)[0]).toContain('transfiere')
  })

  it('exige escribir ELIMINAR y no llama a la función sin confirmación', async () => {
    const fake = client({})
    const d = useAccountDeletion(() => fake.client)
    expect(await d.deleteAccount('borrar')).toBe(false)
    expect(fake.invoke).not.toHaveBeenCalled()
    expect(d.error.value).toContain('ELIMINAR')
  })

  it('con confirmación invoca la Edge Function solo con la confirmación (el usuario sale del JWT)', async () => {
    const fake = client({})
    const d = useAccountDeletion(() => fake.client)
    expect(await d.deleteAccount('ELIMINAR')).toBe(true)
    expect(fake.invoke).toHaveBeenCalledWith('delete-account', { body: { confirm: 'ELIMINAR' } })
  })

  it('un 409 del servidor muestra el impedimento', async () => {
    const response = new Response(JSON.stringify({ code: 'HAS_ADMIN_ROLES', blockers: ['ADMINISTERS_POOL'] }), { status: 409 })
    const fake = client({ invoke: async () => ({ data: null, error: { context: response } }) })
    const d = useAccountDeletion(() => fake.client)
    expect(await d.deleteAccount('ELIMINAR')).toBe(false)
    expect(d.blockers.value).toEqual(['ADMINISTERS_POOL'])
    expect(d.error.value).toContain('quiniela')
  })

  it('un fallo genérico no deja la cuenta como eliminada', async () => {
    const fake = client({ invoke: async () => ({ data: null, error: { message: 'network' } }) })
    const d = useAccountDeletion(() => fake.client)
    expect(await d.deleteAccount('ELIMINAR')).toBe(false)
    expect(d.error.value).toContain('No pudimos eliminar')
  })
})
