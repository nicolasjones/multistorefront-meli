// MSF-796: el panel sigue limpiando con `storage.remove`, pero la garantía de no borrar un archivo referenciado
// está en la política de la base. Acá se verifica el lado del cliente: pide borrar solo lo que el servidor
// reporta sin referencia, no interrumpe ante un fallo y tolera que la base niegue un borrado.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabaseClient: { rpc: mocks.rpc, storage: { from: () => ({ remove: mocks.remove }) } },
}))

import { borrarImagenes } from './tiendaIdentidad'

const EMPRESA = 'e1000000-0000-0000-0000-000000000001'
const RUTA = (archivo: string) => `11111111-1111-1111-1111-111111111111/${EMPRESA}/${archivo}`

describe('borrarImagenes (MSF-796)', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
    mocks.remove.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('con empresa, pide borrar solo las rutas que el servidor reporta sin referencia', async () => {
    mocks.rpc.mockResolvedValue({ data: [RUTA('viejo.png')], error: null })
    mocks.remove.mockResolvedValue({ data: [{ name: RUTA('viejo.png') }], error: null })
    await borrarImagenes([RUTA('viejo.png'), RUTA('en-version.png')], EMPRESA)
    expect(mocks.rpc).toHaveBeenCalledWith('rutas_tienda_sin_referencia', { p_empresa: EMPRESA, p_rutas: [RUTA('viejo.png'), RUTA('en-version.png')] })
    expect(mocks.remove).toHaveBeenCalledWith([RUTA('viejo.png')])
  })

  it('si todas están referenciadas no llama a Storage', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await borrarImagenes([RUTA('en-version.png')], EMPRESA)
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('si no se puede comprobar las referencias, no borra nada ni lanza', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(borrarImagenes([RUTA('viejo.png')], EMPRESA)).resolves.toBeUndefined()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('un borrado que la base niega (la API devuelve menos objetos) no es un error', async () => {
    mocks.rpc.mockResolvedValue({ data: [RUTA('a.png'), RUTA('b.png')], error: null })
    mocks.remove.mockResolvedValue({ data: [{ name: RUTA('a.png') }], error: null })
    await expect(borrarImagenes([RUTA('a.png'), RUTA('b.png')], EMPRESA)).resolves.toBeUndefined()
    expect(console.error).not.toHaveBeenCalled()
  })

  it('un error de Storage se registra pero no interrumpe', async () => {
    mocks.rpc.mockResolvedValue({ data: [RUTA('a.png')], error: null })
    mocks.remove.mockResolvedValue({ data: null, error: { message: 'sin permiso' } })
    await expect(borrarImagenes([RUTA('a.png')], EMPRESA)).resolves.toBeUndefined()
    expect(console.error).toHaveBeenCalled()
  })

  it('sin empresa (archivos recién subidos que la base no referencia) borra directo', async () => {
    mocks.remove.mockResolvedValue({ data: [], error: null })
    await borrarImagenes([RUTA('recien.png')])
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.remove).toHaveBeenCalledWith([RUTA('recien.png')])
  })
})
