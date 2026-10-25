import type { PaymentStatus, PoolStatus } from './admin-contracts'

// «Mis finanzas» (MVP): resumen de SOLO LECTURA del estado MANUAL de pago y participación de las
// quinielas de una organización. No existen importes, tickets cobrados ni transacciones en el MVP,
// así que este módulo solo cuenta filas; nunca calcula ni muestra dinero.
export type FinancePool = { id: string; name: string; status: PoolStatus }
export type FinanceParticipant = { pool_id: string; approval_status: 'pending' | 'approved'; payment_status: PaymentStatus; withdrawn_at: string | null }

export type ParticipationCounts = {
  // Participantes no retirados.
  total: number
  // Estado manual de pago que marca el organizador.
  paid: number
  pending: number
  invited: number
  // Aprobación de ingreso (solo relevante si la quiniela exige aprobación manual).
  approved: number
  awaitingApproval: number
}

export type PoolParticipationSummary = { pool: FinancePool; counts: ParticipationCounts; withdrawn: number }
export type ParticipationSummary = { totals: ParticipationCounts; withdrawn: number; byPool: PoolParticipationSummary[] }

export const PAYMENT_LABELS: Record<PaymentStatus, string> = { paid: 'Pagado', pending: 'Pendiente', invited: 'Invitado' }
export const POOL_STATUS_LABELS: Record<PoolStatus, string> = { draft: 'Borrador', open: 'Abierta', paused: 'Pausada', archived: 'Archivada' }

export function emptyCounts(): ParticipationCounts {
  return { total: 0, paid: 0, pending: 0, invited: 0, approved: 0, awaitingApproval: 0 }
}

function add(target: ParticipationCounts, row: FinanceParticipant): void {
  target.total += 1
  if (row.payment_status === 'paid') target.paid += 1
  else if (row.payment_status === 'pending') target.pending += 1
  else if (row.payment_status === 'invited') target.invited += 1
  if (row.approval_status === 'approved') target.approved += 1
  else if (row.approval_status === 'pending') target.awaitingApproval += 1
}

// Filas de quinielas que no estén en `pools` se ignoran: el resumen solo habla de las quinielas de
// la organización seleccionada. Los participantes retirados no cuentan como inscritos; se informan aparte.
export function summarizeParticipation(pools: FinancePool[], participants: FinanceParticipant[]): ParticipationSummary {
  const byPool = new Map<string, PoolParticipationSummary>(pools.map((pool) => [pool.id, { pool, counts: emptyCounts(), withdrawn: 0 }]))
  const totals = emptyCounts()
  let withdrawn = 0
  for (const row of participants) {
    const entry = byPool.get(row.pool_id)
    if (!entry) continue
    if (row.withdrawn_at) { entry.withdrawn += 1; withdrawn += 1; continue }
    add(entry.counts, row)
    add(totals, row)
  }
  return { totals, withdrawn, byPool: pools.map((pool) => byPool.get(pool.id)!) }
}
