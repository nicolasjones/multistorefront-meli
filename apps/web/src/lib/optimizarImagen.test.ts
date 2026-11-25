import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepararImagen } from './productoImagenes'
import { ImagenDemasiadoGrandeError, dimensionesOptimizadas, optimizarImagen } from './optimizarImagen'

const archivo = (nombre: string, tipo: string, tamano: number) => {
  const f = new File(['x'], nombre, { type: tipo })
  Object.defineProperty(f, 'size', { value: tamano })
  return f
}

type Simulacion = { ancho: number; alto: number; bytesSalida: number; tipoSalida?: string }

// Simula createImageBitmap y OffscreenCanvas (jsdom no tiene canvas real).
function simular({ ancho, alto, bytesSalida, tipoSalida = 'image/webp' }: Simulacion) {
  const cerrar = vi.fn()
  const dibujar = vi.fn()
  const lienzos: Array<{ ancho: number; alto: number }> = []
  const crear = vi.fn().mockResolvedValue({ width: ancho, height: alto, close: cerrar })
  class LienzoFalso {
    constructor(width: number, alto: number) { lienzos.push({ ancho: width, alto }) }
    getContext() { return { drawImage: dibujar } }
    async convertToBlob() {
      const blob = new Blob(['x'], { type: tipoSalida })
      Object.defineProperty(blob, 'size', { value: bytesSalida })
      return blob
    }
  }
  vi.stubGlobal('createImageBitmap', crear)
  vi.stubGlobal('OffscreenCanvas', LienzoFalso)
  return { cerrar, dibujar, lienzos, crear }
}

describe('dimensionesOptimizadas', () => {
  it('reduce el lado largo a 1600 manteniendo la proporción', () => {
    expect(dimensionesOptimizadas(4000, 3000)).toEqual({ ancho: 1600, alto: 1200 })
    expect(dimensionesOptimizadas(3000, 4000)).toEqual({ ancho: 1200, alto: 1600 })
  })
  it('no agranda nunca', () => {
    expect(dimensionesOptimizadas(800, 600)).toEqual({ ancho: 800, alto: 600 })
    expect(dimensionesOptimizadas(1600, 1600)).toEqual({ ancho: 1600, alto: 1600 })
  })
})

describe('optimizarImagen', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it('redimensiona, recodifica a WebP y devuelve un File con nombre y tipo nuevos', async () => {
    const sim = simular({ ancho: 4000, alto: 3000, bytesSalida: 150_000 })
    const salida = await optimizarImagen(archivo('foto.celular.JPG', 'image/jpeg', 4_000_000))
    expect(sim.crear).toHaveBeenCalledWith(expect.any(File), { imageOrientation: 'from-image' })
    expect(sim.lienzos).toEqual([{ ancho: 1600, alto: 1200 }])
    expect(sim.dibujar).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1200)
    expect(salida.name).toBe('foto.celular.webp')
    expect(salida.type).toBe('image/webp')
    expect(sim.cerrar).toHaveBeenCalled()
  })

  it('no agranda una imagen chica', async () => {
    const sim = simular({ ancho: 800, alto: 600, bytesSalida: 10_000 })
    await optimizarImagen(archivo('a.png', 'image/png', 500_000))
    expect(sim.lienzos).toEqual([{ ancho: 800, alto: 600 }])
  })

  it('conserva el original si el resultado no es más chico', async () => {
    simular({ ancho: 800, alto: 600, bytesSalida: 50_000 })
    const original = archivo('a.webp', 'image/webp', 50_000)
    expect(await optimizarImagen(original)).toBe(original)
  })

  it('conserva el original si el navegador no codifica WebP', async () => {
    simular({ ancho: 800, alto: 600, bytesSalida: 1_000, tipoSalida: 'image/png' })
    const original = archivo('a.png', 'image/png', 50_000)
    expect(await optimizarImagen(original)).toBe(original)
  })

  it('degrada seguro ante un error de decodificación', async () => {
    const sim = simular({ ancho: 1, alto: 1, bytesSalida: 1 })
    sim.crear.mockRejectedValue(new Error('corrupto'))
    const original = archivo('rota.jpg', 'image/jpeg', 50_000)
    expect(await optimizarImagen(original)).toBe(original)
  })

  it('degrada seguro sin soporte de createImageBitmap', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    const original = archivo('a.jpg', 'image/jpeg', 50_000)
    expect(await optimizarImagen(original)).toBe(original)
  })

  it('degrada seguro sin lienzo disponible', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 10, height: 10, close: vi.fn() }))
    vi.stubGlobal('OffscreenCanvas', undefined)
    vi.stubGlobal('document', undefined)
    const original = archivo('a.jpg', 'image/jpeg', 50_000)
    expect(await optimizarImagen(original)).toBe(original)
  })

  describe('guarda de píxeles por encabezado', () => {
    const conBytes = (bytes: number[], tipo: string) => new File([new Uint8Array(bytes)], 'x', { type: tipo })
    const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
    const png = (ancho: number, alto: number) => conBytes([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...u32(ancho), ...u32(alto)], 'image/png')
    const webpVp8x = (ancho: number, alto: number) => {
      const a = ancho - 1, h = alto - 1
      return conBytes([...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBPVP8X'].map((c) => c.charCodeAt(0)), [10, 0, 0, 0, 0, 0, 0, 0], [a & 255, (a >> 8) & 255, (a >> 16) & 255, h & 255, (h >> 8) & 255, (h >> 16) & 255]), 'image/webp')
    }
    const jpeg = (ancho: number, alto: number) => conBytes([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, (alto >> 8) & 255, alto & 255, (ancho >> 8) & 255, ancho & 255, 1, 0, 0], 'image/jpeg')

    it.each([
      ['PNG', png(30000, 30000)],
      ['WebP VP8X', webpVp8x(20000, 20000)],
      ['JPEG', jpeg(20000, 20000)],
    ])('rechaza %s de más de 100 megapíxeles antes de decodificar', async (_nombre, enorme) => {
      const sim = simular({ ancho: 10, alto: 10, bytesSalida: 1 })
      await expect(optimizarImagen(enorme)).rejects.toBeInstanceOf(ImagenDemasiadoGrandeError)
      expect(sim.crear).not.toHaveBeenCalled()
    })

    it('prepararImagen la rechaza con un error claro de validación', async () => {
      simular({ ancho: 10, alto: 10, bytesSalida: 1 })
      const enorme = png(30000, 30000)
      Object.defineProperty(enorme, 'name', { value: 'enorme.png' })
      expect(await prepararImagen(enorme, 0)).toEqual({ error: '«enorme.png» tiene demasiados píxeles: usá una imagen de menor resolución.' })
    })

    it('deja pasar una imagen de tamaño normal', async () => {
      const sim = simular({ ancho: 4000, alto: 3000, bytesSalida: 10 })
      await optimizarImagen(png(4000, 3000))
      expect(sim.crear).toHaveBeenCalled()
    })

    it('si el encabezado no se puede leer sigue con la degradación segura', async () => {
      simular({ ancho: 10, alto: 10, bytesSalida: 1 })
      const original = archivo('a.png', 'image/png', 50_000)
      await expect(optimizarImagen(original)).resolves.toBeDefined()
    })
  })
})
