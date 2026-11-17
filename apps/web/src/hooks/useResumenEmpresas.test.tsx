import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  tiendas: vi.fn(),
  reglas: vi.fn(),
  catalogo: vi.fn(),
  version: vi.fn(),
  tablas: [] as string[],
  ids: [] as string[][],
}))

vi.mock('../lib/supabase', () => ({
  supabaseClient: {
    schema: () => ({
      from: (tabla: string) => {
        mocks.tablas.push(tabla)
        return { select: () => ({ in: (_columna: string, ids: string[]) => { mocks.ids.push(ids); return { returns: () => (tabla === 'tiendas' ? mocks.tiendas() : mocks.reglas()) } } }) }
      },
    }),
  },
}))
vi.mock('../lib/tiendaCatalogo', () => ({ listarCatalogoTienda: mocks.catalogo }))
vi.mock('./useVersionEmpresaActiva', () => ({ useVersionEmpresaActiva: mocks.version }))

import { useResumenEmpresas } from './useResumenEmpresas'

describe('useResumenEmpresas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.tablas.length = 0
    mocks.ids.length = 0
    mocks.version.mockReturnValue(1)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.tiendas.mockResolvedValue({ data: [{ empresa_id: 'e-1', dominio: 'uno.example.com' }], error: null })
    mocks.reglas.mockResolvedValue({ data: [{ empresa_id: 'e-1', base: 'central_ajuste', ajuste_pct: '-5', updated_at: 'x' }], error: null })
    mocks.catalogo.mockResolvedValue({ resumen: { visibles: 7, destacados: 0 } })
  })

  it('lee tienda y precio de todas las empresas con una consulta por dato y el catálogo solo de las que tienen tienda', async () => {
    const { result } = renderHook(() => useResumenEmpresas(['e-1', 'e-2']))
    await waitFor(() => expect(result.current['e-1']).toBeDefined())
    expect(mocks.tablas).toEqual(['tiendas', 'precios_empresa'])
    expect(result.current['e-1']).toMatchObject({ dominioTienda: 'uno.example.com', productosVisibles: 7, regla: { base: 'central_ajuste', ajustePct: -5 } })
    expect(result.current['e-2']).toMatchObject({ dominioTienda: null, productosVisibles: 0, regla: { base: 'central', ajustePct: 0 } })
    expect(mocks.catalogo).toHaveBeenCalledTimes(1)
    expect(mocks.catalogo).toHaveBeenCalledWith('e-1')
  })

  it('si una lectura falla deja ese dato como no disponible sin tapar los demás', async () => {
    mocks.tiendas.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const { result } = renderHook(() => useResumenEmpresas(['e-1']))
    await waitFor(() => expect(result.current['e-1']).toBeDefined())
    expect(result.current['e-1'].dominioTienda).toBeUndefined()
    expect(result.current['e-1'].productosVisibles).toBeNull()
    expect(result.current['e-1'].regla?.base).toBe('central_ajuste')
  })

  it('al cambiar la empresa activa vuelve a leer todo', async () => {
    const { result, rerender } = renderHook(() => useResumenEmpresas(['e-1']))
    await waitFor(() => expect(result.current['e-1']).toBeDefined())
    expect(mocks.tiendas).toHaveBeenCalledTimes(1)
    expect(mocks.ids).toEqual([['e-1'], ['e-1']])
    mocks.version.mockReturnValue(2)
    rerender()
    await waitFor(() => expect(mocks.tiendas).toHaveBeenCalledTimes(2))
    expect(mocks.catalogo).toHaveBeenCalledTimes(2)
    expect(mocks.ids).toEqual([['e-1'], ['e-1'], ['e-1'], ['e-1']])
  })

  it('al cambiar las empresas piden exactamente los ids nuevos', async () => {
    let ids = ['e-1']
    const { result, rerender } = renderHook(() => useResumenEmpresas(ids))
    await waitFor(() => expect(result.current['e-1']).toBeDefined())
    ids = ['e-3', 'e-4']
    rerender()
    await waitFor(() => expect(mocks.ids).toContainEqual(['e-3', 'e-4']))
  })

  it('con dos tiendas por empresa toma la más antigua, sin depender del orden de llegada', async () => {
    mocks.tiendas.mockResolvedValue({ data: [
      { empresa_id: 'e-1', dominio: 'nueva.example.com', created_at: '2026-02-01' },
      { empresa_id: 'e-1', dominio: 'vieja.example.com', created_at: '2026-01-01' },
    ], error: null })
    const { result } = renderHook(() => useResumenEmpresas(['e-1']))
    await waitFor(() => expect(result.current['e-1']).toBeDefined())
    expect(result.current['e-1'].dominioTienda).toBe('vieja.example.com')
  })
})
