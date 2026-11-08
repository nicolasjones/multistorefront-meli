import { describe, expect, it } from 'vitest'
import { DESTINOS_PANEL } from '../components/navegacion/destinosPanel'
import { resolverAyuda } from './resolverAyuda'
import type { AyudaPorDestino } from './tipos'

const ayuda = (...ids: string[]): AyudaPorDestino =>
  Object.fromEntries(ids.map((id) => [id, { titulo: id, resumen: `resumen de ${id}` }]))

describe('resolverAyuda (FR-022, FR-025)', () => {
  const todas = ayuda(...DESTINOS_PANEL.map((d) => d.id))

  it('destino exacto del menú', () => {
    expect(resolverAyuda('/categorias', todas).destinoId).toBe('categorias')
    expect(resolverAyuda('/ventas/mostrador', todas).destinoId).toBe('ventas-mostrador')
  })

  it('una subruta (ficha, formulario) muestra la ayuda de su destino padre', () => {
    expect(resolverAyuda('/clientes/123/editar', todas).destinoId).toBe('clientes')
    expect(resolverAyuda('/productos/abc-def', todas).destinoId).toBe('productos')
  })

  it('cuando coinciden varios destinos gana el MÁS ESPECÍFICO (no el primero del menú)', () => {
    expect(resolverAyuda('/stock', todas).destinoId).toBe('stock')
    expect(resolverAyuda('/stock/movimientos', todas).destinoId).toBe('stock-movimientos')
    expect(resolverAyuda('/stock/movimientos/9', todas).destinoId).toBe('stock-movimientos')
    expect(resolverAyuda('/clientes/correo-masivo', todas).destinoId).toBe('correo-masivo')
  })

  it('la raíz «/» solo coincide exacta (no se lleva todas las rutas)', () => {
    expect(resolverAyuda('/', todas).destinoId).toBe('inicio')
    expect(resolverAyuda('/ruta-que-no-existe', todas)).toEqual({ destinoId: null, contenido: null })
  })

  it('un destino del menú sin entrada de ayuda devuelve contenido null (la pantalla dice «todavía no tiene ayuda»)', () => {
    const sin = ayuda(...DESTINOS_PANEL.map((d) => d.id).filter((id) => id !== 'stock-ingresos'))
    expect(resolverAyuda('/stock/ingresos', sin)).toEqual({ destinoId: 'stock-ingresos', contenido: null })
  })
})
