import { describe, expect, it } from 'vitest'
import { DESTINOS_PANEL } from '../components/navegacion/destinosPanel'
import { AYUDA_POR_DESTINO } from './contenidos'

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

  it('los ids de destino son únicos (si no, dos pantallas compartirían la misma ayuda)', () => {
    expect(new Set(ids).size).toBe(ids.length)
  })
})
