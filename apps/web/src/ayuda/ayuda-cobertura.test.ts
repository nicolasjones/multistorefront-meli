import { describe, expect, it } from 'vitest'
import { DESTINOS_PANEL } from '../components/navegacion/destinosPanel'
import { AYUDA_POR_DESTINO } from './contenidos'
import { ayudaAdministracion } from './contenidos/administracion'
import { ayudaAnalisis } from './contenidos/analisis'
import { ayudaCanales } from './contenidos/canales'
import { ayudaCatalogo } from './contenidos/catalogo'
import { ayudaContactos } from './contenidos/contactos'
import { ayudaInicio } from './contenidos/inicio'
import { ayudaPlataforma } from './contenidos/plataforma'
import { ayudaReportes } from './contenidos/reportes'
import { ayudaService } from './contenidos/service'
import { ayudaStock } from './contenidos/stock'
import { ayudaVentas } from './contenidos/ventas'

// FR-023: cada destino de SECCIONES_PANEL tiene su ayuda y no hay ayudas huérfanas. Si se agrega un destino al menú sin su
// texto (o se renombra un id), este test falla en el CI. Cómo agregar la ayuda de una pantalla: docs/ayuda-en-panel.md.
describe('cobertura de la ayuda (FR-023)', () => {
  const ids = DESTINOS_PANEL.map((d) => d.id)

  it('todo destino del menú tiene entrada de ayuda', () => {
    expect(ids.filter((id) => !(id in AYUDA_POR_DESTINO))).toEqual([])
  })

  it('no hay entradas de ayuda sin destino en el menú', () => {
    expect(Object.keys(AYUDA_POR_DESTINO).filter((id) => !ids.includes(id))).toEqual([])
  })

  it('ningún id de ayuda se repite entre módulos de sección (el spread del índice pisaría una entrada en silencio)', () => {
    const modulos = [ayudaInicio, ayudaCatalogo, ayudaStock, ayudaVentas, ayudaService, ayudaContactos, ayudaCanales, ayudaAnalisis, ayudaReportes, ayudaAdministracion, ayudaPlataforma]
    const claves = modulos.flatMap((m) => Object.keys(m))
    expect(claves.filter((id, i) => claves.indexOf(id) !== i)).toEqual([])
    expect(claves.length).toBe(Object.keys(AYUDA_POR_DESTINO).length)
  })

  it('los ids de destino son únicos (si no, dos pantallas compartirían la misma ayuda)', () => {
    expect(new Set(ids).size).toBe(ids.length)
  })
})
