import { ImageMagick, MagickFormat, initializeImageMagick } from 'npm:@imagemagick/magick-wasm@0.0.43'

import { type AssetKind, safeError } from './_shared.ts'
import { assertDimensions, assertFileSize, type ImageDimensions } from './image-validation.ts'

let magickInitialization: Promise<void> | undefined

async function ensureImageMagick(): Promise<void> {
  magickInitialization ??= Deno.readFile(new URL(import.meta.resolve('npm:@imagemagick/magick-wasm@0.0.43/magick.wasm')))
    .then((wasmBytes) => initializeImageMagick(wasmBytes))
  await magickInitialization
}

export type NormalizedImage = ImageDimensions & { bytes: Uint8Array; sha256: string }

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

export async function normalizeToWebp(input: Uint8Array, assetKind: AssetKind): Promise<NormalizedImage> {
  try {
    await ensureImageMagick()
    let output: Uint8Array | undefined
    let dimensions: ImageDimensions | undefined

    await ImageMagick.read(input, async (image) => {
      dimensions = { width: image.width, height: image.height }
      assertDimensions(dimensions, assetKind)
      image.strip()
      await image.write(MagickFormat.WebP, (bytes) => { output = new Uint8Array(bytes) })
    })

    if (!output || !dimensions) throw safeError('IMAGE_DECODE_FAILED')
    assertFileSize(output.byteLength, assetKind)
    return { ...dimensions, bytes: output, sha256: await sha256(output) }
  } catch (error) {
    if (error instanceof Error && error.name === 'BrandingAssetError') throw error
    throw safeError('IMAGE_DECODE_FAILED')
  }
}
