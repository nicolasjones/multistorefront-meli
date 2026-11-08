import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { COLUMNAS_PLANTILLA, MAX_IMAGENES_CARGA, armarPlantilla, armarReporteErrores, leerImagenes, normalizarCsv, normalizarImporte, validarImagenCarga } from './importacion-productos'


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

// Un ZIP en memoria con la forma mínima de `File` que usa `leerImagenes` (name, size, arrayBuffer).
function zipDe(entradas: Record<string, Uint8Array>): File {
  const bytes = zipSync(entradas)
  return { name: 'imagenes.zip', size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } as unknown as File
}

describe('leerImagenes · ZIP', () => {
  it('abre el ZIP y conserva las imágenes válidas', async () => {
    const { imagenes, rechazadas } = await leerImagenes([zipDe({ 'a.jpg': new Uint8Array([1]), 'sub/b.png': new Uint8Array([2]) })])
    expect(imagenes.map((i) => i.nombre).sort()).toEqual(['a.jpg', 'b.png'])
    expect(rechazadas).toEqual([])
  })

  it('avisa cuando dos carpetas traen el mismo nombre y se queda con la primera', async () => {
    const { imagenes, rechazadas } = await leerImagenes([zipDe({ 'uno/a.jpg': new Uint8Array([1]), 'dos/a.jpg': new Uint8Array([2]) })])
    expect(imagenes).toHaveLength(1)
    expect(rechazadas.join(' ')).toMatch(/«a\.jpg» aparece más de una vez/)
  })

  it('no expande más de MAX_IMAGENES_CARGA entradas y lo informa', async () => {
    const muchas: Record<string, Uint8Array> = {}
    for (let i = 0; i < MAX_IMAGENES_CARGA + 3; i += 1) muchas[`img-${i}.jpg`] = new Uint8Array([1])
    const { imagenes, rechazadas } = await leerImagenes([zipDe(muchas)])
    expect(imagenes).toHaveLength(MAX_IMAGENES_CARGA)
    expect(rechazadas.join(' ')).toMatch(/3 imagen\(es\) no entran/)
  })
})
