import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ crearUrls: vi.fn(), desde: vi.fn(), desdePanel: vi.fn() }))

// El cliente por defecto es el SIN sesión (anon); el de la app (con la sesión de quien mira) es otro.
vi.mock('./supabase', () => ({
  supabaseSinSesion: { storage: { from: mocks.desde } },
  supabaseClient: { storage: { from: mocks.desdePanel } },
}))

import { urlImagenProducto, urlsImagenesProducto } from './imagenProducto'

// F-TDA-12 (FR-031, D1): el front firma las imágenes del bucket privado con la clave pública; una ruta
// que no se pudo firmar cae en «Sin imagen» y nunca lanza.
const RUTA = 'org/producto/a.png'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.desde.mockReturnValue({ createSignedUrls: mocks.crearUrls })
})

describe('imagenProducto', () => {
  it('firma un lote sin repetir rutas', async () => {
    mocks.crearUrls.mockResolvedValue({
      data: [{ path: RUTA, signedUrl: 'https://firmada.test/a.png' }],
      error: null,
    })
    const urls = await urlsImagenesProducto([RUTA, RUTA, ''])
    expect(mocks.crearUrls).toHaveBeenCalledWith([RUTA], 3600)
    expect(urls).toEqual({ [RUTA]: 'https://firmada.test/a.png' })
  })

  it('firma con el cliente SIN sesión (anon), no con el de la app: un cliente de la tienda es `authenticated` y no podría', async () => {
    mocks.crearUrls.mockResolvedValue({ data: [{ path: RUTA, signedUrl: 'https://firmada.test/a.png' }], error: null })
    await urlsImagenesProducto([RUTA])
    expect(mocks.desde).toHaveBeenCalledWith('productos-imagenes')
    expect(mocks.desdePanel).not.toHaveBeenCalled()
  })

  it('la vista previa del panel puede pasar el cliente de la app (con la sesión de quien edita)', async () => {
    mocks.desdePanel.mockReturnValue({ createSignedUrls: mocks.crearUrls })
    mocks.crearUrls.mockResolvedValue({ data: [{ path: RUTA, signedUrl: 'https://firmada.test/a.png' }], error: null })
    const { supabaseClient } = await import('./supabase')
    await urlsImagenesProducto([RUTA], supabaseClient)
    expect(mocks.desdePanel).toHaveBeenCalledWith('productos-imagenes')
    expect(mocks.desde).not.toHaveBeenCalled()
  })

  it('una sola ruta devuelve su URL firmada', async () => {
    mocks.crearUrls.mockResolvedValue({
      data: [{ path: RUTA, signedUrl: 'https://firmada.test/a.png' }],
      error: null,
    })
    await expect(urlImagenProducto(RUTA)).resolves.toBe('https://firmada.test/a.png')
  })

  it('si firmar falla devuelve null y lo registra, sin romper el listado', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.crearUrls.mockResolvedValue({ data: null, error: { message: 'sin permiso' } })
    await expect(urlImagenProducto(RUTA)).resolves.toBeNull()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('sin rutas no llama a Storage', async () => {
    await expect(urlsImagenesProducto([])).resolves.toEqual({})
    expect(mocks.desde).not.toHaveBeenCalled()
  })
})
