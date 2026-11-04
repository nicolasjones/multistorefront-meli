import { describe, expect, it } from 'vitest'
import { acumularConteoCategorias } from './tiendaConteoCategorias'

const c = (id: string, padreId: string | null, productos: number) => ({ id, nombre: id, padreId, productos })

describe('acumularConteoCategorias (MSF-623)', () => {
  it('una raíz suma los productos de sus subcategorías y las hojas conservan el suyo', () => {
    const r = acumularConteoCategorias([c('consolas', null, 0), c('portatiles', 'consolas', 4), c('sobremesa', 'consolas', 9), c('otra', null, 2)])
    expect(r.map((x) => [x.id, x.productos])).toEqual([['consolas', 13], ['portatiles', 4], ['sobremesa', 9], ['otra', 2]])
  })

  it('suma varios niveles y suma los directos de la raíz', () => {
    const r = acumularConteoCategorias([c('a', null, 1), c('b', 'a', 2), c('c', 'b', 3)])
    expect(r.map((x) => x.productos)).toEqual([6, 5, 3])
  })

  it('una subcategoría cuyo padre no está en la lista no rompe, y un ciclo no se cuenta dos veces', () => {
    expect(acumularConteoCategorias([c('x', 'ausente', 3)])[0].productos).toBe(3)
    expect(acumularConteoCategorias([c('a', 'b', 1), c('b', 'a', 2)]).map((x) => x.productos)).toEqual([3, 3])
  })
})
