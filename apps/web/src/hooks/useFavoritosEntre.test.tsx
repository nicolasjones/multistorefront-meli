import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCuentaTienda } from '../lib/tiendaCuentaDatos'

const mocks = vi.hoisted(() => ({ leerFavoritosEntre: vi.fn() }))
vi.mock('../lib/tiendaCuentaDatos', async (original) => ({
  ...(await original<typeof import('../lib/tiendaCuentaDatos')>()),
  leerFavoritosEntre: mocks.leerFavoritosEntre,
}))

import { useFavoritosEntre } from './useFavoritosEntre'

const A = 'a1000000-0000-4000-8000-000000000001'
const B = 'a1000000-0000-4000-8000-000000000002'
const HOST = 'mundojc.localhost'

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

// F-CLI-20 (FR-007): UNA llamada por pantalla; nada de la persona anterior sobrevive a su salida.
describe('useFavoritosEntre', () => {
  it('una sola llamada con todos los ids de la pantalla', async () => {
    mocks.leerFavoritosEntre.mockResolvedValue([B])
    const { result } = renderHook(() => useFavoritosEntre(HOST, [A, B], true))
    expect(result.current.fase).toBe('cargando')
    await waitFor(() => expect(result.current.fase).toBe('lista'))
    expect(result.current.esFavorito(A)).toBe(false)
    expect(result.current.esFavorito(B)).toBe(true)
    expect(mocks.leerFavoritosEntre).toHaveBeenCalledTimes(1)
    expect(mocks.leerFavoritosEntre).toHaveBeenCalledWith(HOST, [A, B])
  })

  it('con activo = false no llama', async () => {
    const { result } = renderHook(() => useFavoritosEntre(HOST, [A], false))
    await new Promise((resolver) => setTimeout(resolver, 10))
    expect(mocks.leerFavoritosEntre).not.toHaveBeenCalled()
    expect(result.current.esFavorito(A)).toBe(false)
  })

  it('marcar refleja un cambio confirmado sin volver a pedir', async () => {
    mocks.leerFavoritosEntre.mockResolvedValue([])
    const { result } = renderHook(() => useFavoritosEntre(HOST, [A], true))
    await waitFor(() => expect(result.current.fase).toBe('lista'))
    act(() => result.current.marcar(A, true))
    expect(result.current.esFavorito(A)).toBe(true)
    act(() => result.current.marcar(A, false))
    expect(result.current.esFavorito(A)).toBe(false)
    expect(mocks.leerFavoritosEntre).toHaveBeenCalledTimes(1)
  })

  it('error: fase error y ningún favorito; sin_acceso: fase sin_acceso', async () => {
    mocks.leerFavoritosEntre.mockRejectedValueOnce(new Error('red'))
    const uno = renderHook(() => useFavoritosEntre(HOST, [A], true))
    await waitFor(() => expect(uno.result.current.fase).toBe('error'))
    uno.unmount()
    mocks.leerFavoritosEntre.mockRejectedValueOnce(new ErrorCuentaTienda('sin_acceso'))
    const dos = renderHook(() => useFavoritosEntre(HOST, [A], true))
    await waitFor(() => expect(dos.result.current.fase).toBe('sin_acceso'))
  })

  it('al cerrar la sesión (activo pasa a false) se descarta lo de esa persona y al volver a entrar se vuelve a pedir', async () => {
    mocks.leerFavoritosEntre.mockResolvedValueOnce([A]).mockResolvedValueOnce([])
    const { result, rerender } = renderHook(({ activo }) => useFavoritosEntre(HOST, [A], activo), { initialProps: { activo: true } })
    await waitFor(() => expect(result.current.esFavorito(A)).toBe(true))
    rerender({ activo: false })
    expect(result.current.esFavorito(A)).toBe(false)
    expect(result.current.fase).toBe('cargando')
    rerender({ activo: true })
    // Otra persona con el mismo host y los mismos productos: lo anterior no reaparece mientras llega lo suyo.
    expect(result.current.esFavorito(A)).toBe(false)
    await waitFor(() => expect(result.current.fase).toBe('lista'))
    expect(result.current.esFavorito(A)).toBe(false)
    expect(mocks.leerFavoritosEntre).toHaveBeenCalledTimes(2)
  })

  it('un ingreso distinto sin pasar por «sin sesión» (cambia el contador de sesión) descarta lo anterior y vuelve a pedir', async () => {
    mocks.leerFavoritosEntre.mockResolvedValueOnce([A]).mockResolvedValueOnce([])
    const { result, rerender } = renderHook(({ sesion }) => useFavoritosEntre(HOST, [A], true, sesion), { initialProps: { sesion: 1 } })
    await waitFor(() => expect(result.current.esFavorito(A)).toBe(true))
    rerender({ sesion: 2 })
    expect(result.current.esFavorito(A)).toBe(false)
    await waitFor(() => expect(result.current.fase).toBe('lista'))
    expect(result.current.esFavorito(A)).toBe(false)
  })

  it('cambiar de host o de productos vuelve a pedir', async () => {
    mocks.leerFavoritosEntre.mockResolvedValue([])
    const { result, rerender } = renderHook(({ host }) => useFavoritosEntre(host, [A], true), { initialProps: { host: HOST } })
    await waitFor(() => expect(result.current.fase).toBe('lista'))
    rerender({ host: 'sanjavucho.localhost' })
    expect(result.current.fase).toBe('cargando')
    await waitFor(() => expect(result.current.fase).toBe('lista'))
    expect(mocks.leerFavoritosEntre).toHaveBeenLastCalledWith('sanjavucho.localhost', [A])
  })
})
