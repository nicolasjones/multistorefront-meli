import { describe, expect, it } from 'vitest'
import { FILTROS_INICIALES, conCambio, formatearPrecioArs, mapearPagina, parsearFiltros, serializarFiltros, subtotalLinea, totalLista } from './tiendaListado'

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

describe('mapearPagina', () => {
  // La base (`publico.categorias_por_dominio`) ya devuelve el conteo acumulado: una raíz con 2 hijas de 3 productos llega con 6.
  it('no suma de nuevo las subcategorías: raíz con 2 hijas de 3 productos muestra 6, no 12', () => {
    const pagina = mapearPagina({
      total: 0, pagina: 1, tamano: 24, productos: [],
      categorias: [
        { id: 'r', nombre: 'Consolas', padre_id: null, productos: 6 },
        { id: 'h1', nombre: 'Portátiles', padre_id: 'r', productos: 3 },
        { id: 'h2', nombre: 'Sobremesa', padre_id: 'r', productos: 3 },
      ],
    })
    expect(pagina.categorias.map((c) => c.productos)).toEqual([6, 3, 3])
  })
})

describe('formatearPrecioArs', () => {
  it.each([
    [18455, '$ 18.455'],
    [999, '$ 999'],
    [1234, '$ 1.234'],
    [1234567, '$ 1.234.567'],
    [18455.4, '$ 18.455,40'],
    [18455.5, '$ 18.455,50'],
    [18455.99, '$ 18.455,99'],
    [1234.05, '$ 1.234,05'],
    [0.99, '$ 0,99'],
    [4775.1 + 0.2, '$ 4.775,30'],
  ])('%s → %s', (precio, esperado) => {
    expect(formatearPrecioArs(precio)).toBe(esperado)
  })

  it('sin precio calculable no inventa texto', () => {
    expect(formatearPrecioArs(null)).toBeNull()
  })
})

describe('importes de la lista al centavo', () => {
  it('el subtotal de una línea es precio al centavo por cantidad, sin errores de coma flotante', () => {
    expect(subtotalLinea(1.1, 3)).toBe(3.3)
    expect(subtotalLinea(4775.35, 7)).toBe(33427.45)
  })

  it('el total suma los subtotales en centavos y no redondea al peso', () => {
    expect(totalLista([{ precioUnitario: 10.1, cantidad: 3 }, { precioUnitario: 0.2, cantidad: 1 }])).toBe(30.5)
    expect(formatearPrecioArs(totalLista([{ precioUnitario: 4775.35, cantidad: 2 }]))).toBe('$ 9.550,70')
  })
})
