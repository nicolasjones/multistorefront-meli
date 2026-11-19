import { describe, expect, it } from 'vitest'
import { FORMAS_RMA, definicionForma } from './formasRma'

describe('formasRma', () => {
  it('el catálogo no repite valores ni deja etiquetas vacías', () => {
    const valores = FORMAS_RMA.map((forma) => forma.valor)
    expect(new Set(valores).size).toBe(valores.length)
    for (const forma of FORMAS_RMA) {
      expect(forma.etiqueta.trim()).not.toBe('')
      expect(forma.descripcion.trim()).not.toBe('')
    }
  })

  it('definicionForma devuelve la definición de una forma conocida', () => {
    expect(definicionForma('devolucion_importe')).toMatchObject({ etiqueta: 'Devolución de importe', tono: 'neutral' })
  })

  it('definicionForma muestra el valor crudo como etiqueta cuando la forma es desconocida', () => {
    expect(definicionForma('otra_forma')).toEqual({ valor: 'cambio_directo', etiqueta: 'otra_forma', descripcion: '', tono: 'neutral' })
  })
})
