import { describe, expect, it } from 'vitest'
import { normalizarCbu, validarCbu } from './cbu'

// Mismos vectores que supabase/tests/database/cuentas_cobro.test.sql (private.cbu_valido).
describe('validarCbu', () => {
  it.each(['0170099220000067797370', '2850590940090418135201'])('acepta el CBU válido %s', (cbu) => {
    expect(validarCbu(cbu)).toEqual({ valido: true })
  })

  it('acepta espacios, puntos y guiones al pegarlo', () => {
    expect(validarCbu('0170 0992 2000 0067 7973 70')).toEqual({ valido: true })
    expect(normalizarCbu('01700992-20000067797370')).toBe('0170099220000067797370')
  })

  it('rechaza el vacío pidiendo el dato', () => {
    expect(validarCbu('  ')).toEqual({ valido: false, motivo: 'Ingresá el CBU o CVU.' })
  })

  it('rechaza letras', () => {
    expect(validarCbu('01700992200000677973AB')).toEqual({ valido: false, motivo: 'El CBU / CVU solo admite números.' })
  })

  it('rechaza una cantidad de dígitos distinta de 22', () => {
    expect(validarCbu('017009922000006779737')).toEqual({ valido: false, motivo: 'El CBU / CVU debe tener 22 dígitos.' })
    expect(validarCbu('01700992200000677973700')).toEqual({ valido: false, motivo: 'El CBU / CVU debe tener 22 dígitos.' })
  })

  it('rechaza el verificador del segundo bloque mal', () => {
    expect(validarCbu('0170099220000067797371')).toMatchObject({ valido: false, motivo: expect.stringContaining('dígitos verificadores') })
  })

  it('rechaza el primer bloque alterado', () => {
    expect(validarCbu('0170099120000067797370')).toMatchObject({ valido: false, motivo: expect.stringContaining('dígitos verificadores') })
  })
})
