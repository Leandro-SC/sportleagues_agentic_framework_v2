import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { id: string; display_name: string } | null

function makeClient(opts: { profile?: Row; user?: Record<string, unknown> | null; profileError?: boolean } = {}) {
  const calls = { upserts: [] as Array<{ row: unknown; options: unknown }> }
  const user = opts.user === undefined ? null : opts.user
  let profile: Row = opts.profile ?? null
  const auth = {
    onAuthStateChange: vi.fn(),
    getSession: vi.fn(async () => ({ data: { session: user ? { user } : null }, error: null })),
    signUp: vi.fn(async () => ({ data: { session: null, user: { id: 'new' } }, error: null })),
    signInWithPassword: vi.fn(async () => ({ data: {}, error: null })),
    signInWithOAuth: vi.fn(async () => ({ data: {}, error: null })),
    resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
    updateUser: vi.fn(async () => ({ data: {}, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
  }
  const client = {
    auth,
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile, error: opts.profileError ? { message: 'offline' } : null }) }) }),
      upsert: async (row: { id: string; display_name: string }, options: unknown) => {
        calls.upserts.push({ row, options })
        profile = row
        return { error: null }
      },
    })),
  }
  return { client, auth, calls }
}

async function load(client: unknown) {
  vi.resetModules()
  vi.doMock('../lib/supabase', () => ({ getSupabaseClient: () => client }))
  const { useAuth } = await import('./useAuth')
  return useAuth()
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('useAuth — email and password', () => {
  it('exposes no Magic Link / OTP entry point', async () => {
    const { client } = makeClient()
    const api = (await load(client)) as Record<string, unknown>
    expect(Object.keys(api).some((key) => /magic|otp/i.test(key))).toBe(false)
    expect(api.signUpWithPassword).toBeTypeOf('function')
    expect(api.signInWithPassword).toBeTypeOf('function')
  })

  it('sign-up sends the full name as metadata, normalizes the email and asks to confirm by email', async () => {
    const { client, auth } = makeClient()
    const api = await load(client)
    const result = await api.signUpWithPassword({ fullName: '  Ada   Lovelace ', email: ' ADA@Example.com ', password: 'Secreta123' })
    expect(auth.signUp).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'Secreta123',
      options: { data: { full_name: 'Ada Lovelace' }, emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    expect(result).toMatchObject({ error: null, signedIn: false })
    expect(result.notice).toMatch(/confirmar tu cuenta/)
  })

  it('sign-up rejects an empty name without calling Supabase', async () => {
    const { client, auth } = makeClient()
    const api = await load(client)
    expect((await api.signUpWithPassword({ fullName: '  ', email: 'a@b.co', password: 'Secreta123' })).error).toBeTruthy()
    expect(auth.signUp).not.toHaveBeenCalled()
  })

  it('sign-up gives the same notice whether or not the email already exists (no enumeration)', async () => {
    const { client, auth } = makeClient()
    auth.signUp.mockResolvedValueOnce({ data: { session: null, user: { id: 'x', identities: [] } }, error: null } as never)
    const api = await load(client)
    const existing = await api.signUpWithPassword({ fullName: 'Ada', email: 'ada@example.com', password: 'Secreta123' })
    const fresh = await api.signUpWithPassword({ fullName: 'Ada', email: 'otra@example.com', password: 'Secreta123' })
    expect(existing).toEqual(fresh)
  })

  it('maps a wrong password to a generic message', async () => {
    const { client, auth } = makeClient()
    auth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: { code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 } } as never)
    const api = await load(client)
    expect(await api.signInWithPassword('ada@example.com', 'mala')).toBe('Correo o contraseña incorrectos.')
  })

  it('signs in with a normalized email and returns no error on success', async () => {
    const { client, auth } = makeClient()
    const api = await load(client)
    expect(await api.signInWithPassword(' ADA@example.com', 'Secreta123')).toBeNull()
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'Secreta123' })
  })

  it('password recovery redirects to /auth/callback and always returns the neutral notice', async () => {
    const { client, auth } = makeClient()
    auth.resetPasswordForEmail.mockResolvedValueOnce({ data: null, error: { status: 400, code: 'user_not_found' } } as never)
    const api = await load(client)
    const result = await api.requestPasswordReset('nadie@example.com')
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('nadie@example.com', { redirectTo: `${window.location.origin}/auth/callback` })
    expect(result.error).toBeNull()
    expect(result.notice).toMatch(/Si existe una cuenta/)
  })

  it('password recovery still reports rate limiting', async () => {
    const { client, auth } = makeClient()
    auth.resetPasswordForEmail.mockResolvedValueOnce({ data: null, error: { status: 429, code: 'over_email_send_rate_limit' } } as never)
    const api = await load(client)
    expect((await api.requestPasswordReset('a@b.co')).error).toMatch(/Demasiados intentos/)
  })

  it('updatePassword needs a session and enforces the policy before calling Supabase', async () => {
    const { client, auth } = makeClient()
    const api = await load(client)
    expect(await api.updatePassword('Nueva12345')).toMatch(/expiró/)
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('updatePassword changes the password for a recovery session', async () => {
    const { client, auth } = makeClient({ user: { id: 'u1', user_metadata: {} }, profile: { id: 'u1', display_name: 'Ada' } })
    const api = await load(client)
    await api.restore()
    expect(await api.updatePassword('corta')).toMatch(/al menos 8/)
    expect(await api.updatePassword('Nueva12345')).toBeNull()
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'Nueva12345' })
  })

  it('Google OAuth returns to /auth/callback', async () => {
    const { client, auth } = makeClient()
    const api = await load(client)
    expect(await api.signInWithGoogle()).toBeNull()
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` } })
  })
})

describe('useAuth — profile persistence', () => {
  it('creates the profile from the sign-up name on first session, without overwriting (ON CONFLICT DO NOTHING)', async () => {
    const { client, calls } = makeClient({ user: { id: 'u1', user_metadata: { full_name: 'Ada Lovelace' } } })
    const api = await load(client)
    await api.restore()
    expect(calls.upserts).toEqual([{ row: { id: 'u1', display_name: 'Ada Lovelace' }, options: { onConflict: 'id', ignoreDuplicates: true } }])
    expect(api.state.profile?.display_name).toBe('Ada Lovelace')
  })

  it('uses the Google display name when there is no full_name', async () => {
    const { client, calls } = makeClient({ user: { id: 'u2', user_metadata: { name: 'Grace Hopper' } } })
    const api = await load(client)
    await api.restore()
    expect(calls.upserts[0]?.row).toEqual({ id: 'u2', display_name: 'Grace Hopper' })
  })

  it('never touches an existing profile', async () => {
    const { client, calls } = makeClient({ user: { id: 'u1', user_metadata: { full_name: 'Otro Nombre' } }, profile: { id: 'u1', display_name: 'Nombre Guardado' } })
    const api = await load(client)
    await api.restore()
    expect(calls.upserts).toHaveLength(0)
    expect(api.state.profile?.display_name).toBe('Nombre Guardado')
  })

  it('leaves the profile empty (so the guard sends the user to onboarding) when no name is available', async () => {
    const { client, calls } = makeClient({ user: { id: 'u3', user_metadata: {} } })
    const api = await load(client)
    await api.restore()
    expect(calls.upserts).toHaveLength(0)
    expect(api.state.profile).toBeNull()
  })

  it('does not write any role or tenant data when creating a profile', async () => {
    const { client, calls } = makeClient({ user: { id: 'u1', user_metadata: { full_name: 'Ada', role: 'owner', tenant_id: 't' } } })
    const api = await load(client)
    await api.restore()
    expect(Object.keys(calls.upserts[0]!.row as object).sort()).toEqual(['display_name', 'id'])
  })
})

describe('useAuth — resilience', () => {
  it('UAT-03: un fallo de red al consultar perfil no se confunde con perfil inexistente', async () => {
    const { client } = makeClient({ user: { id: 'u-offline', user_metadata: { full_name: 'Ada' } }, profileError: true })
    const api = await load(client)
    await api.restore()
    expect(api.state.profile).toBeNull()
    expect(api.state.profileLookupUnavailable).toBe(true)
    expect(api.state.error).toBe('No pudimos guardar tu perfil. Inténtalo de nuevo.')
  })
  it('a failed profile creation is attempted once, shows a generic error and does not block the session', async () => {
    const { client, calls } = makeClient({ user: { id: 'u9', user_metadata: { full_name: 'Ada' } } })
    const original = client.from
    client.from = vi.fn(() => {
      const builder = original() as Record<string, unknown>
      return { ...builder, upsert: async (row: unknown, options: unknown) => { calls.upserts.push({ row, options }); return { error: { message: 'db host 10.0.0.5 unreachable' } } } }
    }) as never
    const api = await load(client)
    await api.restore()
    await api.restore()
    expect(calls.upserts).toHaveLength(1)
    expect(api.state.error).toBe('No pudimos guardar tu perfil. Inténtalo de nuevo.')
    expect(api.state.error).not.toMatch(/10\.0\.0\.5/)
    expect(api.isAuthenticated.value).toBe(true)
    expect(api.state.profile).toBeNull()
  })

  it('onboarding can still save the profile after an automatic attempt failed (same primary key, no duplicates)', async () => {
    const { client, calls } = makeClient({ user: { id: 'u9', user_metadata: {} } })
    const api = await load(client)
    await api.restore()
    expect(await api.saveProfile('  Ada   Lovelace ')).toBeNull()
    expect(calls.upserts).toEqual([{ row: { id: 'u9', display_name: 'Ada Lovelace' }, options: undefined }])
  })

  it('leaving recovery mode is explicit and a normal login also clears it', async () => {
    const { client } = makeClient()
    const api = await load(client)
    api.state.recovery = true
    api.clearRecovery()
    expect(api.state.recovery).toBe(false)
    api.state.recovery = true
    await api.signInWithPassword('a@b.co', 'Secreta123')
    expect(api.state.recovery).toBe(false)
  })

  it('logout clears session, profile, recovery mode and any pending invitation', async () => {
    localStorage.setItem('sportleagues.join-code', JSON.stringify({ code: 'AB12CD', at: Date.now() }))
    const { client } = makeClient({ user: { id: 'u1', user_metadata: {} }, profile: { id: 'u1', display_name: 'Ada' } })
    const api = await load(client)
    await api.restore()
    expect(await api.signOut()).toBeNull()
    expect(api.state.user).toBeNull()
    expect(api.state.profile).toBeNull()
    expect(localStorage.getItem('sportleagues.join-code')).toBeNull()
  })
})

describe('useAuth — sesión de este dispositivo y recuperación de contraseña (FE-06, FE-09)', () => {
  const RAW = 'TypeError: Failed to fetch (https://x.supabase.co/auth/v1/logout)'

  it('FE-06: cierra solo la sesión de este dispositivo (scope local), no todas las del usuario', async () => {
    const { client, auth } = makeClient({ user: { id: 'u1', user_metadata: {} }, profile: { id: 'u1', display_name: 'Ada' } })
    const api = await load(client)
    await api.restore()
    await api.signOut()
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('FE-06: si el servidor falla limpia igualmente el estado local y la invitación, y devuelve un mensaje amable (nunca el texto crudo)', async () => {
    localStorage.setItem('sportleagues.join-code', JSON.stringify({ code: 'AB12CD', at: Date.now() }))
    const { client, auth } = makeClient({ user: { id: 'u1', user_metadata: {} }, profile: { id: 'u1', display_name: 'Ada' } })
    auth.signOut.mockResolvedValueOnce({ error: { message: RAW } } as never)
    const api = await load(client)
    await api.restore()
    const result = await api.signOut()
    expect(result).toMatch(/Cerramos tu sesión en este dispositivo/)
    expect(result).not.toContain('Failed to fetch')
    expect(api.state.user).toBeNull()
    expect(api.state.session).toBeNull()
    expect(api.state.profile).toBeNull()
    expect(api.state.recovery).toBe(false)
    expect(localStorage.getItem('sportleagues.join-code')).toBeNull()
  })

  it('FE-06: si la petición lanza una excepción también limpia todo', async () => {
    localStorage.setItem('sportleagues.join-code', JSON.stringify({ code: 'AB12CD', at: Date.now() }))
    const { client, auth } = makeClient({ user: { id: 'u1', user_metadata: {} }, profile: { id: 'u1', display_name: 'Ada' } })
    auth.signOut.mockRejectedValueOnce(new TypeError(RAW))
    const api = await load(client)
    await api.restore()
    const result = await api.signOut()
    expect(result).not.toContain('Failed to fetch')
    expect(api.state.user).toBeNull()
    expect(localStorage.getItem('sportleagues.join-code')).toBeNull()
  })

  it('FE-09: «Cancelar» en la recuperación cierra la sesión de recuperación (local) y sale del modo recuperación', async () => {
    const { client, auth } = makeClient({ user: { id: 'u1', user_metadata: {} }, profile: { id: 'u1', display_name: 'Ada' } })
    const api = await load(client)
    await api.restore()
    api.state.recovery = true
    await api.cancelRecovery()
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(api.state.recovery).toBe(false)
    expect(api.state.user).toBeNull()
  })

  it('FE-09: tras cambiar la contraseña cierra las demás sesiones (scope others)', async () => {
    const { client, auth } = makeClient({ user: { id: 'u1', user_metadata: {} }, profile: { id: 'u1', display_name: 'Ada' } })
    const api = await load(client)
    await api.restore()
    expect(await api.updatePassword('Nueva12345')).toBeNull()
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'others' })
    expect(api.state.user).not.toBeNull() // la sesión actual se conserva
  })

  it('FE-09: si cerrar las demás sesiones falla, el cambio de contraseña sigue siendo un éxito (no bloqueante)', async () => {
    const { client, auth } = makeClient({ user: { id: 'u1', user_metadata: {} }, profile: { id: 'u1', display_name: 'Ada' } })
    auth.signOut.mockRejectedValueOnce(new Error('network'))
    const api = await load(client)
    await api.restore()
    expect(await api.updatePassword('Nueva12345')).toBeNull()
    expect(api.state.recovery).toBe(false)
  })

  it('FE-09: si cambiar la contraseña falla NO se cierran otras sesiones', async () => {
    const { client, auth } = makeClient({ user: { id: 'u1', user_metadata: {} }, profile: { id: 'u1', display_name: 'Ada' } })
    auth.updateUser.mockResolvedValueOnce({ data: {}, error: { message: 'weak', code: 'weak_password', status: 422 } } as never)
    const api = await load(client)
    await api.restore()
    expect(await api.updatePassword('Nueva12345')).not.toBeNull()
    expect(auth.signOut).not.toHaveBeenCalled()
  })
})
