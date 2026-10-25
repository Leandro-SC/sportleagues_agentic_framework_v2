// ADR-026: núcleo de la Edge Function delete-account (index.ts solo lo expone con Deno.serve).
import { describe, expect, it } from 'vitest'
import { allowedOrigins, bearerToken, corsHeaders, mapAnonymizeError, NATIVE_APP_ORIGIN, STATUS, validConfirmation } from '../../../../supabase/functions/delete-account/_core.ts'

describe('delete-account: CORS', () => {
  it('admite los orígenes configurados y el del wrapper nativo', () => {
    expect(allowedOrigins('https://sportleagues-qa.vercel.app')).toEqual(['https://sportleagues-qa.vercel.app', NATIVE_APP_ORIGIN])
    expect(allowedOrigins(undefined)).toEqual([NATIVE_APP_ORIGIN])
    expect(corsHeaders('https://sportleagues-qa.vercel.app', 'https://sportleagues-qa.vercel.app')['access-control-allow-origin']).toBe('https://sportleagues-qa.vercel.app')
    expect(corsHeaders('https://evil.example', 'https://sportleagues-qa.vercel.app')).toEqual({})
    expect(corsHeaders(null, 'x')).toEqual({})
  })
})

describe('delete-account: entrada', () => {
  it('exige un token Bearer', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi')
    expect(bearerToken('Basic x')).toBeNull()
    expect(bearerToken(null)).toBeNull()
  })

  it('solo acepta la confirmación exacta, sin campos extra (el usuario sale del JWT, no del cuerpo)', () => {
    expect(validConfirmation('{"confirm":"ELIMINAR"}')).toBe(true)
    expect(validConfirmation('{"confirm":"eliminar"}')).toBe(false)
    expect(validConfirmation('{"confirm":"ELIMINAR","user_id":"otro"}')).toBe(false)
    expect(validConfirmation('no json')).toBe(false)
    expect(validConfirmation(`{"confirm":"ELIMINAR","x":"${'a'.repeat(300)}"}`)).toBe(false)
  })
})

describe('delete-account: errores', () => {
  it('traduce los impedimentos administrativos a 409 con su detalle', () => {
    expect(mapAnonymizeError({ message: 'account has administrative roles', hint: 'ADMINISTERS_ORGANIZATION,ADMINISTERS_POOL' })).toEqual({ code: 'HAS_ADMIN_ROLES', blockers: ['ADMINISTERS_ORGANIZATION', 'ADMINISTERS_POOL'] })
    expect(STATUS.HAS_ADMIN_ROLES).toBe(409)
    expect(mapAnonymizeError({ message: 'boom' })).toEqual({ code: 'INTERNAL_ERROR' })
    expect(mapAnonymizeError(null)).toBeNull()
  })
})
