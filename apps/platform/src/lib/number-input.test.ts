import { describe, expect, it } from 'vitest'
import { parseNonNegativeInteger } from './number-input'

describe('parseNonNegativeInteger', () => {
  it('acepta enteros no negativos y recorta espacios', () => {
    expect(parseNonNegativeInteger('0')).toEqual({ ok: true, value: 0 })
    expect(parseNonNegativeInteger(' 12 ')).toEqual({ ok: true, value: 12 })
    expect(parseNonNegativeInteger('007')).toEqual({ ok: true, value: 7 })
  })

  it.each(['', '   '])('rechaza vacío %j como "empty" (nunca lo convierte en 0)', (value) => {
    expect(parseNonNegativeInteger(value)).toEqual({ ok: false, reason: 'empty' })
  })

  it.each(['-1', '1.5', '1,5', 'a', '1e2', '+3'])('rechaza %j por formato', (value) => {
    expect(parseNonNegativeInteger(value)).toEqual({ ok: false, reason: 'format' })
  })

  it('rechaza valores que no son cadenas', () => {
    expect(parseNonNegativeInteger(undefined)).toEqual({ ok: false, reason: 'format' })
    expect(parseNonNegativeInteger(null)).toEqual({ ok: false, reason: 'format' })
    expect(parseNonNegativeInteger(3)).toEqual({ ok: false, reason: 'format' })
  })

  it('aplica el tope y rechaza enteros no seguros', () => {
    expect(parseNonNegativeInteger('1000', 1000)).toEqual({ ok: true, value: 1000 })
    expect(parseNonNegativeInteger('1001', 1000)).toEqual({ ok: false, reason: 'max' })
    expect(parseNonNegativeInteger('99999999999999999999')).toEqual({ ok: false, reason: 'max' })
  })
})
