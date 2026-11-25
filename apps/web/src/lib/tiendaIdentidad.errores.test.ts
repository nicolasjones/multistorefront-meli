import { beforeEach, describe, expect, it, vi } from 'vitest'

const optimizar = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabaseClient: {} }))
vi.mock('./optimizarImagen', () => ({ optimizarImagen: optimizar }))

import { prepararImagenTienda } from './tiendaIdentidad'

const banner = new File(['x'], 'b.jpg', { type: 'image/jpeg' })

describe('prepararImagenTienda: errores de optimización', () => {
  beforeEach(() => vi.clearAllMocks())

  it('solo ImagenDemasiadoGrandeError se informa como «demasiados píxeles»', async () => {
    optimizar.mockRejectedValue(Object.assign(new Error('x'), { name: 'ImagenDemasiadoGrandeError' }))
    expect(await prepararImagenTienda('banner', banner)).toEqual({ error: expect.stringContaining('demasiados píxeles') })
  })

  it('cualquier otro error se informa como error de optimización, sin decir «píxeles»', async () => {
    optimizar.mockRejectedValue(new Error('falló'))
    const r = await prepararImagenTienda('banner', banner)
    expect(r).toEqual({ error: expect.stringContaining('No pudimos optimizar') })
    expect((r as { error: string }).error).not.toContain('píxeles')
  })
})
