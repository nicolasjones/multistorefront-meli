import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FiltrosGastos } from '../lib/gastos'

// El hook corre REAL, con la RPC de Supabase simulada: se prueba la carga por tandas, el cursor, el reinicio y el descarte de
// respuestas tardías, no un mock del hook.
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { useGastos } from './useGastos'

const fila = (n: number) => ({
  id: `g${String(n).padStart(3, '0')}`, empresa_id: 'e1', empresa_nombre: 'San Javucho', fecha: `2026-11-${String(30 - (n % 28)).padStart(2, '0')}`,
  categoria: 'Servicios', tipo_costo: 'fijo', detalle: null, importe: 100, moneda: 'ARS', cotizacion_usada: null, importe_pesos: 100,
  recurrente: false, anulado_en: null, motivo_anulacion: null, updated_at: '2026-11-01T10:00:00Z',
})
const tanda = (desde: number, cantidad: number) => Array.from({ length: cantidad }, (_, i) => fila(desde + i))
const resumenDe = (total: number) => ({ total, conteo: 1, conteo_anulados: 0, desglose: [] })

const FILTROS: FiltrosGastos = { desde: '2026-11-01', hasta: '2026-11-30', empresaId: 'e1', categoria: null, tipoCosto: null }

type Resolver<T> = { promesa: Promise<T>; resolver: (v: T) => void; rechazar: (e: unknown) => void }
const diferida = <T,>(): Resolver<T> => {
  let resolver!: (v: T) => void
  let rechazar!: (e: unknown) => void
  const promesa = new Promise<T>((res, rej) => { resolver = res; rechazar = rej })
  return { promesa, resolver, rechazar }
}

const llamadas = (nombre: string) => mocks.rpc.mock.calls.filter(([n]) => n === nombre).map(([, args]) => args as Record<string, unknown>)

