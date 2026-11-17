import { describe, expect, it } from 'vitest'
import { enLotes, MAXIMA_CONCURRENCIA_PETICIONES, MAXIMO_IDS_POR_PETICION, pedirEnOlas } from './repartoIds'

describe('reparto de ids en lotes', () => {
  it('parte la lista sin perder ni repetir ids y deja el resto en el último lote', () => {
    expect(enLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(enLotes([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]])
  })

  it('una lista vacía no genera lotes', () => {
    expect(enLotes([], 100)).toEqual([])
  })

  it('con el máximo por petición, 250 ids son tres lotes de 100, 100 y 50', () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`)
    const lotes = enLotes(ids, MAXIMO_IDS_POR_PETICION)
    expect(lotes.map((lote) => lote.length)).toEqual([100, 100, 50])
    expect(lotes.flat()).toEqual(ids)
  })
})

describe('pedido de lotes por olas', () => {
  it('devuelve las respuestas en el orden de los lotes', async () => {
    const lotes = [[1], [2], [3]]
    const respuestas = await pedirEnOlas(lotes, async ([n]) => [n * 10, n * 10 + 1])
    expect(respuestas).toEqual([10, 11, 20, 21, 30, 31])
  })

  it('nunca tiene más peticiones simultáneas que el tope', async () => {
    let enCurso = 0
    let maximo = 0
    const lotes = Array.from({ length: 10 }, (_, i) => [i])
    const respuestas = await pedirEnOlas(lotes, async ([n]) => {
      enCurso += 1
      maximo = Math.max(maximo, enCurso)
      await Promise.resolve()
      enCurso -= 1
      return [n]
    })
    expect(maximo).toBe(MAXIMA_CONCURRENCIA_PETICIONES)
    expect(respuestas).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('si un lote falla, el error sale y no se piden las olas siguientes', async () => {
    const pedidos: number[] = []
    const lotes = Array.from({ length: 8 }, (_, i) => [i])
    await expect(
      pedirEnOlas(lotes, async ([n]) => {
        pedidos.push(n)
        if (n === 1) throw new Error('falló')
        return [n]
      }),
    ).rejects.toThrow('falló')
    expect(pedidos).toEqual([0, 1, 2, 3])
  })

  it('sin lotes no hace ninguna petición', async () => {
    expect(await pedirEnOlas([], async () => [1])).toEqual([])
  })
})
