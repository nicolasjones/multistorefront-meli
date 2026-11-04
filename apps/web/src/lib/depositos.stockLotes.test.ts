import { beforeEach, describe, expect, it, vi } from 'vitest'

// MSF-716: la toma de inventario pedía el stock de hasta 1000 productos en un único `in.(…)`
// dentro de la URL GET (≈39 KB) y el proxy la rechazaba: la pantalla mostraba «No pudimos cargar
// los productos de esta categoría». Los lotes acotan la URL y las olas acotan la ráfaga.

const mocks = vi.hoisted(() => ({
  llamadas: [] as string[][],
  falla: null as null | { lote: number },
  enVuelo: 0,
  pico: 0,
}))

vi.mock('./supabase', () => ({
  supabaseClient: {
    from: () => {
      let ids: string[] = []
      const consulta = {
        select: () => consulta,
        in: (_col: string, valores: string[]) => { ids = valores; return consulta },
        eq: () => consulta,
        returns: async () => {
          mocks.enVuelo += 1
          mocks.pico = Math.max(mocks.pico, mocks.enVuelo)
          try {
            // Un turno de espera: las peticiones de una ola quedan efectivamente simultáneas.
            await new Promise((resolver) => setTimeout(resolver, 0))
            mocks.llamadas.push(ids)
            if (mocks.falla && mocks.llamadas.length === mocks.falla.lote) {
              return { data: null, error: new Error('boom') }
            }
            return {
              data: ids.map((id) => ({ producto_id: id, deposito_id: 'dep', cantidad: '2', reservado: '1', disponible: '1' })),
              error: null,
            }
          } finally {
            mocks.enVuelo -= 1
          }
        },
      }
      return consulta
    },
  },
}))

import { LOTE_IDS_STOCK, MAXIMA_CONCURRENCIA_STOCK, listarStockPorDepositoDe } from './depositos'

// Ids con la forma de un uuid (36 caracteres): es lo que viaja en la URL.
const ids = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)

// Largo de la URL que arma PostgREST para el filtro `in.(…)` (como la codifica URLSearchParams).
const largoUrlFiltro = (valores: string[]) =>
  new URLSearchParams({ producto_id: `in.(${valores.join(',')})` }).toString().length

// El límite típico de 8 KB del proxy (nginx) para la línea de petición.
const LIMITE_PROXY = 8000

describe('listarStockPorDepositoDe (MSF-716)', () => {
  beforeEach(() => {
    mocks.llamadas = []
    mocks.falla = null
    mocks.enVuelo = 0
    mocks.pico = 0
  })

  it('con 1000 ids parte en lotes acotados y devuelve la unión completa', async () => {
    const r = await listarStockPorDepositoDe(ids(1000), 'dep')
    expect(mocks.llamadas.length).toBe(Math.ceil(1000 / LOTE_IDS_STOCK))
    expect(Math.max(...mocks.llamadas.map((l) => l.length))).toBeLessThanOrEqual(LOTE_IDS_STOCK)
    expect(Object.keys(r)).toHaveLength(1000)
    expect(r[ids(1000)[999]]).toEqual({ deposito_id: 'dep', cantidad: 2, reservado: 1, disponible: 1 })
  })

  it('ninguna petición lleva una URL más larga que el límite del proxy', async () => {
    await listarStockPorDepositoDe(ids(1000), 'dep')
    for (const lote of mocks.llamadas) {
      expect(largoUrlFiltro(lote)).toBeLessThanOrEqual(LIMITE_PROXY)
    }
  })

  it('el mismo conjunto de ids en una sola petición excedería el límite del proxy', () => {
    // El lote sin partir es el que rompía: deja por qué el reparto no es un detalle cosmético.
    expect(largoUrlFiltro(ids(250))).toBeGreaterThan(LIMITE_PROXY)
    expect(largoUrlFiltro(ids(1000))).toBeGreaterThan(LIMITE_PROXY)
  })

  it('no lanza más de MAXIMA_CONCURRENCIA_STOCK peticiones a la vez', async () => {
    await listarStockPorDepositoDe(ids(1000), 'dep')
    expect(mocks.pico).toBeLessThanOrEqual(MAXIMA_CONCURRENCIA_STOCK)
    expect(mocks.pico).toBeGreaterThan(1)
  })

  it('lista vacía devuelve {} sin peticiones', async () => {
    expect(await listarStockPorDepositoDe([], 'dep')).toEqual({})
    expect(mocks.llamadas).toHaveLength(0)
  })

  it('ids repetidos se consultan una sola vez', async () => {
    await listarStockPorDepositoDe(['a', 'a', 'b'], 'dep')
    expect(mocks.llamadas).toEqual([['a', 'b']])
  })

  it('si un lote falla propaga el error (sin stock parcial)', async () => {
    mocks.falla = { lote: 2 }
    await expect(listarStockPorDepositoDe(ids(250), 'dep')).rejects.toThrow('boom')
  })
})