describe('useGastos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rpc.mockImplementation(async (nombre: string) => ({ data: nombre === 'resumen_gastos' ? resumenDe(100) : tanda(0, 3), error: null }))
  })

  it('una tanda completa de 25 indica que hay más y una incompleta que no', async () => {
    mocks.rpc.mockImplementation(async (nombre: string) => ({ data: nombre === 'resumen_gastos' ? resumenDe(2500) : tanda(0, 25), error: null }))
    const { result, unmount } = renderHook(() => useGastos(FILTROS, false))
    await waitFor(() => expect(result.current.cargando).toBe(false))
    expect(result.current.filas).toHaveLength(25)
    expect(result.current.hayMas).toBe(true)
    expect(result.current.resumen?.total).toBe(2500)
    unmount()

    mocks.rpc.mockImplementation(async (nombre: string) => ({ data: nombre === 'resumen_gastos' ? resumenDe(300) : tanda(0, 24), error: null }))
    const otro = renderHook(() => useGastos(FILTROS, false))
    await waitFor(() => expect(otro.result.current.cargando).toBe(false))
    expect(otro.result.current.hayMas).toBe(false)
  })

  it('«cargar más» envía el cursor de la última fila, agrega la tanda y termina cuando es incompleta', async () => {
    mocks.rpc.mockImplementation(async (nombre: string, args: Record<string, unknown>) => {
      if (nombre === 'resumen_gastos') return { data: resumenDe(100), error: null }
      return { data: args.p_cursor_id ? tanda(25, 5) : tanda(0, 25), error: null }
    })
    const { result } = renderHook(() => useGastos(FILTROS, false))
    await waitFor(() => expect(result.current.hayMas).toBe(true))
    const ultima = result.current.filas[24]
    await act(async () => { await result.current.cargarMas() })
    const conCursor = llamadas('listar_gastos').find((a) => a.p_cursor_id)
    expect(conCursor).toMatchObject({ p_cursor_id: ultima.id, p_cursor_fecha: ultima.fecha, p_empresa: 'e1', p_incluir_anulados: false })
    expect(result.current.filas).toHaveLength(30)
    expect(result.current.hayMas).toBe(false)
    expect(result.current.errorTanda).toBe(false)
  })

  it('un error al pedir una tanda conserva lo cargado, avisa y permite reintentar con el mismo cursor', async () => {
    mocks.rpc.mockImplementation(async (nombre: string) => ({ data: nombre === 'resumen_gastos' ? resumenDe(100) : tanda(0, 25), error: null }))
    const { result } = renderHook(() => useGastos(FILTROS, false))
    await waitFor(() => expect(result.current.hayMas).toBe(true))
    mocks.rpc.mockImplementationOnce(async () => ({ data: null, error: { code: '57014', message: 'timeout' } }))
    await act(async () => { await result.current.cargarMas() })
    expect(result.current.errorTanda).toBe(true)
    expect(result.current.filas).toHaveLength(25)
    expect(result.current.hayError).toBe(false)
    expect(result.current.cargandoMas).toBe(false)
    mocks.rpc.mockImplementation(async (nombre: string, args: Record<string, unknown>) => ({
      data: nombre === 'resumen_gastos' ? resumenDe(100) : (args.p_cursor_id ? tanda(25, 2) : tanda(0, 25)), error: null,
    }))
    await act(async () => { await result.current.cargarMas() })
    expect(result.current.errorTanda).toBe(false)
    expect(result.current.filas).toHaveLength(27)
  })

  it('un error en la primera consulta deja la lista vacía con error y «recargar» reintenta', async () => {
    mocks.rpc.mockImplementation(async () => ({ data: null, error: { code: '500', message: 'boom' } }))
    const { result } = renderHook(() => useGastos(FILTROS, false))
    await waitFor(() => expect(result.current.hayError).toBe(true))
    expect(result.current.filas).toEqual([])
    expect(result.current.resumen).toBeNull()
    mocks.rpc.mockImplementation(async (nombre: string) => ({ data: nombre === 'resumen_gastos' ? resumenDe(100) : tanda(0, 3), error: null }))
    await act(async () => { await result.current.recargar() })
    expect(result.current.hayError).toBe(false)
    expect(result.current.filas).toHaveLength(3)
  })

  it('cambiar el filtro o la empresa reinicia desde la primera tanda, vacía lo viejo y descarta la respuesta tardía', async () => {
    const lenta = diferida<{ data: unknown; error: null }>()
    const { result, rerender } = renderHook(({ filtros, anulados }: { filtros: FiltrosGastos; anulados: boolean }) => useGastos(filtros, anulados), {
      initialProps: { filtros: FILTROS, anulados: false },
    })
    await waitFor(() => expect(result.current.cargando).toBe(false))
    expect(result.current.filas).toHaveLength(3)

    // Cambia la empresa y la respuesta de la anterior está en vuelo: la nueva gana aunque la vieja llegue después.
    mocks.rpc.mockImplementation(async (nombre: string, args: Record<string, unknown>) => {
      if (args.p_empresa === 'e2') return nombre === 'resumen_gastos' ? { data: resumenDe(777), error: null } : { data: [fila(50)], error: null }
      return lenta.promesa
    })
    rerender({ filtros: { ...FILTROS, empresaId: 'e3' }, anulados: false })
    // Con la consulta nueva en curso no queda nada de la anterior visible (ni filas, ni resumen).
    await waitFor(() => expect(result.current.cargando).toBe(true))
    expect(result.current.filas).toEqual([])
    expect(result.current.resumen).toBeNull()
    rerender({ filtros: { ...FILTROS, empresaId: 'e2' }, anulados: false })
    await waitFor(() => expect(result.current.filas).toHaveLength(1))
    expect(result.current.resumen?.total).toBe(777)
    await act(async () => { lenta.resolver({ data: tanda(100, 9), error: null }) })
    expect(result.current.filas).toHaveLength(1)
    expect(result.current.filas[0].id).toBe('g050')
    expect(result.current.resumen?.total).toBe(777)
    expect(llamadas('listar_gastos').at(-1)).toMatchObject({ p_empresa: 'e2', p_cursor_id: null })

    // «Mostrar anulados» también reinicia con el parámetro nuevo.
    rerender({ filtros: { ...FILTROS, empresaId: 'e2' }, anulados: true })
    await waitFor(() => expect(llamadas('listar_gastos').at(-1)).toMatchObject({ p_incluir_anulados: true, p_cursor_id: null }))
  })

  it('una tanda de «cargar más» que llega después de cambiar el filtro se descarta y no deja «cargando más» colgado', async () => {
    const tardia = diferida<{ data: unknown; error: null }>()
    mocks.rpc.mockImplementation(async (nombre: string) => ({ data: nombre === 'resumen_gastos' ? resumenDe(100) : tanda(0, 25), error: null }))
    const { result, rerender } = renderHook(({ filtros }: { filtros: FiltrosGastos }) => useGastos(filtros, false), { initialProps: { filtros: FILTROS } })
    await waitFor(() => expect(result.current.hayMas).toBe(true))
    mocks.rpc.mockImplementation(async (nombre: string, args: Record<string, unknown>) => {
      if (nombre === 'listar_gastos' && args.p_cursor_id) return tardia.promesa
      return { data: nombre === 'resumen_gastos' ? resumenDe(5) : tanda(200, 2), error: null }
    })
    act(() => { void result.current.cargarMas() })
    await waitFor(() => expect(result.current.cargandoMas).toBe(true))
    rerender({ filtros: { ...FILTROS, categoria: 'Alquiler' } })
    await waitFor(() => expect(result.current.filas).toHaveLength(2))
    await act(async () => { tardia.resolver({ data: tanda(900, 25), error: null }) })
    expect(result.current.filas).toHaveLength(2)
    expect(result.current.cargandoMas).toBe(false)
    expect(result.current.hayMas).toBe(false)
  })

  it('recargar con la misma consulta (tras guardar) conserva las filas hasta que llega la respuesta', async () => {
    const { result } = renderHook(() => useGastos(FILTROS, false))
    await waitFor(() => expect(result.current.cargando).toBe(false))
    const nueva = diferida<{ data: unknown; error: null }>()
    mocks.rpc.mockImplementation(async (nombre: string) => (nombre === 'listar_gastos' ? nueva.promesa : { data: resumenDe(1), error: null }))
    act(() => { void result.current.recargar() })
    expect(result.current.filas).toHaveLength(3)
    await act(async () => { nueva.resolver({ data: tanda(0, 1), error: null }) })
    await waitFor(() => expect(result.current.filas).toHaveLength(1))
  })
})
