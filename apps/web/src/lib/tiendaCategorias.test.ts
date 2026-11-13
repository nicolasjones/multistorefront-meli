import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { schema: () => ({ rpc: mocks.rpc }) } }))

import { leerCategoriasPublicas, categoriasPrincipales, CATEGORIAS_PRINCIPALES, cuantasEntran, filasPanelCategorias, hayMasCategorias, type CategoriaPublica } from './tiendaCategorias'

const cat = (id: string, nombre: string, productos: number, padreId: string | null = null): CategoriaPublica => ({ id, nombre, productos, padreId, imagen: null })

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

describe('leerCategoriasPublicas · imagen (MSF-841)', () => {
  it('lleva la ruta de la foto de la categoría y null cuando no hay (o la base aún no la devuelve)', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        categorias: [
          { id: 'a', nombre: 'Joysticks', padre_id: null, productos: 3, imagen: 'org/prod/frente.png' },
          { id: 'b', nombre: 'Cargadores', padre_id: null, productos: 1, imagen: null },
          { id: 'c', nombre: 'Cables', padre_id: null, productos: 1 },
        ],
      },
      error: null,
    })
    const categorias = await leerCategoriasPublicas('mundojc.test')
    expect(categorias.map((c) => c.imagen)).toEqual(['org/prod/frente.png', null, null])
  })

  it('sin tienda (null) devuelve una lista vacía', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    expect(await leerCategoriasPublicas('no-existe.test')).toEqual([])
  })
})

describe('cuantasEntran (MSF-846)', () => {
  // 6 entradas de 150 px, «Más categorías» de 160 px y separación de 28 px.
  const anchos = [150, 150, 150, 150, 150, 150]
  it('entran todas cuando alcanza el ancho y no hay más categorías', () => {
    expect(cuantasEntran(anchos, 160, 28, 6 * 150 + 5 * 28, false)).toBe(6)
  })
  it('reserva el lugar de «Más categorías» si hay más en el catálogo', () => {
    expect(cuantasEntran(anchos, 160, 28, 6 * 150 + 5 * 28, true)).toBe(4)
  })
  it('muestra menos categorías y nunca corta la última (San Javucho a 1440 px: 1168 px)', () => {
    const anchosAncho = [190, 170, 210, 180, 200, 175]
    const n = cuantasEntran(anchosAncho, 190, 28, 1168, true)
    const usado = anchosAncho.slice(0, n).reduce((a, b) => a + b, 0) + 28 * n + 190
    expect(n).toBeLessThan(6)
    expect(usado).toBeLessThanOrEqual(1168)
    expect(cuantasEntran(anchosAncho, 190, 28, 1168 + 220, true)).toBeGreaterThan(n)
  })
  it('sin lugar para ninguna deja solo «Más categorías»; sin medidas muestra todas', () => {
    expect(cuantasEntran(anchos, 160, 28, 200, true)).toBe(0)
    expect(cuantasEntran(anchos.map(() => 0), 0, 28, 1000, true)).toBe(6)
    expect(cuantasEntran([], 160, 28, 1000, true)).toBe(0)
  })
})
