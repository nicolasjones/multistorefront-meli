import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ErrorCuentaTienda } from '../lib/tiendaCuentaDatos'
import { useListadoPorCursor, type TandaPorCursor } from './useListadoPorCursor'

type Fila = { id: string }
const fila = (id: string): Fila => ({ id })

function montar(leer: (cursor: string | null) => Promise<TandaPorCursor<Fila, string>>, clave = 'a', alSinAcceso?: () => void) {
  return renderHook(({ clave: c }) => useListadoPorCursor<Fila, string>({ clave: c, leer, idDe: (f) => f.id, alSinAcceso }), { initialProps: { clave } })
}

// F-CLI-20 (Principio VI): carga infinita por cursor; cada tanda se suma, buscar/cambiar de consulta reinicia.
describe('useListadoPorCursor', () => {
  it('carga la primera tanda y suma la siguiente con el cursor devuelto', async () => {
    const leer = vi.fn()
      .mockResolvedValueOnce({ total: 3, filas: [fila('1'), fila('2')], siguiente: 'c2' })
      .mockResolvedValueOnce({ total: 3, filas: [fila('3')], siguiente: null })
    const { result } = montar(leer)
    expect(result.current.fase).toBe('cargando')
    await waitFor(() => expect(result.current.fase).toBe('lista'))
    expect(result.current.filas.map((f) => f.id)).toEqual(['1', '2'])
    expect(result.current.hayMas).toBe(true)
    expect(leer).toHaveBeenLastCalledWith(null)

    act(() => result.current.cargarMas())
    expect(result.current.cargandoMas).toBe(true)
    await waitFor(() => expect(result.current.cargandoMas).toBe(false))
    expect(leer).toHaveBeenLastCalledWith('c2')
    expect(result.current.filas.map((f) => f.id)).toEqual(['1', '2', '3'])
    expect(result.current.hayMas).toBe(false)
  })

  it('una fila que se corre de tanda no se repite y dos «cargar más» seguidos piden una sola vez', async () => {
    const leer = vi.fn()
      .mockResolvedValueOnce({ total: 3, filas: [fila('1'), fila('2')], siguiente: 'c2' })
      .mockResolvedValueOnce({ total: 3, filas: [fila('2'), fila('3')], siguiente: null })
    const { result } = montar(leer)
    await waitFor(() => expect(result.current.fase).toBe('lista'))
    act(() => { result.current.cargarMas(); result.current.cargarMas() })
    await waitFor(() => expect(result.current.cargandoMas).toBe(false))
    expect(leer).toHaveBeenCalledTimes(2)
    expect(result.current.filas.map((f) => f.id)).toEqual(['1', '2', '3'])
  })

  it('un error al pedir más conserva lo cargado y permite reintentar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const leer = vi.fn()
      .mockResolvedValueOnce({ total: 3, filas: [fila('1')], siguiente: 'c2' })
      .mockRejectedValueOnce(new Error('red'))
      .mockResolvedValueOnce({ total: 3, filas: [fila('2')], siguiente: null })
    const { result } = montar(leer)
    await waitFor(() => expect(result.current.fase).toBe('lista'))
    act(() => result.current.cargarMas())
    await waitFor(() => expect(result.current.errorMas).toBe(true))
    expect(result.current.filas.map((f) => f.id)).toEqual(['1'])
    act(() => result.current.cargarMas())
    await waitFor(() => expect(result.current.filas.map((f) => f.id)).toEqual(['1', '2']))
    expect(result.current.errorMas).toBe(false)
  })

  it('un error de la primera tanda es fase error y reintentar vuelve a pedirla', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const leer = vi.fn().mockRejectedValueOnce(new Error('red')).mockResolvedValueOnce({ total: 1, filas: [fila('1')], siguiente: null })
    const { result } = montar(leer)
    await waitFor(() => expect(result.current.fase).toBe('error'))
    act(() => result.current.reintentar())
    await waitFor(() => expect(result.current.fase).toBe('lista'))
    expect(result.current.filas).toHaveLength(1)
  })

  it('cambiar la clave descarta lo acumulado (nunca se mezcla lo de otra consulta)', async () => {
    const leer = vi.fn()
      .mockResolvedValueOnce({ total: 1, filas: [fila('a1')], siguiente: null })
      .mockResolvedValueOnce({ total: 1, filas: [fila('b1')], siguiente: null })
    const { result, rerender } = montar(leer, 'a')
    await waitFor(() => expect(result.current.filas.map((f) => f.id)).toEqual(['a1']))
    rerender({ clave: 'b' })
    expect(result.current.fase).toBe('cargando')
    expect(result.current.filas).toEqual([])
    await waitFor(() => expect(result.current.filas.map((f) => f.id)).toEqual(['b1']))
  })

  it('sin_acceso descarta todo y avisa a la pantalla (primera tanda y tandas siguientes)', async () => {
    const alSinAcceso = vi.fn()
    const leer = vi.fn()
      .mockResolvedValueOnce({ total: 2, filas: [fila('1')], siguiente: 'c2' })
      .mockRejectedValueOnce(new ErrorCuentaTienda('sin_acceso'))
    const { result } = montar(leer, 'a', alSinAcceso)
    await waitFor(() => expect(result.current.fase).toBe('lista'))
    act(() => result.current.cargarMas())
    await waitFor(() => expect(result.current.fase).toBe('sin_acceso'))
    expect(result.current.filas).toEqual([])
    expect(alSinAcceso).toHaveBeenCalledTimes(1)
  })

  it('el cupo de llamadas por cuenta (H-3) se distingue de una caída de red: expone el aviso con la espera', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const leer = vi.fn().mockRejectedValueOnce(new ErrorCuentaTienda('limite', 20))
    const { result } = montar(leer)
    await waitFor(() => expect(result.current.fase).toBe('error'))
    expect(result.current.espera).toEqual({ mensaje: 'Hiciste muchas consultas seguidas. Esperá 20 segundos y probá de nuevo.', segundos: 20 })
  })

  it('el cupo en una tanda siguiente deja lo cargado y expone el aviso con la espera', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const leer = vi.fn()
      .mockResolvedValueOnce({ total: 3, filas: [fila('1')], siguiente: 'c2' })
      .mockRejectedValueOnce(new ErrorCuentaTienda('limite', 30))
    const { result } = montar(leer)
    await waitFor(() => expect(result.current.fase).toBe('lista'))
    act(() => result.current.cargarMas())
    await waitFor(() => expect(result.current.errorMas).toBe(true))
    expect(result.current.filas.map((f) => f.id)).toEqual(['1'])
    expect(result.current.espera).toEqual({ mensaje: 'Hiciste muchas consultas seguidas. Esperá 30 segundos y probá de nuevo.', segundos: 30 })
  })

  it('un error de red no es un cupo: no hay aviso de espera', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const leer = vi.fn().mockRejectedValueOnce(new Error('red'))
    const { result } = montar(leer)
    await waitFor(() => expect(result.current.fase).toBe('error'))
    expect(result.current.espera).toBeNull()
  })

  it('quitar saca una fila y baja el total; reponer la devuelve en su lugar', async () => {
    const leer = vi.fn().mockResolvedValue({ total: 3, filas: [fila('1'), fila('2'), fila('3')], siguiente: null })
    const { result } = montar(leer)
    await waitFor(() => expect(result.current.fase).toBe('lista'))
    let quitado: ReturnType<typeof result.current.quitar> = null
    act(() => { quitado = result.current.quitar('2') })
    expect(result.current.filas.map((f) => f.id)).toEqual(['1', '3'])
    expect(result.current.total).toBe(2)
    expect(quitado).toEqual({ fila: fila('2'), indice: 1 })
    act(() => result.current.reponer(fila('2'), 1))
    expect(result.current.filas.map((f) => f.id)).toEqual(['1', '2', '3'])
    expect(result.current.total).toBe(3)
    act(() => result.current.reponer(fila('2'), 1))
    expect(result.current.filas).toHaveLength(3)
  })
})
