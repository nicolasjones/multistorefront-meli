import { describe, expect, it } from 'vitest'
import { recortar } from './tiendaSeo'

describe('recortar (F-TDA-21, FR-021)', () => {
  it('junta los espacios y no pasa el máximo, con «…» al cortar', () => {
    expect(recortar('  hola    mundo  ', 50)).toBe('hola mundo')
    const r = recortar('a'.repeat(200), 160)
    expect(r.length).toBe(160)
    expect(r.endsWith('…')).toBe(true)
  })

  it('tolera un texto ausente: devuelve cadena vacía en vez de romper la cabecera de SEO', () => {
    expect(recortar(undefined, 160)).toBe('')
    expect(recortar(null, 160)).toBe('')
  })
})
