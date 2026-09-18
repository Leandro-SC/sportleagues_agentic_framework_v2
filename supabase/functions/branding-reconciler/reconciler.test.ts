import { assertEquals } from 'jsr:@std/assert@1.0.16'

import { ORPHAN_GRACE_PERIOD_MS, PENDING_TIMEOUT_MS, isOlderThan, parseCanonicalStoragePath } from './_shared.ts'

const tenantId = '11111111-1111-4111-8111-111111111111'
const assetId = '22222222-2222-4222-8222-222222222222'
const now = Date.parse('2026-09-15T12:00:00.000Z')

Deno.test('solo acepta paths canónicos tenant_uuid/asset_uuid', () => {
  assertEquals(parseCanonicalStoragePath(`${tenantId}/${assetId}`), { tenantId, assetId })
  assertEquals(parseCanonicalStoragePath(`tenant/${tenantId}/${assetId}`), null)
  assertEquals(parseCanonicalStoragePath(`${tenantId}/logo.webp`), null)
})

Deno.test('conserva huérfanos recientes y permite limpiar solo tras una hora', () => {
  assertEquals(isOlderThan(new Date(now - ORPHAN_GRACE_PERIOD_MS + 1).toISOString(), ORPHAN_GRACE_PERIOD_MS, now), false)
  assertEquals(isOlderThan(new Date(now - ORPHAN_GRACE_PERIOD_MS).toISOString(), ORPHAN_GRACE_PERIOD_MS, now), true)
  assertEquals(isOlderThan(undefined, ORPHAN_GRACE_PERIOD_MS, now), false)
})

Deno.test('el umbral de pending abandonado es una hora', () => {
  assertEquals(PENDING_TIMEOUT_MS, 60 * 60 * 1000)
})
