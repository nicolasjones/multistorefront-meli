import { describe, expect, it, vi } from 'vitest'
import { aTextoImporte, fijarPrecioPropio, leerPreciosPropios, mensajeErrorPrecioPropio, quitarPrecioPropio, validarPrecioPropio } from './preciosPropios'

describe('validación del precio propio', () => {
  it.each([
    ['1500', 1500],
    ['  1500,5 ', 1500.5],
    ['0,01', 0.01],
    ['12.50', 12.5],
  ])('lee %j como %d', (texto, importe) => {
    expect(validarPrecioPropio(texto)).toEqual({ importe })
  })

  it('un campo vacío pide ingresar el precio', () => {
    expect(validarPrecioPropio('')).toEqual({ error: 'Ingresá el precio propio.' })
    expect(validarPrecioPropio('   ')).toEqual({ error: 'Ingresá el precio propio.' })
  })

  it('cero no es un precio', () => {
    expect(validarPrecioPropio('0')).toEqual({ error: 'El precio propio debe ser mayor que cero.' })
    expect(validarPrecioPropio('0,00')).toEqual({ error: 'El precio propio debe ser mayor que cero.' })
  })

  it.each(['abc', '-5', '1,234', '1e3', '12 5', '1.234,56'])('rechaza %j como no numérico o fuera de formato', (texto) => {
    expect(validarPrecioPropio(texto)).toHaveProperty('error')
  })
})

describe('mensajes de error del precio propio', () => {
  it('traduce los códigos de la base a texto de negocio', () => {
    expect(mensajeErrorPrecioPropio({ code: '42501' })).toContain('no puede editar')
    expect(mensajeErrorPrecioPropio({ code: 'P0002' })).toContain('ya no existe')
    expect(mensajeErrorPrecioPropio({ code: '22023' })).toContain('mayor que cero')
    expect(mensajeErrorPrecioPropio({ code: '23514' })).toContain('mayor que cero')
    expect(mensajeErrorPrecioPropio({ code: '22003' })).toContain('demasiado grande')
  })

  it('un error desconocido no filtra el texto técnico', () => {
    const mensaje = mensajeErrorPrecioPropio({ code: 'XX000', message: 'relation dominio.precios_propios_empresa violates policy' })
    expect(mensaje).toBe('No pudimos guardar el precio propio. Probá de nuevo.')
    expect(mensajeErrorPrecioPropio(null)).toBe(mensaje)
    expect(mensajeErrorPrecioPropio(undefined, 'Otro')).toBe('Otro')
  })
})

describe('importe como texto del campo', () => {
  it('usa coma decimal', () => {
    expect(aTextoImporte(1500.5)).toBe('1500,5')
    expect(aTextoImporte(20)).toBe('20')
  })

  it('el texto vuelve a leerse como el mismo importe', () => {
    for (const importe of [0.01, 12.5, 1500, 99999.99]) expect(validarPrecioPropio(aTextoImporte(importe))).toEqual({ importe })
  })
})

describe('llamadas a la base', () => {
  it('lee los precios propios y convierte los importes a número', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ empresa_id: 'e1', moneda: 'ARS', importe: '1500.50' }], error: null })
    expect(await leerPreciosPropios({ rpc } as never, 'p1')).toEqual([{ empresaId: 'e1', moneda: 'ARS', importe: 1500.5 }])
    expect(rpc).toHaveBeenCalledWith('leer_precios_propios', { p_producto: 'p1' })
  })

  it('una respuesta que no es lista se lee como vacía', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    expect(await leerPreciosPropios({ rpc } as never, 'p1')).toEqual([])
  })

  it('propaga el error de la base al leer, fijar y quitar', async () => {
    const error = { code: '42501' }
    const rpc = vi.fn().mockResolvedValue({ data: null, error })
    await expect(leerPreciosPropios({ rpc } as never, 'p1')).rejects.toBe(error)
    await expect(fijarPrecioPropio({ rpc } as never, 'p1', 'e1', 'ARS', 10)).rejects.toBe(error)
    await expect(quitarPrecioPropio({ rpc } as never, 'p1', 'e1')).rejects.toBe(error)
  })

  it('fija y quita con los parámetros de la RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    await fijarPrecioPropio({ rpc } as never, 'p1', 'e1', 'USD', 9.5)
    await quitarPrecioPropio({ rpc } as never, 'p1', 'e1')
    expect(rpc).toHaveBeenNthCalledWith(1, 'fijar_precio_propio', { p_producto: 'p1', p_empresa: 'e1', p_moneda: 'USD', p_importe: 9.5 })
    expect(rpc).toHaveBeenNthCalledWith(2, 'quitar_precio_propio', { p_producto: 'p1', p_empresa: 'e1' })
  })
})
