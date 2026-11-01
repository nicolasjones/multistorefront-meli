import { describe, expect, it } from 'vitest'
import { DESTINOS_PANEL, destinoVisible } from '../../../components/navegacion/destinosPanel'
import { panelFixtures } from '../../../test/fixtures/panel'

describe('Navegación de Inicio (FR-011)', () => {
  const inicio = DESTINOS_PANEL.find((destino) => destino.id === 'inicio')

  it('declara el ítem «Inicio» en la ruta canónica / para todos los roles de organización', () => {
    expect(inicio).toMatchObject({ etiqueta: 'Inicio', ruta: '/', audiencia: 'autenticada', seccionPermiso: 'inicio' })
  })

  it('es visible para un miembro con lectura de Inicio', () => {
    const permisos = [{ seccion: 'inicio', nivel: 'lectura' as const, eliminar: false, exportar: false, ver_costos: false }]
    expect(destinoVisible(inicio!, panelFixtures.miembro, permisos)).toBe(true)
  })
})
