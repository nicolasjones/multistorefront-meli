import { beforeEach, describe, expect, it, vi } from 'vitest'

// SC-004 (F-ROL-02): lo que se guarda en la matriz se refleja en el menú y las
// rutas. Usa la librería de permisos real (caché incluida); solo se simula el
// servidor: `permisos_actuales` devuelve la matriz vigente y la RPC de guardado la cambia.
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  checkIsSuperadmin: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabaseClient: { auth: { getUser: mocks.getUser }, rpc: mocks.rpc },
}))
vi.mock('../lib/superadmin', () => ({
  checkIsSuperadmin: mocks.checkIsSuperadmin,
  checkOrganizacionActiva: vi.fn(),
}))
vi.mock('../lib/features', () => ({ checkFeatureHabilitada: vi.fn() }))

import { guardarMatrizPermisos, invalidarCachePermisos, restablecerMatrizPermisos } from '../lib/permisos'
import { accessControlProvider } from './accessControlProvider'

const puede = (action: string) => accessControlProvider.can({ resource: 'roles', action })

describe('la matriz guardada se refleja en menú y rutas (SC-004)', () => {
  let nivel: 'edicion' | 'lectura' | 'ninguno'

  beforeEach(() => {
    vi.resetAllMocks()
    invalidarCachePermisos()
    nivel = 'edicion'
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u-operador' } } })
    mocks.checkIsSuperadmin.mockResolvedValue(false)
    mocks.rpc.mockImplementation(async (nombre: string, args?: { p_niveles: { nivel: typeof nivel }[] }) => {
      if (nombre === 'permisos_actuales') {
        return { data: [{ seccion: 'usuarios_permisos', nivel, eliminar: false, exportar: false, ver_costos: false }], error: null }
      }
      if (nombre === 'guardar_matriz_permisos') {
        nivel = args!.p_niveles[0].nivel
      }
      if (nombre === 'restablecer_matriz_permisos') {
        nivel = 'edicion'
      }
      return { error: null }
    })
  })

  it('quitar el acceso a la sección oculta el ítem y bloquea la ruta sin recargar', async () => {
    expect(await puede('list')).toEqual({ can: true })

    await guardarMatrizPermisos([{ rol_id: 'operador', seccion: 'usuarios_permisos', nivel: 'ninguno' }], [])

    expect(await puede('list')).toEqual({ can: false })
    expect(await puede('show')).toEqual({ can: false })
  })

  it('bajar a solo lectura conserva list y niega la edición', async () => {
    await guardarMatrizPermisos([{ rol_id: 'operador', seccion: 'usuarios_permisos', nivel: 'lectura' }], [])

    expect(await puede('list')).toEqual({ can: true })
    expect(await puede('edit')).toEqual({ can: false })
  })

  it('restablecer vuelve a ofrecer lo que se había quitado', async () => {
    await guardarMatrizPermisos([{ rol_id: 'operador', seccion: 'usuarios_permisos', nivel: 'ninguno' }], [])
    expect(await puede('list')).toEqual({ can: false })

    await restablecerMatrizPermisos()

    expect(await puede('list')).toEqual({ can: true })
  })
})
