import { describe, expect, it } from 'vitest'
import { humanizeTicketError, salesLabel, salesOpen, ticketCompetes, ticketStatusLabel } from './tickets'

describe('estado de ticket', () => {
  it('solo compite un ticket enviado y elegible', () => {
    expect(ticketCompetes({ status: 'submitted', eligibility: 'eligible' })).toBe(true)
    expect(ticketCompetes({ status: 'draft', eligibility: 'pending' })).toBe(false)
    expect(ticketCompetes({ status: 'cancelled', eligibility: 'ineligible' })).toBe(false)
  })

  it('etiqueta cada estado sin ambigüedad', () => {
    expect(ticketStatusLabel('draft', 'pending').label).toMatch(/sin enviar/)
    expect(ticketStatusLabel('submitted', 'eligible').label).toMatch(/elegible/)
    expect(ticketStatusLabel('cancelled', 'ineligible').label).toBe('Cancelado')
  })
})

describe('venta de tickets (ayuda visual; el servidor decide)', () => {
  const now = new Date('2026-10-12T12:00:00Z')
  it('abierta o cerrada según el cierre del servidor', () => {
    expect(salesOpen('2026-10-12T12:30:00Z', now)).toBe(true)
    expect(salesOpen('2026-10-12T11:00:00Z', now)).toBe(false)
    expect(salesOpen(null, now)).toBe(false)
  })
  it('etiquetas de cuenta atrás', () => {
    expect(salesLabel('2026-10-12T12:20:00Z', now)).toBe('La venta cierra en 20 min')
    expect(salesLabel('2026-10-12T14:00:00Z', now)).toBe('La venta cierra en 2 h')
    expect(salesLabel('2026-10-14T12:00:00Z', now)).toBe('La venta cierra en 2 d')
    expect(salesLabel('2026-10-12T11:00:00Z', now)).toBe('Venta cerrada')
  })
})

describe('humanizeTicketError', () => {
  it('traduce rechazos del servidor y no filtra mensajes internos', () => {
    expect(humanizeTicketError('42501', 'ticket limit reached for this round', 'TICKET_LIMIT')).toMatch(/máximo/)
    expect(humanizeTicketError('42501', 'ticket sales for this round are closed')).toMatch(/cerró/)
    expect(humanizeTicketError('22023', 'a ticket needs at least one selection')).toMatch(/al menos un pronóstico/)
    expect(humanizeTicketError('42501', 'administrators of a pool cannot participate in it')).toMatch(/administra/)
    expect(humanizeTicketError('PT409', 'idempotency key already used')).toMatch(/Inténtalo/)
    expect(humanizeTicketError(null, 'relation "x" does not exist')).toBe('No pudimos completar la acción. Inténtalo de nuevo.')
  })
})
