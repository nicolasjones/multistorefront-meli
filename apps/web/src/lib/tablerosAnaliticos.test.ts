import { describe, expect, it } from 'vitest'
import { TABLEROS_ANALITICOS, tablerosDisponibles } from './tablerosAnaliticos'

describe('catálogo de tableros analíticos (F-REP-07)', () => {
  it('cada tablero se describe para poder elegirlo sin abrirlo: título, descripción, cruces y filtros', () => {
    for (const tablero of TABLEROS_ANALITICOS) {
      expect(tablero.titulo.length).toBeGreaterThan(5)
      expect(tablero.descripcion.length).toBeGreaterThan(20)
      expect(tablero.cruces.length).toBeGreaterThan(0)
      expect(tablero.filtros).toContain('Período')
    }
  })

  it('las claves y los nombres de reporte son únicos', () => {
    expect(new Set(TABLEROS_ANALITICOS.map((t) => t.clave)).size).toBe(TABLEROS_ANALITICOS.length)
    expect(new Set(TABLEROS_ANALITICOS.map((t) => t.nombreReporte)).size).toBe(TABLEROS_ANALITICOS.length)
  })

  it('solo el tablero de margen real muestra costos', () => {
    expect(TABLEROS_ANALITICOS.filter((t) => t.muestraCostos).map((t) => t.clave)).toEqual(['margen-real'])
  })

  it('ofrece solo los tableros del catálogo que el usuario tiene asignados, en el orden del catálogo', () => {
    const disponibles = tablerosDisponibles([
      { id: 'r-3', nombre: 'Ventas · Más vendidos' },
      { id: 'r-1', nombre: 'Analítica · Ventas por tienda y categoría' },
      { id: 'r-9', nombre: 'Un reporte que no está en el catálogo' },
    ])
    expect(disponibles.map((t) => [t.clave, t.reporteId])).toEqual([
      ['ventas-tienda-categoria', 'r-1'],
      ['mas-vendidos', 'r-3'],
    ])
  })

  it('sin reportes asignados no ofrece nada', () => {
    expect(tablerosDisponibles([])).toEqual([])
  })
})
