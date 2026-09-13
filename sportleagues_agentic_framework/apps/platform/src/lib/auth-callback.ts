export function callbackErrorFromUrl(href: string): string | null {
  const url = new URL(href)
  const params = url.hash ? new URLSearchParams(url.hash.slice(1)) : url.searchParams
  return params.get('error_description') ?? params.get('error')
}

export async function completeImplicitCallback(href: string, restore: () => Promise<boolean>): Promise<string | null> {
  const callbackError = callbackErrorFromUrl(href)
  if (callbackError) return callbackError
  return await restore() ? null : 'No se pudo iniciar sesión con el enlace recibido.'
}
