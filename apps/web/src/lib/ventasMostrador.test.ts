import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), crear: vi.fn(), obtener: vi.fn(), guardar: vi.fn() }))

vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))
vi.mock('./ventas', async (original) => ({
  ...(await original<typeof import('./ventas')>()),
  crearComprobante: mocks.crear,
  obtenerComprobante: mocks.obtener,
}))
vi.mock('./ventasLineas', async (original) => ({
  ...(await original<typeof import('./ventasLineas')>()),
  guardarLineasComprobante: mocks.guardar,
}))

import type { Comprobante } from './ventas'
import {
  MENSAJE_CODIGO_INVALIDO, agregarProductoAVenta, buscarProductoPorCodigoBarras, esEan13, mensajeDeEscaneo,
} from './ventasMostrador'

const venta = (lineas: Array<{ producto_id: string; cantidad: number }> = []) =>
  ({ id: 'c-1', updated_at: 't-1', lineas: lineas.map((l) => ({ ...l, deposito_id: null, precio_manual: false, precio_unitario: 1, sin_stock: false })) }) as unknown as Comprobante

describe('ventasMostrador (F-VTA-31)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('valida el formato EAN-13', () => {
    expect(esEan13('7790001000011')).toBe(true)
    expect(esEan13(' 7790001000011 ')).toBe(true)
    expect(esEan13('12345')).toBe(false)
    expect(esEan13('77900010000AB')).toBe(false)
  })

  it('buscarProductoPorCodigoBarras devuelve la fila o null si no existe', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ producto_id: 'p-1', nombre: 'Joystick', sku: 'J', codigo_barras: '7790001000011' }], error: null })
    expect((await buscarProductoPorCodigoBarras('7790001000011'))?.producto_id).toBe('p-1')
    expect(mocks.rpc).toHaveBeenCalledWith('buscar_producto_por_codigo_barras', { p_codigo_barras: '7790001000011' })
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null })
    expect(await buscarProductoPorCodigoBarras('7790000000000')).toBeNull()
  })

  it('el primer producto crea la factura de mostrador a Consumidor final y agrega la línea', async () => {
    mocks.crear.mockResolvedValue({ id: 'c-1', tipo: 'factura', numero: '1' })
    mocks.obtener.mockResolvedValue(venta())
    await agregarProductoAVenta(null, 'e-1', 'cf-1', 'p-1')
    expect(mocks.crear).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'factura', empresa_id: 'e-1', canal: 'mostrador', cliente: expect.objectContaining({ id: 'cf-1' }) }))
    expect(mocks.guardar).toHaveBeenCalledWith('c-1', [{ producto_id: 'p-1', cantidad: 1, deposito_id: null, precio_manual: null }], 't-1')
  })

  it('escanear un producto que ya está incrementa la cantidad sin crear otro comprobante', async () => {
    mocks.obtener.mockResolvedValue(venta())
    await agregarProductoAVenta(venta([{ producto_id: 'p-1', cantidad: 1 }]), 'e-1', 'cf-1', 'p-1')
    expect(mocks.crear).not.toHaveBeenCalled()
    expect(mocks.guardar).toHaveBeenCalledWith('c-1', [expect.objectContaining({ producto_id: 'p-1', cantidad: 2 })], 't-1')
  })

  it('traduce los errores del escaneo', () => {
    expect(mensajeDeEscaneo({ code: '22023', hint: 'codigo_barras' })).toBe(MENSAJE_CODIGO_INVALIDO)
    expect(mensajeDeEscaneo({ code: '42501' })).toMatch(/No tenés permiso/)
  })
})
