import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(import.meta.dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|vue)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : []
  })
}

describe('Magic Link removal (ADR-013)', () => {
  it('no application source uses OTP / Magic Link sign-in', () => {
    const offenders = sourceFiles(SRC).filter((file) => /signInWithOtp|verifyOtp|magic\s?link/i.test(readFileSync(file, 'utf8')))
    expect(offenders).toEqual([])
  })
})
