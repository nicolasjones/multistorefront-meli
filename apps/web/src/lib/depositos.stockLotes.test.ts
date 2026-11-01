import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ llamadas: [] as string[][], falla: null as null | { lote: number } }))

vi.mock('./supabase', () => ({
  supabaseClient: {
    from: () => {
      let ids: string[] = []
      const consulta = {
        select: () => consulta,
        in: (_col: string, valores: string[]) => { ids = valores; return consulta },
        eq: () => consulta,
        returns: async () => {
          mocks.llamadas.push(ids)
          if (mocks.falla && mocks.llamadas.length === mocks.falla.lote) return { data: null, error: new Error('boom') }
          return {
            data: ids.map((id) => ({ producto_id: id, deposito_id: 'dep', cantidad: '2', reservado: '1', disponible: '1' })),
            error: null,
          }
        },
      }
      return consulta
    },
  },
}))

import { LOTE_IDS_STOCK, listarStockPorDepositoDe } from './depositos'

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`)

describe('listarStockPorDepositoDe (MSF-716)', () => {
  beforeEach(() => { mocks.llamadas = []; mocks.falla = null })

  it('con 1000 ids parte en lotes acotados y devuelve la unión completa', async () => {
    const r = await listarStockPorDepositoDe(ids(1000), 'dep')
    expect(mocks.llamadas.length).toBe(Math.ceil(1000 / LOTE_IDS_STOCK))
    expect(Math.max(...mocks.llamadas.map((l) => l.length))).toBeLessThanOrEqual(LOTE_IDS_STOCK)
    expect(Object.keys(r)).toHaveLength(1000)
    expect(r['id-999']).toEqual({ deposito_id: 'dep', cantidad: 2, reservado: 1, disponible: 1 })
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
