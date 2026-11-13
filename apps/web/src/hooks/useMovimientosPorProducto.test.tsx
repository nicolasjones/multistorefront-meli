import { renderHook, waitFor, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Hallazgo D-1 de la revisión final: el total conservado de una tanda que falla solo puede venir de la respuesta VIGENTE.
const mocks = vi.hoisted(() => ({ leer: vi.fn() }))
vi.mock('../lib/inicioBloques', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/inicioBloques')>()), leerMovimientosPorProducto: mocks.leer }))
vi.mock('./useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1' } }) }))

import { useMovimientosPorProducto } from './useMovimientosPorProducto'

const CONTEXTO = { desde: '2026-10-01', hasta: '2026-10-31', empresaId: null as string | null, depositoId: null as string | null }
const filtros = (busqueda: string) => ({ busqueda, categoriaId: null as string | null, vista: 'todos' as const, orden: 'nombre' as const, direccion: 'asc' as const })
const fila = (n: number) => ({
  productoId: `p-${n}`, nombre: `Producto ${n}`, sku: null, categoria: 'X', stockInicial: 1, entradas: 0, salidas: 0, ajustes: 0,
  stockActual: 1, minimo: 0, ventas: null, ultimoMovimiento: null, estado: 'normal' as const,
})
const diferida = <T,>() => {
  let resolver!: (valor: T) => void
  const promesa = new Promise<T>((resolve) => { resolver = resolve })
  return { promesa, resolver }
}

beforeEach(() => { mocks.leer.mockReset() })

describe('useMovimientosPorProducto · total conservado', () => {
  it('una respuesta vieja descartada no deja su total para una tanda que falla en la consulta nueva', async () => {
    const A = diferida<{ filas: ReturnType<typeof fila>[]; total: number }>()
    const B = diferida<{ filas: ReturnType<typeof fila>[]; total: number }>()
    mocks.leer.mockImplementation((_ctx, f: { busqueda: string }, pagina: number) => {
      if (f.busqueda === 'a') return A.promesa
      if (pagina === 1) return B.promesa
      return Promise.reject(new Error('tanda 2 falla'))
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { result, rerender } = renderHook(({ busqueda, pagina }) => useMovimientosPorProducto(CONTEXTO, filtros(busqueda), pagina), {
      initialProps: { busqueda: 'a', pagina: 1 },
    })
    rerender({ busqueda: 'b', pagina: 1 })
    await act(async () => { B.resolver({ filas: [fila(1)], total: 30 }) })
    await waitFor(() => expect(result.current.total).toBe(30))
    // La respuesta de la consulta vieja llega DESPUÉS y se descarta: su total (99) no debe quedar guardado.
    await act(async () => { A.resolver({ filas: [fila(2)], total: 99 }) })
    rerender({ busqueda: 'b', pagina: 2 })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.total).toBe(30)
  })

  it('si falla la segunda tanda conserva el total de la primera de la misma consulta', async () => {
    mocks.leer.mockImplementation(async (_ctx, _f, pagina: number) => {
      if (pagina === 1) return { filas: [fila(1)], total: 30 }
      throw new Error('tanda 2 falla')
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { result, rerender } = renderHook(({ pagina }) => useMovimientosPorProducto(CONTEXTO, filtros('x'), pagina), { initialProps: { pagina: 1 } })
    await waitFor(() => expect(result.current.total).toBe(30))
    rerender({ pagina: 2 })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.total).toBe(30)
  })
})
