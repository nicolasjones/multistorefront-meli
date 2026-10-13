import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PermisoSeccion } from '../lib/permisos'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  checkIsSuperadmin: vi.fn(),
  checkOrganizacionActiva: vi.fn(),
  obtenerPermisosActuales: vi.fn(),
  from: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabaseClient: { auth: { getUser: mocks.getUser }, from: mocks.from },
}))
vi.mock('../lib/superadmin', () => ({
  checkIsSuperadmin: mocks.checkIsSuperadmin,
  checkOrganizacionActiva: mocks.checkOrganizacionActiva,
}))
vi.mock('../lib/features', () => ({ checkFeatureHabilitada: vi.fn() }))
vi.mock('../lib/permisos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/permisos')>()),
  obtenerPermisosActuales: mocks.obtenerPermisosActuales,
}))

import { accessControlProvider } from './accessControlProvider'

const fila = (seccion: string, nivel: PermisoSeccion['nivel']): PermisoSeccion => ({
  seccion,
  nivel,
  eliminar: false,
  exportar: false,
  ver_costos: false,
})

const puede = (resource: string, action: string) => accessControlProvider.can({ resource, action })

describe('accessControlProvider con permisos por sección (F-ROL-01, FR-005)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mocks.checkIsSuperadmin.mockResolvedValue(false)
  })

  it('edición: permite list, show, create, edit y delete', async () => {
    mocks.obtenerPermisosActuales.mockResolvedValue([fila('clientes', 'edicion')])
    for (const action of ['list', 'show', 'create', 'edit', 'delete']) {
      expect(await puede('clientes', action)).toEqual({ can: true })
    }
  })

  it('solo lectura: permite list y show, niega create, edit y delete', async () => {
    mocks.obtenerPermisosActuales.mockResolvedValue([fila('clientes', 'lectura')])
    expect(await puede('clientes', 'list')).toEqual({ can: true })
    expect(await puede('clientes', 'show')).toEqual({ can: true })
    for (const action of ['create', 'edit', 'delete']) {
      expect(await puede('clientes', action)).toEqual({ can: false })
    }
  })

  it('sin acceso: niega todo, incluido listar por URL', async () => {
    mocks.obtenerPermisosActuales.mockResolvedValue([fila('clientes', 'ninguno')])
    for (const action of ['list', 'show', 'create', 'edit', 'delete']) {
      expect(await puede('clientes', action)).toEqual({ can: false })
    }
  })

  it('sin fila para la sección: niega (nunca acceso total por omisión)', async () => {
    mocks.obtenerPermisosActuales.mockResolvedValue([])
    expect(await puede('clientes', 'list')).toEqual({ can: false })
  })

  it('si la consulta de permisos falla, niega', async () => {
    mocks.obtenerPermisosActuales.mockRejectedValue(new Error('boom'))
    expect(await puede('clientes', 'list')).toEqual({ can: false })
  })

  it('sin sesión: niega', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } })
    expect(await puede('clientes', 'list')).toEqual({ can: false })
  })

  it('Miembros conserva además su control de administrador del template', async () => {
    mocks.obtenerPermisosActuales.mockResolvedValue([fila('usuarios_permisos', 'edicion')])
    mocks.from.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { rol_id: 'operador' } }) }) }),
    })
    expect(await puede('miembros', 'list')).toEqual({ can: false })
  })

  it('el superadmin no consulta la matriz: sigue su camino por organización activa', async () => {
    mocks.checkIsSuperadmin.mockResolvedValue(true)
    mocks.checkOrganizacionActiva.mockResolvedValue({ id: 'o1', nombre: 'Org' })
    expect(await puede('clientes', 'delete')).toEqual({ can: true })
    expect(mocks.obtenerPermisosActuales).not.toHaveBeenCalled()
  })

  it('un recurso fuera de la matriz no consulta permisos', async () => {
    expect(await puede('ejecuciones', 'list')).toEqual({ can: true })
    expect(mocks.obtenerPermisosActuales).not.toHaveBeenCalled()
  })
})
