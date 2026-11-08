import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MAXIMO_SELECCION, useSeleccionProductos } from './useSeleccionProductos'

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p-${i}`)

describe('useSeleccionProductos', () => {
  it('«Seleccionar todos» marca como mucho 100 filas cargadas', () => {
    const visibles = ids(130)
    const { result } = renderHook(() => useSeleccionProductos('ctx', visibles))
    act(() => result.current.alternarTodos())
    expect(result.current.cantidad).toBe(MAXIMO_SELECCION)
    expect(result.current.todosMarcados).toBe(true)
  })

  it('a mano tampoco pasa de 100', () => {
    const visibles = ids(105)
    const { result } = renderHook(() => useSeleccionProductos('ctx', visibles))
    act(() => result.current.alternarTodos())
    act(() => result.current.alternar('p-104'))
    expect(result.current.cantidad).toBe(MAXIMO_SELECCION)
    act(() => result.current.alternar('p-0'))
    act(() => result.current.alternar('p-104'))
    expect(result.current.ids.has('p-104')).toBe(true)
  })

  it('cambiar el contexto descarta la selección', () => {
    const visibles = ids(3)
    const { result, rerender } = renderHook(({ c }) => useSeleccionProductos(c, visibles), { initialProps: { c: 'a' } })
    act(() => result.current.alternarTodos())
    expect(result.current.cantidad).toBe(3)
    rerender({ c: 'b' })
    expect(result.current.cantidad).toBe(0)
  })
})

describe('useSeleccionProductos: bordes', () => {
  it('sin filas visibles (lista vacía) «Seleccionar todos» no marca nada', () => {
    const { result } = renderHook(() => useSeleccionProductos('ctx', []))
    act(() => result.current.alternarTodos())
    expect(result.current.cantidad).toBe(0)
    expect(result.current.todosMarcados).toBe(false)
  })

  it('marcar dos veces el mismo id lo desmarca: nunca hay ids duplicados', () => {
    const visibles = ids(3)
    const { result } = renderHook(() => useSeleccionProductos('ctx', visibles))
    act(() => result.current.alternar('p-1'))
    act(() => result.current.alternar('p-1'))
    expect(result.current.cantidad).toBe(0)
    act(() => result.current.alternar('p-1'))
    expect(result.current.cantidad).toBe(1)
  })
})
