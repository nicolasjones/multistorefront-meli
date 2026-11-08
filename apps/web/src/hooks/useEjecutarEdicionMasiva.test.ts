import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEjecutarEdicionMasiva } from './useEjecutarEdicionMasiva'

afterEach(() => vi.restoreAllMocks())

describe('useEjecutarEdicionMasiva', () => {
  it('devuelve el resultado, queda sin error y sin «en curso»', async () => {
    const { result } = renderHook(() => useEjecutarEdicionMasiva())
    let valor: number | null = -1
    await act(async () => { valor = await result.current.ejecutar(async () => 4) })
    expect(valor).toBe(4)
    expect(result.current.error).toBeNull()
    expect(result.current.enCurso).toBe(false)
  })

  it('marca «en curso» mientras corre', async () => {
    const { result } = renderHook(() => useEjecutarEdicionMasiva())
    let liberar: (n: number) => void = () => {}
    let promesa: Promise<number | null> = Promise.resolve(null)
    act(() => { promesa = result.current.ejecutar(() => new Promise<number>((resolver) => { liberar = resolver })) })
    expect(result.current.enCurso).toBe(true)
    await act(async () => { liberar(1); await promesa })
    expect(result.current.enCurso).toBe(false)
  })

  it.each([
    ['42501', /No tenés permiso/],
    ['P0002', /ya no existe/],
    ['22023', /no es válido/],
  ])('si la base responde %s devuelve null y muestra un mensaje claro', async (code, mensaje) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useEjecutarEdicionMasiva())
    let valor: number | null = 0
    await act(async () => { valor = await result.current.ejecutar(async () => { throw { code } }) })
    expect(valor).toBeNull()
    expect(result.current.error).toMatch(mensaje)
    act(() => result.current.limpiarError())
    expect(result.current.error).toBeNull()
  })
})
