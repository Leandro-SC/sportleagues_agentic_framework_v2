import { describe, expect, it, vi } from 'vitest'
import { completeImplicitCallback } from './auth-callback'

describe('implicit auth callback', () => {
  it('returns provider errors without attempting a restore', async () => {
    const restore = vi.fn()
    await expect(completeImplicitCallback('http://127.0.0.1:5173/auth/callback#error_description=expired', restore)).resolves.toBe('expired')
    expect(restore).not.toHaveBeenCalled()
  })

  it('is safe to repeat because it only restores the existing session', async () => {
    const restore = vi.fn().mockResolvedValue(true)
    await expect(completeImplicitCallback('http://127.0.0.1:5173/auth/callback', restore)).resolves.toBeNull()
    await expect(completeImplicitCallback('http://127.0.0.1:5173/auth/callback', restore)).resolves.toBeNull()
    expect(restore).toHaveBeenCalledTimes(2)
  })
})
