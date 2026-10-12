import { describe, expect, it, vi } from 'vitest'
import { chunk, readInChunks } from './chunks'

describe('chunk', () => {
  it('trocea en lotes del tamaño pedido y conserva el orden', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 2)).toEqual([])
    expect(chunk([1], 0)).toEqual([[1]])
  })
})

describe('readInChunks', () => {
  it('no hace peticiones con una lista vacía', async () => {
    const read = vi.fn()
    expect(await readInChunks([], read)).toEqual([])
    expect(read).not.toHaveBeenCalled()
  })

  it('divide 380 ids en 4 peticiones de 100 como máximo y une los resultados', async () => {
    const ids = Array.from({ length: 380 }, (_, index) => `id-${index}`)
    const read = vi.fn(async (batch: string[]) => batch.map((id) => ({ id })))
    const rows = await readInChunks(ids, read)
    expect(read).toHaveBeenCalledTimes(4)
    expect(Math.max(...read.mock.calls.map(([batch]) => batch.length))).toBe(100)
    expect(rows).toHaveLength(380)
    expect(rows.map((row) => row.id)).toEqual(ids)
  })
})
