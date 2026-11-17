import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ leer: vi.fn() }))
vi.mock('../lib/capacidadesPrecios', () => ({ leerCapacidadesPrecios: mocks.leer }))
vi.mock('../lib/supabase', () => ({ supabaseClient: {} }))

import { INTERVALO_RELECTURA_BANDERA_MS, useBanderaPromociones } from './useBanderaPromociones'

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
    mocks.leer.mockResolvedValue({ promociones: true })
    const { result } = renderHook(() => useBanderaPromociones(false))
    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current).toBe(true))
  })

  it('con una venta abierta relee cada minuto y toma el cambio', async () => {
    vi.useFakeTimers()
    mocks.leer.mockResolvedValue({ promociones: true })
    const { result } = renderHook(() => useBanderaPromociones(true))
    await act(async () => {})
    expect(result.current).toBe(true)
    mocks.leer.mockResolvedValue({ promociones: false })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_RELECTURA_BANDERA_MS)
    })
    expect(result.current).toBe(false)
  })

  it('si una relectura falla conserva el último valor', async () => {
    vi.useFakeTimers()
    mocks.leer.mockResolvedValue({ promociones: true })
    const { result } = renderHook(() => useBanderaPromociones(true))
    await act(async () => {})
    mocks.leer.mockRejectedValue(new Error('red'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_RELECTURA_BANDERA_MS)
    })
    expect(result.current).toBe(true)
  })
})
