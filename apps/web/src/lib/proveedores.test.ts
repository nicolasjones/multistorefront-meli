import { describe, expect, it, vi } from 'vitest'
import { esConflicto, esCuitRepetido, mensajeDeError } from './proveedores'

describe('esCuitRepetido', () => {
  it('reconoce la restricción por el message', () => {
    expect(
      esCuitRepetido({
        code: '23505',
        message: 'duplicate key value violates unique constraint "proveedores_organizacion_id_cuit_key"',
      }),
    ).toBe(true)
  })

  it('reconoce la restricción por el details', () => {
    expect(
      esCuitRepetido({
        code: '23505',
        message: 'duplicate key value',
        details: 'Key (organizacion_id, cuit)=(…, 20123456786) already exists.',
      }),
    ).toBe(true)
  })

  it('no confunde otra 23505 ni otro código', () => {
    expect(esCuitRepetido({ code: '23505', message: 'violates "otra_restriccion_key"', details: 'Key (id)=(1) already exists.' })).toBe(false)
    expect(esCuitRepetido({ code: '22023', message: 'proveedores_organizacion_id_cuit_key' })).toBe(false)
    expect(esCuitRepetido(null)).toBe(false)
  })
})

describe('proveedores · códigos de «no existe» y conflicto de edición (código viejo y nuevo)', () => {
  it.each(['40001', 'PT412'])('reconoce %s como conflicto de edición', (code) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(esConflicto({ code })).toBe(true)
    expect(mensajeDeError({ code }, 'Base')).toMatch(/Otra persona/)
  })
  it.each(['P0002', 'PT404'])('traduce %s a «el proveedor ya no existe»', (code) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(mensajeDeError({ code }, 'Base')).toBe('El proveedor ya no existe o no pertenece a tu organización.')
  })
  it('no toma otros códigos por conflicto', () => {
    expect(esConflicto({ code: '23505' })).toBe(false)
  })
})
