import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), organizacionId: 'org-1' as string | null }))

vi.mock('./useOrganizacionActiva', () => ({
  useOrganizacionActiva: () => ({ organizacionActiva: mocks.organizacionId ? { id: mocks.organizacionId } : null, isLoading: false }),
}))
vi.mock('../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { useBuscarClientes, type FiltrosClientes } from './useBuscarClientes'

const base: FiltrosClientes = { texto: '', tipo: null, archivados: false, pagina: 1, tamano: 25 }
const fila = (n: number, total = 2) => ({
  id: `c-${n}`, numero: n, nombre: `Cliente ${n}`, documento: null, correo: null, telefono: null, celular: null,
  localidad: null, expreso_preferido: null, tipo: 'minorista', es_consumidor_final: false, archivado_en: null, total,
})

describe('useBuscarClientes', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
    mocks.organizacionId = 'org-1'
  })

  it('llama a buscar_clientes con los filtros y separa el total de las filas', async () => {
    mocks.rpc.mockResolvedValue({ data: [fila(1, 60), fila(2, 60)], error: null })
    const { result } = renderHook(() => useBuscarClientes({ ...base, tipo: 'mayorista', archivados: true, pagina: 2 }))
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mocks.rpc).toHaveBeenCalledWith('buscar_clientes', {
      p_texto: null, p_tipo: 'mayorista', p_archivados: true, p_pagina: 2, p_tamano: 25,
    })
    expect(result.current.total).toBe(60)
    expect(result.current.clientes).toHaveLength(2)
    expect(result.current.clientes[0]).not.toHaveProperty('total')
  })

  it('envía el texto recortado y sin escapar: los comodines los escapa el servidor', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    const { result } = renderHook(() => useBuscarClientes({ ...base, texto: '  50%_\\  ' }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mocks.rpc.mock.calls[0][1].p_texto).toBe('50%_\\')
    expect(result.current.total).toBe(0)
  })

  it('un texto de solo espacios se manda como null', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    renderHook(() => useBuscarClientes({ ...base, texto: '   ' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled())
    expect(mocks.rpc.mock.calls[0][1].p_texto).toBeNull()
  })

  it('ante un error de la base marca isError y permite reintentar', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    const { result } = renderHook(() => useBuscarClientes(base))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.clientes).toEqual([])
    mocks.rpc.mockResolvedValueOnce({ data: [fila(1, 1)], error: null })
    await result.current.refetch()
    await waitFor(() => expect(result.current.isError).toBe(false))
    expect(result.current.clientes).toHaveLength(1)
  })

  it('una excepción de red también cuenta como error', async () => {
    mocks.rpc.mockRejectedValue(new Error('red caída'))
    const { result } = renderHook(() => useBuscarClientes(base))
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('última petición gana: una respuesta vieja no pisa la nueva y las filas previas se conservan al cambiar de página', async () => {
    let resolverVieja: (v: unknown) => void = () => {}
    mocks.rpc.mockImplementationOnce(() => new Promise((resolver) => { resolverVieja = resolver }))
    mocks.rpc.mockResolvedValueOnce({ data: [fila(9, 1)], error: null })
    const { result, rerender } = renderHook((filtros: FiltrosClientes) => useBuscarClientes(filtros), { initialProps: base })
    rerender({ ...base, texto: 'nuevo' })
    await waitFor(() => expect(result.current.clientes.map((c) => c.id)).toEqual(['c-9']))
    resolverVieja({ data: [fila(1, 1)], error: null })
    await new Promise((resolver) => setTimeout(resolver, 0))
    expect(result.current.clientes.map((c) => c.id)).toEqual(['c-9'])
  })
})
