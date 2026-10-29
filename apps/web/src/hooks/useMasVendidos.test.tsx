import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ listarMasVendidos: vi.fn(), useOrganizacionActiva: vi.fn() }))
vi.mock('../lib/masVendidos', () => ({ listarMasVendidos: mocks.listarMasVendidos }))
vi.mock('./useOrganizacionActiva', () => ({ useOrganizacionActiva: mocks.useOrganizacionActiva }))

import { useMasVendidos } from './useMasVendidos'

const fila = (nombre: string) => ({ posicion: 1, producto_id: `p-${nombre}`, nombre, sku: null, unidades: 2 })

const filtros = (extra: { empresaId?: string | null; desde?: string; hasta?: string } = {}) => ({
  desde: extra.desde ?? '2026-10-01',
  hasta: extra.hasta ?? '2026-10-31',
  empresaId: extra.empresaId ?? null,
  pagina: 1,
})

describe('useMasVendidos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useOrganizacionActiva.mockReturnValue({ organizacionActiva: { id: 'o-1', nombre: 'Org' }, isLoading: false })
  })

  it('carga el ranking y expone filas y total', async () => {
    mocks.listarMasVendidos.mockResolvedValue({ filas: [fila('Auricular')], total: 1 })
    const { result } = renderHook(() => useMasVendidos(filtros()))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.filas.map((f) => f.nombre)).toEqual(['Auricular'])
    expect(result.current.total).toBe(1)
    expect(result.current.isError).toBe(false)
  })

  it('al cambiar la tienda no muestra las filas de la tienda anterior', async () => {
    mocks.listarMasVendidos.mockResolvedValue({ filas: [fila('Auricular')], total: 1 })
    const { result, rerender } = renderHook(
      ({ empresaId }: { empresaId: string | null }) => useMasVendidos(filtros({ empresaId })),
      { initialProps: { empresaId: null as string | null } },
    )
    await waitFor(() => expect(result.current.filas).toHaveLength(1))

    mocks.listarMasVendidos.mockResolvedValue({ filas: [fila('Silla')], total: 1 })
    rerender({ empresaId: 'e-2' })

    // Hasta que llega la respuesta nueva no se ve nada de la tienda anterior.
    expect(result.current.filas).toEqual([])
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.filas.map((f) => f.nombre)).toEqual(['Silla']))
  })

  it('al cambiar el período tampoco muestra las filas del período anterior', async () => {
    mocks.listarMasVendidos.mockResolvedValue({ filas: [fila('Auricular')], total: 1 })
    const { result, rerender } = renderHook(
      ({ desde }: { desde: string }) => useMasVendidos(filtros({ desde })),
      { initialProps: { desde: '2026-10-01' } },
    )
    await waitFor(() => expect(result.current.filas).toHaveLength(1))

    mocks.listarMasVendidos.mockResolvedValue({ filas: [fila('Cable')], total: 1 })
    rerender({ desde: '2026-09-01' })

    expect(result.current.filas).toEqual([])
    await waitFor(() => expect(result.current.filas.map((f) => f.nombre)).toEqual(['Cable']))
  })

  it('si la base falla, muestra el estado de error y no deja filas viejas', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.listarMasVendidos.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useMasVendidos(filtros()))

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.filas).toEqual([])
    expect(result.current.total).toBe(0)
  })
})
