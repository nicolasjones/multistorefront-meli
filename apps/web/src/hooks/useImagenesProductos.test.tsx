import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ consultar: vi.fn() }))
vi.mock('../lib/imagenesPrincipales', () => ({ consultarImagenesPrincipales: mocks.consultar }))
vi.mock('../lib/supabase', () => ({ supabaseClient: {} }))

import { useImagenesProductos } from './useImagenesProductos'

describe('useImagenesProductos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.consultar.mockImplementation(async (_cliente: unknown, ids: string[]) => new Map(ids.filter((id) => id !== 'sin-foto').map((id) => [id, `https://img/${id}.png`])))
  })

  it('devuelve la URL de cada producto con imagen y no pide dos veces el mismo', async () => {
    const { result, rerender } = renderHook(({ ids }: { ids: string[] }) => useImagenesProductos(ids), { initialProps: { ids: ['a', 'b', 'sin-foto'] } })
    await waitFor(() => expect(result.current.get('a')).toBe('https://img/a.png'))
    expect(result.current.has('sin-foto')).toBe(false)
    expect(mocks.consultar).toHaveBeenCalledTimes(1)

    // Llega otra tanda del listado: solo se piden los productos nuevos.
    rerender({ ids: ['a', 'b', 'sin-foto', 'c'] })
    await waitFor(() => expect(result.current.get('c')).toBe('https://img/c.png'))
    expect(mocks.consultar).toHaveBeenCalledTimes(2)
    expect(mocks.consultar.mock.calls[1][1]).toEqual(['c'])
    expect(result.current.get('a')).toBe('https://img/a.png')
  })

  it('sin ids, nulos o repetidos no consulta nada de más', async () => {
    renderHook(() => useImagenesProductos([null, undefined, '']))
    expect(mocks.consultar).not.toHaveBeenCalled()
  })

  it('si falla la consulta no rompe: queda el mapa vacío', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.consultar.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useImagenesProductos(['a']))
    await waitFor(() => expect(mocks.consultar).toHaveBeenCalled())
    expect(result.current.size).toBe(0)
  })

  describe('vencimiento de las URL firmadas y carga infinita', () => {
    // La URL firmada vive 300 s; el hook la da por vencida a los 270 s.
    afterEach(() => vi.useRealTimers())

    it('al sumar una tanda pasados los 270 s pide SOLO los ids nuevos (no re-firma lo ya cargado)', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      const { result, rerender } = renderHook(({ ids }: { ids: string[] }) => useImagenesProductos(ids), { initialProps: { ids: ['a', 'b'] } })
      await waitFor(() => expect(result.current.get('a')).toBe('https://img/a.png'))
      const urlA = result.current.get('a')
      vi.setSystemTime(Date.now() + 280_000)
      rerender({ ids: ['a', 'b', 'c'] })
      await waitFor(() => expect(result.current.get('c')).toBe('https://img/c.png'))
      expect(mocks.consultar).toHaveBeenCalledTimes(2)
      expect(mocks.consultar.mock.calls[1][1]).toEqual(['c'])
      expect(result.current.get('a')).toBe(urlA)
    })

    it('si la lista cambia de otra manera (filtros) renueva las vencidas que siguen en pantalla', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      const { result, rerender } = renderHook(({ ids }: { ids: string[] }) => useImagenesProductos(ids), { initialProps: { ids: ['a', 'b'] } })
      await waitFor(() => expect(result.current.get('a')).toBe('https://img/a.png'))
      vi.setSystemTime(Date.now() + 280_000)
      rerender({ ids: ['a', 'z'] })
      await waitFor(() => expect(result.current.get('z')).toBe('https://img/z.png'))
      expect(mocks.consultar.mock.calls[1][1]).toEqual(['a', 'z'])
    })

    it('mientras siguen vigentes no se vuelven a pedir aunque cambie la lista', async () => {
      const { result, rerender } = renderHook(({ ids }: { ids: string[] }) => useImagenesProductos(ids), { initialProps: { ids: ['a', 'b'] } })
      await waitFor(() => expect(result.current.get('a')).toBe('https://img/a.png'))
      rerender({ ids: ['a', 'z'] })
      await waitFor(() => expect(result.current.get('z')).toBe('https://img/z.png'))
      expect(mocks.consultar.mock.calls[1][1]).toEqual(['z'])
    })
  })
})
