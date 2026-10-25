import { describe, expect, it } from 'vitest'
import { formatearCuit, normalizarCuit, validarCuit } from './cuit'

// Mismos vectores que supabase/tests/database/proveedores.test.sql.
describe('cuit', () => {
  it.each(['20123456786', '30701234568', '33555555550', '30700000040'])('acepta el CUIT válido %s', (cuit) => {
    expect(validarCuit(cuit)).toEqual({ valido: true })
  })

  it.each(['20-12345678-6', ' 33 555.555.55-0 ', '30-70123456-8'])('acepta guiones, puntos y espacios: %s', (cuit) => {
    expect(validarCuit(cuit)).toEqual({ valido: true })
  })

  it('rechaza un dígito verificador incorrecto', () => {
    expect(validarCuit('20123456785')).toEqual({ valido: false, motivo: 'El CUIT no es válido: revisá el dígito verificador.' })
  })

  it('rechaza el resto 1 (el dígito 10 no existe) sin importar el último dígito', () => {
    for (const ultimo of '0123456789') {
      expect(validarCuit(`3070000013${ultimo}`).valido).toBe(false)
    }
  })

  it('rechaza letras, largo incorrecto y vacío con mensajes distintos', () => {
    expect(validarCuit('AB123456786')).toEqual({ valido: false, motivo: 'El CUIT solo admite números (con o sin guiones).' })
    expect(validarCuit('2012345678')).toEqual({ valido: false, motivo: 'El CUIT debe tener 11 dígitos.' })
    expect(validarCuit('201234567860')).toEqual({ valido: false, motivo: 'El CUIT debe tener 11 dígitos.' })
    expect(validarCuit('  ')).toEqual({ valido: false, motivo: 'Ingresá el CUIT.' })
  })

  it('normaliza a solo dígitos', () => {
    expect(normalizarCuit(' 20-12345678.6 ')).toBe('20123456786')
  })

  it('formatea como XX-XXXXXXXX-X y no inventa si no son 11 dígitos', () => {
    expect(formatearCuit('20123456786')).toBe('20-12345678-6')
    expect(formatearCuit('20-12345678-6')).toBe('20-12345678-6')
    expect(formatearCuit('123')).toBe('123')
    expect(formatearCuit(null)).toBe('')
  })
})
