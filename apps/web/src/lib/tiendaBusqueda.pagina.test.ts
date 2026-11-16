import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { schema: () => ({ rpc: mocks.rpc }) } }))

import { leerPaginaBusqueda } from './tiendaBusqueda'
import { FILTROS_INICIALES } from './tiendaListado'

// MSF-845: la tanda a leer viaja como `pagina` al RPC de búsqueda (carga infinita).
describe('leerPaginaBusqueda', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
    mocks.rpc.mockResolvedValue({ data: { total: 0, pagina: 3, tamano: 24, categorias: [], productos: [] }, error: null })
  })

  it('envía la tanda pedida como `pagina` junto con host, q y filtros', async () => {
    await leerPaginaBusqueda('mundojc.localhost', 'joystick', { ...FILTROS_INICIALES, soloConStock: true }, 3)
    expect(mocks.rpc).toHaveBeenCalledWith(
      'busqueda_pagina_por_dominio',
      expect.objectContaining({ host: 'mundojc.localhost', q: 'joystick', solo_con_stock: true, pagina: 3 }),
    )
  })

  it('sin tanda pide la primera', async () => {
    await leerPaginaBusqueda('mundojc.localhost', 'joystick', FILTROS_INICIALES)
    expect(mocks.rpc).toHaveBeenCalledWith('busqueda_pagina_por_dominio', expect.objectContaining({ pagina: 1 }))
  })
})
