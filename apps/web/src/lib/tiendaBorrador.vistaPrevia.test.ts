import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { leerVistaPrevia } from './tiendaBorrador'

const base = { empresa_nombre: 'Demo', en_linea: true, identidad: {}, contenido: {}, hay_productos: true, destacados: [] }

describe('leerVistaPrevia (MSF-846)', () => {
  it('conserva la foto de cada categoría que devuelve la RPC y usa null si falta', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        ...base,
        categorias: [
          { id: 'a', nombre: 'Consolas', padre_id: null, productos: 3, imagen: 'org/emp/p1.jpg' },
          { id: 'b', nombre: 'Cables', padre_id: 'a', productos: 1, imagen: null },
          { id: 'c', nombre: 'Juegos', padre_id: null, productos: 2 },
        ],
      },
      error: null,
    })
    const vista = await leerVistaPrevia('e1')
    expect(mocks.rpc).toHaveBeenCalledWith('vista_previa_tienda', { p_empresa: 'e1' })
    expect(vista.categorias.map((c) => c.imagen)).toEqual(['org/emp/p1.jpg', null, null])
    expect(vista.categorias[1]).toMatchObject({ padreId: 'a', productos: 1 })
  })
})
