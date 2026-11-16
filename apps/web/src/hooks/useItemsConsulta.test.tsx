import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ listarItemsConsulta: vi.fn(), organizacionId: 'o-1' as string | null }))

vi.mock('../lib/consultas', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/consultas')>()), listarItemsConsulta: mocks.listarItemsConsulta }))
vi.mock('./useOrganizacionActiva', () => ({
  useOrganizacionActiva: () => ({ organizacionActiva: mocks.organizacionId ? { id: mocks.organizacionId, nombre: 'Org' } : null, isLoading: false }),
}))

import { useItemsConsulta } from './useItemsConsulta'

const ITEM = { orden: 1, producto_id: null, descripcion: 'Taza', sku: null, cantidad: 1, precio_referencia: 10 }

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  mocks.organizacionId = 'o-1'
})

describe('useItemsConsulta (B1, P-6)', () => {
  it('sin consulta (no es un pedido) no llama y queda cargando', () => {
    const { result } = renderHook(() => useItemsConsulta(null))
    expect(result.current.fase).toBe('cargando')
    expect(mocks.listarItemsConsulta).not.toHaveBeenCalled()
  })

  it('carga los ítems del pedido', async () => {
    mocks.listarItemsConsulta.mockResolvedValue([ITEM])
    const { result } = renderHook(() => useItemsConsulta('c-1'))
    expect(result.current.fase).toBe('cargando')
    await waitFor(() => expect(result.current.fase).toBe('lista'))
    expect(result.current.items).toEqual([ITEM])
  })

  it('un error deja la fase «error» y «reintentar» vuelve a pedir', async () => {
    mocks.listarItemsConsulta.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce([ITEM])
    const { result } = renderHook(() => useItemsConsulta('c-1'))
    await waitFor(() => expect(result.current.fase).toBe('error'))
    act(() => result.current.reintentar())
    await waitFor(() => expect(result.current.fase).toBe('lista'))
    expect(mocks.listarItemsConsulta).toHaveBeenCalledTimes(2)
  })

  it('al cambiar de organización o de consulta no se muestra lo del ámbito anterior', async () => {
    mocks.listarItemsConsulta.mockResolvedValue([ITEM])
    const { result, rerender } = renderHook(({ id }: { id: string }) => useItemsConsulta(id), { initialProps: { id: 'c-1' } })
    await waitFor(() => expect(result.current.fase).toBe('lista'))
    mocks.listarItemsConsulta.mockReturnValue(new Promise(() => undefined))
    rerender({ id: 'c-2' })
    expect(result.current.fase).toBe('cargando')
    expect(result.current.items).toEqual([])
  })
})
