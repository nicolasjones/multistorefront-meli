import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  productos: vi.fn(),
  proveedores: vi.fn(),
  or: vi.fn(),
  limite: vi.fn(),
}))

// Consulta encadenable: cada método devuelve la misma consulta y `returns` entrega el resultado.
const consulta = (resultado: () => unknown) => {
  const q: Record<string, unknown> = {}
  for (const metodo of ['select', 'eq', 'order']) q[metodo] = () => q
  q.or = (...argumentos: unknown[]) => { mocks.or(...argumentos); return q }
  q.limit = (tope: number) => { mocks.limite(tope); return q }
  q.returns = () => resultado()
  return q
}

vi.mock('../lib/supabase', () => ({
  supabaseClient: {
    schema: () => ({
      from: (tabla: string) => consulta(() => (tabla === 'proveedores' ? mocks.proveedores() : mocks.productos())),
    }),
  },
}))

import { avisoCatalogoTruncado, filtroBusquedaCatalogo, MAXIMO_OPCIONES_CATALOGO, useBuscadorCatalogo } from './useBuscadorCatalogo'

const producto = (indice: number) => ({ id: `p-${indice}`, nombre: `Producto ${indice}`, sku: null, proveedor_id: null })

describe('filtroBusquedaCatalogo', () => {
  it('arma el filtro «contiene» por las columnas indicadas', () => {
    expect(filtroBusquedaCatalogo('joy', ['nombre', 'sku'])).toBe('nombre.ilike.%joy%,sku.ilike.%joy%')
  })

  it('quita los caracteres que alterarían el filtro y escapa los comodines de LIKE', () => {
    expect(filtroBusquedaCatalogo('a,b(c)"d\\e*f', ['nombre'])).toBe('nombre.ilike.%a b c  d e f%')
    expect(filtroBusquedaCatalogo('100%_x', ['nombre'])).toBe('nombre.ilike.%100\\%\\_x%')
  })

  it('devuelve null cuando no hay texto útil', () => {
    expect(filtroBusquedaCatalogo('', ['nombre'])).toBeNull()
    expect(filtroBusquedaCatalogo('   ', ['nombre'])).toBeNull()
    expect(filtroBusquedaCatalogo(',()', ['nombre'])).toBeNull()
  })
})

describe('avisoCatalogoTruncado', () => {
  it('anuncia el tope y cómo buscar el resto', () => {
    expect(avisoCatalogoTruncado('productos')).toBe('Hay más de 500 productos: escribí para buscar el que necesitás.')
  })
})

