import { describe, expect, it } from 'vitest'
import ImportExportIcon from '@mui/icons-material/ImportExport'
import { panelFixtures } from '../../test/fixtures/panel'
import app from '../../App.tsx?raw'
import { DESTINOS_PANEL, destinoVisible } from './destinosPanel'

const destino = DESTINOS_PANEL.find((d) => d.id === 'importaciones')

describe('[MSF-354:T008] Ítem «Importaciones» de la navegación (FR-011)', () => {
  it('existe con ruta /importaciones e icono', () => {
    expect(destino).toBeDefined()
    expect(destino?.etiqueta).toBe('Importaciones')
    expect(destino?.ruta).toBe('/importaciones')
    expect(destino?.icono).toBe(ImportExportIcon)
  })

  it('lo ve el administrador y no el miembro', () => {
    expect(destinoVisible(destino!, panelFixtures.administrador)).toBe(true)
    expect(destinoVisible(destino!, panelFixtures.miembro)).toBe(false)
  })

  it('la ruta está registrada en la aplicación, con organización activa', () => {
    expect(app).toContain('<Route path="/importaciones" element={<RequiereOrganizacionActiva>')
  })
})
