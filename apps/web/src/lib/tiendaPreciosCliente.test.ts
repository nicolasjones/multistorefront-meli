import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), rpc: vi.fn() }))
vi.mock('./supabase', () => ({
  supabaseClient: { auth: { getSession: mocks.getSession }, schema: () => ({ rpc: mocks.rpc }) },
}))

import { leerPreciosCliente, rangoUnidades } from './tiendaPreciosCliente'

const ID = 'a1000000-0000-4000-8000-000000000001'
const MAYORISTA = {
  tipo: 'mayorista',
  precios: [{
    producto_id: ID,
    escalas: [
      { escala: 'x1', desde: 1, hasta: 4, final: '1210' },
      { escala: 'x5', desde: 5, hasta: 9, final: 1089 },
      { escala: 'x10', desde: 10, hasta: 49, final: 968 },
      { escala: 'x50', desde: 50, hasta: null, final: null },
    ],
  }],
}

// F-CLI-07 (FR-035): una llamada por carga, sin caché de escala; sin sesión no se llama a la base.
beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: 't' } } })
  mocks.rpc.mockResolvedValue({ data: MAYORISTA, error: null })
})

describe('leerPreciosCliente', () => {
  it('pide los precios del producto con el host y devuelve las escalas con importes numéricos', async () => {
    const precios = await leerPreciosCliente('mundojc.localhost', ID)
    expect(mocks.rpc).toHaveBeenCalledWith('precios_cliente_por_dominio', { host: 'mundojc.localhost', productos: [ID] })
    expect(precios?.tipo).toBe('mayorista')
    expect(precios?.escalas.map((e) => e.final)).toEqual([1210, 1089, 968, null])
  })

  it('sin sesión (visitante) devuelve null sin llamar a la base', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } })
    expect(await leerPreciosCliente('mundojc.localhost', ID)).toBeNull()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('un id que no es UUID no llega a la base', async () => {
    expect(await leerPreciosCliente('mundojc.localhost', 'no-es-un-id')).toBeNull()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('cuenta suspendida o no habilitada (la base responde null) → null', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    expect(await leerPreciosCliente('mundojc.localhost', ID)).toBeNull()
  })

  it('si la base falla, cae al precio público y deja el error en consola', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect(await leerPreciosCliente('mundojc.localhost', ID)).toBeNull()
    expect(consola).toHaveBeenCalled()
    consola.mockRestore()
  })

  it('no guarda caché: cada carga llama de nuevo y refleja el tipo actual', async () => {
    const primera = await leerPreciosCliente('mundojc.localhost', ID)
    mocks.rpc.mockResolvedValue({
      data: { tipo: 'minorista', precios: [{ producto_id: ID, escalas: [{ escala: 'x1', desde: 1, hasta: 4, final: 1210 }] }] },
      error: null,
    })
    const segunda = await leerPreciosCliente('mundojc.localhost', ID)
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(primera?.escalas).toHaveLength(4)
    expect(segunda).toEqual({ tipo: 'minorista', escalas: [{ escala: 'x1', desde: 1, hasta: 4, final: 1210 }] })
  })
})

describe('rangoUnidades', () => {
  it.each([
    [{ desde: 1, hasta: 4 }, '1 a 4 u.'],
    [{ desde: 5, hasta: 9 }, '5 a 9 u.'],
    [{ desde: 50, hasta: null }, '50 u. o más'],
    [{ desde: 3, hasta: 3 }, '3 u.'],
  ])('%j → %s', (escala, texto) => {
    expect(rangoUnidades(escala)).toBe(texto)
  })
})
