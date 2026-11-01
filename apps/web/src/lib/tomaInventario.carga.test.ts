import { beforeEach, describe, expect, it, vi } from 'vitest'

// MSF-716: la toma de inventario con una categoría grande fallaba porque el stock del depósito se
// pedía con un único `in.(…)` en la URL (≈39 KB con 1000 productos). Estos tests cubren el camino
// real de carga: productos de la categoría → lotes de stock → filas con su stock en el sistema.

const mocks = vi.hoisted(() => ({
  productos: [] as { id: string; nombre: string; sku: string | null }[],
  total: null as number | null,
  stockVacio: false,
  peticionesStock: [] as string[][],
}))

vi.mock('./supabase', () => ({
  supabaseClient: {
    from: (tabla: string) => {
      let ids: string[] = []
      const consulta = {
        select: () => consulta,
        eq: () => consulta,
        in: (_col: string, valores: string[]) => { ids = valores; return consulta },
        order: () => consulta,
        limit: () => consulta,
        returns: async () => {
          if (tabla === 'v_productos_listado') {
            return { data: mocks.productos, error: null, count: mocks.total ?? mocks.productos.length }
          }
          if (tabla === 'depositos_listado') {
            return { data: [{ id: 'dep-1', nombre: 'Principal', por_defecto: true }], error: null, count: null }
          }
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

// Largo de la URL que arma PostgREST para el filtro `in.(…)` (como la codifica URLSearchParams).
const largoUrlFiltro = (valores: string[]) =>
  new URLSearchParams({ producto_id: `in.(${valores.join(',')})` }).toString().length

describe('cargarFilasToma (MSF-716)', () => {
  beforeEach(() => {
    mocks.productos = []
    mocks.total = null
    mocks.stockVacio = false
    mocks.peticionesStock = []
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
})
