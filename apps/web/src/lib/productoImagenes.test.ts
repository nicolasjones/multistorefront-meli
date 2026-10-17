import { describe, expect, it, vi } from 'vitest'
import {
  MAX_BYTES_IMAGEN,
  type ImagenExistente,
  aplicarCambiosImagenes,
  ordenFinal,
  posicionesLibres,
  rutaImagen,
  validarArchivo,
} from './productoImagenes'

const archivo = (nombre: string, tipo: string, tamano = 10) => {
  const f = new File(['x'], nombre, { type: tipo })
  Object.defineProperty(f, 'size', { value: tamano })
  return f
}

const existente = (id: string, posicion: number): ImagenExistente => ({ id, posicion, ruta: `o/p/${id}.png`, url: null })

describe('validarArchivo', () => {
  it('acepta JPG, PNG y WebP dentro del tope', () => {
    for (const tipo of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(validarArchivo(archivo('a', tipo), 0)).toBeNull()
    }
  })

  it('rechaza otros formatos (GIF, SVG) con un mensaje claro', () => {
    expect(validarArchivo(archivo('a.gif', 'image/gif'), 0)).toBe('«a.gif» no es JPG, PNG ni WebP.')
    expect(validarArchivo(archivo('a.svg', 'image/svg+xml'), 0)).toContain('no es JPG, PNG ni WebP')
  })

  it('rechaza más de 2 MB pero admite exactamente 2 MB', () => {
    expect(validarArchivo(archivo('a.png', 'image/png', MAX_BYTES_IMAGEN), 0)).toBeNull()
    expect(validarArchivo(archivo('a.png', 'image/png', MAX_BYTES_IMAGEN + 1), 0)).toBe('«a.png» pesa más de 2 MB.')
  })

  it('rechaza la quinta imagen', () => {
    expect(validarArchivo(archivo('a.png', 'image/png'), 4)).toContain('Ya hay 4 imágenes')
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
