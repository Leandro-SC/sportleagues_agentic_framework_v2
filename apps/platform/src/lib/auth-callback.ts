function callbackParams(href: string): URLSearchParams {
  const url = new URL(href)
  return url.hash ? new URLSearchParams(url.hash.slice(1)) : url.searchParams
}

export function callbackErrorFromUrl(href: string): string | null {
  const params = callbackParams(href)
  return params.get('error_description') ?? params.get('error')
}

/** El enlace de recuperación de contraseña vuelve a /auth/callback con `type=recovery`. */
export function isRecoveryCallback(href: string): boolean {
  return callbackParams(href).get('type') === 'recovery'
}

/** Mensaje para el usuario; nunca reenvía el texto crudo del proveedor. */
export function callbackErrorMessage(href: string): string | null {
  if (!callbackErrorFromUrl(href)) return null
  const params = callbackParams(href)
  const code = params.get('error_code') ?? ''
  if (code === 'otp_expired' || /expired|invalid/i.test(params.get('error_description') ?? '')) {
    return 'El enlace expiró o ya fue usado. Solicita uno nuevo desde "¿Olvidaste tu contraseña?" o inicia sesión de nuevo.'
  }
  if (params.get('error') === 'access_denied') return 'El acceso fue cancelado o denegado. Inténtalo de nuevo.'
  return 'No se pudo completar el inicio de sesión. Inténtalo de nuevo.'
}

export async function completeImplicitCallback(href: string, restore: () => Promise<boolean>): Promise<string | null> {
  const callbackError = callbackErrorMessage(href)
  if (callbackError) return callbackError
  return await restore() ? null : 'No se pudo iniciar sesión con el enlace recibido.'
}
