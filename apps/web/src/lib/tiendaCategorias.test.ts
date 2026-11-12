import { describe, expect, it } from 'vitest'
import { categoriasPrincipales, CATEGORIAS_PRINCIPALES, filasPanelCategorias, hayMasCategorias, type CategoriaPublica } from './tiendaCategorias'

const cat = (id: string, nombre: string, productos: number, padreId: string | null = null): CategoriaPublica => ({ id, nombre, productos, padreId })

describe('categoriasPrincipales (MSF-825)', () => {
  it('toma las raíces de mayor a menor cantidad y corta en 6', () => {
    const raices = Array.from({ length: 10 }, (_, i) => cat(`r${i}`, `Raíz ${i}`, i + 1))
    const hijas = [cat('h1', 'Hija enorme', 999, 'r0')]
    const principales = categoriasPrincipales([...hijas, ...raices])
    expect(principales).toHaveLength(CATEGORIAS_PRINCIPALES)
    expect(principales.map((c) => c.id)).toEqual(['r9', 'r8', 'r7', 'r6', 'r5', 'r4'])
  })

  it('no repite nombres (queda la de más productos)', () => {
    const principales = categoriasPrincipales([cat('a', 'Consolas', 5), cat('b', 'consolas ', 9), cat('c', 'Juegos', 1)])
    expect(principales.map((c) => c.id)).toEqual(['b', 'c'])
  })

  it('desempata por nombre', () => {
    expect(categoriasPrincipales([cat('b', 'Beta', 3), cat('a', 'Alfa', 3)]).map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('sin raíces usa las categorías que haya; sin categorías devuelve []', () => {
    expect(categoriasPrincipales([cat('h', 'Hija', 2, 'oculta')]).map((c) => c.id)).toEqual(['h'])
    expect(categoriasPrincipales([])).toEqual([])
  })

  it('respeta un máximo propio y hayMasCategorias avisa cuando se recortó', () => {
    const todas = [cat('a', 'A', 3), cat('b', 'B', 2), cat('c', 'C', 1)]
    const dos = categoriasPrincipales(todas, 2)
    expect(dos).toHaveLength(2)
    expect(hayMasCategorias(todas, dos)).toBe(true)
    expect(hayMasCategorias(todas, categoriasPrincipales(todas))).toBe(false)
  })
})

describe('filasPanelCategorias (MSF-825, MSF-830)', () => {
  const todas = [
    cat('r1', 'Consolas', 10), cat('r2', 'Juegos', 8),
    cat('h1', 'Xbox', 4, 'r1'), cat('h2', 'Switch', 6, 'r1'), cat('n1', 'Xbox 360', 2, 'h1'), cat('h3', 'PS4', 8, 'r2'),
  ]
  const ver = (sel: string | null) => filasPanelCategorias(todas, sel).map((f) => `${f.nivel}:${f.categoria.id}`)

  it('sin selección solo muestra las raíces', () => {
    expect(ver(null)).toEqual(['0:r1', '0:r2'])
  })
  it('al elegir una raíz despliega sus hijas debajo de ella', () => {
    expect(ver('r1')).toEqual(['0:r1', '1:h1', '1:h2', '0:r2'])
  })
  it('al elegir una nieta despliega todo el camino con sangría por nivel', () => {
    expect(ver('n1')).toEqual(['0:r1', '1:h1', '2:n1', '1:h2', '0:r2'])
  })
  it('una categoría cuyo padre no vino se muestra como raíz', () => {
    expect(filasPanelCategorias([cat('x', 'Suelta', 1, 'oculta')], 'x').map((f) => f.nivel)).toEqual([0])
  })
})
