// Lectura de imágenes elegidas en el dispositivo. Se decodifican en el navegador y nunca se suben a ningún servicio desde aquí.
export type LocalImage = { image: CanvasImageSource; width: number; height: number }
export type LocalImageResult = { ok: true; value: LocalImage } | { ok: false; message: string }

export const MAX_LOCAL_IMAGE_BYTES = 15 * 1024 * 1024
const ACCEPTED = /^image\/(png|jpeg|webp|gif|heic|heif|avif)$/i

export function validateLocalImage(file: Pick<File, 'type' | 'size'>, maxBytes = MAX_LOCAL_IMAGE_BYTES): string | null {
  if (!ACCEPTED.test(file.type)) return 'Elige una foto (PNG, JPG o WebP).'
  if (file.size <= 0) return 'La imagen está vacía.'
  if (file.size > maxBytes) return `La imagen supera ${Math.round(maxBytes / 1024 / 1024)} MB.`
  return null
}

/** Decodifica el archivo respetando la orientación EXIF cuando el navegador lo permite. */
export async function readLocalImage(file: File, maxBytes = MAX_LOCAL_IMAGE_BYTES): Promise<LocalImageResult> {
  const invalid = validateLocalImage(file, maxBytes)
  if (invalid) return { ok: false, message: invalid }
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { ok: true, value: { image: bitmap, width: bitmap.width, height: bitmap.height } }
    }
    const url = URL.createObjectURL(file)
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image()
        element.onload = () => resolve(element)
        element.onerror = () => reject(new Error('decode'))
        element.src = url
      })
      return { ok: true, value: { image: img, width: img.naturalWidth, height: img.naturalHeight } }
    } finally {
      URL.revokeObjectURL(url)
    }
  } catch {
    return { ok: false, message: 'No pudimos abrir esa imagen. Prueba con otra.' }
  }
}
