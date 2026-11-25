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

    const ascii = (t: string) => [...t].map((c) => c.charCodeAt(0))
    const riff = (forma: string, resto: number[]) => conBytes([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii(forma), 0, 0, 0, 0, ...resto, 0, 0, 0, 0, 0, 0, 0, 0], 'image/webp')
    const webpVp8l = (ancho: number, alto: number) => {
      const bits = (ancho - 1) | ((alto - 1) << 14)
      return riff('VP8L', [0x2f, bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, (bits >>> 24) & 255])
    }
    const webpVp8 = (ancho: number, alto: number) => riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ancho & 255, ancho >> 8, alto & 255, alto >> 8])
    const sof = (marcador: number, ancho: number, alto: number) => [0xff, marcador, 0, 11, 8, alto >> 8, alto & 255, ancho >> 8, ancho & 255, 1, 0, 0, 0]

    it.each([
      ['WebP VP8L', webpVp8l(12000, 12000), webpVp8l(9000, 9000)],
      ['WebP VP8 lossy', webpVp8(12000, 12000), webpVp8(9000, 9000)],
      ['JPEG progresivo (SOF2)', conBytes([0xff, 0xd8, ...sof(0xc2, 12000, 12000)], 'image/jpeg'), conBytes([0xff, 0xd8, ...sof(0xc2, 9000, 9000)], 'image/jpeg')],
      ['JPEG con marcadores sin longitud antes del SOF', conBytes([0xff, 0xd8, 0xff, 0xd0, 0xff, 0x01, 0xff, 0xd1, ...sof(0xc0, 12000, 12000)], 'image/jpeg'), conBytes([0xff, 0xd8, 0xff, 0xd0, 0xff, 0x01, 0xff, 0xd1, ...sof(0xc0, 9000, 9000)], 'image/jpeg')],
    ])('%s: sobre el límite se rechaza y bajo el límite pasa', async (_nombre, sobre, bajo) => {
      const sim = simular({ ancho: 10, alto: 10, bytesSalida: 1 })
      await expect(optimizarImagen(sobre)).rejects.toBeInstanceOf(ImagenDemasiadoGrandeError)
      expect(sim.crear).not.toHaveBeenCalled()
      await optimizarImagen(bajo)
      expect(sim.crear).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['PNG de menos de 24 bytes', conBytes([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0xff, 0xff], 'image/png')],
      ['WebP de menos de 30 bytes', conBytes([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBPVP8X'), 0, 0, 0, 0, 0xff, 0xff], 'image/webp')],
      ['JPEG cortado antes del SOF', conBytes([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0, 0, 0, 0, 0, 0], 'image/jpeg')],
      ['JPEG con basura donde debería ir un marcador', conBytes([0xff, 0xd8, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'image/jpeg')],
      ['archivo vacío', conBytes([], 'image/png')],
    ])('encabezado ilegible (%s): sigue con la degradación segura, sin error y sin rechazar', async (_nombre, truncado) => {
      const sim = simular({ ancho: 10, alto: 10, bytesSalida: 1_000_000 })
      // El resultado simulado no es más chico que el original: se conserva el original.
      await expect(optimizarImagen(truncado)).resolves.toBe(truncado)
      expect(sim.crear).toHaveBeenCalledTimes(1)
    })
  })
})

describe('optimizarImagen: lado máximo por uso', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it.each([[512, 512, 384], [1024, 1024, 768], [1920, 1920, 1440]])('con lado máximo %i reduce 4000×3000 a %i×%i', async (lado, ancho, alto) => {
    const sim = simular({ ancho: 4000, alto: 3000, bytesSalida: 10_000 })
    await optimizarImagen(archivo('a.jpg', 'image/jpeg', 4_000_000), lado)
    expect(sim.lienzos).toEqual([{ ancho, alto }])
  })

  it.each([0, -5, Number.NaN, Infinity, -Infinity])('un lado máximo inválido (%s) se ignora y se usa 1600', async (lado) => {
    const sim = simular({ ancho: 4000, alto: 3000, bytesSalida: 10_000 })
    await optimizarImagen(archivo('a.jpg', 'image/jpeg', 4_000_000), lado)
    expect(sim.lienzos).toEqual([{ ancho: 1600, alto: 1200 }])
  })

  it('un lado máximo entero positivo se respeta', async () => {
    const sim = simular({ ancho: 4000, alto: 3000, bytesSalida: 10_000 })
    await optimizarImagen(archivo('a.jpg', 'image/jpeg', 4_000_000), 800)
    expect(sim.lienzos).toEqual([{ ancho: 800, alto: 600 }])
  })

  it('un lado máximo decimal positivo se respeta (sin caer a 1×1 ni al valor por defecto)', async () => {
    const sim = simular({ ancho: 4000, alto: 3000, bytesSalida: 10_000 })
    await optimizarImagen(archivo('a.jpg', 'image/jpeg', 4_000_000), 1000.5)
    expect(sim.lienzos[0].ancho).toBeGreaterThanOrEqual(1000)
    expect(sim.lienzos[0].ancho).toBeLessThanOrEqual(1001)
  })

  it('sin parámetro mantiene el lado de 1600 de las fotos de producto', async () => {
    const sim = simular({ ancho: 4000, alto: 3000, bytesSalida: 10_000 })
    await optimizarImagen(archivo('a.jpg', 'image/jpeg', 4_000_000))
    expect(sim.lienzos).toEqual([{ ancho: 1600, alto: 1200 }])
  })

  it.each([['logo.svg', 'image/svg+xml'], ['favicon.ico', 'image/x-icon'], ['animada.gif', 'image/gif']])('%s no se toca: se devuelve el mismo archivo', async (nombre, tipo) => {
    const sim = simular({ ancho: 4000, alto: 3000, bytesSalida: 10 })
    const original = archivo(nombre, tipo, 5_000_000)
    expect(await optimizarImagen(original, 512)).toBe(original)
    expect(sim.crear).not.toHaveBeenCalled()
  })

  it('prepararImagen de producto sigue usando 1600 px', async () => {
    const sim = simular({ ancho: 4000, alto: 3000, bytesSalida: 10_000 })
    const r = await prepararImagen(archivo('a.jpg', 'image/jpeg', 4_000_000), 0)
    expect('archivo' in r).toBe(true)
    expect(sim.lienzos).toEqual([{ ancho: 1600, alto: 1200 }])
  })
})
