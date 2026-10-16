import { describe, expect, it } from 'vitest'
import { panelFixtures } from '../../test/fixtures/panel'
import type { PermisoSeccion } from '../../lib/permisos'
import { SECCION_POR_RECURSO } from '../../lib/permisos'
import { DESTINOS_PANEL, destinoVisible } from './destinosPanel'

const sinAcciones = { eliminar: false, exportar: false, ver_costos: false }
const permisos = (...filas: [string, PermisoSeccion['nivel']][]): PermisoSeccion[] =>
  filas.map(([seccion, nivel]) => ({ seccion, nivel, ...sinAcciones }))

const destino = (id: string) => {
  const encontrado = DESTINOS_PANEL.find((d) => d.id === id)
  if (!encontrado) throw new Error(`destino ${id} no existe`)
  return encontrado
}

describe('destinoVisible con permisos por sección (F-ROL-01, FR-005)', () => {
  it('oculta del menú la sección sin acceso', () => {
    const p = permisos(['inicio', 'lectura'], ['clientes', 'ninguno'])
    expect(destinoVisible(destino('clientes'), panelFixtures.miembro, p)).toBe(false)
    expect(destinoVisible(destino('inicio'), panelFixtures.miembro, p)).toBe(true)
  })

  it('muestra la sección en solo lectura y en edición', () => {
    expect(destinoVisible(destino('clientes'), panelFixtures.miembro, permisos(['clientes', 'lectura']))).toBe(true)
    expect(destinoVisible(destino('clientes'), panelFixtures.miembro, permisos(['clientes', 'edicion']))).toBe(true)
  })

  it('una sección sin fila se trata como sin acceso (nunca acceso total por omisión)', () => {
    expect(destinoVisible(destino('clientes'), panelFixtures.miembro, [])).toBe(false)
  })

  it('un destino sin sección de la matriz (plataforma) no depende de los permisos', () => {
    expect(destinoVisible(destino('ejecuciones'), panelFixtures.miembro, [])).toBe(true)
  })

  it('sin permisos cargados no filtra (compatibilidad sin PermisosPanelProvider)', () => {
    expect(destinoVisible(destino('clientes'), panelFixtures.miembro)).toBe(true)
    expect(destinoVisible(destino('clientes'), panelFixtures.miembro, null)).toBe(true)
  })

  it('la audiencia sigue mandando: Miembros exige administrador aunque la matriz dé acceso', () => {
    const p = permisos(['usuarios_permisos', 'edicion'])
    expect(destinoVisible(destino('usuarios'), panelFixtures.miembro, p)).toBe(false)
    expect(destinoVisible(destino('usuarios'), panelFixtures.administrador, p)).toBe(true)
  })

  it('un administrador sin acceso a Usuarios y permisos no ve Miembros', () => {
    expect(destinoVisible(destino('usuarios'), panelFixtures.administrador, permisos(['usuarios_permisos', 'ninguno']))).toBe(false)
  })

  it('un superadmin sin organización activa no queda filtrado por la matriz', () => {
    expect(destinoVisible(destino('inicio'), panelFixtures.superadmin, [])).toBe(true)
  })
})

describe('destino Actividad por nivel de la sección (F-AUD-01, FR-005, FR-008)', () => {
  it('lo ven quienes tienen lectura o edición, también sin ser administradores', () => {
    expect(destinoVisible(destino('actividad'), panelFixtures.miembro, permisos(['actividad', 'lectura']))).toBe(true)
    expect(destinoVisible(destino('actividad'), panelFixtures.administrador, permisos(['actividad', 'edicion']))).toBe(true)
  })

  it('no aparece en el menú con nivel ninguno ni sin fila en la matriz', () => {
    expect(destinoVisible(destino('actividad'), panelFixtures.miembro, permisos(['actividad', 'ninguno']))).toBe(false)
    expect(destinoVisible(destino('actividad'), panelFixtures.miembro, [])).toBe(false)
  })

  it('sigue a la matriz: el mismo usuario lo gana o lo pierde sin tocar código', () => {
    expect(destinoVisible(destino('actividad'), panelFixtures.miembro, permisos(['actividad', 'ninguno']))).toBe(false)
    expect(destinoVisible(destino('actividad'), panelFixtures.miembro, permisos(['actividad', 'lectura']))).toBe(true)
  })

  it('apunta a /actividad y la ruta del recurso usa la sección «actividad»', () => {
    expect(destino('actividad').ruta).toBe('/actividad')
    expect(SECCION_POR_RECURSO.actividad).toBe('actividad')
  })
})

describe('coherencia menú ↔ rutas (F-ROL-01)', () => {
  it('cada recurso de SECCION_POR_RECURSO con destino de menú usa la misma sección', () => {
    for (const [recurso, seccion] of Object.entries(SECCION_POR_RECURSO)) {
      const d = DESTINOS_PANEL.find((x) => x.ruta === `/${recurso}`)
      expect(d, `destino para ${recurso}`).toBeDefined()
      expect(d?.seccionPermiso).toBe(seccion)
    }
  })
})
