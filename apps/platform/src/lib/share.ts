// Comparte un enlace con Web Share cuando existe y, si no, lo copia al portapapeles.
// Cancelar el diálogo nativo no es un error: devuelve 'cancelled'.
export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'unsupported'

type ShareNavigator = Pick<Navigator, 'share' | 'clipboard'>

export async function shareLink(data: { title: string; url: string }, nav: Partial<ShareNavigator> = navigator): Promise<ShareOutcome> {
  if (typeof nav.share === 'function') {
    try {
      await nav.share(data)
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    }
  }
  if (nav.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(data.url)
      return 'copied'
    } catch {
      return 'unsupported'
    }
  }
  return 'unsupported'
}
