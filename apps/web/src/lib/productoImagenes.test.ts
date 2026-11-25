import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_BYTES_IMAGEN,
  MAX_BYTES_ORIGEN_IMAGEN,
  type ImagenExistente,
  aplicarCambiosImagenes,
  ordenFinal,
  posicionesLibres,
  prepararImagen,
  rutaImagen,
} from './productoImagenes'

const optimizar = vi.hoisted(() => vi.fn())
vi.mock('./optimizarImagen', () => ({ optimizarImagen: optimizar }))

const archivo = (nombre: string, tipo: string, tamano = 10) => {
  const f = new File(['x'], nombre, { type: tipo })
  Object.defineProperty(f, 'size', { value: tamano })
  return f
}

const existente = (id: string, posicion: number): ImagenExistente => ({ id, posicion, ruta: `o/p/${id}.png`, url: null })

describe('prepararImagen', () => {
  beforeEach(() => optimizar.mockReset().mockImplementation(async (f: File) => f))

  it('acepta JPG, PNG y WebP dentro del tope', async () => {
    for (const tipo of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(await prepararImagen(archivo('a', tipo), 0)).toHaveProperty('archivo')
    }
  })

  it('rechaza otros formatos (GIF, SVG) con un mensaje claro y sin optimizar', async () => {
    expect(await prepararImagen(archivo('a.gif', 'image/gif'), 0)).toEqual({ error: '«a.gif» no es JPG, PNG ni WebP.' })
    expect(await prepararImagen(archivo('a.svg', 'image/svg+xml'), 0)).toHaveProperty('error', expect.stringContaining('no es JPG, PNG ni WebP'))
    expect(optimizar).not.toHaveBeenCalled()
  })

  it('rechaza de origen más de 15 MB pero admite exactamente 15 MB', async () => {
    optimizar.mockResolvedValue(archivo('a.webp', 'image/webp', 100))
    expect(await prepararImagen(archivo('a.png', 'image/png', MAX_BYTES_ORIGEN_IMAGEN), 0)).toHaveProperty('archivo')
    expect(await prepararImagen(archivo('a.png', 'image/png', MAX_BYTES_ORIGEN_IMAGEN + 1), 0)).toEqual({ error: '«a.png» pesa más de 15 MB.' })
  })

  it('acepta un origen de 12 MB si el optimizado entra en 2 MB y entrega el optimizado', async () => {
    const optimizado = archivo('foto.webp', 'image/webp', 200 * 1024)
    optimizar.mockResolvedValue(optimizado)
    const resultado = await prepararImagen(archivo('foto.jpg', 'image/jpeg', 12 * 1024 * 1024), 0)
    expect(resultado).toEqual({ archivo: optimizado })
  })

  it('si el optimizado sigue pasando de 2 MB, da un error claro', async () => {
    optimizar.mockResolvedValue(archivo('foto.webp', 'image/webp', MAX_BYTES_IMAGEN + 1))
    expect(await prepararImagen(archivo('foto.jpg', 'image/jpeg', 12 * 1024 * 1024), 0)).toEqual({
      error: '«foto.jpg» sigue pesando más de 2 MB aun optimizada: usá una imagen más chica.',
    })
  })

  it('rechaza la quinta imagen', async () => {
    expect(await prepararImagen(archivo('a.png', 'image/png'), 4)).toHaveProperty('error', expect.stringContaining('Ya hay 4 imágenes'))
  })
})

describe('posiciones y orden', () => {
  it('asigna las primeras posiciones libres', () => {
    expect(posicionesLibres([2, 3], 2)).toEqual([1, 4])
    expect(posicionesLibres([1, 2, 3, 4], 1)).toEqual([])
  })

  it('la menor posición es la principal y quitar promueve a la siguiente', () => {
    const existentes = [existente('a', 1), existente('b', 2)]
    const sinPrimera = ordenFinal(existentes, { nuevas: [], eliminadas: ['a'] })
    expect(sinPrimera.map((e) => e.posicion)).toEqual([2])
    expect(sinPrimera[0].tipo === 'existente' && sinPrimera[0].imagen.id).toBe('b')
  })

  it('una nueva ocupa el hueco que dejó la principal quitada', () => {
    const nueva = archivo('n.png', 'image/png')
    const orden = ordenFinal([existente('a', 1), existente('b', 2)], { nuevas: [nueva], eliminadas: ['a'] })
    expect(orden.map((e) => [e.tipo, e.posicion])).toEqual([['nueva', 1], ['existente', 2]])
  })
})

describe('rutaImagen', () => {
  it('cuelga del prefijo organización/producto y conserva la extensión', () => {
    expect(rutaImagen('org', 'prod', archivo('x', 'image/webp'))).toMatch(/^org\/prod\/[0-9a-f-]{36}\.webp$/)
    expect(rutaImagen('org', 'prod', archivo('x', 'image/jpeg'))).toMatch(/\.jpg$/)
  })
})

describe('aplicarCambiosImagenes', () => {
  it('una imagen que no se pudo quitar sigue ocupando su posición', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const insertar = vi.fn().mockResolvedValue({ error: null })
    const cliente = {
      schema: () => ({
        from: () => ({
          delete: () => ({ eq: () => ({ select: () => Promise.resolve({ data: null, error: { code: '42501', message: 'rls' } }) }) }),
          insert: insertar,
        }),
      }),
      storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ error: null }), remove: vi.fn().mockResolvedValue({ error: null }) }) },
    } as unknown as Parameters<typeof aplicarCambiosImagenes>[0]
    const existentes = [1, 2].map((posicion) => ({ id: `i-${posicion}`, posicion, ruta: `o/p/${posicion}.png`, url: null }))
    const resultado = await aplicarCambiosImagenes(cliente, {
      organizacionId: 'o',
      productoId: 'p',
      existentes,
      cambios: { nuevas: [archivo('n.png', 'image/png')], eliminadas: ['i-1'] },
    })
    expect(insertar).toHaveBeenCalledWith(expect.objectContaining({ posicion: 3 }))
    expect(resultado.errores).toEqual(['Tu rol no puede modificar las imágenes de este producto.'])
    expect(resultado.noEliminadas).toEqual(['i-1'])
  })

  it('si el insert lanza una excepción, borra el archivo ya subido', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const quitar = vi.fn().mockResolvedValue({ error: null })
    const cliente = {
      schema: () => ({ from: () => ({ insert: vi.fn().mockRejectedValue(new Error('red')) }) }),
      storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ error: null }), remove: quitar }) },
    } as unknown as Parameters<typeof aplicarCambiosImagenes>[0]
    const nueva = archivo('n.png', 'image/png')
    const resultado = await aplicarCambiosImagenes(cliente, {
      organizacionId: 'o',
      productoId: 'p',
      existentes: [],
      cambios: { nuevas: [nueva], eliminadas: [] },
    })
    expect(quitar).toHaveBeenCalledWith([expect.stringMatching(/^o\/p\//)])
    expect(resultado.fallidas).toEqual([nueva])
    expect(resultado.errores).toEqual(['No pudimos subir «n.png».'])
  })
})
