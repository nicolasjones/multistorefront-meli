import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useListadoAcumulado, useListadoLocal } from './useListadoAcumulado'

const lote = (desde: number, cantidad: number) => Array.from({ length: cantidad }, (_, i) => desde + i)

type Props = { items: number[]; pagina: number; cargando: boolean; reinicio: string }

describe('useListadoAcumulado', () => {
  it('suma cada página a la anterior y no duplica la página vieja mientras carga la siguiente', () => {
    const setPagina = vi.fn()
    const A = lote(1, 25)
    const B = lote(26, 25)
    const inicial: Props = { items: A, pagina: 1, cargando: false, reinicio: '' }
    const { result, rerender } = renderHook((p: Props) => useListadoAcumulado({ ...p, total: 60, setPagina }), { initialProps: inicial })
    expect(result.current.filas).toEqual(A)
    expect(result.current.hayMas).toBe(true)

    act(() => result.current.cargarMas())
    expect(setPagina).toHaveBeenCalledWith(2)

    // Render previo a que empiece a cargar: pagina=2 pero `items` sigue siendo la página 1.
    rerender({ ...inicial, pagina: 2 })
    expect(result.current.filas).toEqual(A)
    rerender({ ...inicial, pagina: 2, cargando: true })
    expect(result.current.filas).toEqual(A)
    expect(result.current.cargandoMas).toBe(true)

    rerender({ items: B, pagina: 2, cargando: false, reinicio: '' })
    expect(result.current.filas).toEqual([...A, ...B])
    expect(result.current.cargandoMas).toBe(false)
  })

  it('no entra en bucle aunque `items` sea un arreglo nuevo en cada render', () => {
    const { result } = renderHook(() => useListadoAcumulado({ items: lote(1, 25), pagina: 1, setPagina: vi.fn(), total: 60, cargando: false, reinicio: '' }))
    expect(result.current.filas).toHaveLength(25)
    expect(result.current.hayMas).toBe(true)
  })

  it('una tanda vacía (se borraron filas) deja de ofrecer más', () => {
    const A = lote(1, 25)
    const setPagina = vi.fn()
    const base: Props = { items: A, pagina: 1, cargando: false, reinicio: '' }
    const { result, rerender } = renderHook((p: Props) => useListadoAcumulado({ ...p, total: 60, setPagina }), { initialProps: base })
    act(() => result.current.cargarMas())
    rerender({ ...base, pagina: 2, cargando: true })
    const vacia: number[] = []
    rerender({ items: vacia, pagina: 2, cargando: false, reinicio: '' })
    expect(result.current.filas).toEqual(A)
    expect(result.current.hayMas).toBe(false)
  })

  it('cuando se acumuló todo el total ya no hay más', () => {
    const items = lote(1, 3)
    const { result } = renderHook(() => useListadoAcumulado({ items, pagina: 1, setPagina: vi.fn(), total: 3, cargando: false, reinicio: '' }))
    expect(result.current.hayMas).toBe(false)
  })

  it('no pide otra tanda mientras ya está cargando', () => {
    const setPagina = vi.fn()
    const items = lote(1, 25)
    const { result } = renderHook(() => useListadoAcumulado({ items, pagina: 1, setPagina, total: 60, cargando: true, reinicio: '' }))
    act(() => result.current.cargarMas())
    expect(setPagina).not.toHaveBeenCalled()
  })

  it('al cambiar la búsqueda o un filtro descarta lo acumulado y vuelve a la página 1', () => {
    const setPagina = vi.fn()
    const A = lote(1, 25)
    const B = lote(26, 25)
    const { result, rerender } = renderHook((p: Props) => useListadoAcumulado({ ...p, total: 60, setPagina }), {
      initialProps: { items: A, pagina: 1, cargando: false, reinicio: 'a' } as Props,
    })
    act(() => result.current.cargarMas())
    rerender({ items: A, pagina: 2, cargando: true, reinicio: 'a' })
    rerender({ items: B, pagina: 2, cargando: false, reinicio: 'a' })
    expect(result.current.filas).toEqual([...A, ...B])

    // Cambia el filtro estando en la página 2 (los items todavía son los viejos).
    rerender({ items: B, pagina: 2, cargando: false, reinicio: 'b' })
    expect(setPagina).toHaveBeenCalledWith(1)
    const C = lote(100, 10)
    rerender({ items: B, pagina: 1, cargando: true, reinicio: 'b' })
    rerender({ items: C, pagina: 1, cargando: false, reinicio: 'b' })
    expect(result.current.filas).toEqual(C)
  })
})

describe('useListadoLocal', () => {
  it('muestra de a tandas y hay más hasta mostrar todo', () => {
    const items = lote(1, 60)
    const { result } = renderHook(() => useListadoLocal(items, 25))
    expect(result.current.filas).toHaveLength(25)
    expect(result.current.hayMas).toBe(true)
    act(() => result.current.cargarMas())
    act(() => result.current.cargarMas())
    expect(result.current.filas).toHaveLength(60)
    expect(result.current.hayMas).toBe(false)
  })

  it('cambiar el criterio vuelve a la primera tanda', () => {
    const items = lote(1, 60)
    const { result, rerender } = renderHook(({ r }: { r: string }) => useListadoLocal(items, 25, r), { initialProps: { r: 'a' } })
    act(() => result.current.cargarMas())
    expect(result.current.filas).toHaveLength(50)
    rerender({ r: 'b' })
    expect(result.current.filas).toHaveLength(25)
  })
})
