import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ useEmpresasAccesibles: vi.fn() }))
vi.mock('./useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))

import { useFiltroPorEmpresaActiva } from './useFiltroPorEmpresaActiva'

const accesibles = (empresaActivaId: string | null) => ({
  empresas: [{ id: 'e-1', nombre: 'A', esActiva: empresaActivaId === 'e-1' }, { id: 'e-2', nombre: 'B', esActiva: empresaActivaId === 'e-2' }],
  empresaActivaId,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
})

describe('useFiltroPorEmpresaActiva', () => {
  beforeEach(() => mocks.useEmpresasAccesibles.mockReset())

  it('arranca en la empresa activa y expone las empresas accesibles', () => {
    mocks.useEmpresasAccesibles.mockReturnValue(accesibles('e-1'))
    const { result } = renderHook(() => useFiltroPorEmpresaActiva())

    expect(result.current.valor).toBe('e-1')
    expect(result.current.empresas.map((e) => e.id)).toEqual(['e-1', 'e-2'])
  })

  it('la pantalla puede sobreescribir el filtro sin tocar la activa', () => {
    mocks.useEmpresasAccesibles.mockReturnValue(accesibles('e-1'))
    const { result } = renderHook(() => useFiltroPorEmpresaActiva())

    act(() => result.current.cambiar('e-2'))
    expect(result.current.valor).toBe('e-2')
    expect(result.current.empresaActivaId).toBe('e-1')
  })

  it('«todas» (null) es una sobreescritura válida', () => {
    mocks.useEmpresasAccesibles.mockReturnValue(accesibles('e-1'))
    const { result } = renderHook(() => useFiltroPorEmpresaActiva())

    act(() => result.current.cambiar(null))
    expect(result.current.valor).toBeNull()
  })

  it('al cambiar la empresa activa la pantalla la sigue, aunque se haya elegido «todas»', () => {
    mocks.useEmpresasAccesibles.mockReturnValue(accesibles('e-1'))
    const { result, rerender } = renderHook(() => useFiltroPorEmpresaActiva())
    act(() => result.current.cambiar(null))
    expect(result.current.valor).toBeNull()

    // La barra superior cambia la activa: el filtro de pantalla vuelve a seguirla.
    mocks.useEmpresasAccesibles.mockReturnValue(accesibles('e-2'))
    rerender()

    expect(result.current.valor).toBe('e-2')
    expect(result.current.empresaActivaId).toBe('e-2')
  })
})
