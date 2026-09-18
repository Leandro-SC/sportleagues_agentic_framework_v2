import {
  BRANDING_LIMITS,
  type AssetKind,
  type DetectedImageType,
  safeError,
} from './_shared.ts'

export type ImageDimensions = { width: number; height: number }

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_SOI = [0xff, 0xd8, 0xff]
const RIFF = [0x52, 0x49, 0x46, 0x46]
const WEBP = [0x57, 0x45, 0x42, 0x50]

function matchesAt(bytes: Uint8Array, offset: number, expected: number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value)
}

function readUint16BigEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1]
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]) | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] * 0x1000000)
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] * 0x1000000) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]
}

export function detectImageType(bytes: Uint8Array): DetectedImageType | null {
  if (bytes.length >= 8 && matchesAt(bytes, 0, PNG_SIGNATURE)) return 'image/png'
  if (bytes.length >= 3 && matchesAt(bytes, 0, JPEG_SOI)) return 'image/jpeg'
  if (bytes.length >= 12 && matchesAt(bytes, 0, RIFF) && matchesAt(bytes, 8, WEBP)) return 'image/webp'
  return null
}

function readPngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24 || !matchesAt(bytes, 12, [0x49, 0x48, 0x44, 0x52])) return null
  return { width: readUint32BigEndian(bytes, 16), height: readUint32BigEndian(bytes, 20) }
}

function readJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd9 || marker === 0xda) return null
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 1 >= bytes.length) return null
    const segmentLength = readUint16BigEndian(bytes, offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null
    const isStartOfFrame = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)
    if (isStartOfFrame) {
      if (segmentLength < 8) return null
      return { width: readUint16BigEndian(bytes, offset + 5), height: readUint16BigEndian(bytes, offset + 3) }
    }
    offset += segmentLength
  }
  return null
}

function readWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 30) return null
  const chunk = String.fromCharCode(...bytes.slice(12, 16))
  if (chunk === 'VP8X') {
    return { width: readUint24LittleEndian(bytes, 24) + 1, height: readUint24LittleEndian(bytes, 27) + 1 }
  }
  if (chunk === 'VP8 ') {
    if (bytes.length < 30 || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null
    return { width: readUint16BigEndian(bytes, 26) & 0x3fff, height: readUint16BigEndian(bytes, 28) & 0x3fff }
  }
  if (chunk === 'VP8L') {
    if (bytes.length < 25 || bytes[20] !== 0x2f) return null
    const packed = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)
    return { width: (packed & 0x3fff) + 1, height: ((packed >> 14) & 0x3fff) + 1 }
  }
  return null
}

export function readHeaderDimensions(bytes: Uint8Array, type: DetectedImageType): ImageDimensions | null {
  if (type === 'image/png') return readPngDimensions(bytes)
  if (type === 'image/jpeg') return readJpegDimensions(bytes)
  return readWebpDimensions(bytes)
}

export function assertFileSize(byteSize: number, assetKind: AssetKind): void {
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > BRANDING_LIMITS[assetKind].maxBytes) {
    throw safeError('FILE_TOO_LARGE')
  }
}

export function assertDimensions(dimensions: ImageDimensions, assetKind: AssetKind): void {
  const limits = BRANDING_LIMITS[assetKind]
  if (!Number.isSafeInteger(dimensions.width) || !Number.isSafeInteger(dimensions.height)
    || dimensions.width < limits.minWidth || dimensions.height < limits.minHeight
    || dimensions.width > limits.maxWidth || dimensions.height > limits.maxHeight) {
    throw safeError('INVALID_DIMENSIONS')
  }
}
