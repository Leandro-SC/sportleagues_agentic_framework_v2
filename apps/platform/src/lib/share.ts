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

export type ShareImageOutcome = 'shared' | 'downloaded' | 'cancelled' | 'unsupported'

/** Comparte una imagen con el menú nativo (Web Share con archivos). Sin soporte, la descarga: nunca sube nada a un servicio. */
export async function shareImage(
  file: { blob: Blob; filename: string; title: string; text?: string },
  nav: Partial<Pick<Navigator, 'share' | 'canShare'>> = navigator,
  doc: Pick<Document, 'createElement' | 'body'> | null = typeof document === 'undefined' ? null : document,
): Promise<ShareImageOutcome> {
  const image = new File([file.blob], file.filename, { type: file.blob.type || 'image/png' })
  if (typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [image] })) {
    try {
      await nav.share({ files: [image], title: file.title, text: file.text })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    }
  }
  if (!doc) return 'unsupported'
  const url = URL.createObjectURL(file.blob)
  const link = doc.createElement('a')
  link.href = url; link.download = file.filename
  doc.body.appendChild(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return 'downloaded'
}

/** Enlace oficial de WhatsApp con el mensaje prellenado (sin destinatario: el usuario elige el chat o grupo). */
export function whatsappTextUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

export type WhatsAppShareOutcome = 'shared' | 'cancelled' | 'downloaded-and-opened' | 'unsupported'

/**
 * Pensado para WhatsApp. Con Web Share de archivos (Android/iOS) se abre el menú del sistema con la imagen y el mensaje como pie,
 * y el usuario elige WhatsApp. Sin esa capacidad (escritorio, algunos navegadores) se descarga la imagen y se abre WhatsApp con el
 * mensaje para adjuntarla. Nada se sube a un servicio de SportLeagues.
 */
export async function shareToWhatsApp(
  file: { blob: Blob; filename: string; title: string; text: string },
  nav: Partial<Pick<Navigator, 'share' | 'canShare'>> = navigator,
  doc: Pick<Document, 'createElement' | 'body'> | null = typeof document === 'undefined' ? null : document,
  open: (url: string) => void = (url) => { window.open(url, '_blank', 'noopener') },
): Promise<WhatsAppShareOutcome> {
  const outcome = await shareImage(file, nav, doc)
  if (outcome === 'downloaded') {
    open(whatsappTextUrl(file.text))
    return 'downloaded-and-opened'
  }
  return outcome
}
