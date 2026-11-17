import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ crearComprobante: vi.fn(), obtenerComprobante: vi.fn(), guardarLineasComprobante: vi.fn(), obtenerConsumidorFinal: vi.fn() }))
vi.mock('./ventas', () => ({ crearComprobante: mocks.crearComprobante, obtenerComprobante: mocks.obtenerComprobante }))
vi.mock('./ventasMostrador', () => ({ obtenerConsumidorFinal: mocks.obtenerConsumidorFinal }))
vi.mock('./ventasLineas', async (importOriginal) => ({ ...(await importOriginal<typeof import('./ventasLineas')>()), guardarLineasComprobante: mocks.guardarLineasComprobante }))
vi.mock('./reparaciones', () => ({ hoyEnArgentina: () => '2026-11-17' }))

import { ErrorPresupuestoDesdePedido, crearPresupuestoDesdePedido, entradasDesdePedido } from './presupuestoDesdePedido'

const item = (extra: Partial<{ producto_id: string | null; cantidad: number }> = {}) => ({
  orden: 1, producto_id: 'p-1', descripcion: 'Joystick', sku: null, cantidad: 2, precio_referencia: 2500, ...extra,
})
const consulta = { empresa_id: 'e-1', cliente_id: 'cl-1', nombre: 'Bruno', contacto: 'bruno@example.com' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.crearComprobante.mockResolvedValue({ id: 'c-1', tipo: 'presupuesto', numero: '00000007' })
  mocks.obtenerComprobante.mockResolvedValue({ updated_at: 'sello' })
  mocks.guardarLineasComprobante.mockResolvedValue(undefined)
  mocks.obtenerConsumidorFinal.mockResolvedValue('cf-1')
})

describe('presupuesto desde un pedido', () => {
  it('pasa solo las líneas con producto, sin precio manual ni depósito, y cuenta las omitidas', () => {
    const { entradas, omitidas } = entradasDesdePedido([item(), item({ producto_id: null }), item({ producto_id: 'p-3', cantidad: 0 }), item({ producto_id: 'p-4', cantidad: 200000 })])
    expect(entradas).toEqual([
      { producto_id: 'p-1', cantidad: 2, deposito_id: null, precio_manual: null },
      { producto_id: 'p-4', cantidad: 99999, deposito_id: null, precio_manual: null },
    ])
    expect(omitidas).toBe(2)
  })

  it('crea un presupuesto para el cliente de la consulta y le guarda las líneas con el sello vigente', async () => {
    const resultado = await crearPresupuestoDesdePedido(consulta, [item()], 'org-1')
    expect(mocks.crearComprobante).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'presupuesto', empresa_id: 'e-1', cliente: expect.objectContaining({ id: 'cl-1' }), fecha: '2026-11-17' }))
    expect(mocks.guardarLineasComprobante).toHaveBeenCalledWith('c-1', [{ producto_id: 'p-1', cantidad: 2, deposito_id: null, precio_manual: null }], 'sello')
    expect(mocks.obtenerConsumidorFinal).not.toHaveBeenCalled()
    expect(resultado).toEqual({ id: 'c-1', numero: '00000007', omitidas: 0 })
  })

  it('sin cliente en la consulta usa Consumidor final', async () => {
    await crearPresupuestoDesdePedido({ ...consulta, cliente_id: null }, [item()], 'org-1')
    expect(mocks.obtenerConsumidorFinal).toHaveBeenCalledWith('org-1')
    expect(mocks.crearComprobante).toHaveBeenCalledWith(expect.objectContaining({ cliente: expect.objectContaining({ id: 'cf-1' }) }))
  })

  it('no crea nada si no hay productos que presupuestar o no hay Consumidor final', async () => {
    await expect(crearPresupuestoDesdePedido(consulta, [item({ producto_id: null })], 'org-1')).rejects.toBeInstanceOf(ErrorPresupuestoDesdePedido)
    mocks.obtenerConsumidorFinal.mockResolvedValue(null)
    await expect(crearPresupuestoDesdePedido({ ...consulta, cliente_id: null }, [item()], 'org-1')).rejects.toBeInstanceOf(ErrorPresupuestoDesdePedido)
    expect(mocks.crearComprobante).not.toHaveBeenCalled()
  })

  it('si falla el guardado de las líneas informa el presupuesto creado (número e id) y no pide reintentar', async () => {
    mocks.guardarLineasComprobante.mockRejectedValue(new Error('boom'))
    const error = await crearPresupuestoDesdePedido(consulta, [item()], 'org-1').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ErrorPresupuestoDesdePedido)
    expect((error as ErrorPresupuestoDesdePedido).presupuesto).toEqual({ id: 'c-1', numero: '00000007' })
    expect((error as Error).message).toContain('00000007')
    expect((error as Error).message).not.toMatch(/reintent|de nuevo/i)
  })

  it('si falla la relectura del presupuesto recién creado también informa que existe', async () => {
    mocks.obtenerComprobante.mockRejectedValue(new Error('boom'))
    const error = await crearPresupuestoDesdePedido(consulta, [item()], 'org-1').catch((e: unknown) => e)
    expect((error as ErrorPresupuestoDesdePedido).presupuesto?.id).toBe('c-1')
    expect(mocks.guardarLineasComprobante).not.toHaveBeenCalled()
  })
})
