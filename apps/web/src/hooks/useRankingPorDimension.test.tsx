import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), organizacion: { id: 'org-1' } as { id: string } | null }))
vi.mock('../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))
vi.mock('./useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: mocks.organizacion }) }))

import { useRankingPorDimension, type ParametrosRankingPorDimension } from './useRankingPorDimension'

const parametros: ParametrosRankingPorDimension = {
  desde: '2026-10-01', hasta: '2026-10-31', productoId: null, categoriaId: null, provincia: null,
  tipo: null, incluirConsumidorFinal: false, conIva: false, empresaId: null, pagina: 1, tamano: 25,
}

const filaServidor = (extra: Record<string, unknown> = {}) => ({
  posicion: '1', cliente_id: 'c-1', numero: '101', nombre: 'Alfa', tipo: 'mayorista', comprobantes: '2',
  facturado: '1300.50', participacion: '57.14', total_filas: '4', ...extra,
})

describe('useRankingPorDimension', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.organizacion = { id: 'org-1' }
  })

  it('llama a la RPC con producto, categoría y provincia y normaliza numeric/bigint que llegan como texto', async () => {
    mocks.rpc.mockResolvedValue({ data: [filaServidor()], error: null })
    const { result } = renderHook(() => useRankingPorDimension({
      ...parametros, productoId: 'p-1', categoriaId: 'k-1', provincia: 'Córdoba', tipo: 'mayorista', empresaId: 'e-1', pagina: 2,
    }))
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mocks.rpc).toHaveBeenCalledWith('ranking_clientes_por_dimension', {
      p_desde: '2026-10-01', p_hasta: '2026-10-31', p_producto_id: 'p-1', p_categoria_id: 'k-1', p_provincia: 'Córdoba',
      p_tipo: 'mayorista', p_incluir_consumidor_final: false, p_con_iva: false, p_pagina: 2, p_tamano: 25, p_empresa_id: 'e-1',
    })
    expect(result.current.total).toBe(4)
    expect(result.current.filas[0]).toMatchObject({ posicion: 1, numero: 101, comprobantes: 2, facturado: 1300.5, participacion: 57.14 })
  })

  it('pausado no consulta', async () => {
    renderHook(() => useRankingPorDimension({ ...parametros, pausado: true }))
    await Promise.resolve()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('sin filas deja total 0 y sin error', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    const { result } = renderHook(() => useRankingPorDimension(parametros))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.filas).toEqual([])
    expect(result.current.total).toBe(0)
    expect(result.current.isError).toBe(false)
  })

  it('un error de la RPC o una excepción deja isError y vacía las filas', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    const { result, rerender } = renderHook((p: ParametrosRankingPorDimension) => useRankingPorDimension(p), { initialProps: parametros })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isError).toBe(true)
    expect(result.current.filas).toEqual([])

    mocks.rpc.mockRejectedValueOnce(new Error('red'))
    rerender({ ...parametros, pagina: 2 })
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.isFetching).toBe(false))
    expect(result.current.isError).toBe(true)
  })

  it('«última petición gana»: una respuesta vieja no pisa a la nueva', async () => {
    let resolverVieja: (valor: unknown) => void = () => {}
    mocks.rpc.mockImplementationOnce(() => new Promise((resolver) => { resolverVieja = resolver }))
    mocks.rpc.mockResolvedValueOnce({ data: [filaServidor({ nombre: 'Nueva' })], error: null })
    const { result, rerender } = renderHook((p: ParametrosRankingPorDimension) => useRankingPorDimension(p), { initialProps: parametros })
    rerender({ ...parametros, productoId: 'p-2' })
    await waitFor(() => expect(result.current.filas[0]?.nombre).toBe('Nueva'))
    resolverVieja({ data: [filaServidor({ nombre: 'Vieja' })], error: null })
    await Promise.resolve()
    expect(result.current.filas[0].nombre).toBe('Nueva')
  })

  it('al cambiar la empresa activa vuelve a consultar con la nueva tienda', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    const { result, rerender } = renderHook((p: ParametrosRankingPorDimension) => useRankingPorDimension(p), { initialProps: { ...parametros, empresaId: 'e-1' } })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    rerender({ ...parametros, empresaId: 'e-2' })
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2))
    expect(mocks.rpc.mock.calls[1][1].p_empresa_id).toBe('e-2')
  })
})
