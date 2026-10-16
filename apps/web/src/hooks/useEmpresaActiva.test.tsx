import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ listar: vi.fn(), cambiar: vi.fn() }))

vi.mock('@refinedev/core', () => ({ useInvalidate: () => vi.fn() }))
vi.mock('./useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1' } }) }))
vi.mock('../context/PermisosPanel', () => ({ usePermisosPanel: () => null }))
vi.mock('../lib/empresaActiva', () => ({ listarEmpresasSelector: mocks.listar, cambiarEmpresaActiva: mocks.cambiar }))

import { useEmpresaActiva } from './useEmpresaActiva'

const empresa = (id: string) => ({ id, nombre: id, esActiva: false, rolId: null })

describe('useEmpresaActiva — última petición gana', () => {
  beforeEach(() => vi.resetAllMocks())

  it('una respuesta vieja no pisa a la más reciente', async () => {
    let resolverVieja!: (v: unknown) => void
    mocks.listar
      .mockImplementationOnce(() => new Promise((r) => { resolverVieja = r }))
      .mockResolvedValueOnce([empresa('nueva')])
    const { result } = renderHook(() => useEmpresaActiva())
    await act(async () => { await result.current.refetch() })
    await waitFor(() => expect(result.current.empresas.map((e) => e.id)).toEqual(['nueva']))
    await act(async () => { resolverVieja([empresa('vieja')]) })
    expect(result.current.empresas.map((e) => e.id)).toEqual(['nueva'])
  })
})
