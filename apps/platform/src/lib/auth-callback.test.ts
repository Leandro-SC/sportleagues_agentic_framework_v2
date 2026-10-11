import { describe, expect, it, vi } from 'vitest'
import { completeImplicitCallback, isRecoveryCallback } from './auth-callback'

describe('recovery callback detection', () => {
  it('detects a password recovery link', () => {
    expect(isRecoveryCallback('http://127.0.0.1:5173/auth/callback#access_token=a&type=recovery')).toBe(true)
  })

  it('does not treat sign-in, signup confirmation or OAuth callbacks as recovery', () => {
    expect(isRecoveryCallback('http://127.0.0.1:5173/auth/callback#access_token=a&type=signup')).toBe(false)
    expect(isRecoveryCallback('http://127.0.0.1:5173/auth/callback#access_token=a')).toBe(false)
    expect(isRecoveryCallback('http://127.0.0.1:5173/auth/callback')).toBe(false)
  })
})

describe('implicit auth callback', () => {
  it('returns a friendly message for expired links without attempting a restore', async () => {
    const restore = vi.fn()
    const href = 'http://127.0.0.1:5173/auth/callback#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'
    await expect(completeImplicitCallback(href, restore)).resolves.toMatch(/expiró o ya fue usado/)
    expect(restore).not.toHaveBeenCalled()
  })

  it('does not echo raw provider error text', async () => {
    const restore = vi.fn()
    const result = await completeImplicitCallback('http://127.0.0.1:5173/auth/callback#error=server_error&error_description=db+host+10.0.0.5+down', restore)
    expect(result).not.toMatch(/10\.0\.0\.5/)
    await expect(completeImplicitCallback('http://127.0.0.1:5173/auth/callback#error=access_denied', restore)).resolves.toMatch(/cancelado o denegado/)
  })

  it('is safe to repeat because it only restores the existing session', async () => {
    const restore = vi.fn().mockResolvedValue(true)
    await expect(completeImplicitCallback('http://127.0.0.1:5173/auth/callback', restore)).resolves.toBeNull()
    await expect(completeImplicitCallback('http://127.0.0.1:5173/auth/callback', restore)).resolves.toBeNull()
    expect(restore).toHaveBeenCalledTimes(2)
  })
})
