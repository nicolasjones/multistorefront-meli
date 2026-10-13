import { beforeEach, describe, expect, it, vi } from 'vitest'
import migracionRoles from '../../../../supabase/migrations/20261013130002_roles_basicos_permisos.sql?raw'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import {
  ETIQUETA_ROL,
  invalidarCachePermisos,
  nivelDe,
  obtenerPermisosActualesCacheado,
  puedeAccionEn,
  type PermisoSeccion,
} from './permisos'

const fila = (seccion: string, extra: Partial<PermisoSeccion> = {}): PermisoSeccion => ({
  seccion,
  nivel: 'edicion',
  eliminar: false,
  exportar: false,
  ver_costos: false,
  ...extra,
})

describe('puedeAccionEn / nivelDe', () => {
  it('devuelve la acción de la sección y deniega si no hay fila', () => {
    const permisos = [fila('ventas', { eliminar: true })]
    expect(puedeAccionEn(permisos, 'ventas', 'eliminar')).toBe(true)
    expect(puedeAccionEn(permisos, 'ventas', 'exportar')).toBe(false)
    expect(puedeAccionEn(permisos, 'stock', 'eliminar')).toBe(false)
    expect(nivelDe(permisos, 'stock')).toBe('ninguno')
  })
})

describe('obtenerPermisosActualesCacheado', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    invalidarCachePermisos()
  })

  it('comparte una sola RPC entre evaluaciones simultáneas del mismo usuario', async () => {
    mocks.rpc.mockResolvedValue({ data: [fila('ventas')], error: null })
    const resultados = await Promise.all([
      obtenerPermisosActualesCacheado('u1'),
      obtenerPermisosActualesCacheado('u1'),
      obtenerPermisosActualesCacheado('u1'),
    ])
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(resultados[2]).toEqual([fila('ventas')])
  })

  it('cambiar de usuario o invalidar vuelve a consultar', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await obtenerPermisosActualesCacheado('u1')
    await obtenerPermisosActualesCacheado('u2')
    invalidarCachePermisos()
    await obtenerPermisosActualesCacheado('u2')
    expect(mocks.rpc).toHaveBeenCalledTimes(3)
  })

  it('no cachea los fallos', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    await expect(obtenerPermisosActualesCacheado('u1')).rejects.toThrow('boom')
    mocks.rpc.mockResolvedValueOnce({ data: [fila('ventas')], error: null })
    await expect(obtenerPermisosActualesCacheado('u1')).resolves.toEqual([fila('ventas')])
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })
})

describe('ETIQUETA_ROL', () => {
  it('cubre los roles sembrados en roles_organizacion', () => {
    // Solo el bloque INSERT: un rol mencionado en un comentario no cuenta.
    const insercion = /insert into public\.roles_organizacion[\s\S]*?;/i.exec(migracionRoles)?.[0] ?? ''
    expect(insercion).not.toBe('')
    const sembrados = [...insercion.matchAll(/\(\s*'([a-z_]+)'\s*,/g)].map(([, id]) => id)
    expect(sembrados).toEqual(['operador', 'consulta', 'mostrador', 'deposito', 'administracion'])
    // `administrador` y `miembro` ya existían en el template.
    for (const rol of [...sembrados, 'administrador', 'miembro']) {
      expect(ETIQUETA_ROL[rol], rol).toBeTruthy()
    }
  })
})
