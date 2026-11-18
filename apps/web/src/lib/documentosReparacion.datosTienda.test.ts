import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { obtenerDatosTienda } from './documentosReparacion'

describe('obtenerDatosTienda', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lee el contacto por la RPC (no de la tabla) con la empresa de la reparación', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ nombre: 'Tienda A', direccion: 'Calle 1', whatsapp: '+54911', correo: 'a@x.com' }], error: null })
    await expect(obtenerDatosTienda('e-1')).resolves.toEqual({ nombre: 'Tienda A', direccion: 'Calle 1', whatsapp: '+54911', correo: 'a@x.com' })
    expect(mocks.rpc).toHaveBeenCalledWith('empresa_contacto_documentos', { p_empresa: 'e-1' })
  })

  it('sin filas avisa que no encontró la tienda', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await expect(obtenerDatosTienda('e-1')).rejects.toThrow('No se encontró la tienda de la reparación.')
  })

  it('propaga el rechazo de la base (rol sin sección)', async () => {
    const rechazo = { code: '42501', message: 'Tu rol no puede ver los datos de contacto de la tienda' }
    mocks.rpc.mockResolvedValue({ data: null, error: rechazo })
    await expect(obtenerDatosTienda('e-1')).rejects.toEqual(rechazo)
  })
})
