import { describe, expect, it } from 'vitest'
import {
  humanizeSportsRpcError,
  isoToZonedLocal,
  lockAtPreview,
  parseTeamLines,
  validateEntityName,
  validateKickoff,
  validateOptionalColor,
  validateScore,
  zonedLocalToIso,
} from './sports-admin'

describe('validaciones de catálogo', () => {
  it('exige nombre entre 1 y 120 caracteres', () => {
    expect(validateEntityName('  ')).not.toBeNull()
    expect(validateEntityName('Alianza')).toBeNull()
    expect(validateEntityName('x'.repeat(121))).not.toBeNull()
  })

  it('acepta color vacío o hexadecimal de seis dígitos', () => {
    expect(validateOptionalColor('')).toBeNull()
    expect(validateOptionalColor('#00ff88')).toBeNull()
    expect(validateOptionalColor('rojo')).not.toBeNull()
    expect(validateOptionalColor('#0f8')).not.toBeNull()
  })

  it('valida marcadores como enteros no negativos', () => {
    expect(validateScore(0)).toBeNull()
    expect(validateScore(3)).toBeNull()
    expect(validateScore(-1)).not.toBeNull()
    expect(validateScore(1.5)).not.toBeNull()
    expect(validateScore(Number.NaN)).not.toBeNull()
  })
})

describe('parseTeamLines', () => {
  it('crea equipos únicos con abreviatura opcional y rechaza duplicados y líneas inválidas', () => {
    const { teams, rejected } = parseTeamLines('Alianza Lima, ALI\nCristal\n\nalianza lima\nMelgar, ABCDEFGHIJKLM', ['Universitario'])
    expect(teams).toEqual([{ name: 'Alianza Lima', shortName: 'ALI' }, { name: 'Cristal', shortName: null }])
    expect(rejected).toEqual(['alianza lima', 'Melgar, ABCDEFGHIJKLM'])
  })

  it('respeta equipos ya existentes sin distinguir mayúsculas', () => {
    expect(parseTeamLines('universitario', ['Universitario']).rejected).toEqual(['universitario'])
  })
})

describe('horario en la zona del tenant', () => {
  it('convierte hora local de Lima (UTC−5) a UTC y de vuelta', () => {
    const iso = zonedLocalToIso('2026-10-12T20:30', 'America/Lima')
    expect(iso).toBe('2026-10-13T01:30:00.000Z')
    expect(isoToZonedLocal(iso!, 'America/Lima')).toBe('2026-10-12T20:30')
  })

  it('respeta el horario de verano de otra zona', () => {
    expect(zonedLocalToIso('2026-07-01T12:00', 'Europe/Madrid')).toBe('2026-07-01T10:00:00.000Z')
    expect(zonedLocalToIso('2026-01-01T12:00', 'Europe/Madrid')).toBe('2026-01-01T11:00:00.000Z')
  })

  it('UTC es identidad', () => {
    expect(zonedLocalToIso('2026-10-12T20:30', 'UTC')).toBe('2026-10-12T20:30:00.000Z')
  })

  it('rechaza formato o zona inválidos', () => {
    expect(zonedLocalToIso('12/10/2026 20:30', 'UTC')).toBeNull()
    expect(zonedLocalToIso('2026-10-12T20:30', 'No/Existe')).toBeNull()
    expect(validateKickoff('', 'UTC').error).not.toBeNull()
    expect(validateKickoff('2026-10-12T20:30', 'UTC').iso).toBe('2026-10-12T20:30:00.000Z')
  })

  it('la vista previa del cierre resta el offset de la quiniela', () => {
    expect(lockAtPreview('2026-10-13T01:30:00.000Z', 15).toISOString()).toBe('2026-10-13T01:15:00.000Z')
  })
})

describe('humanizeSportsRpcError', () => {
  it('traduce los rechazos de integridad del servidor', () => {
    expect(humanizeSportsRpcError('schedule is frozen: a pool lock has been reached', '42501')).toMatch(/congelado/)
    expect(humanizeSportsRpcError('both teams must be enrolled in the tournament')).toMatch(/inscritos/)
    expect(humanizeSportsRpcError('revision conflict', '40001')).toMatch(/cambió/)
    expect(humanizeSportsRpcError('the match has not started')).toMatch(/antes de que empiece/)
    expect(humanizeSportsRpcError('not authorized', '42501')).toMatch(/permisos/)
  })

  it('no filtra mensajes internos desconocidos', () => {
    expect(humanizeSportsRpcError('relation "x" does not exist')).toBe('No pudimos completar esta acción. Inténtalo de nuevo.')
  })
})
