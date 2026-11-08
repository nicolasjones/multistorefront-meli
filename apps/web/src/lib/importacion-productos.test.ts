import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { COLUMNAS_PLANTILLA, ErrorImportacion, MAX_IMAGENES_CARGA, armarPlantilla, armarReporteErrores, importacionDeUrl, leerImagenes, leerPlanillaProductos, normalizarCsv, normalizarImporte, validarImagenCarga } from './importacion-productos'
import { TAMANO_MAXIMO_BYTES } from './migracionCsv'


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

describe('leerImagenes · topes y nombres repetidos', () => {
  const limites = { maxImagenes: 500, maxBytesZip: 50 * 1024 * 1024, maxBytesDescomprimido: 10 }

  it('el tope de bytes descomprimidos se aplica y descarta lo que lo pasa (parametrizado, sin crear 100 MB)', async () => {
    const { imagenes, rechazadas } = await leerImagenes(
      [zipDe({ 'a.jpg': new Uint8Array(6).fill(1), 'b.jpg': new Uint8Array(6).fill(2) })],
      limites,
    )
    expect(imagenes).toHaveLength(1)
    expect(rechazadas.join(' ')).toMatch(/1 imagen\(es\) no entran/)
  })

  it('el tope se comprueba con el tamaño REAL descomprimido, no con el que declara la cabecera', async () => {
    // Cabecera mentirosa: el ZIP declara 1 byte por entrada (originalSize) pero cada una descomprime a 6.
    const bytes = zipSync({ 'a.jpg': new Uint8Array(6).fill(1), 'b.jpg': new Uint8Array(6).fill(2) }, { level: 0 })
    const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let i = 0; i + 46 <= bytes.length; i += 1) {
      // Registro del directorio central (firma PK\x01\x02): tamaño sin comprimir en el offset 24.
      if (vista.getUint32(i, true) === 0x02014b50) vista.setUint32(i + 24, 1, true)
    }
    const archivo = { name: 'mentira.zip', size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } as unknown as File
    const { imagenes } = await leerImagenes([archivo], limites)
    const total = imagenes.reduce((suma, imagen) => suma + imagen.blob.size, 0)
    expect(total).toBeLessThanOrEqual(limites.maxBytesDescomprimido)
  })

  it('un ZIP de más de maxBytesZip se rechaza sin abrirlo', async () => {
    const { imagenes, rechazadas } = await leerImagenes([zipDe({ 'a.jpg': new Uint8Array([1]) })], { ...limites, maxBytesZip: 10 })
    expect(imagenes).toHaveLength(0)
    expect(rechazadas.join(' ')).toMatch(/pesa más de/)
  })

  it('gana la primera: mismo nombre en dos ZIP o en un ZIP y un archivo suelto', async () => {
    const suelta = new File([new Uint8Array([9])], 'a.jpg', { type: 'image/jpeg' })
    const { imagenes, rechazadas } = await leerImagenes([
      zipDe({ 'a.jpg': new Uint8Array([1]) }),
      zipDe({ 'x/a.jpg': new Uint8Array([2]), 'c.jpg': new Uint8Array([3]) }),
      suelta,
    ])
    expect(imagenes.map((i) => i.nombre).sort()).toEqual(['a.jpg', 'c.jpg'])
    expect(imagenes.find((i) => i.nombre === 'a.jpg')!.blob.size).toBe(1)
    expect(rechazadas.filter((m) => m.includes('«a.jpg»'))).toHaveLength(2)
  })
})

describe('leerPlanillaProductos · archivos límite (hallazgo 9)', () => {
  const csv = (contenido: string, nombre = 'productos.csv') => new File([contenido], nombre, { type: 'text/csv' })

  it('un CSV vacío no avanza', async () => {
    await expect(leerPlanillaProductos(csv(''))).rejects.toThrow(new ErrorImportacion('El archivo está vacío.'))
  })

  it('un CSV con solo el encabezado no avanza', async () => {
    await expect(leerPlanillaProductos(csv('sku,nombre,categoria\n'))).rejects.toThrow('no tiene filas para importar')
  })

  it('un CSV de más de 25 MB se rechaza sin leerlo', async () => {
    const enorme = { name: 'productos.csv', size: TAMANO_MAXIMO_BYTES + 1, arrayBuffer: () => Promise.reject(new Error('no debe leerse')) }
    await expect(leerPlanillaProductos(enorme as never)).rejects.toThrow('supera los 25 MB')
  })
})

describe('importacionDeUrl', () => {
  it('acepta solo un UUID', () => {
    expect(importacionDeUrl('5b1c9c2e-7f3a-4d51-9a0e-0c2f4a6b8d10')).toBe('5b1c9c2e-7f3a-4d51-9a0e-0c2f4a6b8d10')
    expect(importacionDeUrl('imp-1')).toBeNull()
    expect(importacionDeUrl(null)).toBeNull()
  })
})
