import { describe, expect, it } from 'vitest'
import { COLUMNAS_PLANTILLA, armarPlantilla, armarReporteErrores, normalizarCsv, normalizarImporte, validarImagenCarga } from './importacion-productos'


describe('importacion-productos', () => {
  it('la plantilla trae las 12 columnas en orden (FR-102)', () => {
    expect(armarPlantilla().trim().split(',')).toEqual([...COLUMNAS_PLANTILLA])
    expect(COLUMNAS_PLANTILLA).toHaveLength(12)
  })

  it('normaliza importes en formato castellano', () => {
    expect(normalizarImporte('1.200,50')).toBe('1200.50')
    expect(normalizarImporte('$ 2500')).toBe('2500')
    expect(normalizarImporte('12,5')).toBe('12.5')
  })

  it('exige sku, nombre y categoría', () => {
    expect(() => normalizarCsv({ encabezados: ['sku'], filas: [], separador: ',' })).toThrow(/nombre, categoria/)
  })

  it('rechaza más de 2.000 filas', () => {
    const filas = Array.from({ length: 2001 }, (_, i) => ({ numero: i + 2, celdas: ['a', 'b', 'c'] }))
    expect(() => normalizarCsv({ encabezados: ['sku', 'nombre', 'categoria'], filas, separador: ',' })).toThrow(/más de 2\.000/)
  })

  it('valida tipo y peso de las imágenes (FR-103)', () => {
    expect(validarImagenCarga('a.gif', 10)).toMatch(/no es JPG/)
    expect(validarImagenCarga('a.png', 3 * 1024 * 1024)).toMatch(/2 MB/)
    expect(validarImagenCarga('a.webp', 100)).toBeNull()
  })

  it('el reporte de errores neutraliza fórmulas (FR-110)', () => {
    const csv = armarReporteErrores([{ fila: 3, sku: '=CMD()', mensaje: 'Falta, algo' }])
    expect(csv).toContain('fila,sku,motivo')
    expect(csv).not.toContain(',=CMD')
    expect(csv).toContain('"Falta, algo"')
  })
})
