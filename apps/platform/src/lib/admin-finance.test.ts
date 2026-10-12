import { describe, expect, it } from 'vitest'
import { emptyCounts, summarizeParticipation, type FinanceParticipant, type FinancePool } from './admin-finance'

const pools: FinancePool[] = [
  { id: 'p1', name: 'Quiniela A', status: 'open' },
  { id: 'p2', name: 'Quiniela B', status: 'draft' },
]
const row = (pool_id: string, payment_status: FinanceParticipant['payment_status'], approval_status: FinanceParticipant['approval_status'] = 'approved', withdrawn_at: string | null = null): FinanceParticipant => ({ pool_id, payment_status, approval_status, withdrawn_at })

describe('summarizeParticipation', () => {
  it('counts payment and approval states per pool and in total', () => {
    const summary = summarizeParticipation(pools, [
      row('p1', 'paid'), row('p1', 'paid'), row('p1', 'pending', 'pending'), row('p1', 'invited'),
      row('p2', 'invited', 'pending'),
    ])
    expect(summary.byPool[0].counts).toEqual({ total: 4, paid: 2, pending: 1, invited: 1, approved: 3, awaitingApproval: 1 })
    expect(summary.byPool[1].counts).toEqual({ total: 1, paid: 0, pending: 0, invited: 1, approved: 0, awaitingApproval: 1 })
    expect(summary.totals).toEqual({ total: 5, paid: 2, pending: 1, invited: 2, approved: 3, awaitingApproval: 2 })
  })

  it('reports pools without participants with zero counts, keeping the pool order', () => {
    const summary = summarizeParticipation(pools, [])
    expect(summary.byPool.map((entry) => entry.pool.id)).toEqual(['p1', 'p2'])
    expect(summary.byPool.every((entry) => entry.counts.total === 0)).toBe(true)
    expect(summary.totals).toEqual(emptyCounts())
  })

  it('does not count withdrawn participants as enrolled and reports them apart', () => {
    const summary = summarizeParticipation(pools, [row('p1', 'paid'), row('p1', 'paid', 'approved', '2026-10-01T00:00:00Z')])
    expect(summary.totals.total).toBe(1)
    expect(summary.totals.paid).toBe(1)
    expect(summary.withdrawn).toBe(1)
    expect(summary.byPool[0].withdrawn).toBe(1)
  })

  it('ignores participants of pools outside the summarized organization', () => {
    const summary = summarizeParticipation(pools, [row('ajena', 'paid'), row('p2', 'paid')])
    expect(summary.totals.total).toBe(1)
    expect(summary.byPool[1].counts.paid).toBe(1)
  })
})
