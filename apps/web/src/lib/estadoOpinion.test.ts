import { describe, expect, it } from 'vitest'
import { esEstadoOpinion } from './estadoOpinion'

describe('estado de una opinión', () => {
  it.each(['pendiente', 'aceptada', 'rechazada'])('reconoce %j', (estado) => {
    expect(esEstadoOpinion(estado)).toBe(true)
  })

  it.each(['', 'Pendiente', 'aprobada', 'constructor', 'toString', null, undefined, 1, {}, ['pendiente']])('no reconoce %j', (valor) => {
    expect(esEstadoOpinion(valor)).toBe(false)
  })
})
