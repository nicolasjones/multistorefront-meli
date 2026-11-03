import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  productos: vi.fn(),
  clientes: vi.fn(),
  or: vi.fn(),
  categorias: vi.fn(),
  organizacion: { id: 'org-1' } as { id: string } | null,
}))

// Consulta encadenable: cada método devuelve la misma consulta y `returns` entrega el resultado.
const consulta = (resultado: () => unknown, orMock?: (...args: unknown[]) => void) => {
  const q: Record<string, unknown> = {}
  for (const metodo of ['select', 'order', 'limit', 'not']) q[metodo] = () => q
  q.or = (...args: unknown[]) => { orMock?.(...args); return q }
  q.returns = () => resultado()
  return q
}

vi.mock('../lib/supabase', () => ({
  supabaseClient: {
    schema: () => ({ from: () => consulta(() => mocks.productos(), mocks.or) }),
    from: () => consulta(() => mocks.clientes()),
  },
}))
vi.mock('./useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: mocks.organizacion }) }))
vi.mock('./useCategorias', () => ({ useCategorias: (opciones: unknown) => mocks.categorias(opciones) }))

import { provinciasDistintas, useOpcionesDimension } from './useOpcionesDimension'

describe('provinciasDistintas', () => {
  it('une grafías con distinta mayúscula o tilde, descarta vacíos y ordena', () => {
    expect(provinciasDistintas(['Córdoba', 'CORDOBA', ' santa fe ', null, '', 'Buenos Aires', 'cordoba']))
      .toEqual(['Buenos Aires', 'Córdoba', 'santa fe'])
  })
})

describe('useOpcionesDimension', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.organizacion = { id: 'org-1' }
    mocks.productos.mockResolvedValue({ data: [{ id: 'p-1', nombre: 'Auricular', sku: 'AUR-1' }], error: null })
    mocks.clientes.mockResolvedValue({ data: [{ provincia: 'Córdoba' }, { provincia: 'CORDOBA' }, { provincia: 'Santa Fe' }], error: null })
    mocks.categorias.mockReturnValue({
      categorias: [
        { id: 'k-1', nombre: 'Audio', padre_id: null, posicion: 0, empresa_ids: [] },
        { id: 'k-2', nombre: 'Cables', padre_id: 'k-1', posicion: 0, empresa_ids: [] },
      ],
      isLoading: false, isError: false,
    })
  })

  it('carga productos, categorías con su ruta y provincias distintas, sin identificadores a la vista', async () => {
    const { result } = renderHook(() => useOpcionesDimension({ busquedaProducto: '' }))
    await waitFor(() => expect(result.current.productos).toHaveLength(1))
    await waitFor(() => expect(result.current.provincias).toEqual(['Córdoba', 'Santa Fe']))
    expect(result.current.categorias.map((c) => c.ruta)).toEqual(['Audio', 'Audio > Cables'])
    expect(mocks.or).not.toHaveBeenCalled()
  })

  it('busca por nombre o SKU y quita los caracteres que alterarían el filtro', async () => {
    const { result } = renderHook(() => useOpcionesDimension({ busquedaProducto: ' aur,(x)%*\\ ' }))
    await waitFor(() => expect(result.current.productos).toHaveLength(1))
    expect(mocks.or).toHaveBeenCalledWith('nombre.ilike.%aur x%,sku.ilike.%aur x%')
  })

  it('deshabilitado no consulta nada hasta que se habilita', async () => {
    const { result, rerender } = renderHook(({ habilitado }) => useOpcionesDimension({ busquedaProducto: '', habilitado }), { initialProps: { habilitado: false } })
    await Promise.resolve()
    expect(mocks.productos).not.toHaveBeenCalled()
    expect(mocks.clientes).not.toHaveBeenCalled()
    expect(mocks.categorias).toHaveBeenCalledWith({ habilitado: false })
    rerender({ habilitado: true })
    await waitFor(() => expect(result.current.productos).toHaveLength(1))
    expect(mocks.clientes).toHaveBeenCalled()
  })

  it('un error en la búsqueda de productos deja la lista vacía y marca el error', async () => {
    mocks.productos.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const { result } = renderHook(() => useOpcionesDimension({ busquedaProducto: '' }))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.productos).toEqual([])
  })

  it('un error al cargar categorías se propaga', async () => {
    mocks.categorias.mockReturnValue({ categorias: [], isLoading: false, isError: true })
    const { result } = renderHook(() => useOpcionesDimension({ busquedaProducto: '' }))
    await waitFor(() => expect(result.current.productos).toHaveLength(1))
    expect(result.current.isError).toBe(true)
  })
})
