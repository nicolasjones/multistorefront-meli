import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PermisoSeccion } from '../lib/permisos'

// Con el `useNivelSeccion` REAL (solo se simula el proveedor de permisos): cómo se ve cada estado del panel desde las pantallas de
// Empresas. Cargando → null (spinner); error de carga, sin proveedor o sin nivel → false (restringido/solo lectura, nunca edición,
// nunca colgado); solo `edicion` → true.
const mocks = vi.hoisted(() => ({ usePermisosPanel: vi.fn() }))
vi.mock('../context/PermisosPanel', () => ({ usePermisosPanel: mocks.usePermisosPanel }))

import { usePuedeEditarEmpresas } from './usePuedeEditarEmpresas'

const fila = (nivel: 'edicion' | 'lectura' | 'ninguno', seccion = 'empresas'): PermisoSeccion =>
  ({ seccion, nivel, eliminar: false, exportar: false, ver_costos: false })
const leer = () => renderHook(() => usePuedeEditarEmpresas()).result.current

describe('usePuedeEditarEmpresas con los permisos reales del panel', () => {
  beforeEach(() => mocks.usePermisosPanel.mockReset())

  it('cargando los permisos: null', () => {
    mocks.usePermisosPanel.mockReturnValue({ permisos: null, isLoading: true, error: false, recargar: vi.fn() })
    expect(leer()).toMatchObject({ puedeEditar: null, isLoading: true })
  })

  it('falla la carga de permisos: false (no edita y no queda cargando)', () => {
    mocks.usePermisosPanel.mockReturnValue({ permisos: null, isLoading: false, error: true, recargar: vi.fn() })
    expect(leer()).toMatchObject({ puedeEditar: false, isLoading: false })
  })

  it('sin proveedor de permisos: false', () => {
    mocks.usePermisosPanel.mockReturnValue(undefined)
    expect(leer().puedeEditar).toBe(false)
  })

  it('sin fila para la sección empresas (nivel ninguno): false', () => {
    mocks.usePermisosPanel.mockReturnValue({ permisos: [fila('edicion', 'ventas')], isLoading: false, error: false })
    expect(leer().puedeEditar).toBe(false)
  })

  it('nivel lectura: false; nivel edicion: true', () => {
    mocks.usePermisosPanel.mockReturnValue({ permisos: [fila('lectura')], isLoading: false, error: false })
    expect(leer().puedeEditar).toBe(false)
    mocks.usePermisosPanel.mockReturnValue({ permisos: [fila('edicion')], isLoading: false, error: false })
    expect(leer().puedeEditar).toBe(true)
  })
})
