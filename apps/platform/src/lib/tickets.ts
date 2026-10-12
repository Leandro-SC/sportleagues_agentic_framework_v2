// Contratos de tickets gratuitos (ADR-014 Etapa 1). Todo lo "autoritativo" (cupo, cierre, elegibilidad, puntos) lo decide PostgreSQL;
// este módulo solo traduce estados y errores para la interfaz.
export type TicketStatus = 'draft' | 'submitted' | 'cancelled'
export type TicketEligibility = 'pending' | 'eligible' | 'ineligible'

export type TicketRow = {
  ticket_id: string; pool_id: string; pool_name: string; round_id: string; round_name: string; display_no: number
  status: TicketStatus; eligibility: TicketEligibility; created_at: string; submitted_at: string | null
  selections: number; round_matches: number; results_count: number; points: number; is_best: boolean
  max_tickets: number; sales_closes_at: string | null
}

export function ticketStatusLabel(status: TicketStatus, eligibility: TicketEligibility): { label: string; tone: 'success' | 'warn' | 'neutral' | 'danger' } {
  if (status === 'cancelled') return { label: 'Cancelado', tone: 'neutral' }
  if (status === 'submitted' && eligibility === 'eligible') return { label: 'Enviado · elegible', tone: 'success' }
  if (status === 'submitted') return { label: 'Enviado', tone: 'neutral' }
  return { label: 'Borrador · sin enviar', tone: 'warn' }
}

/** Una jugada solo compite si está enviada y es elegible (lo fija el servidor al enviarla antes del primer cierre). */
export const ticketCompetes = (t: Pick<TicketRow, 'status' | 'eligibility'>): boolean => t.status === 'submitted' && t.eligibility === 'eligible'

export const salesOpen = (closesAt: string | null, now: Date): boolean => closesAt !== null && now.getTime() < new Date(closesAt).getTime()

export function salesLabel(closesAt: string | null, now: Date): string {
  if (!closesAt) return 'Sin partidos en esta jornada'
  const ms = new Date(closesAt).getTime() - now.getTime()
  if (ms <= 0) return 'Venta cerrada'
  const min = Math.max(1, Math.ceil(ms / 60_000))
  if (min < 60) return `La venta cierra en ${min} min`
  if (min < 24 * 60) return `La venta cierra en ${Math.floor(min / 60)} h ${min % 60 ? `${min % 60} min` : ''}`.trim()
  return `La venta cierra en ${Math.floor(min / 1440)} d`
}

export function humanizeTicketError(code: string | null | undefined, message: string | null | undefined, hint?: string | null): string {
  const text = message ?? ''
  if (hint === 'TICKET_LIMIT' || /ticket limit reached/.test(text)) return 'Ya alcanzaste el máximo de tickets de esta jornada.'
  if (/administrators of a pool|ADMIN_PARTICIPANT_INCOMPATIBLE/.test(`${text} ${hint ?? ''}`)) return 'Quien administra una quiniela no participa en ella.'
  if (/sales for this round are closed|after its round closes/.test(text)) return 'La venta de tickets de esta jornada ya cerró.'
  if (/at least one selection/.test(text)) return 'Agrega al menos un pronóstico antes de enviar el ticket.'
  if (/cancelled ticket/.test(text)) return 'Este ticket está cancelado.'
  if (/not sellable|not available in this pool/.test(text)) return 'Esta jornada no tiene tickets habilitados.'
  if (code === 'PT409') return 'Esta solicitud ya se usó para otra jornada. Inténtalo de nuevo.'
  if (code === '42501' || /locked|unavailable|unauthorized|only approved participants/.test(text)) return 'El pronóstico está cerrado o no estás habilitado en esta quiniela.'
  if (code === '22023') return 'Revisa los datos: el marcador debe ser un entero igual o mayor que cero.'
  return 'No pudimos completar la acción. Inténtalo de nuevo.'
}
