import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ useNivelSeccion: vi.fn() }))
vi.mock('./useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))

import { usePuedeEditarEmpresas } from './usePuedeEditarEmpresas'

const leer = () => renderHook(() => usePuedeEditarEmpresas()).result.current

describe('usePuedeEditarEmpresas', () => {
  beforeEach(() => mocks.useNivelSeccion.mockReset())

  it('consulta la sección empresas, la misma que la RLS de dominio.empresas', () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false, error: false })
    leer()
    expect(mocks.useNivelSeccion).toHaveBeenCalledWith('empresas')
  })

  it('edita solo con nivel de edición (un rol personalizado también)', () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false, error: false })
    expect(leer().puedeEditar).toBe(true)
  })

  it('lectura y ninguno no editan', () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false, error: false })
    expect(leer().puedeEditar).toBe(false)
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'ninguno', isLoading: false, error: false })
    expect(leer().puedeEditar).toBe(false)
  })

  it('es null mientras carga o si no hay nivel', () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: null, isLoading: true, error: false })
    expect(leer().puedeEditar).toBeNull()
    mocks.useNivelSeccion.mockReturnValue({ nivel: null, isLoading: false, error: true })
    expect(leer().puedeEditar).toBeNull()
  })
})
