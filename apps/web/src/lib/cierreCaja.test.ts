import { describe, expect, it } from 'vitest'
import { fechaDeHoy } from './cierreCaja'

describe('fechaDeHoy (día de caja en la zona de la organización)', () => {
  it('a las 22:00 ART del día D sigue siendo D, aunque en UTC ya sea D+1', () => {
    expect(fechaDeHoy(new Date('2027-01-06T01:00:00Z'))).toBe('2027-01-05')
  })

  it('pasada la medianoche ART es el día siguiente', () => {
    expect(fechaDeHoy(new Date('2027-01-06T03:00:00Z'))).toBe('2027-01-06')
  })
})
