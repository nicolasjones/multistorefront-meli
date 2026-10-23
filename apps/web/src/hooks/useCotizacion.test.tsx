import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), organizacion: { organizacionId: 'org-1' as string | null } }))

vi.mock('../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))
vi.mock('./useOrganizacionDeTrabajo', () => ({
  useOrganizacionDeTrabajo: () => ({ organizacionId: mocks.organizacion.organizacionId, isLoading: false }),
}))

import { useCargarCotizacion, useEstadoCotizacion } from './useCotizacion'

const estadoRpc = (valor: number) => ({
  data: { vigente: { valor, cargada_en: '2026-09-25T12:00:00Z', cargada_por: 'Javier' }, productos_usd: 3, pendiente: null },
  error: null,
})

describe('useEstadoCotizacion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.organizacion.organizacionId = 'org-1'
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('lee el estado de la cotización', async () => {
    mocks.rpc.mockResolvedValue(estadoRpc(1465))
    const { result } = renderHook(() => useEstadoCotizacion())
    expect(result.current.cargando).toBe(true)
    await waitFor(() => expect(result.current.estado?.vigente?.valor).toBe(1465))
    expect(result.current.cargando).toBe(false)
    expect(result.current.hayError).toBe(false)
    expect(mocks.rpc).toHaveBeenCalledWith('estado_cotizacion')
  })

  it('un error queda visible y no deja datos', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } })
    const { result } = renderHook(() => useEstadoCotizacion())
    await waitFor(() => expect(result.current.hayError).toBe(true))
    expect(result.current.estado).toBeNull()
    expect(console.error).toHaveBeenCalled()
  })

  it('al cambiar de organización descarta la cotización anterior y recarga', async () => {
    mocks.rpc.mockResolvedValueOnce(estadoRpc(1465))
    const { result, rerender } = renderHook(() => useEstadoCotizacion())
    await waitFor(() => expect(result.current.estado?.vigente?.valor).toBe(1465))

    mocks.rpc.mockResolvedValueOnce(estadoRpc(2000))
    mocks.organizacion.organizacionId = 'org-2'
    rerender()
    expect(result.current.estado).toBeNull()
    await waitFor(() => expect(result.current.estado?.vigente?.valor).toBe(2000))
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })

  it('una respuesta tardía de la organización anterior no pisa a la actual', async () => {
    let resolverViejo: (v: unknown) => void = () => undefined
    mocks.rpc.mockReturnValueOnce(new Promise((r) => { resolverViejo = r }))
    const { result, rerender } = renderHook(() => useEstadoCotizacion())

    mocks.rpc.mockResolvedValueOnce(estadoRpc(2000))
    mocks.organizacion.organizacionId = 'org-2'
    rerender()
    await waitFor(() => expect(result.current.estado?.vigente?.valor).toBe(2000))
    await act(async () => resolverViejo(estadoRpc(1465)))
    expect(result.current.estado?.vigente?.valor).toBe(2000)
  })
})

describe('useCargarCotizacion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('devuelve la carga como pendiente', async () => {
    mocks.rpc.mockResolvedValue({ data: { valor: 1490, anterior: 1465, variacion_pct: 1.7065, expira_en: 'x' }, error: null })
    const { result } = renderHook(() => useCargarCotizacion())
    let resultado
    await act(async () => { resultado = await result.current.cargar(1490) })
    expect(resultado).toEqual({ ok: true, carga: { valor: 1490, anterior: 1465, variacionPct: 1.7065, expiraEn: 'x' } })
    expect(mocks.rpc).toHaveBeenCalledWith('cargar_cotizacion', { p_valor: 1490 })
    expect(result.current.enviando).toBe(false)
  })

  it('traduce el rechazo de la base a un mensaje claro', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Tu rol no puede cargar' } })
    const { result } = renderHook(() => useCargarCotizacion())
    let resultado
    await act(async () => { resultado = await result.current.cargar(1490) })
    expect(resultado).toEqual({ ok: false, mensaje: 'Tu rol no puede cargar la cotización del dólar.' })
  })
})
