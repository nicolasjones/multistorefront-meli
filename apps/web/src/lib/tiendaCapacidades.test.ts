import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), schema: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { schema: mocks.schema } }))

import { leerCapacidadesTienda, reiniciarCapacidadesTienda } from './tiendaCapacidades'

// F-CLI-20 (FR-014, D-27): lo único que el front público sabe de la bandera `tienda_pedidos`.
beforeEach(() => {
  vi.clearAllMocks()
  reiniciarCapacidadesTienda()
  mocks.schema.mockReturnValue({ rpc: mocks.rpc })
})

describe('leerCapacidadesTienda', () => {
  it('pide `capacidades_tienda_por_dominio` del host y devuelve solo el booleano', async () => {
    mocks.rpc.mockResolvedValue({ data: { estado: 'ok', pedidos: true }, error: null })
    await expect(leerCapacidadesTienda('mundojc.localhost')).resolves.toEqual({ pedidos: true })
    expect(mocks.schema).toHaveBeenCalledWith('publico')
    expect(mocks.rpc).toHaveBeenCalledWith('capacidades_tienda_por_dominio', { host: 'mundojc.localhost' })
  })

  it('función apagada: pedidos es falso', async () => {
    mocks.rpc.mockResolvedValue({ data: { estado: 'ok', pedidos: false }, error: null })
    await expect(leerCapacidadesTienda('mundojc.localhost')).resolves.toEqual({ pedidos: false })
  })

  it('host desconocido, empresa desactivada o tienda pausada (estado error) devuelve null', async () => {
    mocks.rpc.mockResolvedValue({ data: { estado: 'error' }, error: null })
    await expect(leerCapacidadesTienda('x.localhost')).resolves.toBeNull()
  })

  it('una respuesta rara nunca enciende la función', async () => {
    mocks.rpc.mockResolvedValue({ data: { estado: 'ok', pedidos: 'true' }, error: null })
    await expect(leerCapacidadesTienda('mundojc.localhost')).resolves.toEqual({ pedidos: false })
  })

  it('una sola llamada por host aunque lo pidan varios componentes a la vez', async () => {
    mocks.rpc.mockResolvedValue({ data: { estado: 'ok', pedidos: true }, error: null })
    await Promise.all([leerCapacidadesTienda('mundojc.localhost'), leerCapacidadesTienda('mundojc.localhost'), leerCapacidadesTienda('mundojc.localhost')])
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('cada host tiene lo suyo (dos tiendas no comparten la capacidad)', async () => {
    mocks.rpc.mockImplementation(async (_f: string, { host }: { host: string }) => ({ data: { estado: 'ok', pedidos: host === 'mundojc.localhost' }, error: null }))
    await expect(leerCapacidadesTienda('mundojc.localhost')).resolves.toEqual({ pedidos: true })
    await expect(leerCapacidadesTienda('sanjavucho.localhost')).resolves.toEqual({ pedidos: false })
  })

  it('un error de red lanza y no se guarda: el siguiente intento vuelve a preguntar', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'red' } })
    await expect(leerCapacidadesTienda('mundojc.localhost')).rejects.toThrow('red')
    mocks.rpc.mockResolvedValueOnce({ data: { estado: 'ok', pedidos: true }, error: null })
    await expect(leerCapacidadesTienda('mundojc.localhost')).resolves.toEqual({ pedidos: true })
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })
})
