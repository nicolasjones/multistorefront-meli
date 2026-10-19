import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ listar: vi.fn(), rpc: vi.fn() }))

vi.mock('./useOrganizacionActiva', () => ({
  useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1' }, isLoading: false }),
}))
vi.mock('../lib/supabase', () => ({
  supabaseClient: {
    schema: () => ({ from: () => ({ select: () => ({ eq: () => ({ returns: mocks.listar }) }) }) }),
    rpc: mocks.rpc,
  },
}))

import { guardarEmpresasDeProveedor, useEmpresasDeProveedor } from './useEmpresasDeProveedor'

describe('useEmpresasDeProveedor', () => {
  beforeEach(() => {
    mocks.listar.mockReset()
    mocks.rpc.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('carga los ids de las tiendas del proveedor', async () => {
    mocks.listar.mockResolvedValue({ data: [{ empresa_id: 'e-1' }, { empresa_id: 'e-2' }], error: null })
    const { result } = renderHook(() => useEmpresasDeProveedor('p-1'))
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.empresas).toEqual(['e-1', 'e-2'])
    expect(result.current.isError).toBe(false)
  })

  it('sin proveedor (alta) no consulta y no queda cargando', () => {
    const { result } = renderHook(() => useEmpresasDeProveedor(undefined))
    expect(result.current.isLoading).toBe(false)
    expect(result.current.empresas).toEqual([])
    expect(mocks.listar).not.toHaveBeenCalled()
  })

  it('ante un error de la base marca isError y deja la lista vacía', async () => {
    mocks.listar.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const { result } = renderHook(() => useEmpresasDeProveedor('p-1'))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.empresas).toEqual([])
  })

  it('guardar llama a la RPC con el proveedor y las tiendas, y propaga el error', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: 2, error: null })
    await guardarEmpresasDeProveedor('p-1', ['e-1', 'e-2'])
    expect(mocks.rpc).toHaveBeenCalledWith('guardar_empresas_de_proveedor', { p_proveedor_id: 'p-1', p_empresa_ids: ['e-1', 'e-2'] })
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } })
    await expect(guardarEmpresasDeProveedor('p-1', [])).rejects.toEqual({ code: '42501' })
  })
})
