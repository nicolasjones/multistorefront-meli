import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { esCodigoDeConflicto, mensajeDeErrorBase } from './mensajeErrorBase'

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

  it('traduce PT404 y PT409 (los códigos que PostgREST contesta como 404 y 409) como P0002 y 55000', () => {
    expect(mensajeDeErrorBase({ code: 'PT404' }, 'x')).toBe(mensajeDeErrorBase({ code: 'P0002' }, 'x'))
    expect(mensajeDeErrorBase({ code: 'PT409' }, 'x')).toBe(mensajeDeErrorBase({ code: '55000' }, 'x'))
    expect(mensajeDeErrorBase({ code: 'PT409' }, 'x')).not.toBe('x')
  })

  it('traduce PT412 (conflicto de edición, HTTP 412) como 40001 y reconoce los dos códigos', () => {
    expect(mensajeDeErrorBase({ code: 'PT412' }, 'x')).toBe(mensajeDeErrorBase({ code: '40001' }, 'x'))
    expect(mensajeDeErrorBase({ code: 'PT412' }, 'x')).not.toBe('x')
    expect(esCodigoDeConflicto('40001')).toBe(true)
    expect(esCodigoDeConflicto('PT412')).toBe(true)
    expect(esCodigoDeConflicto('PT409')).toBe(false)
  })

  it('traduce los errores de negocio 55000, 55006 y 54000 sin tratarlos como falla', () => {
    expect(mensajeDeErrorBase({ code: '55000' }, 'x')).toMatch(/estado actual/)
    expect(mensajeDeErrorBase({ code: '55006' }, 'x')).toMatch(/en curso/)
    expect(mensajeDeErrorBase({ code: '54000' }, 'x')).toMatch(/máximo/)
  })

  it('tolera errores sin forma (null, string, Error)', () => {
    expect(mensajeDeErrorBase(null, 'x')).toBe('x')
    expect(mensajeDeErrorBase(new Error('relation "t" does not exist'), 'x')).toBe('x')
  })

  describe('log sin PII', () => {
    it('registra solo el código, no el objeto de error', () => {
      const espia = vi.mocked(console.error)
      mensajeDeErrorBase({ code: '23505', details: 'Key (email)=(ana@x.com)' }, 'Fallo')
      const args = espia.mock.calls.at(-1) ?? []
      expect(JSON.stringify(args)).not.toContain('ana@x.com')
      expect(args).toContain('23505')
    })
  })
})
