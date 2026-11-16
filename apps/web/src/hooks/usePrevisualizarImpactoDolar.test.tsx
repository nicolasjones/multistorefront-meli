import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/cotizacion', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/cotizacion')>()), previsualizarImpactoDolarRpc: mocks.rpc }))
vi.mock('../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('./useOrganizacionDeTrabajo', () => ({ useOrganizacionDeTrabajo: () => ({ organizacionId: 'org-1' }) }))

import { usePrevisualizarImpactoDolar } from './usePrevisualizarImpactoDolar'

const PREVIA = { variacionPct: 5, recalcula: true, umbralPct: 1, redondeoPesos: 10, empresas: [], muestra: [] }

describe('usePrevisualizarImpactoDolar (F-INI-07)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.rpc.mockReset()
    mocks.rpc.mockResolvedValue(PREVIA)
  })
  afterEach(() => vi.useRealTimers())

  it('sin valor válido no llama a la base ni muestra nada', async () => {
    const { result } = renderHook(() => usePrevisualizarImpactoDolar(null))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(result.current).toMatchObject({ previa: null, cargando: false, hayError: false })
  })

  it('espera a que termine de tipear y pide una sola vez, con la empresa', async () => {
    const { result, rerender } = renderHook(({ v }) => usePrevisualizarImpactoDolar(v, 'e1'), { initialProps: { v: 1 as number | null } })
    rerender({ v: 15 })
    rerender({ v: 1538 })
    expect(result.current.cargando).toBe(true)
    expect(mocks.rpc).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith(expect.anything(), 1538, 'e1')
    expect(result.current).toMatchObject({ previa: PREVIA, cargando: false, hayError: false })
  })

  it('al cambiar el valor deja de verse el impacto del valor anterior', async () => {
    const { result, rerender } = renderHook(({ v }) => usePrevisualizarImpactoDolar(v), { initialProps: { v: 1500 as number | null } })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(result.current.previa).toEqual(PREVIA)
    rerender({ v: 1600 })
    expect(result.current.previa).toBeNull()
    expect(result.current.cargando).toBe(true)
  })

  it('un error queda a la vista (no se traga) y permite reintentar', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('falló'))
    const { result } = renderHook(() => usePrevisualizarImpactoDolar(1500))
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(result.current).toMatchObject({ previa: null, hayError: true })
    await act(async () => { result.current.recargar(); await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.previa).toEqual(PREVIA)
  })

  it('respuestas desordenadas: la última petición gana (A resuelve después de B)', async () => {
    let resolverA: (valor: unknown) => void = () => undefined
    const previaB = { ...PREVIA, variacionPct: 7 }
    mocks.rpc
      .mockReturnValueOnce(new Promise((resolve) => { resolverA = resolve }))
      .mockResolvedValueOnce(previaB)
    const { result, rerender } = renderHook(({ v }) => usePrevisualizarImpactoDolar(v), { initialProps: { v: 1500 as number | null } })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    rerender({ v: 1600 })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(result.current.previa).toEqual(previaB)
    // La respuesta vieja (A) llega tarde y no pisa a la nueva.
    await act(async () => { resolverA(PREVIA); await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.previa).toEqual(previaB)
  })

  it('al desmontar, una respuesta en vuelo ya no actualiza nada', async () => {
    let resolver: (valor: unknown) => void = () => undefined
    mocks.rpc.mockReturnValueOnce(new Promise((resolve) => { resolver = resolve }))
    const errores = vi.spyOn(console, 'error')
    const { unmount } = renderHook(() => usePrevisualizarImpactoDolar(1500))
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    unmount()
    await act(async () => { resolver(PREVIA); await vi.advanceTimersByTimeAsync(0) })
    expect(errores).not.toHaveBeenCalled()
  })

  it('conserva el último impacto como `anterior` mientras llega el del valor nuevo (sin habilitar guardar)', async () => {
    const { result, rerender } = renderHook(({ v }) => usePrevisualizarImpactoDolar(v), { initialProps: { v: 1500 as number | null } })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    rerender({ v: 1600 })
    expect(result.current.previa).toBeNull()
    expect(result.current.anterior).toEqual(PREVIA)
    expect(result.current.cargando).toBe(true)
    rerender({ v: null })
    expect(result.current.anterior).toBeNull()
  })
})
