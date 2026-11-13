import { describe, expect, it } from 'vitest'
import { FILTROS_INICIALES, conCambio, formatearPrecioArs, parsearFiltros, serializarFiltros } from './tiendaListado'

const ID = 'ca000000-0000-4000-8000-000000000001'

// F-TDA-12 (FR-036, FR-037): estado en la URL y formato del precio.
describe('parsearFiltros / serializarFiltros', () => {
  it('una query vacía da los filtros iniciales', () => {
    expect(parsearFiltros(new URLSearchParams())).toEqual(FILTROS_INICIALES)
  })

  it('restaura categoría, stock, precio máximo, y orden', () => {
    const filtros = parsearFiltros(new URLSearchParams(`categoria=${ID}&stock=1&max=5000&orden=precio_desc`))
    expect(filtros).toEqual({ categoria: ID, soloConStock: true, precioMax: 5000, orden: 'precio_desc' })
  })

  // MSF-845: los enlaces viejos con ?pagina=N no rompen; el parámetro se ignora y se arranca de la primera tanda.
  it.each(['pagina=3', 'pagina=0', 'pagina=x', 'pagina=999'])('ignora %s (carga infinita)', (consulta) => {
    expect(parsearFiltros(new URLSearchParams(consulta))).toEqual(FILTROS_INICIALES)
    expect(serializarFiltros(parsearFiltros(new URLSearchParams(`stock=1&${consulta}`))).toString()).toBe('stock=1')
  })

  it.each([
    ['categoria=no-es-un-id'],
    ['stock=si'],
    ['max=-5'],
    ['max=abc'],
    ['max=0'],
    ['orden=inventado'],
  ])('ignora el valor inválido %s', (consulta) => {
    expect(parsearFiltros(new URLSearchParams(consulta))).toEqual(FILTROS_INICIALES)
  })

  it('la categoría fija del path manda sobre ?categoria=', () => {
    const otra = 'ca000000-0000-4000-8000-000000000002'
    expect(parsearFiltros(new URLSearchParams(`categoria=${otra}`), ID).categoria).toBe(ID)
  })

  it('serializa solo lo que difiere del valor inicial y es reversible', () => {
    expect(serializarFiltros(FILTROS_INICIALES).toString()).toBe('')
    const filtros = { categoria: ID, soloConStock: true, precioMax: 5000, orden: 'precio_asc' as const }
    expect(parsearFiltros(serializarFiltros(filtros))).toEqual(filtros)
    expect(serializarFiltros(filtros, false).has('categoria')).toBe(false)
  })

  it('cambiar un filtro devuelve filtros nuevos sin tocar los demás', () => {
    const filtros = { ...FILTROS_INICIALES, precioMax: 100 }
    expect(conCambio(filtros, { soloConStock: true })).toEqual({ ...filtros, soloConStock: true })
    expect(conCambio(filtros, { orden: 'precio_asc' }).precioMax).toBe(100)
  })
})

describe('formatearPrecioArs', () => {
  it.each([
    [18455, '$ 18.455'],
    [999, '$ 999'],
    [1234, '$ 1.234'],
    [1234567, '$ 1.234.567'],
    [18455.4, '$ 18.455'],
  ])('%s → %s', (precio, esperado) => {
    expect(formatearPrecioArs(precio)).toBe(esperado)
  })

  it('sin precio calculable no inventa texto', () => {
    expect(formatearPrecioArs(null)).toBeNull()
  })
})
