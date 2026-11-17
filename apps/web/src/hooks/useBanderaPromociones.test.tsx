import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ leer: vi.fn() }))
vi.mock('../lib/capacidadesPrecios', () => ({ leerBanderaPromociones: mocks.leer }))
vi.mock('../lib/supabase', () => ({ supabaseClient: {} }))

import { INTERVALO_RELECTURA_BANDERA_MS, useBanderaPromociones, VENTANA_DEDUPLICACION_MS } from './useBanderaPromociones'

describe('useBanderaPromociones', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('lee la bandera al montar', async () => {
    mocks.leer.mockResolvedValue(true)
    const { result } = renderHook(() => useBanderaPromociones(false))
    expect(result.current.valor).toBeNull()
    await waitFor(() => expect(result.current.valor).toBe(true))
  })

  it('sin venta abierta no relee por intervalo ni al volver a la pestaña', async () => {
    vi.useFakeTimers()
    mocks.leer.mockResolvedValue(true)
    renderHook(() => useBanderaPromociones(false))
    await act(async () => {})
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_RELECTURA_BANDERA_MS * 3)
      window.dispatchEvent(new Event('focus'))
    })
    expect(mocks.leer).toHaveBeenCalledTimes(1)
  })

  it('con una venta abierta relee cada minuto y toma el cambio', async () => {
    vi.useFakeTimers()
    mocks.leer.mockResolvedValue(true)
    const { result } = renderHook(() => useBanderaPromociones(true))
    await act(async () => {})
    expect(result.current.valor).toBe(true)
    mocks.leer.mockResolvedValue(false)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_RELECTURA_BANDERA_MS)
    })
    expect(result.current.valor).toBe(false)
  })

  it('relee al volver a la pestaña y al enfocar la ventana', async () => {
    vi.useFakeTimers()
    mocks.leer.mockResolvedValue(true)
    renderHook(() => useBanderaPromociones(true))
    await act(async () => {})
    expect(mocks.leer).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(VENTANA_DEDUPLICACION_MS + 1)
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(mocks.leer).toHaveBeenCalledTimes(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(VENTANA_DEDUPLICACION_MS + 1)
      window.dispatchEvent(new Event('focus'))
    })
    expect(mocks.leer).toHaveBeenCalledTimes(3)
  })

  it('visibilitychange y focus juntos al volver a la pestaña hacen una sola lectura', async () => {
    vi.useFakeTimers()
    mocks.leer.mockResolvedValue(true)
    renderHook(() => useBanderaPromociones(true))
    await act(async () => {})
    mocks.leer.mockClear()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(VENTANA_DEDUPLICACION_MS + 1)
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
    })
    expect(mocks.leer).toHaveBeenCalledTimes(1)
  })

  it('si la lectura falla en cada vuelta, registra el error una sola vez', async () => {
    vi.useFakeTimers()
    mocks.leer.mockRejectedValue(new Error('sin permiso'))
    renderHook(() => useBanderaPromociones(true))
    await act(async () => {})
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_RELECTURA_BANDERA_MS * 3)
    })
    expect(mocks.leer.mock.calls.length).toBeGreaterThanOrEqual(4)
    expect(console.error).toHaveBeenCalledTimes(1)
  })

  it('al desmontar se limpian el intervalo y los listeners', async () => {
    vi.useFakeTimers()
    mocks.leer.mockResolvedValue(true)
    const quitarDoc = vi.spyOn(document, 'removeEventListener')
    const quitarVentana = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useBanderaPromociones(true))
    await act(async () => {})
    unmount()
    expect(quitarDoc).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(quitarVentana).toHaveBeenCalledWith('focus', expect.any(Function))
    mocks.leer.mockClear()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_RELECTURA_BANDERA_MS * 2)
      window.dispatchEvent(new Event('focus'))
    })
    expect(mocks.leer).not.toHaveBeenCalled()
  })

  it('al pasar activo a false se limpian el intervalo y los listeners', async () => {
    vi.useFakeTimers()
    mocks.leer.mockResolvedValue(true)
    const { rerender } = renderHook(({ activo }) => useBanderaPromociones(activo), { initialProps: { activo: true } })
    await act(async () => {})
    rerender({ activo: false })
    mocks.leer.mockClear()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_RELECTURA_BANDERA_MS * 2)
      window.dispatchEvent(new Event('focus'))
    })
    expect(mocks.leer).not.toHaveBeenCalled()
  })

  it('si una relectura falla conserva el último valor y releer devuelve null', async () => {
    mocks.leer.mockResolvedValue(true)
    const { result } = renderHook(() => useBanderaPromociones(true))
    await waitFor(() => expect(result.current.valor).toBe(true))
    mocks.leer.mockRejectedValue(new Error('red'))
    let leida: boolean | null = true
    await act(async () => {
      leida = await result.current.releer()
    })
    expect(leida).toBeNull()
    expect(result.current.valor).toBe(true)
  })

  it('releer devuelve la lectura nueva', async () => {
    mocks.leer.mockResolvedValue(false)
    const { result } = renderHook(() => useBanderaPromociones(false))
    await waitFor(() => expect(result.current.valor).toBe(false))
    mocks.leer.mockResolvedValue(true)
    let leida: boolean | null = null
    await act(async () => {
      leida = await result.current.releer()
    })
    expect(leida).toBe(true)
    expect(result.current.valor).toBe(true)
  })
})
