import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listar: vi.fn(),
  organizacionId: 'org-1' as string | null,
}))

vi.mock('./useOrganizacionActiva', () => ({
  useOrganizacionActiva: () => ({
    organizacionActiva: mocks.organizacionId ? { id: mocks.organizacionId } : null,
    isLoading: false,
  }),
}))
vi.mock('../lib/empresaActiva', () => ({ listarEmpresasSelector: mocks.listar }))

import { notificarEmpresaActivaCambiada } from '../lib/empresaActivaRevision'
import { useEmpresasAccesibles } from './useEmpresasAccesibles'

const accesible = (n: number, esActiva = false) => ({ id: `e-${n}`, nombre: `Empresa ${n}`, esActiva, rolId: null })

describe('useEmpresasAccesibles', () => {
  beforeEach(() => {
    mocks.listar.mockReset()
    mocks.organizacionId = 'org-1'
  })

  it('carga las empresas accesibles y expone la activa', async () => {
    mocks.listar.mockResolvedValue([accesible(1), accesible(2, true)])
    const { result } = renderHook(() => useEmpresasAccesibles())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.empresas).toHaveLength(2)
    expect(result.current.empresaActivaId).toBe('e-2')
  })

  it('sin empresa activa el id es null', async () => {
    mocks.listar.mockResolvedValue([accesible(1)])
    const { result } = renderHook(() => useEmpresasAccesibles())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.empresaActivaId).toBeNull()
  })

  it('si el RPC falla deja la lista vacía y marca error', async () => {
    mocks.listar.mockRejectedValue(new Error('sin sesión'))
    const { result } = renderHook(() => useEmpresasAccesibles())

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.empresas).toEqual([])
    expect(result.current.isLoading).toBe(false)
  })

  it('al cambiar la organización activa vuelve a consultar', async () => {
    mocks.listar.mockResolvedValueOnce([accesible(1)])
    const { rerender, result } = renderHook(() => useEmpresasAccesibles())
    await waitFor(() => expect(result.current.empresas).toHaveLength(1))

    mocks.listar.mockResolvedValueOnce([accesible(2), accesible(3)])
    mocks.organizacionId = 'org-2'
    rerender()
    await waitFor(() => expect(result.current.empresas).toHaveLength(2))
  })

  it('al cambiar la empresa activa en la barra superior vuelve a consultar', async () => {
    mocks.listar.mockResolvedValueOnce([accesible(1, true)])
    const { result } = renderHook(() => useEmpresasAccesibles())
    await waitFor(() => expect(result.current.empresaActivaId).toBe('e-1'))

    // La barra superior cambió la activa (F-ROL-06): la pantalla la sigue.
    mocks.listar.mockResolvedValueOnce([accesible(1), accesible(2, true)])
    act(() => notificarEmpresaActivaCambiada())

    await waitFor(() => expect(result.current.empresaActivaId).toBe('e-2'))
  })

  it('refetch vuelve a consultar', async () => {
    mocks.listar.mockResolvedValue([])
    const { result } = renderHook(() => useEmpresasAccesibles())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.refetch()
    })
    expect(mocks.listar).toHaveBeenCalledTimes(2)
  })
})
