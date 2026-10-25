import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type Rule = { source: string; headers: Array<{ key: string; value: string }> }
const config = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../../vercel.json'), 'utf8')) as { headers: Rule[]; rewrites: Array<{ source: string; destination: string }> }
const global = Object.fromEntries(config.headers.find((r) => r.source === '/(.*)')!.headers.map((h) => [h.key, h.value]))

// F-06 (reports/security/security-review-20261012.md): cabeceras de seguridad y CSP en modo Report-Only.
describe('vercel.json: cabeceras de seguridad', () => {
  it('fija las cabeceras defensivas básicas', () => {
    expect(global['X-Content-Type-Options']).toBe('nosniff')
    expect(global['X-Frame-Options']).toBe('DENY')
    expect(global['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(global['Permissions-Policy']).toMatch(/camera=\(\)/)
    expect(global['Strict-Transport-Security']).toMatch(/max-age=\d{7,}/)
  })

  it('la CSP es Report-Only, sin eval ni scripts en línea, y solo permite los orígenes que la app usa', () => {
    const csp = global['Content-Security-Policy-Report-Only']
    expect(csp).toBeTruthy()
    expect(global['Content-Security-Policy']).toBeUndefined()   // aún no se impone: primero observar
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toMatch(/unsafe-eval/)
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toMatch(/connect-src 'self' https:\/\/\*\.supabase\.co/)
    expect(csp).toMatch(/img-src 'self' data: blob: https:\/\/\*\.supabase\.co/)   // logos de branding: URL firmada de Storage
    expect(csp).toContain('https://fonts.googleapis.com')
    expect(csp).toContain('https://fonts.gstatic.com')
    expect(csp).not.toMatch(/\*(;|\s|$)(?!\.)/)   // sin comodín total
  })

  it('los reportes CSP van solo al receptor desplegado de Supabase (F-06, runbook §1 paso 6)', () => {
    const csp = global['Content-Security-Policy-Report-Only']!
    const reportUris = [...csp.matchAll(/report-uri\s+(\S+)/g)].map((m) => m[1]!.replace(/;$/, ''))
    expect(reportUris).toHaveLength(1)
    expect(reportUris[0]).toMatch(/^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/csp-report$/)
    expect(csp.trim().endsWith(reportUris[0]!)).toBe(true)
  })

  it('assetlinks.json se sirve como JSON para la verificación de App Links', () => {
    const rule = config.headers.find((r) => r.source === '/.well-known/assetlinks.json')!
    expect(Object.fromEntries(rule.headers.map((h) => [h.key, h.value]))['Content-Type']).toBe('application/json')
  })

  it('el service worker no se cachea en el borde y se conserva el rewrite SPA', () => {
    const sw = config.headers.find((r) => r.source === '/sw.js')!
    expect(sw.headers.find((h) => h.key === 'Cache-Control')!.value).toMatch(/no-cache/)
    expect(config.rewrites).toEqual([{ source: '/(.*)', destination: '/' }])
  })
})
