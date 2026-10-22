import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { useIngresos } from './useIngresos'

const FILA = {
  ingreso_id: 'ingreso-1', fecha: '2026-10-20', creado_en: '2026-10-20T10:00:00Z', estado: 'registrado',
  comprobante: null, motivo_anulacion: null, anulado_en: null, producto_id: 'producto-1',
  producto_nombre: 'Producto Uno', producto_sku: 'SKU-1', cantidad: 5, costo_unitario_usd: '10.00',
  destino: 'Depósito principal', empresa: 'Tienda Uno', proveedor: 'Proveedor Uno', operador: 'Nicolás', total: 30,
}

describe('useIngresos', () => {
  beforeEach(() => vi.clearAllMocks())

  it('consulta la RPC con los filtros y devuelve el total', async () => {
    mocks.rpc.mockResolvedValue({ data: [FILA], error: null })
    const { result } = renderHook(() => useIngresos({
      desde: '2026-10-01', hasta: '2026-10-31', proveedorId: 'proveedor-1', empresaId: 'empresa-1',
      productoId: 'producto-1', operadorId: 'user-1', pagina: 2, tamano: 25,
    }))

    await waitFor(() => expect(result.current.filas).toHaveLength(1))
    expect(mocks.rpc).toHaveBeenCalledWith('listar_ingresos_mercaderia', {
      p_desde: '2026-10-01', p_hasta: '2026-10-31', p_proveedor: 'proveedor-1',
      p_empresa: 'empresa-1', p_producto: 'producto-1', p_operador: 'user-1',
      p_pagina: 2, p_tamano: 25,
    })
    expect(result.current.total).toBe(30)
  })

  it('expone el error sin romper la pantalla', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const { result } = renderHook(() => useIngresos({ pagina: 1 }))
    await waitFor(() => expect(result.current.hayError).toBe(true))
    expect(result.current.filas).toBeNull()
  })
})
