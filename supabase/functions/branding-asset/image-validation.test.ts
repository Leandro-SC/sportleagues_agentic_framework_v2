import { assertEquals, assertThrows } from 'jsr:@std/assert@1.0.16'

import { BrandingAssetError, mapRpcError } from './_shared.ts'
import { assertDimensions, assertFileSize, detectImageType, readHeaderDimensions } from './image-validation.ts'

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}

function webpVp8x(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30)
  bytes.set([0x52, 0x49, 0x46, 0x46, 22, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, 10, true)
  bytes[20] = 0
  const write24 = (offset: number, value: number) => {
    bytes[offset] = value & 0xff
    bytes[offset + 1] = (value >> 8) & 0xff
    bytes[offset + 2] = (value >> 16) & 0xff
  }
  write24(24, width - 1)
  write24(27, height - 1)
  return bytes
}

function jpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    height >> 8, height & 0xff,
    width >> 8, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ])
}

function expectCode(run: () => void, code: string): void {
  const error = assertThrows(run, BrandingAssetError)
  assertEquals(error.code, code)
}

Deno.test('detecta PNG aunque el MIME del navegador no sea autoridad', () => {
  const bytes = png(512, 512)
  assertEquals(detectImageType(bytes), 'image/png')
  assertEquals(readHeaderDimensions(bytes, 'image/png'), { width: 512, height: 512 })
})

Deno.test('detecta WebP y dimensiones de banner', () => {
  const bytes = webpVp8x(1600, 600)
  assertEquals(detectImageType(bytes), 'image/webp')
  assertEquals(readHeaderDimensions(bytes, 'image/webp'), { width: 1600, height: 600 })
  assertDimensions({ width: 1600, height: 600 }, 'banner')
})

Deno.test('detecta JPEG de logo sin confiar en extensión o MIME declarado', () => {
  const bytes = jpeg(512, 512)
  assertEquals(detectImageType(bytes), 'image/jpeg')
  assertEquals(readHeaderDimensions(bytes, 'image/jpeg'), { width: 512, height: 512 })
  assertDimensions({ width: 512, height: 512 }, 'logo')
})

Deno.test('rechaza SVG, binario arbitrario y PNG truncado', () => {
  assertEquals(detectImageType(new TextEncoder().encode('<svg/>')), null)
  assertEquals(detectImageType(new Uint8Array([1, 2, 3, 4])), null)
  assertEquals(readHeaderDimensions(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'), null)
})

Deno.test('aplica límites por slot antes de decodificar', () => {
  expectCode(() => assertFileSize(1024 * 1024 + 1, 'logo'), 'FILE_TOO_LARGE')
  expectCode(() => assertFileSize(2 * 1024 * 1024 + 1, 'banner'), 'FILE_TOO_LARGE')
  expectCode(() => assertDimensions({ width: 255, height: 256 }, 'logo'), 'INVALID_DIMENSIONS')
  expectCode(() => assertDimensions({ width: 2049, height: 512 }, 'logo'), 'INVALID_DIMENSIONS')
  expectCode(() => assertDimensions({ width: 1199, height: 450 }, 'banner'), 'INVALID_DIMENSIONS')
  expectCode(() => assertDimensions({ width: 2401, height: 900 }, 'banner'), 'INVALID_DIMENSIONS')
})

Deno.test('traduce rechazos de autorización de la RPC a errores HTTP seguros', () => {
  assertEquals(mapRpcError('authentication required').code, 'UNAUTHORIZED')
  assertEquals(mapRpcError('not authorized').code, 'FORBIDDEN')
  assertEquals(mapRpcError('pro branding is required').code, 'PLAN_REQUIRED')
  assertEquals(mapRpcError('branding asset not found').code, 'ASSET_NOT_FOUND')
  assertEquals(mapRpcError('branding asset is not pending').code, 'INVALID_ASSET_STATE')
  assertEquals(mapRpcError('unexpected SQL error').code, 'INTERNAL_ERROR')
})
