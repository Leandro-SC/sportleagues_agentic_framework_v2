// Parseo puro y compartido de campos numéricos de formulario (cadenas del <input>).
//
// Regla de seguridad funcional (FE-01): una cadena vacía NO es 0. `Number('') === 0` y
// `Number.isInteger(0)` es true, así que validar después de convertir con Number() convierte un
// campo en blanco en un valor válido sin aviso. Aquí se valida la cadena ANTES de convertir.
// Es solo UX: la restricción real vive en la base de datos / RPC.

export type NonNegativeIntegerInput =
  | { ok: true; value: number }
  | { ok: false; reason: 'empty' | 'format' | 'max' }

/** Entero decimal >= 0, sin signos, decimales ni notación científica. Vacío o solo espacios se rechaza. */
export function parseNonNegativeInteger(raw: unknown, max?: number): NonNegativeIntegerInput {
  if (typeof raw !== 'string') return { ok: false, reason: 'format' }
  const text = raw.trim()
  if (text === '') return { ok: false, reason: 'empty' }
  if (!/^\d+$/.test(text)) return { ok: false, reason: 'format' }
  const value = Number(text)
  if (!Number.isSafeInteger(value) || (max !== undefined && value > max)) return { ok: false, reason: 'max' }
  return { ok: true, value }
}
