import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), organizacion: { id: 'org-1' } as { id: string } | null }))
vi.mock('../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))
vi.mock('./useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: mocks.organizacion }) }))

import { useRankingComparado, type ParametrosRankingComparado } from './useRankingComparado'

const parametros: ParametrosRankingComparado = {
  desde: '2026-10-01', hasta: '2026-10-31', desdeComparacion: '2026-08-31', hastaComparacion: '2026-09-30',
  tipo: null, incluirConsumidorFinal: false, conIva: false, empresaId: null, pagina: 1, tamano: 25,
}

const filaServidor = (extra: Record<string, unknown> = {}) => ({
  posicion: '1', cliente_id: 'c-1', numero: '101', nombre: 'Alfa', tipo: 'mayorista', comprobantes: '2', facturado: '3500.00',
  comprobantes_comparacion: '1', facturado_comparacion: '1000.00', variacion: '2500.00', variacion_porcentaje: '250.00', total_filas: '4', ...extra,
})

describe('useRankingComparado', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.organizacion = { id: 'org-1' }
  })

  it('llama a la RPC con ambos períodos y normaliza numeric/bigint que llegan como texto', async () => {
    mocks.rpc.mockResolvedValue({ data: [filaServidor()], error: null })
    const { result } = renderHook(() => useRankingComparado({ ...parametros, empresaId: 'e-1', pagina: 2 }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mocks.rpc).toHaveBeenCalledWith('ranking_clientes_comparado', {
      p_desde: '2026-10-01', p_hasta: '2026-10-31', p_desde_comparacion: '2026-08-31', p_hasta_comparacion: '2026-09-30',
      p_tipo: null, p_incluir_consumidor_final: false, p_con_iva: false, p_pagina: 2, p_tamano: 25, p_empresa_id: 'e-1',
    })
    expect(result.current.total).toBe(4)
    expect(result.current.filas[0]).toMatchObject({ posicion: 1, facturado: 3500, facturado_comparacion: 1000, variacion: 2500, variacion_porcentaje: 250 })
  })

  it('conserva el porcentaje nulo (base 0) como nulo, no como 0', async () => {
    mocks.rpc.mockResolvedValue({ data: [filaServidor({ variacion_porcentaje: null })], error: null })
    const { result } = renderHook(() => useRankingComparado(parametros))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.filas[0].variacion_porcentaje).toBeNull()
  })

  it('sin filas deja total 0 y sin error', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    const { result } = renderHook(() => useRankingComparado(parametros))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.filas).toEqual([])
    expect(result.current.total).toBe(0)
    expect(result.current.isError).toBe(false)
  })

  it('un error o una excepción deja isError y vacía las filas', async () => {
    mocks.rpc.mockRejectedValue(new Error('red'))
    const { result } = renderHook(() => useRankingComparado(parametros))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isError).toBe(true)
    expect(result.current.filas).toEqual([])
  })

  it('«Reintentar» (refetch) vuelve a consultar', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } }).mockResolvedValueOnce({ data: [filaServidor()], error: null })
    const { result } = renderHook(() => useRankingComparado(parametros))
    await waitFor(() => expect(result.current.isError).toBe(true))
    await act(async () => { await result.current.refetch() })
    expect(result.current.isError).toBe(false)
    expect(result.current.filas).toHaveLength(1)
  })

  it('la última petición gana: una respuesta tardía de otra página no pisa la actual', async () => {
    let resolverLenta: (valor: unknown) => void = () => undefined
    mocks.rpc
      .mockImplementationOnce(() => new Promise((resolver) => { resolverLenta = resolver }))
      .mockResolvedValueOnce({ data: [filaServidor({ nombre: 'Nueva' })], error: null })
    const { result, rerender } = renderHook(({ pagina }) => useRankingComparado({ ...parametros, pagina }), { initialProps: { pagina: 1 } })
    rerender({ pagina: 2 })
    await waitFor(() => expect(result.current.filas[0]?.nombre).toBe('Nueva'))
    await act(async () => { resolverLenta({ data: [filaServidor({ nombre: 'Vieja' })], error: null }) })
    expect(result.current.filas[0].nombre).toBe('Nueva')
  })
})
