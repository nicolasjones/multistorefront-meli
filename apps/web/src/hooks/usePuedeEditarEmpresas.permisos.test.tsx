import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BorradorConservadoContext } from '../context/BorradorConservado'
import type { PermisoSeccion } from '../lib/permisos'

// Con el `useNivelSeccion` REAL (solo se simula el proveedor de permisos): cómo se ve cada estado
// del panel desde las pantallas de Empresas. Cargando → null (spinner); error de carga, sin
// proveedor o sin nivel → false (restringido/solo lectura, nunca edición, nunca colgado); solo
// `edicion` → true.
const mocks = vi.hoisted(() => ({ usePermisosPanel: vi.fn() }))
vi.mock('../context/PermisosPanel', () => ({ usePermisosPanel: mocks.usePermisosPanel }))

import { usePuedeEditarEmpresas } from './usePuedeEditarEmpresas'

const fila = (nivel: 'edicion' | 'lectura' | 'ninguno', seccion = 'empresas'): PermisoSeccion =>
  ({ seccion, nivel, eliminar: false, exportar: false, ver_costos: false })
const leer = (conservado: { clave: string } | null = null) => {
  const envoltorio = ({ children }: { children: ReactNode }) => (
    <BorradorConservadoContext.Provider value={conservado}>{children}</BorradorConservadoContext.Provider>
  )
  return renderHook(() => usePuedeEditarEmpresas(), { wrapper: envoltorio }).result.current
}

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

  it('falla el repedido CON permisos previos (último nivel edición): false, con o sin borrador conservado', () => {
    const valor = { permisos: null, isLoading: false, error: true, clave: 'u1:o1', recargar: vi.fn(),
      ultimosConfirmados: { clave: 'u1:o1', permisos: [fila('edicion')] } }
    // Sin pantalla que conserve borrador, el hook no usa los permisos anteriores: sin nivel →
    // false.
    mocks.usePermisosPanel.mockReturnValue(valor)
    expect(leer(null).puedeEditar).toBe(false)
    // Con borrador conservado el hook devuelve el último nivel como `sinConfirmar`: la pantalla
    // es inerte, no edita.
    expect(leer({ clave: 'u1:o1' }).puedeEditar).toBe(false)
  })
})
