import { describe, expect, it } from 'vitest'
import { definicionEstadoRma, ESTADOS_RMA, siguienteEstadoRma } from './estadoRma'

describe('estados del RMA', () => {
  it('cada estado tiene su etiqueta visible', () => {
    expect(ESTADOS_RMA.map((e) => [e.valor, e.etiqueta])).toEqual([
      ['abierto', 'Abierta'],
      ['en_gestion', 'En gestión'],
      ['cerrado', 'Cerrada'],
    ])
    expect(definicionEstadoRma('cerrado')).toMatchObject({ etiqueta: 'Cerrada', tono: 'exito' })
  })

  it('un estado desconocido se muestra con su valor crudo y tono neutro', () => {
    expect(definicionEstadoRma('raro')).toMatchObject({ etiqueta: 'raro', tono: 'neutral' })
  })

  it('la secuencia avanza abierto, en gestión, cerrado y ahí termina', () => {
    expect(siguienteEstadoRma('abierto')).toBe('en_gestion')
    expect(siguienteEstadoRma('en_gestion')).toBe('cerrado')
    expect(siguienteEstadoRma('cerrado')).toBeNull()
  })

  it('un estado desconocido no ofrece un próximo paso', () => {
    expect(siguienteEstadoRma('raro')).toBeNull()
    expect(siguienteEstadoRma('')).toBeNull()
  })
})
