import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installGlobalErrorHandlers, reportError, resetTelemetryForTests, safeRoute, scrubPii, setTelemetrySink, trackEvent, type TelemetryEvent } from './telemetry'

describe('scrubPii', () => {
  it('redacta correos, UUID, JWT, bearer y parámetros secretos', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop'
    const out = scrubPii(`fallo de ana@example.com id 123e4567-e89b-12d3-a456-426614174000 ${jwt} Bearer abcdefgh12345678 https://x.test/cb?access_token=SECRETO&a=1#refresh_token=OTRO`)
    expect(out).not.toMatch(/ana@example\.com/)
    expect(out).not.toMatch(/123e4567/)
    expect(out).not.toMatch(/eyJhbGci/)
    expect(out).not.toMatch(/abcdefgh12345678/)
    expect(out).not.toMatch(/SECRETO|OTRO/)
    expect(out).toContain('[email]')
    expect(out).toContain('[id]')
  })

  it('acepta Error y valores no string, y limita la longitud', () => {
    expect(scrubPii(new Error('boom'))).toBe('boom')
    expect(scrubPii(undefined)).toBe('')
    expect(scrubPii('x'.repeat(1000)).length).toBe(300)
  })
})

describe('safeRoute', () => {
  it('quita query/hash y oculta códigos de unión', () => {
    expect(safeRoute('/j/AB12CD?x=1#h')).toBe('/j/[code]')
    expect(safeRoute('/p/123e4567-e89b-12d3-a456-426614174000')).toBe('/p/[id]')
    expect(safeRoute(undefined)).toBeUndefined()
  })
})

describe('telemetría', () => {
  beforeEach(() => resetTelemetryForTests())

  it('entrega eventos depurados al sumidero y nunca lanza si el sumidero falla', () => {
    const seen: TelemetryEvent[] = []
    setTelemetrySink((e) => seen.push(e))
    reportError(new Error('x ana@example.com'), { route: '/perfil?token=abc' })
    expect(seen[0]).toMatchObject({ kind: 'error', message: 'x [email]', route: '/perfil' })
    setTelemetrySink(() => { throw new Error('sumidero roto') })
    expect(() => reportError('otra')).not.toThrow()
    expect(() => trackEvent('evt')).not.toThrow()
  })

  it('instala los manejadores globales una sola vez y reporta sin PII', () => {
    const listeners: Record<string, Array<(e: unknown) => void>> = {}
    const target = {
      addEventListener: vi.fn((type: string, fn: (e: unknown) => void) => { (listeners[type] ??= []).push(fn) }),
      location: { pathname: '/j/AB12CD' },
    } as unknown as Pick<Window, 'addEventListener' | 'location'>
    const seen: TelemetryEvent[] = []
    setTelemetrySink((e) => seen.push(e))
    installGlobalErrorHandlers(target)
    installGlobalErrorHandlers(target)
    expect(target.addEventListener).toHaveBeenCalledTimes(2)
    listeners.error[0]({ error: new Error('bad') })
    listeners.unhandledrejection[0]({ reason: 'rechazo ana@example.com' })
    expect(seen.map((e) => e.kind)).toEqual(['error', 'unhandled-rejection'])
    expect(seen[1].message).toBe('rechazo [email]')
    expect(seen[0].route).toBe('/j/[code]')
  })
})
