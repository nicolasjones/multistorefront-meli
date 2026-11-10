import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  leerConteoVentas: vi.fn(),
  resolvers: [] as Array<(conteo: number) => void>,
}))

vi.mock('../lib/ventas-reportes', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/ventas-reportes')>()
  return { ...original, leerConteoVentas: mocks.leerConteoVentas }
})
vi.mock('../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('./useOrganizacionDeTrabajo', () => ({
  useOrganizacionDeTrabajo: () => ({ organizacionId: 'org-1', isLoading: false }),
}))

import { useConteoVentasReporte } from './useVentasReportes'

const OCTUBRE = { desde: '2026-10-01', hasta: '2026-10-31' }
const SEPTIEMBRE = { desde: '2026-09-01', hasta: '2026-09-30' }

const responder = async (indice: number, conteo: number) => {
  await act(async () => {
    mocks.resolvers[indice]?.(conteo)
  })
}

describe('useConteoVentasReporte (F-VTA-22, FR-005): conteo del período', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvers = []
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.leerConteoVentas.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          mocks.resolvers.push(resolve)
        }),
    )
  })

  it('no expone el conteo anterior mientras llega el del período nuevo (un pedido por cambio)', async () => {
    const { result, rerender } = renderHook(
      ({ rango }) => useConteoVentasReporte({ rango, empresaId: 'e-sj' }),
      { initialProps: { rango: OCTUBRE } },
    )
    expect(result.current.conteo).toBeNull()
    expect(result.current.isLoading).toBe(true)

    await responder(0, 5)
    expect(result.current.conteo).toBe(5)
    expect(result.current.isLoading).toBe(false)
    expect(mocks.leerConteoVentas).toHaveBeenCalledTimes(1)

    // La clave cambia: el conteo de octubre deja de ser vigente EN EL MISMO render, sin esperar al
    // efecto. Si se expusiera el valor viejo, el tablero se montaría (y pediría el token) antes de
    // llegar el conteo nuevo: dos pedidos por cada cambio de filtro.
    rerender({ rango: SEPTIEMBRE })
    expect(result.current.conteo).toBeNull()
    expect(result.current.isLoading).toBe(true)
    expect(mocks.leerConteoVentas).toHaveBeenCalledTimes(2)

    await responder(1, 3)
    expect(result.current.conteo).toBe(3)
    expect(result.current.isLoading).toBe(false)
    expect(mocks.leerConteoVentas).toHaveBeenCalledTimes(2)
  })

  it('descarta la respuesta vieja si el filtro cambia mientras viaja la consulta', async () => {
    const { result, rerender } = renderHook(
      ({ rango, empresaId }) => useConteoVentasReporte({ rango, empresaId }),
      { initialProps: { rango: OCTUBRE, empresaId: 'e-sj' } },
    )

    rerender({ rango: SEPTIEMBRE, empresaId: 'e-mjc' })
    expect(mocks.leerConteoVentas).toHaveBeenCalledTimes(2)

    // Llega tarde la respuesta de los filtros anteriores: no se muestra.
    await responder(0, 9)
    expect(result.current.conteo).toBeNull()
    expect(result.current.isLoading).toBe(true)

    await responder(1, 4)
    expect(result.current.conteo).toBe(4)
    expect(result.current.isLoading).toBe(false)
  })

  it('un error del conteo no se traga y deja de cargar', async () => {
    mocks.leerConteoVentas.mockRejectedValueOnce(new Error('red'))
    const { result } = renderHook(() =>
      useConteoVentasReporte({ rango: OCTUBRE, empresaId: null }),
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.hayError).toBe(true)
    expect(result.current.conteo).toBeNull()
  })

  it('deshabilitado no pide el conteo', () => {
    const { result } = renderHook(() =>
      useConteoVentasReporte({ rango: OCTUBRE, empresaId: null, habilitado: false }),
    )

    expect(mocks.leerConteoVentas).not.toHaveBeenCalled()
    expect(result.current.isLoading).toBe(false)
  })
})
