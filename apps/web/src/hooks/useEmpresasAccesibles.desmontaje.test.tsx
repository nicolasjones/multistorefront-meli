import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const { listar } = vi.hoisted(() => ({ listar: vi.fn() }))
vi.mock('../lib/empresaActiva', () => ({ listarEmpresasSelector: listar }))
vi.mock('./useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1' } }) }))

import { useEmpresasAccesibles } from './useEmpresasAccesibles'

describe('useEmpresasAccesibles — desmontaje [MSF-808]', () => {
  it('no actualiza estado si la respuesta llega tras desmontar', async () => {
    let resolver!: (v: unknown[]) => void
    listar.mockReturnValue(new Promise((r) => (resolver = r)))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result, unmount } = renderHook(() => useEmpresasAccesibles())
    unmount()
    resolver([{ id: 'e1', esActiva: true }])
    await Promise.resolve()
    await Promise.resolve()
    expect(result.current.empresas).toEqual([])
    expect(result.current.isLoading).toBe(true)
    expect(error).not.toHaveBeenCalled()
  })
})
