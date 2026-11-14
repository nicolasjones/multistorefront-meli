import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ leerCapacidadesTienda: vi.fn() }))
vi.mock('../lib/tiendaCapacidades', () => ({ leerCapacidadesTienda: mocks.leerCapacidadesTienda }))

import { useCapacidadesTienda } from './useCapacidadesTienda'

// F-CLI-20 (FR-014): mientras no responde, o si falla, no se dibuja nada de la épica.
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('useCapacidadesTienda', () => {
  it('arranca en cargando (pedidos falso) y pasa a lista con el valor del servidor', async () => {
    mocks.leerCapacidadesTienda.mockResolvedValue({ pedidos: true })
    const { result } = renderHook(() => useCapacidadesTienda('mundojc.localhost'))
    expect(result.current).toMatchObject({ fase: 'cargando', pedidos: false })
    await waitFor(() => expect(result.current.fase).toBe('lista'))
    expect(result.current.pedidos).toBe(true)
  })

  it('host desconocido (null) o función apagada: lista con pedidos falso', async () => {
    mocks.leerCapacidadesTienda.mockResolvedValue(null)
    const { result } = renderHook(() => useCapacidadesTienda('x.localhost'))
    await waitFor(() => expect(result.current.fase).toBe('lista'))
    expect(result.current.pedidos).toBe(false)
  })

  it('un error es fase error con pedidos falso, y reintentar vuelve a preguntar', async () => {
    mocks.leerCapacidadesTienda.mockRejectedValueOnce(new Error('red')).mockResolvedValueOnce({ pedidos: true })
    const { result } = renderHook(() => useCapacidadesTienda('mundojc.localhost'))
    await waitFor(() => expect(result.current.fase).toBe('error'))
    expect(result.current.pedidos).toBe(false)
    act(() => result.current.reintentar())
    expect(result.current.fase).toBe('cargando')
    await waitFor(() => expect(result.current.fase).toBe('lista'))
    expect(result.current.pedidos).toBe(true)
    expect(mocks.leerCapacidadesTienda).toHaveBeenCalledTimes(2)
  })

  it('al cambiar de host vuelve a cargando y nunca muestra lo del host anterior', async () => {
    mocks.leerCapacidadesTienda.mockImplementation(async (host: string) => ({ pedidos: host === 'mundojc.localhost' }))
    const { result, rerender } = renderHook(({ host }) => useCapacidadesTienda(host), { initialProps: { host: 'mundojc.localhost' } })
    await waitFor(() => expect(result.current).toMatchObject({ fase: 'lista', pedidos: true }))
    rerender({ host: 'sanjavucho.localhost' })
    expect(result.current).toMatchObject({ fase: 'cargando', pedidos: false })
    await waitFor(() => expect(result.current.fase).toBe('lista'))
    expect(result.current.pedidos).toBe(false)
  })

  it('con activo = false no llama y queda en cargando', async () => {
    const { result } = renderHook(() => useCapacidadesTienda('mundojc.localhost', false))
    await new Promise((resolver) => setTimeout(resolver, 10))
    expect(mocks.leerCapacidadesTienda).not.toHaveBeenCalled()
    expect(result.current).toMatchObject({ fase: 'cargando', pedidos: false })
  })
})
