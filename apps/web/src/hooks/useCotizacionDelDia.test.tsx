import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), organizacion: { organizacionId: 'org-1' as string | null } }))

vi.mock('../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))
vi.mock('./useOrganizacionDeTrabajo', () => ({
  useOrganizacionDeTrabajo: () => ({ organizacionId: mocks.organizacion.organizacionId, isLoading: false }),
}))

import { useCotizacionDelDia } from './useCotizacionDelDia'

const CARGADA = { cargada_hoy: true, cargada_en: '2026-10-23T13:32:00Z', cargada_por: 'Administrador', valor: '1490.0000' }
const SIN_CARGA = { cargada_hoy: false, cargada_en: null, cargada_por: null, valor: null }

describe('useCotizacionDelDia', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.organizacion.organizacionId = 'org-1'
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('lee si se cargó hoy y convierte el valor a número', async () => {
    mocks.rpc.mockResolvedValue({ data: CARGADA, error: null })
    const { result } = renderHook(() => useCotizacionDelDia())
    expect(result.current.cargando).toBe(true)
    await waitFor(() => expect(result.current.delDia?.cargadaHoy).toBe(true))
    expect(result.current.delDia).toEqual({ cargadaHoy: true, cargadaEn: '2026-10-23T13:32:00Z', cargadaPor: 'Administrador', valor: 1490 })
    expect(mocks.rpc).toHaveBeenCalledWith('cotizacion_del_dia')
  })

  it('un error queda visible y no deja datos', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } })
    const { result } = renderHook(() => useCotizacionDelDia())
    await waitFor(() => expect(result.current.hayError).toBe(true))
    expect(result.current.delDia).toBeNull()
    expect(console.error).toHaveBeenCalled()
  })

  it('deshabilitado no consulta', () => {
    const { result } = renderHook(() => useCotizacionDelDia(false))
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(result.current.cargando).toBe(false)
  })

  it('al cambiar la organización descarta lo anterior y vuelve a consultar', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: CARGADA, error: null })
    const { result, rerender } = renderHook(() => useCotizacionDelDia())
    await waitFor(() => expect(result.current.delDia?.cargadaHoy).toBe(true))
    mocks.rpc.mockResolvedValueOnce({ data: SIN_CARGA, error: null })
    mocks.organizacion.organizacionId = 'org-2'
    rerender()
    await waitFor(() => expect(result.current.delDia?.cargadaHoy).toBe(false))
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })
})
