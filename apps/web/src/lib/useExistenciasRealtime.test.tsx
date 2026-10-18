import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  contexto: { current: { organizacion_id: 'org-1' } as { organizacion_id: string | null } | null },
  aviso: { current: null as null | (() => void) },
  estado: { current: null as null | ((estado: string, error?: unknown) => void) },
  on: vi.fn(),
  subscribe: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(),
}))

vi.mock('../hooks/useContextoPanel', () => ({
  useContextoPanel: () => ({ contexto: mocks.contexto.current, isLoading: false, error: null, invalidar: vi.fn() }),
}))
vi.mock('./supabase', () => ({
  supabaseClient: { channel: mocks.channel, removeChannel: mocks.removeChannel },
}))

import { ESPERA_AGRUPAR_MS, useExistenciasRealtime } from './useExistenciasRealtime'

describe('useExistenciasRealtime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.contexto.current = { organizacion_id: 'org-1' }
    mocks.aviso.current = null
    mocks.estado.current = null
    const canal = { on: mocks.on, subscribe: mocks.subscribe }
    mocks.channel.mockReset().mockReturnValue(canal)
    mocks.on.mockReset().mockImplementation((_tipo: string, _filtro: unknown, aviso: () => void) => {
      mocks.aviso.current = aviso
      return canal
    })
    mocks.subscribe.mockReset().mockImplementation((alEstado: (estado: string, error?: unknown) => void) => {
      mocks.estado.current = alEstado
      return canal
    })
    mocks.removeChannel.mockReset().mockResolvedValue('ok')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('se suscribe a existencias de la organización activa', () => {
    renderHook(() => useExistenciasRealtime(vi.fn()))
    expect(mocks.channel).toHaveBeenCalledWith('existencias:org-1')
    expect(mocks.on).toHaveBeenCalledWith(
      'postgres_changes',
      { event: '*', schema: 'dominio', table: 'existencias', filter: 'organizacion_id=eq.org-1' },
      expect.any(Function),
    )
    expect(mocks.subscribe).toHaveBeenCalledTimes(1)
  })

  it('un aviso dispara un solo refresco', () => {
    const alCambiar = vi.fn()
    renderHook(() => useExistenciasRealtime(alCambiar))
    act(() => { mocks.aviso.current?.() })
    expect(alCambiar).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(ESPERA_AGRUPAR_MS) })
    expect(alCambiar).toHaveBeenCalledTimes(1)
  })

  it('una ráfaga de avisos se agrupa en un refresco', () => {
    const alCambiar = vi.fn()
    renderHook(() => useExistenciasRealtime(alCambiar))
    act(() => {
      for (let i = 0; i < 20; i += 1) {
        mocks.aviso.current?.()
        vi.advanceTimersByTime(ESPERA_AGRUPAR_MS / 3)
      }
    })
    expect(alCambiar).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(ESPERA_AGRUPAR_MS) })
    expect(alCambiar).toHaveBeenCalledTimes(1)
  })

  it('llama siempre a la versión más reciente del callback', () => {
    const primero = vi.fn()
    const segundo = vi.fn()
    const { rerender } = renderHook(({ cb }) => useExistenciasRealtime(cb), { initialProps: { cb: primero } })
    rerender({ cb: segundo })
    expect(mocks.channel).toHaveBeenCalledTimes(1)
    act(() => { mocks.aviso.current?.() })
    act(() => { vi.advanceTimersByTime(ESPERA_AGRUPAR_MS) })
    expect(primero).not.toHaveBeenCalled()
    expect(segundo).toHaveBeenCalledTimes(1)
  })

  it('al cambiar de organización cierra el canal y se re-suscribe', () => {
    const { rerender } = renderHook(() => useExistenciasRealtime(vi.fn()))
    mocks.contexto.current = { organizacion_id: 'org-2' }
    rerender()
    expect(mocks.removeChannel).toHaveBeenCalledTimes(1)
    expect(mocks.channel).toHaveBeenLastCalledWith('existencias:org-2')
    expect(mocks.channel).toHaveBeenCalledTimes(2)
  })

  it('al desmontar cierra el canal y descarta el refresco pendiente', () => {
    const alCambiar = vi.fn()
    const { unmount } = renderHook(() => useExistenciasRealtime(alCambiar))
    act(() => { mocks.aviso.current?.() })
    unmount()
    act(() => { vi.advanceTimersByTime(ESPERA_AGRUPAR_MS * 2) })
    expect(mocks.removeChannel).toHaveBeenCalledTimes(1)
    expect(alCambiar).not.toHaveBeenCalled()
  })

  it('sin organización no se suscribe', () => {
    mocks.contexto.current = { organizacion_id: null }
    renderHook(() => useExistenciasRealtime(vi.fn()))
    expect(mocks.channel).not.toHaveBeenCalled()
  })

  it('un fallo del canal no lanza ni bloquea', () => {
    renderHook(() => useExistenciasRealtime(vi.fn()))
    expect(() => act(() => { mocks.estado.current?.('CHANNEL_ERROR', new Error('caído')) })).not.toThrow()
    expect(console.warn).toHaveBeenCalled()
  })

  it('si crear el canal lanza, el hook no rompe la pantalla', () => {
    mocks.channel.mockImplementation(() => { throw new Error('sin websocket') })
    const { unmount } = renderHook(() => useExistenciasRealtime(vi.fn()))
    expect(console.warn).toHaveBeenCalled()
    expect(() => unmount()).not.toThrow()
  })
})
