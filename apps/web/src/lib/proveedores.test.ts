import { describe, expect, it } from 'vitest'
import { esCuitRepetido } from './proveedores'

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
