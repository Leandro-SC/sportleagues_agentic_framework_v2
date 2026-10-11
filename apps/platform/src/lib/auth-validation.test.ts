import { describe, expect, it } from 'vitest'
import {
  authErrorMessage,
  normalizeEmail,
  sanitizeFullName,
  validateEmail,
  validateNewPassword,
  validatePasswordUpdate,
  validateSignIn,
  validateSignUp,
} from './auth-validation'

const VALID = { fullName: 'Ada Lovelace', email: 'ada@example.com', password: 'Secreta123', confirmPassword: 'Secreta123' }

describe('sign-up validation', () => {
  it('accepts a complete, consistent form', () => {
    expect(validateSignUp(VALID)).toEqual({})
  })

  it('requires a full name', () => {
    expect(validateSignUp({ ...VALID, fullName: '   ' }).fullName).toBeTruthy()
    expect(validateSignUp({ ...VALID, fullName: 'x'.repeat(81) }).fullName).toBeTruthy()
  })

  it('requires a valid email', () => {
    expect(validateSignUp({ ...VALID, email: '' }).email).toBeTruthy()
    expect(validateSignUp({ ...VALID, email: 'no-es-correo' }).email).toBeTruthy()
  })

  it('rejects short, letter-only and digit-only passwords', () => {
    expect(validateNewPassword('Ab1')).toMatch(/al menos 8/)
    expect(validateNewPassword('sololetras')).toMatch(/letras y números/)
    expect(validateNewPassword('12345678')).toMatch(/letras y números/)
    expect(validateNewPassword('a1'.repeat(40))).toMatch(/no puede superar/)
    expect(validateNewPassword('Secreta123')).toBeNull()
  })

  it('requires the confirmation to match', () => {
    expect(validateSignUp({ ...VALID, confirmPassword: 'Otra12345' }).confirmPassword).toBe('Las contraseñas no coinciden.')
    expect(validateSignUp({ ...VALID, confirmPassword: '' }).confirmPassword).toBeTruthy()
  })
})

describe('sign-in and password update validation', () => {
  it('requires email and password but does not apply the new-password policy to existing accounts', () => {
    expect(validateSignIn({ email: 'ada@example.com', password: 'x' })).toEqual({})
    expect(validateSignIn({ email: '', password: '' })).toEqual({ email: expect.any(String), password: expect.any(String) })
  })

  it('validates a replacement password and its confirmation', () => {
    expect(validatePasswordUpdate({ password: 'Nueva12345', confirmPassword: 'Nueva12345' })).toEqual({})
    expect(validatePasswordUpdate({ password: 'Nueva12345', confirmPassword: 'Distinta1' }).confirmPassword).toBeTruthy()
    expect(validatePasswordUpdate({ password: 'corta', confirmPassword: 'corta' }).password).toBeTruthy()
  })
})

describe('normalizers', () => {
  it('normalizes emails', () => {
    expect(normalizeEmail('  ADA@Example.COM ')).toBe('ada@example.com')
    expect(validateEmail(' ada@example.com ')).toBeNull()
  })

  it('sanitizes display names for profiles.display_name', () => {
    expect(sanitizeFullName('  Ada   Lovelace\n')).toBe('Ada Lovelace')
    expect(sanitizeFullName('')).toBeNull()
    expect(sanitizeFullName(undefined)).toBeNull()
    expect(sanitizeFullName(42)).toBeNull()
    expect(sanitizeFullName('y'.repeat(81))).toBeNull()
  })
})

describe('auth error messages', () => {
  it('uses one generic message for bad credentials', () => {
    expect(authErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe('Correo o contraseña incorrectos.')
  })

  it('asks to confirm the email when it is not confirmed', () => {
    expect(authErrorMessage({ code: 'email_not_confirmed' })).toMatch(/Confirma tu correo/)
  })

  it('maps rate limits and never echoes raw server text', () => {
    expect(authErrorMessage({ code: 'over_email_send_rate_limit' })).toMatch(/Demasiados intentos/)
    expect(authErrorMessage({ status: 429 })).toMatch(/Demasiados intentos/)
    const unknown = authErrorMessage({ code: 'unexpected_failure', message: 'User ada@example.com not found in auth.users' })
    expect(unknown).not.toMatch(/ada@example.com|auth\.users/)
  })
})
