import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), organizacion: { organizacionId: 'org-1' as string | null } }))

vi.mock('../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))
vi.mock('./useOrganizacionDeTrabajo', () => ({
  useOrganizacionDeTrabajo: () => ({ organizacionId: mocks.organizacion.organizacionId, isLoading: false }),
}))

import { useHistorialCargasCotizacion } from './useHistorialCargasCotizacion'

const fila = (id: string, valor: number) => ({
  id, cargada_en: '2026-09-25T12:00:00Z', valor, variacion_pct: '0.6900', cargada_por_nombre: 'Javier',
  recalculo_aplicado: true, precios_recalculados: 89,
})
const pagina = (filas: ReturnType<typeof fila>[], siguiente: string | null) => ({ data: { filas, siguiente_cursor: siguiente }, error: null })

describe('useHistorialCargasCotizacion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.organizacion.organizacionId = 'org-1'
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('lee la primera página y convierte los números', async () => {
    mocks.rpc.mockResolvedValue(pagina([fila('a', 1465)], 'cursor-1'))
    const { result } = renderHook(() => useHistorialCargasCotizacion())
    expect(result.current.cargando).toBe(true)
    await waitFor(() => expect(result.current.filas).toHaveLength(1))
    expect(mocks.rpc).toHaveBeenCalledWith('listar_cotizaciones', { p_limite: 10, p_cursor: null })
    expect(result.current.filas[0]).toMatchObject({ id: 'a', valor: 1465, variacionPct: 0.69, cargadaPorNombre: 'Javier', preciosRecalculados: 89 })
    expect(result.current.haySiguiente).toBe(true)
    expect(result.current.hayAnterior).toBe(false)
  })

  it('avanza con el cursor devuelto y vuelve a la página anterior', async () => {
    mocks.rpc
      .mockResolvedValueOnce(pagina([fila('a', 1465)], 'cursor-1'))
      .mockResolvedValueOnce(pagina([fila('b', 1455)], null))
      .mockResolvedValueOnce(pagina([fila('a', 1465)], 'cursor-1'))
    const { result } = renderHook(() => useHistorialCargasCotizacion())
    await waitFor(() => expect(result.current.filas[0]?.id).toBe('a'))
    act(() => result.current.siguiente())
    await waitFor(() => expect(result.current.filas[0]?.id).toBe('b'))
    expect(mocks.rpc).toHaveBeenLastCalledWith('listar_cotizaciones', { p_limite: 10, p_cursor: 'cursor-1' })
    expect(result.current.numeroPagina).toBe(2)
    expect(result.current.haySiguiente).toBe(false)
    expect(result.current.hayAnterior).toBe(true)
    act(() => result.current.anterior())
    await waitFor(() => expect(result.current.filas[0]?.id).toBe('a'))
    expect(result.current.numeroPagina).toBe(1)
  })

  it('un error queda visible, sin filas, y reintentar relee desde la primera página', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } })
    const { result } = renderHook(() => useHistorialCargasCotizacion())
    await waitFor(() => expect(result.current.hayError).toBe(true))
    expect(result.current.filas).toEqual([])
    mocks.rpc.mockResolvedValueOnce(pagina([fila('a', 1465)], null))
    act(() => result.current.recargar())
    await waitFor(() => expect(result.current.filas).toHaveLength(1))
    expect(result.current.hayError).toBe(false)
  })

  it('al cambiar la organización de trabajo vuelve a la primera página y no conserva filas ajenas', async () => {
    mocks.rpc
      .mockResolvedValueOnce(pagina([fila('a', 1465)], 'cursor-1'))
      .mockResolvedValueOnce(pagina([fila('b', 1455)], null))
      .mockResolvedValueOnce(pagina([fila('z', 900)], null))
    const { result, rerender } = renderHook(() => useHistorialCargasCotizacion())
    await waitFor(() => expect(result.current.filas[0]?.id).toBe('a'))
    act(() => result.current.siguiente())
    await waitFor(() => expect(result.current.numeroPagina).toBe(2))
    await waitFor(() => expect(result.current.filas[0]?.id).toBe('b'))
    mocks.organizacion.organizacionId = 'org-2'
    rerender()
    await waitFor(() => expect(result.current.filas[0]?.id).toBe('z'))
    expect(result.current.numeroPagina).toBe(1)
    expect(mocks.rpc).toHaveBeenLastCalledWith('listar_cotizaciones', { p_limite: 10, p_cursor: null })
  })
})
