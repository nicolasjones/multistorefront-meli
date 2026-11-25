import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dimensionesOptimizadas, optimizarImagen } from './optimizarImagen'

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
})
