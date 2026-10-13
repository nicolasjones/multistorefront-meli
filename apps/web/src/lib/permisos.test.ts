import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    const migracion = readFileSync(
      resolve(__dirname, '../../../../supabase/migrations/20261013130000_roles_basicos_permisos.sql'),
      'utf8',
    )
    for (const rol of ['administrador', 'miembro', 'operador', 'consulta', 'mostrador', 'deposito', 'administracion']) {
      expect(migracion).toContain(`'${rol}'`)
      expect(ETIQUETA_ROL[rol]).toBeTruthy()
    }
  })
})