describe('useBuscadorCatalogo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.productos.mockResolvedValue({ data: [producto(1)], error: null })
    mocks.proveedores.mockResolvedValue({ data: [{ id: 'pr-1', razon_social: 'Proveedor Uno' }], error: null })
  })

  it('no consulta nada hasta que se habilita', async () => {
    const { result, rerender } = renderHook(({ habilitado }) => useBuscadorCatalogo<{ id: string }>({
      tabla: 'productos', columnas: 'id, nombre', columnasBusqueda: 'nombre', orden: 'nombre', habilitado,
    }), { initialProps: { habilitado: false } })
    await Promise.resolve()
    expect(mocks.productos).not.toHaveBeenCalled()
    rerender({ habilitado: true })
    await waitFor(() => expect(result.current.opciones).toHaveLength(1))
    expect(mocks.productos).toHaveBeenCalled()
  })

  it('trae el catálogo completo y avisa cuando se cortó', async () => {
    mocks.productos.mockResolvedValue({ data: Array.from({ length: MAXIMO_OPCIONES_CATALOGO + 1 }, (_, i) => producto(i)), error: null })
    const { result } = renderHook(() => useBuscadorCatalogo<{ id: string }>({
      tabla: 'productos', columnas: 'id, nombre', columnasBusqueda: 'nombre', orden: 'nombre', habilitado: true,
    }))
    await waitFor(() => expect(result.current.truncado).toBe(true))
    expect(result.current.opciones).toHaveLength(MAXIMO_OPCIONES_CATALOGO)
    // Una fila de más para detectar el corte.
    expect(mocks.limite).toHaveBeenCalledWith(MAXIMO_OPCIONES_CATALOGO + 1)
  })

  it('no avisa cuando el catálogo entra entero', async () => {
    mocks.productos.mockResolvedValue({ data: Array.from({ length: MAXIMO_OPCIONES_CATALOGO }, (_, i) => producto(i)), error: null })
    const { result } = renderHook(() => useBuscadorCatalogo<{ id: string }>({
      tabla: 'productos', columnas: 'id, nombre', columnasBusqueda: 'nombre', orden: 'nombre', habilitado: true,
    }))
    await waitFor(() => expect(result.current.opciones).toHaveLength(MAXIMO_OPCIONES_CATALOGO))
    expect(result.current.truncado).toBe(false)
  })

  it('busca en el servidor por las columnas indicadas', async () => {
    const { result } = renderHook(() => useBuscadorCatalogo<{ id: string }>({
      tabla: 'productos', columnas: 'id, nombre, sku', columnasBusqueda: 'nombre,sku', orden: 'nombre', habilitado: true,
    }))
    await waitFor(() => expect(result.current.opciones).toHaveLength(1))
    expect(mocks.or).not.toHaveBeenCalled()
    act(() => { result.current.buscar('joy') })
    await waitFor(() => expect(mocks.or).toHaveBeenCalledWith('nombre.ilike.%joy%,sku.ilike.%joy%'))
  })

  it('descarta la respuesta de una búsqueda anterior', async () => {
    let resolver: (valor: unknown) => void = () => undefined
    mocks.productos.mockReturnValueOnce(new Promise((resolve) => { resolver = resolve }))
    const { result } = renderHook(() => useBuscadorCatalogo<{ id: string; nombre: string }>({
      tabla: 'productos', columnas: 'id, nombre', columnasBusqueda: 'nombre', orden: 'nombre', habilitado: true,
    }))
    await waitFor(() => expect(mocks.productos).toHaveBeenCalledTimes(1))
    act(() => { result.current.buscar('a') })
    await waitFor(() => expect(mocks.productos).toHaveBeenCalledTimes(2))
    mocks.productos.mockResolvedValue({ data: [{ id: 'nuevo', nombre: 'Nuevo' }], error: null })
    act(() => { result.current.buscar('ab') })
    await waitFor(() => expect(result.current.opciones).toEqual([{ id: 'nuevo', nombre: 'Nuevo' }]))
    // La respuesta vieja llega tarde: no puede pisar la de la búsqueda vigente.
    resolver({ data: [{ id: 'viejo', nombre: 'Viejo' }], error: null })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(result.current.opciones).toEqual([{ id: 'nuevo', nombre: 'Nuevo' }])
  })

  it('marca el error cuando la consulta falla', async () => {
    mocks.productos.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const { result } = renderHook(() => useBuscadorCatalogo<{ id: string }>({
      tabla: 'productos', columnas: 'id, nombre', columnasBusqueda: 'nombre', orden: 'nombre', habilitado: true,
    }))
    await waitFor(() => expect(result.current.error).toBe(true))
    expect(result.current.opciones).toEqual([])
  })

  it('filtra por los proveedores activos con su razón social', async () => {
    const { result } = renderHook(() => useBuscadorCatalogo<{ id: string }>({
      tabla: 'proveedores', columnas: 'id, razon_social', columnasBusqueda: 'razon_social', orden: 'razon_social', soloActivos: true, habilitado: true,
    }))
    await waitFor(() => expect(result.current.opciones).toHaveLength(1))
    act(() => { result.current.buscar('demo') })
    await waitFor(() => expect(mocks.or).toHaveBeenCalledWith('razon_social.ilike.%demo%'))
  })
})
