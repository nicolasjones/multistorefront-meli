import { describe, expect, it } from 'vitest'
import { etiquetaZonaHoraria } from './zonaHoraria'

describe('etiquetaZonaHoraria', () => {
  it('muestra la ciudad sin guiones bajos y la región entre paréntesis', () => {
    expect(etiquetaZonaHoraria('America/Argentina/Buenos_Aires')).toBe('Buenos Aires (América/Argentina)')
    expect(etiquetaZonaHoraria('America/Bogota')).toBe('Bogota (América)')
  })
  it('una zona sin región se muestra tal cual', () => {
    expect(etiquetaZonaHoraria('UTC')).toBe('UTC')
  })
})
