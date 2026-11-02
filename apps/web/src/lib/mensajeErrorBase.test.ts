import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mensajeDeErrorBase } from './mensajeErrorBase'

describe('mensajeDeErrorBase', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { vi.restoreAllMocks() })

  it('nunca devuelve el message crudo de la base', () => {
    const crudo = { code: 'XX000', message: 'new row violates row-level security policy "politica_x"' }
    expect(mensajeDeErrorBase(crudo, 'No pudimos.')).toBe('No pudimos.')
  })

  it('mapea por código y prioriza los mensajes de la pantalla', () => {
    expect(mensajeDeErrorBase({ code: '42501' }, 'x')).toMatch(/permiso/)
    expect(mensajeDeErrorBase({ code: '23514' }, 'x', { '23514': 'Propio.' })).toBe('Propio.')
  })

  it('tolera errores sin forma (null, string, Error)', () => {
    expect(mensajeDeErrorBase(null, 'x')).toBe('x')
    expect(mensajeDeErrorBase(new Error('relation "t" does not exist'), 'x')).toBe('x')
  })
})
