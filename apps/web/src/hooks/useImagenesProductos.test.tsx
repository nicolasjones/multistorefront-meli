import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ consultar: vi.fn() }))
vi.mock('../lib/imagenesPrincipales', () => ({ consultarImagenesPrincipales: mocks.consultar }))
vi.mock('../lib/supabase', () => ({ supabaseClient: {} }))

import { useImagenesProductos, useImagenesProductosRenovables } from './useImagenesProductos'

const resultado = (ids: string[], fallidos: string[] = []) => ({
  urls: new Map(ids.filter((id) => id !== 'sin-foto' && !fallidos.includes(id)).map((id) => [id, `https://img/${id}.png`])),
  fallidos: new Set(fallidos),
})

describe('useImagenesProductos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.consultar.mockImplementation(async (_cliente: unknown, ids: string[]) => resultado(ids))
  })
  afterEach(() => vi.useRealTimers())

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
    it('al sumar una tanda AL FINAL pasados los 270 s pide SOLO los ids nuevos (no re-firma lo ya cargado)', async () => {
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

    it('un SUPERCONJUNTO en otro orden (de «En alerta» a «Todos») no es una ampliación: renueva las vencidas', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      const { result, rerender } = renderHook(({ ids }: { ids: string[] }) => useImagenesProductos(ids), { initialProps: { ids: ['a', 'b'] } })
      await waitFor(() => expect(result.current.get('a')).toBe('https://img/a.png'))
      vi.setSystemTime(Date.now() + 280_000)
      // «Todos» trae un producto nuevo ENTRE medio: los anteriores no son un prefijo, las filas se montan de nuevo.
      rerender({ ids: ['a', 'x', 'b'] })
      await waitFor(() => expect(result.current.get('x')).toBe('https://img/x.png'))
      expect(mocks.consultar.mock.calls[1][1]).toEqual(['a', 'x', 'b'])
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

  describe('bloques caídos', () => {
    it('los ids de un bloque que falló NO se anotan como «sin imagen»: se reintentan en el siguiente cambio de lista', async () => {
      mocks.consultar.mockImplementationOnce(async (_c: unknown, ids: string[]) => resultado(ids, ['b']))
      const { result, rerender } = renderHook(({ ids }: { ids: string[] }) => useImagenesProductos(ids), { initialProps: { ids: ['a', 'b'] } })
      await waitFor(() => expect(result.current.get('a')).toBe('https://img/a.png'))
      expect(result.current.has('b')).toBe(false)
      // Sumar una tanda cambia la clave: 'b' nunca quedó anotado, así que se vuelve a pedir (junto con lo nuevo).
      rerender({ ids: ['a', 'b', 'c'] })
      await waitFor(() => expect(result.current.get('b')).toBe('https://img/b.png'))
      expect(mocks.consultar.mock.calls[1][1]).toEqual(['b', 'c'])
    })

    it('sin cambio de lista no hay reintento en bucle', async () => {
      mocks.consultar.mockImplementation(async (_c: unknown, ids: string[]) => resultado(ids, ids))
      const { rerender } = renderHook(({ ids }: { ids: string[] }) => useImagenesProductos(ids), { initialProps: { ids: ['a', 'b'] } })
      await waitFor(() => expect(mocks.consultar).toHaveBeenCalledTimes(1))
      rerender({ ids: ['a', 'b'] })
      rerender({ ids: ['a', 'b'] })
      await new Promise((r) => setTimeout(r, 30))
      expect(mocks.consultar).toHaveBeenCalledTimes(1)
    })
  })

  describe('renovar una imagen que no cargó (URL vencida antes del scroll)', () => {
    it('pide una URL nueva para ese id y la deja en el mapa', async () => {
      let n = 0
      mocks.consultar.mockImplementation(async (_c: unknown, ids: string[]) => ({ urls: new Map(ids.map((id) => [id, `https://img/${id}-${++n}.png`])), fallidos: new Set<string>() }))
      const { result } = renderHook(() => useImagenesProductosRenovables(['a']))
      await waitFor(() => expect(result.current.imagenes.get('a')).toBe('https://img/a-1.png'))
      act(() => result.current.renovar('a'))
      await waitFor(() => expect(result.current.imagenes.get('a')).toBe('https://img/a-2.png'))
      expect(mocks.consultar.mock.calls[1][1]).toEqual(['a'])
    })

    it('UNA sola vez por id (tope): una segunda falla no entra en bucle', async () => {
      const { result } = renderHook(() => useImagenesProductosRenovables(['a']))
      await waitFor(() => expect(result.current.imagenes.get('a')).toBeDefined())
      act(() => result.current.renovar('a'))
      act(() => result.current.renovar('a'))
      act(() => result.current.renovar('a'))
      await waitFor(() => expect(mocks.consultar).toHaveBeenCalledTimes(2))
      await new Promise((r) => setTimeout(r, 30))
      expect(mocks.consultar).toHaveBeenCalledTimes(2)
    })

    it('si la renovación falla, no rompe ni cambia el mapa', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const { result } = renderHook(() => useImagenesProductosRenovables(['a']))
      await waitFor(() => expect(result.current.imagenes.get('a')).toBe('https://img/a.png'))
      mocks.consultar.mockRejectedValueOnce(new Error('boom'))
      act(() => result.current.renovar('a'))
      await new Promise((r) => setTimeout(r, 30))
      expect(result.current.imagenes.get('a')).toBe('https://img/a.png')
    })
  })
})
