import { describe, expect, it, vi } from 'vitest'
import { CAPACIDADES_APAGADAS, leerBanderaPromociones, leerCapacidadesPrecios } from './capacidadesPrecios'

describe('leerCapacidadesPrecios', () => {
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

describe('leerBanderaPromociones', () => {
  const clienteCon = (resultado: { data: unknown; error: unknown }) => {
    const maybeSingle = vi.fn().mockResolvedValue(resultado)
    const eq = vi.fn().mockReturnValue({ maybeSingle })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    return { cliente: { from } as never, from, eq }
  }

  it('lee solo la fila de la bandera', async () => {
    const { cliente, from, eq } = clienteCon({ data: { activa: true }, error: null })
    expect(await leerBanderaPromociones(cliente)).toBe(true)
    expect(from).toHaveBeenCalledWith('banderas_plataforma')
    expect(eq).toHaveBeenCalledWith('clave', 'promociones_precio')
  })

  it('una clave inexistente cuenta como apagada', async () => {
    expect(await leerBanderaPromociones(clienteCon({ data: null, error: null }).cliente)).toBe(false)
  })

  it('un error se propaga', async () => {
    await expect(leerBanderaPromociones(clienteCon({ data: null, error: { code: '42501' } }).cliente)).rejects.toEqual({ code: '42501' })
  })
})
