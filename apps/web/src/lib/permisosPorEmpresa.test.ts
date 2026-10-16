import { beforeEach, describe, expect, it, vi } from 'vitest'

// F-ROL-04 (FR-006): un usuario con varias empresas ve el nivel de la empresa
// activa. El servidor resuelve el nivel (private.nivel_seccion); acá se simula
// `permisos_actuales` según la empresa activa y se verifica que el panel, con
// su caché real, refleja el cambio al invalidarla.
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import {
  invalidarCachePermisos,
  nivelDe,
  nivelPermiteAccionRefine,
  obtenerPermisosActualesCacheado,
  puedeAccionEn,
  type PermisoSeccion,
} from './permisos'

// Operador en la empresa A, Consulta en la B; productos es compartida.
const PERMISOS_POR_EMPRESA: Record<string, PermisoSeccion[]> = {
  A: [
    { seccion: 'ventas', nivel: 'edicion', eliminar: true, exportar: false, ver_costos: false },
    { seccion: 'productos', nivel: 'edicion', eliminar: false, exportar: false, ver_costos: false },
  ],
  B: [
    { seccion: 'ventas', nivel: 'lectura', eliminar: false, exportar: false, ver_costos: false },
    { seccion: 'productos', nivel: 'edicion', eliminar: false, exportar: false, ver_costos: false },
  ],
}

describe('permisos del panel con usuario de varias empresas', () => {
  let empresaActiva: string

  beforeEach(() => {
    vi.resetAllMocks()
    invalidarCachePermisos()
    empresaActiva = 'A'
    mocks.rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'permisos_actuales') {
        return { data: PERMISOS_POR_EMPRESA[empresaActiva], error: null }
      }
      return { error: null }
    })
  })

  it('el nivel por empresa sigue a la empresa activa al invalidar la caché', async () => {
    const enA = await obtenerPermisosActualesCacheado('u1')
    expect(nivelDe(enA, 'ventas')).toBe('edicion')
    expect(puedeAccionEn(enA, 'ventas', 'eliminar')).toBe(true)
    expect(nivelPermiteAccionRefine(nivelDe(enA, 'ventas'), 'edit')).toBe(true)

    empresaActiva = 'B'
    // Sin invalidar, la caché corta evita una RPC por evaluación.
    expect(nivelDe(await obtenerPermisosActualesCacheado('u1'), 'ventas')).toBe('edicion')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)

    invalidarCachePermisos()
    const enB = await obtenerPermisosActualesCacheado('u1')
    expect(nivelDe(enB, 'ventas')).toBe('lectura')
    expect(puedeAccionEn(enB, 'ventas', 'eliminar')).toBe(false)
    expect(nivelPermiteAccionRefine(nivelDe(enB, 'ventas'), 'list')).toBe(true)
    expect(nivelPermiteAccionRefine(nivelDe(enB, 'ventas'), 'edit')).toBe(false)
  })

  it('una sección compartida no cambia al cambiar de empresa', async () => {
    expect(nivelDe(await obtenerPermisosActualesCacheado('u1'), 'productos')).toBe('edicion')
    empresaActiva = 'B'
    invalidarCachePermisos()
    expect(nivelDe(await obtenerPermisosActualesCacheado('u1'), 'productos')).toBe('edicion')
  })

  it('sin empresa activa válida la sección por empresa queda en ninguno (deniega)', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ seccion: 'ventas', nivel: 'ninguno', eliminar: false, exportar: false, ver_costos: false }],
      error: null,
    })
    const permisos = await obtenerPermisosActualesCacheado('u1')
    expect(nivelDe(permisos, 'ventas')).toBe('ninguno')
    expect(nivelPermiteAccionRefine('ninguno', 'list')).toBe(false)
  })
})
