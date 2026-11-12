import { describe, expect, it, vi } from 'vitest'
import { CAPACIDADES_APAGADAS, leerCapacidadesPrecios } from './capacidadesPrecios'

describe('leerCapacidadesPrecios (MSF-363)', () => {
  it('traduce la respuesta de la base', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        promociones: true, precios_masivos: false, edicion_en_todas_las_tiendas: true,
        niveles_productos: { e1: 'edicion', e2: 'lectura', e3: 'raro' },
      },
      error: null,
    })
    expect(await leerCapacidadesPrecios({ rpc } as never)).toEqual({
      promociones: true,
      preciosMasivos: false,
      edicionEnTodasLasTiendas: true,
      nivelesProductos: { e1: 'edicion', e2: 'lectura', e3: 'ninguno' },
    })
    expect(rpc).toHaveBeenCalledWith('capacidades_precios')
  })

  it('una respuesta vacía o rara deja todo apagado', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    expect(await leerCapacidadesPrecios({ rpc } as never)).toEqual(CAPACIDADES_APAGADAS)
  })

  it('un error de la base se propaga (el hook lo trata como apagado)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(leerCapacidadesPrecios({ rpc } as never)).rejects.toEqual({ code: '42501' })
  })
})
