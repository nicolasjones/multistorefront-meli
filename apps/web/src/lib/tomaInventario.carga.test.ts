import { beforeEach, describe, expect, it, vi } from 'vitest'

// MSF-716: la toma de inventario con una categoría grande fallaba porque el stock del depósito se
// pedía con un único `in.(…)` en la URL (≈39 KB con 1000 productos). Estos tests cubren el camino
// real de carga: productos de la categoría → lotes de stock → filas con su stock en el sistema.
// También el filtro por categoría, que viaja por la URL igual que el de producto.

type Producto = { id: string; nombre: string; sku: string | null }

const mocks = vi.hoisted(() => ({
  productos: [] as Producto[],
  // Productos por categoría (para probar el filtro repartido en varios lotes).
  porCategoria: null as null | Record<string, Producto[]>,
  total: null as number | null,
  stockVacio: false,
  peticionesStock: [] as string[][],
  peticionesCategoria: [] as string[][],
}))

vi.mock('./supabase', () => ({
  supabaseClient: {
    from: (tabla: string) => {
      let ids: string[] = []
      let columna = ''
      const consulta = {
        select: () => consulta,
        eq: () => consulta,
        in: (col: string, valores: string[]) => { columna = col; ids = valores; return consulta },
        order: () => consulta,
        limit: () => consulta,
        returns: async () => {
          if (tabla === 'v_productos_listado') {
            mocks.peticionesCategoria.push(ids)
            const productos = mocks.porCategoria
              ? ids.flatMap((id) => mocks.porCategoria?.[id] ?? [])
              : mocks.productos
            return { data: productos, error: null, count: mocks.total ?? productos.length }
          }
          if (tabla === 'depositos_listado') {
            return { data: [{ id: 'dep-1', nombre: 'Principal', por_defecto: true }], error: null, count: null }
          }
          if (columna !== 'producto_id') throw new Error(`Filtro inesperado: ${columna}`)
          mocks.peticionesStock.push(ids)
          return {
            data: mocks.stockVacio ? [] : ids.map((id) => ({
              producto_id: id, deposito_id: 'dep-1', cantidad: '3', reservado: '0', disponible: '3',
            })),
            error: null,
            count: null,
          }
        },
      }
      return consulta
    },
  },
}))

import { LOTE_IDS_STOCK } from './depositos'
import { MAXIMO_PRODUCTOS_TOMA, cargarFilasToma } from './tomaInventario'

// Ids con la forma de un uuid (36 caracteres): es lo que viaja en la URL.
const productos = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    nombre: `Producto ${i}`,
    sku: `SKU-${i}`,
  }))

// Ids de categoría con la forma de un uuid: también viajan en la URL.
const categorias = (n: number) =>
  Array.from({ length: n }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`)

// Largo de la URL que arma PostgREST para el filtro `in.(…)` (como la codifica URLSearchParams).
const largoUrlFiltro = (valores: string[]) =>
  new URLSearchParams({ producto_id: `in.(${valores.join(',')})` }).toString().length

describe('cargarFilasToma (MSF-716)', () => {
  beforeEach(() => {
    mocks.productos = []
    mocks.porCategoria = null
    mocks.total = null
    mocks.stockVacio = false
    mocks.peticionesStock = []
    mocks.peticionesCategoria = []
  })

  it('una categoría de 1000 productos carga todas las filas con su stock en el sistema', async () => {
    mocks.productos = productos(MAXIMO_PRODUCTOS_TOMA)
    const filas = await cargarFilasToma(['c-1'])
    expect(filas).toHaveLength(MAXIMO_PRODUCTOS_TOMA)
    expect(filas[0]).toEqual({
      producto_id: '00000000-0000-4000-8000-000000000000',
      nombre: 'Producto 0',
      sku: 'SKU-0',
      sistema: 3,
    })
    expect(filas.at(-1)?.sistema).toBe(3)
  })

  it('el stock se pide en lotes cuya URL no excede el límite del proxy', async () => {
    mocks.productos = productos(MAXIMO_PRODUCTOS_TOMA)
    await cargarFilasToma(['c-1'])
    expect(mocks.peticionesStock.length).toBe(Math.ceil(MAXIMO_PRODUCTOS_TOMA / LOTE_IDS_STOCK))
    for (const lote of mocks.peticionesStock) {
      expect(lote.length).toBeLessThanOrEqual(LOTE_IDS_STOCK)
      expect(largoUrlFiltro(lote)).toBeLessThanOrEqual(8000)
    }
  })

  it('sin stock en el depósito, la fila muestra 0 (no queda indefinido)', async () => {
    mocks.productos = productos(3)
    mocks.stockVacio = true
    const filas = await cargarFilasToma(['c-1'])
    expect(filas.map((fila) => fila.sistema)).toEqual([0, 0, 0])
  })

  it('una categoría con más de 1000 productos avisa y no pide el stock', async () => {
    // La API tops las filas en 1000: el total (`count`) es lo que delata el exceso.
    mocks.productos = productos(MAXIMO_PRODUCTOS_TOMA)
    mocks.total = MAXIMO_PRODUCTOS_TOMA + 1
    await expect(cargarFilasToma(['c-1'])).rejects.toThrow(
      `La categoría tiene más de ${MAXIMO_PRODUCTOS_TOMA} productos: elegí una subcategoría.`,
    )
    expect(mocks.peticionesStock).toHaveLength(0)
  })

  it('una categoría vacía devuelve [] sin pedir el stock', async () => {
    expect(await cargarFilasToma(['c-2'])).toEqual([])
    expect(mocks.peticionesStock).toHaveLength(0)
  })

  it('una sola categoría se consulta en una petición (no se parte al pedo)', async () => {
    mocks.productos = productos(3)
    await cargarFilasToma(['c-1'])
    expect(mocks.peticionesCategoria).toEqual([['c-1']])
  })

  it('muchas categorías se reparten en lotes cuya URL no excede el límite del proxy', async () => {
    mocks.productos = productos(2)
    await cargarFilasToma(categorias(250))
    expect(mocks.peticionesCategoria.length).toBe(Math.ceil(250 / LOTE_IDS_STOCK))
    for (const lote of mocks.peticionesCategoria) {
      expect(lote.length).toBeLessThanOrEqual(LOTE_IDS_STOCK)
      expect(largoUrlFiltro(lote)).toBeLessThanOrEqual(8000)
    }
  })

  it('los productos de varias categorías se unen sin repetir y quedan ordenados por nombre', async () => {
    const ids = categorias(150)
    mocks.porCategoria = {
      [ids[0]]: [{ id: 'p-2', nombre: 'Beta', sku: 'B' }],
      [ids[120]]: [{ id: 'p-1', nombre: 'Alfa', sku: 'A' }, { id: 'p-3', nombre: 'Gamma', sku: 'G' }],
    }
    const filas = await cargarFilasToma(ids)
    expect(filas.map((fila) => fila.nombre)).toEqual(['Alfa', 'Beta', 'Gamma'])
    expect(new Set(filas.map((fila) => fila.producto_id)).size).toBe(3)
  })

  it('el total de la categoría suma los lotes y avisa si supera el máximo', async () => {
    const ids = categorias(150)
    mocks.porCategoria = { [ids[0]]: productos(1), [ids[120]]: productos(1) }
    mocks.total = 600
    await expect(cargarFilasToma(ids)).rejects.toThrow(
      `La categoría tiene más de ${MAXIMO_PRODUCTOS_TOMA} productos: elegí una subcategoría.`,
    )
    expect(mocks.peticionesStock).toHaveLength(0)
  })
})
