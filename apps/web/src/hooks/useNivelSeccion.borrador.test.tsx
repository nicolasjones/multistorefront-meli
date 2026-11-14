import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PermisoSeccion } from '../lib/permisos'

// MSF-855: el último nivel confirmado solo se entrega con la MISMA clave en los tres lados (contexto conservado,
// clave vigente y clave de los últimos confirmados) y con el repedido fallido. Defensa en profundidad del hook,
// independiente de cómo arme su valor el provider.
const mocks = vi.hoisted(() => ({ usePermisosPanel: vi.fn() }))
vi.mock('../context/PermisosPanel', () => ({ usePermisosPanel: mocks.usePermisosPanel }))

import { BorradorConservadoContext } from '../context/BorradorConservado'
import { useNivelSeccion } from './useNivelSeccion'

const fila = (nivel: 'edicion' | 'lectura' | 'ninguno'): PermisoSeccion => ({ seccion: 'ventas', nivel, eliminar: false, exportar: false, ver_costos: false })

function leer(valor: Record<string, unknown>, conservado: { clave: string } | null) {
  mocks.usePermisosPanel.mockReturnValue({ permisos: null, isLoading: false, error: true, recargar: vi.fn(), ...valor })
  const envoltorio = ({ children }: { children: ReactNode }) => (
    <BorradorConservadoContext.Provider value={conservado}>{children}</BorradorConservadoContext.Provider>
  )
  return renderHook(() => useNivelSeccion('ventas'), { wrapper: envoltorio }).result.current
}

describe('useNivelSeccion: último nivel confirmado (MSF-855)', () => {
  beforeEach(() => mocks.usePermisosPanel.mockReset())

  it('misma clave en los tres lados y repedido fallido: último nivel con sinConfirmar', () => {
    const r = leer({ clave: 'u1:o1', ultimosConfirmados: { clave: 'u1:o1', permisos: [fila('edicion')] } }, { clave: 'u1:o1' })
    expect(r).toMatchObject({ nivel: 'edicion', sinConfirmar: true, error: false })
  })

  it('sin contexto de borrador conservado: nivel null', () => {
    const r = leer({ clave: 'u1:o1', ultimosConfirmados: { clave: 'u1:o1', permisos: [fila('edicion')] } }, null)
    expect(r).toMatchObject({ nivel: null, error: true })
    expect(r.sinConfirmar).toBeUndefined()
  })

  it('el contexto conservado es de otra clave: nivel null', () => {
    const r = leer({ clave: 'u1:o2', ultimosConfirmados: { clave: 'u1:o2', permisos: [fila('edicion')] } }, { clave: 'u1:o1' })
    expect(r.nivel).toBeNull()
    expect(r.sinConfirmar).toBeUndefined()
  })

  it('los últimos confirmados son de otra clave: nunca se entregan', () => {
    const r = leer({ clave: 'u1:o1', ultimosConfirmados: { clave: 'u1:o0', permisos: [fila('edicion')] } }, { clave: 'u1:o1' })
    expect(r.nivel).toBeNull()
    expect(r.sinConfirmar).toBeUndefined()
  })

  it('cargando sin error (no es un fallo del repedido): nivel null, no se entrega el último', () => {
    const r = leer({ clave: 'u1:o1', error: false, isLoading: true, ultimosConfirmados: { clave: 'u1:o1', permisos: [fila('edicion')] } }, { clave: 'u1:o1' })
    expect(r).toMatchObject({ nivel: null, isLoading: true })
    expect(r.sinConfirmar).toBeUndefined()
  })

  it('sin últimos confirmados o sin error: nivel null / el vigente manda', () => {
    expect(leer({ clave: 'u1:o1', ultimosConfirmados: null }, { clave: 'u1:o1' }).nivel).toBeNull()
    const vigente = leer({ clave: 'u1:o1', permisos: [fila('lectura')], error: false, ultimosConfirmados: { clave: 'u1:o1', permisos: [fila('edicion')] } }, { clave: 'u1:o1' })
    expect(vigente).toMatchObject({ nivel: 'lectura' })
    expect(vigente.sinConfirmar).toBeUndefined()
  })
})
