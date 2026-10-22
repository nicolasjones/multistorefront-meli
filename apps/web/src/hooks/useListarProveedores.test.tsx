import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), organizacionId: 'org-1' as string | null }))

vi.mock('./useOrganizacionActiva', () => ({
  useOrganizacionActiva: () => ({ organizacionActiva: mocks.organizacionId ? { id: mocks.organizacionId } : null, isLoading: false }),
}))
vi.mock('../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { useListarProveedores, type FiltrosProveedores } from './useListarProveedores'

const base: FiltrosProveedores = { texto: '', estado: 'activos', pagina: 1, tamano: 25 }
const fila = (n: number, total = 2) => ({
  id: `p-${n}`, razon_social: `Proveedor ${n}`, cuit: '20123456786', correo: null, telefono: null, activo: true, empresas: [], total_filas: total,
})

describe('useListarProveedores', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
    mocks.organizacionId = 'org-1'
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('llama a listar_proveedores con los filtros y separa el total de las filas', async () => {
    mocks.rpc.mockResolvedValue({ data: [fila(1, 60), fila(2, 60)], error: null })
    const { result } = renderHook(() => useListarProveedores({ ...base, estado: 'todos', pagina: 2 }))
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mocks.rpc).toHaveBeenCalledWith('listar_proveedores', { p_busqueda: null, p_estado: 'todos', p_pagina: 2, p_tamano: 25, p_empresa_id: null })
    expect(result.current.total).toBe(60)
    expect(result.current.proveedores).toHaveLength(2)
    expect(result.current.proveedores[0]).not.toHaveProperty('total_filas')
  })

  it('envía la tienda elegida como p_empresa_id y devuelve las tiendas de cada fila', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...fila(1, 1), empresas: [{ id: 'e-1', nombre: 'San Javucho' }] }], error: null })
    const { result } = renderHook(() => useListarProveedores({ ...base, empresaId: 'e-1' }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mocks.rpc.mock.calls[0][1].p_empresa_id).toBe('e-1')
    expect(result.current.proveedores[0].empresas).toEqual([{ id: 'e-1', nombre: 'San Javucho' }])
  })

  it('envía el texto recortado y sin escapar: los comodines los escapa el servidor', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    const { result } = renderHook(() => useListarProveedores({ ...base, texto: '  50%_  ' }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mocks.rpc.mock.calls[0][1].p_busqueda).toBe('50%_')
    expect(result.current.total).toBe(0)
  })

  it('un texto de solo espacios se manda como null', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    renderHook(() => useListarProveedores({ ...base, texto: '   ' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled())
    expect(mocks.rpc.mock.calls[0][1].p_busqueda).toBeNull()
  })

  it('ante un error de la base marca isError y permite reintentar', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    const { result } = renderHook(() => useListarProveedores(base))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.proveedores).toEqual([])
    mocks.rpc.mockResolvedValueOnce({ data: [fila(1, 1)], error: null })
    await result.current.refetch()
    await waitFor(() => expect(result.current.isError).toBe(false))
    expect(result.current.proveedores).toHaveLength(1)
  })

  it('una excepción de red también cuenta como error', async () => {
    mocks.rpc.mockRejectedValue(new Error('red caída'))
    const { result } = renderHook(() => useListarProveedores(base))
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('última petición gana: una respuesta vieja no pisa la nueva', async () => {
    let resolverVieja: (v: unknown) => void = () => {}
    mocks.rpc.mockImplementationOnce(() => new Promise((resolver) => { resolverVieja = resolver }))
    mocks.rpc.mockResolvedValueOnce({ data: [fila(9, 1)], error: null })
    const { result, rerender } = renderHook((filtros: FiltrosProveedores) => useListarProveedores(filtros), { initialProps: base })
    rerender({ ...base, texto: 'nuevo' })
    await waitFor(() => expect(result.current.proveedores.map((p) => p.id)).toEqual(['p-9']))
    resolverVieja({ data: [fila(1, 1)], error: null })
    await new Promise((resolver) => setTimeout(resolver, 0))
    expect(result.current.proveedores.map((p) => p.id)).toEqual(['p-9'])
  })
})
