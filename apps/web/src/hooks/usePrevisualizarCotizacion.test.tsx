import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), organizacion: { organizacionId: 'org-1' as string | null } }))

vi.mock('../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))
vi.mock('./useOrganizacionDeTrabajo', () => ({
  useOrganizacionDeTrabajo: () => ({ organizacionId: mocks.organizacion.organizacionId, isLoading: false }),
}))

import { usePrevisualizarCotizacion } from './usePrevisualizarCotizacion'

const previaRpc = (nombre: string) => ({
  data: {
    variacion_pct: 5,
    recalcula: true,
    empresas: [{ empresa_id: 'e1', nombre, precios: 2 }],
    muestra: [],
  },
  error: null,
})

describe('usePrevisualizarCotizacion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.organizacion.organizacionId = 'org-1'
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('lee la vista previa de la cotización pendiente', async () => {
    mocks.rpc.mockResolvedValue(previaRpc('Mundo JC'))
    const { result } = renderHook(() => usePrevisualizarCotizacion())
    expect(result.current.cargando).toBe(true)
    await waitFor(() => expect(result.current.previa?.empresas[0].nombre).toBe('Mundo JC'))
    expect(result.current.cargando).toBe(false)
    expect(result.current.hayError).toBe(false)
    expect(mocks.rpc).toHaveBeenCalledWith('previsualizar_cotizacion')
  })

  it('un error queda visible, sin datos, y se puede reintentar', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'boom' } })
    const { result } = renderHook(() => usePrevisualizarCotizacion())
    await waitFor(() => expect(result.current.hayError).toBe(true))
    expect(result.current.previa).toBeNull()
    expect(console.error).toHaveBeenCalled()

    mocks.rpc.mockResolvedValueOnce(previaRpc('Mundo JC'))
    await act(async () => { await result.current.recargar() })
    expect(result.current.hayError).toBe(false)
    expect(result.current.previa?.recalcula).toBe(true)
  })

  it('al cambiar de organización descarta la vista previa anterior y recarga', async () => {
    mocks.rpc.mockResolvedValueOnce(previaRpc('Empresa de la org 1'))
    const { result, rerender } = renderHook(() => usePrevisualizarCotizacion())
    await waitFor(() => expect(result.current.previa?.empresas[0].nombre).toBe('Empresa de la org 1'))

    mocks.rpc.mockResolvedValueOnce(previaRpc('Empresa de la org 2'))
    mocks.organizacion.organizacionId = 'org-2'
    rerender()
    await waitFor(() => expect(result.current.previa?.empresas[0].nombre).toBe('Empresa de la org 2'))
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })

  it('«última petición gana»: una respuesta vieja no pisa a la nueva', async () => {
    let resolverViejo: (valor: unknown) => void = () => undefined
    mocks.rpc.mockImplementationOnce(() => new Promise((resolver) => { resolverViejo = resolver }))
    const { result, rerender } = renderHook(() => usePrevisualizarCotizacion())

    mocks.rpc.mockResolvedValueOnce(previaRpc('Nueva'))
    mocks.organizacion.organizacionId = 'org-2'
    rerender()
    await waitFor(() => expect(result.current.previa?.empresas[0].nombre).toBe('Nueva'))
    await act(async () => resolverViejo(previaRpc('Vieja')))
    expect(result.current.previa?.empresas[0].nombre).toBe('Nueva')
  })
})
