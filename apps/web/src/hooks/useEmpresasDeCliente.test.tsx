import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listar: vi.fn(),
  rpc: vi.fn(),
  organizacionId: 'org-1' as string | null,
}))

vi.mock('./useOrganizacionActiva', () => ({
  useOrganizacionActiva: () => ({
    organizacionActiva: mocks.organizacionId ? { id: mocks.organizacionId } : null,
    isLoading: false,
  }),
}))
vi.mock('../lib/supabase', () => ({
  supabaseClient: {
    from: () => ({ select: () => ({ eq: () => ({ returns: mocks.listar }) }) }),
    rpc: mocks.rpc,
  },
}))

import { useEmpresasDeCliente, useGuardarEmpresasDeCliente } from './useEmpresasDeCliente'

describe('useEmpresasDeCliente', () => {
  beforeEach(() => {
    mocks.listar.mockReset()
    mocks.rpc.mockReset()
    mocks.organizacionId = 'org-1'
  })

  it('carga los ids de las tiendas del cliente', async () => {
    mocks.listar.mockResolvedValue({ data: [{ empresa_id: 'e-1' }, { empresa_id: 'e-2' }], error: null })
    const { result } = renderHook(() => useEmpresasDeCliente('c-1'))

    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.empresas).toEqual(['e-1', 'e-2'])
    expect(result.current.isError).toBe(false)
  })

  it('sin cliente no consulta y queda vacío', async () => {
    const { result } = renderHook(() => useEmpresasDeCliente(undefined))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.empresas).toEqual([])
    expect(mocks.listar).not.toHaveBeenCalled()
  })

  it('si la consulta falla, informa el error y no rompe', async () => {
    mocks.listar.mockResolvedValue({ data: null, error: { message: 'sin red' } })
    const { result } = renderHook(() => useEmpresasDeCliente('c-1'))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isError).toBe(true)
    expect(result.current.empresas).toEqual([])
  })

  it('al cambiar de cliente vuelve a cargar', async () => {
    mocks.listar.mockResolvedValueOnce({ data: [{ empresa_id: 'e-1' }], error: null })
    mocks.listar.mockResolvedValueOnce({ data: [{ empresa_id: 'e-2' }], error: null })
    const { result, rerender } = renderHook((id: string) => useEmpresasDeCliente(id), { initialProps: 'c-1' })

    await waitFor(() => expect(result.current.empresas).toEqual(['e-1']))
    rerender('c-2')
    await waitFor(() => expect(result.current.empresas).toEqual(['e-2']))
  })
})

describe('useGuardarEmpresasDeCliente', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
  })

  it('llama a la RPC con el cliente y las tiendas elegidas', async () => {
    mocks.rpc.mockResolvedValue({ error: null })
    const { result } = renderHook(() => useGuardarEmpresasDeCliente())

    await act(async () => {
      await result.current.guardar('c-1', ['e-1', 'e-2'])
    })

    expect(mocks.rpc).toHaveBeenCalledWith('guardar_empresas_de_cliente', {
      p_cliente_id: 'c-1',
      p_empresa_ids: ['e-1', 'e-2'],
    })
  })

  it('propaga el error del servidor', async () => {
    const error = new Error('sin permiso')
    mocks.rpc.mockResolvedValue({ error })
    const { result } = renderHook(() => useGuardarEmpresasDeCliente())

    await expect(result.current.guardar('c-1', [])).rejects.toThrow('sin permiso')
  })
})
