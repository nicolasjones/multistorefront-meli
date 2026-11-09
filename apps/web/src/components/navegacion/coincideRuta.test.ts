import { describe, expect, it } from 'vitest'
import { coincideRuta } from './destinosPanel'

// Caracterización de la función que se extrajo de las migas de pan (MSF-385, T011): su comportamiento NO cambió.
describe('coincideRuta (criterio compartido por las migas de pan y la ayuda)', () => {
  it('coincide exacta o por prefijo (subrutas)', () => {
    expect(coincideRuta('/stock', '/stock')).toBe(true)
    expect(coincideRuta('/stock', '/stock/movimientos')).toBe(true)
    expect(coincideRuta('/clientes', '/clientes/123/editar')).toBe(true)
  })

  it('la raíz «/» solo coincide exacta', () => {
    expect(coincideRuta('/', '/')).toBe(true)
    expect(coincideRuta('/', '/stock')).toBe(false)
  })

  it('no coincide con otra ruta', () => {
    expect(coincideRuta('/stock', '/ventas')).toBe(false)
    expect(coincideRuta('/stock/movimientos', '/stock')).toBe(false)
  })
})
