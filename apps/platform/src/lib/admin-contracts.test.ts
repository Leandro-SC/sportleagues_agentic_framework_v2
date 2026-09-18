import { describe, expect, it } from 'vitest'
import { brandingControlsAvailable, humanizeBrandingUploadError, validateBrandingFile, canManageTenant, freeLimitMessage, humanizeAdminRpcError, lockMinutesFromInterval, validatePoints, validatePoolName } from './admin-contracts'

describe('admin contracts', () => {
  it('only exposes administration to owner and admin roles', () => {
    expect(canManageTenant('owner')).toBe(true)
    expect(canManageTenant('admin')).toBe(true)
    expect(canManageTenant('member')).toBe(false)
  })

  it('validates pool and scoring inputs before their RPC calls', () => {
    expect(validatePoolName('')).toBeTruthy()
    expect(validatePoolName('Quiniela Copa')).toBeNull()
    expect(validatePoints(3, 1)).toBeNull()
    expect(validatePoints(-1, 1)).toBeTruthy()
  })

  it('communicates the FREE limit without treating it as enforcement', () => {
    expect(freeLimitMessage('free', 1)).toBe('Tu plan FREE permite una sola quiniela activa.')
    expect(freeLimitMessage('pro', 8)).toBeNull()
  })

  it('turns the FREE limit RPC error into user-facing language', () => {
    expect(humanizeAdminRpcError('free plan allows one active pool')).toBe('Tu plan FREE permite una sola quiniela activa.')
    expect(humanizeAdminRpcError('permission denied for relation pools')).toBe('No pudimos completar esta acción. Inténtalo de nuevo.')
  })

  it('converts Postgres interval output into a form-safe minute value', () => {
    expect(lockMinutesFromInterval('00:15:00')).toBe(15)
    expect(lockMinutesFromInterval('1 hour 30 mins')).toBe(90)
  })

  it('only exposes image-branding controls to PRO tenants', () => {
    expect(brandingControlsAvailable('free')).toBe(false)
    expect(brandingControlsAvailable('pro')).toBe(true)
  })

  it('validates selected logo and banner files before upload without replacing server validation', () => {
    expect(validateBrandingFile('logo', { type: 'image/png', size: 1024 }, { width: 512, height: 512 })).toBeNull()
    expect(validateBrandingFile('banner', { type: 'image/webp', size: 1024 }, { width: 1600, height: 600 })).toBeNull()
    expect(validateBrandingFile('logo', { type: 'image/svg+xml', size: 1024 })).toMatch(/PNG, JPEG o WebP/)
    expect(validateBrandingFile('logo', { type: 'image/png', size: 1024 * 1024 + 1 })).toMatch(/1 MiB/)
    expect(validateBrandingFile('banner', { type: 'image/jpeg', size: 1024 }, { width: 1000, height: 450 })).toMatch(/1200×450/)
  })

  it('turns Edge Function upload failures into human messages', () => {
    expect(humanizeBrandingUploadError('FILE_TOO_LARGE')).toMatch(/máximo permitido/)
    expect(humanizeBrandingUploadError('INVALID_DIMENSIONS')).toMatch(/dimensiones/)
    expect(humanizeBrandingUploadError('ACTIVATION_FAILED')).not.toMatch(/ACTIVATION_FAILED/)
    expect(humanizeBrandingUploadError('unexpected')).not.toMatch(/unexpected/)
  })
})
