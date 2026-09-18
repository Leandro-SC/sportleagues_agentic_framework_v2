import { describe, expect, it } from 'vitest'
import { resolvePoolAccess } from './pool-access'

describe('pool access presentation', () => {
  it('renders a pool only when RLS returned a row', () => {
    expect(resolvePoolAccess({ id: 'pool-a', name: 'Pool A' })).toEqual({ pool: { id: 'pool-a', name: 'Pool A' }, denied: false })
  })

  it('treats a cross-tenant zero-row result as denied', () => {
    expect(resolvePoolAccess(null)).toEqual({ pool: null, denied: true })
  })
})
