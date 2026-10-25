import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { useRegistrarIngreso } from './useRegistrarIngreso'

const parametros = {
  empresaId: '11111111-1111-1111-1111-111111111111',
  proveedorId: '22222222-2222-2222-2222-222222222222',
  fecha: '2026-10-21',
  comprobante: '  R-1  ',
  lineas: [{ producto_id: '33333333-3333-3333-3333-333333333333', cantidad: '2', costo_unitario_usd: '10.50' }],
  actualizarCosto: true,
  claveIdempotencia: '44444444-4444-4444-4444-444444444444',
}

describe('useRegistrarIngreso', () => {
  beforeEach(() => vi.clearAllMocks())

  it('envía la RPC con las líneas normalizadas y la clave de idempotencia', async () => {
    mocks.rpc.mockResolvedValue({ data: { id: 'ingreso-1' }, error: null })
    const { result } = renderHook(() => useRegistrarIngreso())

    let respuesta: Awaited<ReturnType<typeof result.current.registrar>>
    await act(async () => {
      respuesta = await result.current.registrar(parametros)
    })

    expect(mocks.rpc).toHaveBeenCalledWith('registrar_ingreso_mercaderia', {
      p_empresa: parametros.empresaId,
      p_proveedor: parametros.proveedorId,
      p_fecha: parametros.fecha,
      p_comprobante: 'R-1',
      p_lineas: [{ producto_id: parametros.lineas[0].producto_id, cantidad: 2, costo_unitario_usd: 10.5 }],
      p_actualizar_costo: true,
      p_clave_idempotencia: parametros.claveIdempotencia,
    })
    expect(respuesta!.ok).toBe(true)
  })

  it('devuelve el error de la RPC sin lanzar', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'sin permiso' } })
    const { result } = renderHook(() => useRegistrarIngreso())
    await act(async () => {
      const respuesta = await result.current.registrar(parametros)
      expect(respuesta.ok).toBe(false)
    })
  })
})
